#include "LD2451Radar.h"

#include <driver/gpio.h>
#include <stdarg.h>

namespace {

// 原廠 115200（使用手冊、實測）；有人回報被改成 256000（ESPHome 元件），其餘依常見程度排
constexpr uint32_t kBauds[]          = {115200, 256000, 230400, 460800, 57600, 38400, 19200, 9600};
constexpr uint8_t  kBaudCount        = sizeof(kBauds) / sizeof(kBauds[0]);
// 每個鮑率最多聽多久：沒有目標時每 1.39～1.67 s 一個空資料框（實測），聽 3.2 s 至少收得到一個完整的
// （剛開埠時可能從資料框中間開始收，第一個不完整）
constexpr uint32_t kSearchWindowMs   = 3200;
constexpr uint32_t kAckGraceMs       = 1200;   // 收到資料框（鮑率對了）之後，再等多久看指令有沒有回覆
constexpr uint32_t kEnableEveryMs    = 500;    // 找鮑率時隔多久送一次「進入設定」
constexpr uint32_t kAckTimeoutMs     = 400;
constexpr uint8_t  kMaxTries         = 3;
constexpr uint32_t kSilentMs         = 4000;   // 這麼久完全沒收到位元組 → 離線（沒電、線掉了）
constexpr uint32_t kNoValidMs        = 15000;  // 有收到位元組、但這麼久都解不出格式正確的資料框 → 重新找鮑率
// 用「有沒有收到位元組」判斷在線：實測約 1/20 的資料框有位元錯誤，連續兩三個空資料框壞掉時不能就說雷達離線
constexpr uint32_t kRetryMs          = 5000;
constexpr uint32_t kMaxRetryMs       = 30000;
constexpr uint32_t kRxOnlyRetryMs    = 30000;  // 只接收模式：隔多久再試一次指令（可能後來接上了 RX）
constexpr uint8_t  kDelayS           = 1;      // 模組的警報延遲用最小值：保持由 ESP32 自己做
constexpr uint8_t  kTriggerCount     = 1;      // 模組的累計觸發用最小值：確認由 ESP32 自己做，不多等
constexpr uint16_t kMaxBytesPerPump  = 256;
constexpr uint8_t  kEnableValue[2]   = {0x01, 0x00};

const char* directionName(uint8_t d) {
  switch (d) {
    case ld2451::kDirectionAway:     return "只回報遠離";
    case ld2451::kDirectionApproach: return "只回報靠近";
    case ld2451::kDirectionBoth:     return "靠近遠離都回報";
    default:                         return "方向未知";
  }
}

}  // namespace

LD2451Radar::LD2451Radar(HardwareSerial& port, const Settings& settings, Print& log)
    : port_(port), settings_(settings), log_(log) {}

// 每行訊息都加上這顆雷達的名稱，兩顆雷達的訊息才分得出來
void LD2451Radar::say(const char* format, ...) {
  char line[192];
  va_list args;
  va_start(args, format);
  vsnprintf(line, sizeof(line), format, args);
  va_end(args);
  log_.printf("[%s] %s\n", settings_.name, line);
}

void LD2451Radar::setDetection(const Detection& d, uint32_t nowMs) {
  const bool same = d.maxDistanceM == detection_.maxDistanceM && d.direction == detection_.direction &&
                    d.minSpeedKmh == detection_.minSpeedKmh && d.snr == detection_.snr;
  if (begun_ && same) return;
  detection_ = d;
  if (!begun_) return;
  if (state_ == State::Online && !receiveOnly_) {
    say("偵測設定改為 %u m、%s、%u km/h、訊噪比 %u，重新寫入", d.maxDistanceM, directionName(d.direction), d.minSpeedKmh,
        d.snr);
    startConfig(Step::Enable, nowMs);
  }
}

void LD2451Radar::begin(uint32_t nowMs) {
  begun_ = true;
  if (settings_.rxPin < 0) {
    state_ = State::Disabled;
    return;
  }
  if (settings_.txPin >= 0) {
    say("LD2451：TX → GPIO%d、RX → GPIO%d，尋找鮑率中...", settings_.rxPin, settings_.txPin);
  } else {
    say("LD2451：TX → GPIO%d，尋找鮑率中...", settings_.rxPin);
  }
  startSearch(nowMs, true);
}

bool LD2451Radar::readFrame(RadarFrame& out) {
  if (queueCount_ == 0) return false;
  out        = queue_[queueHead_];
  queueHead_ = (queueHead_ + 1) % kQueueSize;
  queueCount_--;
  return true;
}

void LD2451Radar::openPort(uint32_t baud) {
  port_.end();
  port_.setRxBufferSize(512);  // 必須在 begin() 之前設定
  port_.begin(baud, SERIAL_8N1, settings_.rxPin, settings_.txPin);
  // 接收腳加內建上拉：實測 LD2451 TX 的高電位偏弱（錯誤都是 1 讀成 0，接收腳有下拉時幾乎每個位元組都錯），
  // 上拉讓閒置與高電位更穩；LD2451 是推挽輸出時不受影響（docs/REAR_RADAR.md §2.3）
  gpio_pullup_en(static_cast<gpio_num_t>(settings_.rxPin));
  gpio_pulldown_dis(static_cast<gpio_num_t>(settings_.rxPin));
  parser_.reset();
  baud_      = baud;
  baudBytes_ = 0;
  badAtOpen_ = badFrames();
}

void LD2451Radar::sendCommand(uint8_t command, const uint8_t* value, size_t len) {
  if (settings_.txPin < 0) return;
  uint8_t frame[ld2451::kMaxCommandFrame];
  const size_t n = ld2451::buildCommand(command, value, len, frame, sizeof(frame));
  if (n > 0) port_.write(frame, n);
}

// 「進入設定」送出後沒收到回覆：補送「離開設定」。雷達可能收到了、只是回覆在線路上壞掉（實測 TX 訊號偏弱），
// 不補送的話雷達會一直停在設定狀態、不再輸出資料框
void LD2451Radar::sendEnableProbe(uint32_t nowMs) {
  sendCommand(ld2451::kCmdEnableConfig, kEnableValue, sizeof(kEnableValue));
  enableSentMs_   = nowMs;
  enablePending_  = settings_.txPin >= 0;
}

void LD2451Radar::update(uint32_t nowMs) {
  if (state_ == State::Disabled) return;
  pumpBytes(nowMs);
  if (enablePending_ && nowMs - enableSentMs_ >= kAckTimeoutMs) {
    enablePending_ = false;
    sendCommand(ld2451::kCmdEndConfig, nullptr, 0);
  }

  switch (state_) {
    case State::Disabled:
      break;
    case State::Searching:
      runSearch(nowMs);
      break;
    case State::Configuring:
      runConfig(nowMs);
      break;
    case State::Online:
      if (nowMs - lastByteMs_ > kSilentMs) {
        goOffline(nowMs, "超過 4 秒沒有資料");
      } else if (nowMs - lastFrameMs_ > kNoValidMs) {
        goOffline(nowMs, "收到的資料都解不出來（鮑率不對或接線不良）");
      } else if (receiveOnly_ && settings_.txPin >= 0 && nowMs - lastRxOnlyTryMs_ >= kRxOnlyRetryMs) {
        lastRxOnlyTryMs_ = nowMs;
        sendEnableProbe(nowMs);  // 有回覆就改成完整模式（handleAck）；沒回覆就補送「離開設定」
      }
      break;
    case State::Offline:
      if (nowMs - stateSinceMs_ >= retryDelayMs_) startSearch(nowMs, false);
      break;
  }
}

void LD2451Radar::pumpBytes(uint32_t nowMs) {
  uint16_t budget = kMaxBytesPerPump;
  while (budget-- > 0 && port_.available() > 0) {
    lastByteMs_ = nowMs;
    baudBytes_++;
    const LD2451FrameType type = parser_.push(static_cast<uint8_t>(port_.read()));
    if (type == LD2451FrameType::Report) {
      handleReport(nowMs);
    } else if (type == LD2451FrameType::Ack) {
      LD2451Ack ack;
      if (decodeLD2451Ack(parser_.payload(), parser_.length(), ack)) {
        lastFrameMs_ = nowMs;
        handleAck(ack, nowMs);
      }
    }
  }
}

void LD2451Radar::handleReport(uint32_t nowMs) {
  RadarFrame f;
  if (!decodeLD2451Report(parser_.payload(), parser_.length(), f)) {
    decodeErrors_++;  // 位元錯誤：丟掉這一筆
    return;
  }
  lastFrameMs_ = nowMs;
  if (!heardReport_) firstReportMs_ = nowMs;
  heardReport_ = true;
  if (state_ != State::Online) return;  // 找鮑率、設定中收到的不算（設定中雷達本來就不送）
  frames_++;
  if (queueCount_ == kQueueSize) {  // 滿了丟最舊的
    queueHead_ = (queueHead_ + 1) % kQueueSize;
    queueCount_--;
  }
  queue_[(queueHead_ + queueCount_) % kQueueSize] = f;
  queueCount_++;
}

void LD2451Radar::handleAck(const LD2451Ack& ack, uint32_t nowMs) {
  if (ack.command == ld2451::kCmdEnableConfig) enablePending_ = false;
  if (ack.command == ld2451::kCmdEnableConfig && ack.ok && (state_ == State::Searching || state_ == State::Online)) {
    // 指令有回覆：完整模式。雷達已在設定狀態，接著讀韌體與設定
    if (state_ == State::Searching) say("%lu bps，指令有回覆", static_cast<unsigned long>(baud_));
    else say("指令開始有回覆（剛接上 LD2451 RX？），改成完整模式");
    goodBaudIndex_ = baudIndex_;
    receiveOnly_ = false;
    startConfig(Step::ReadFirmware, nowMs);
    return;
  }
  if (state_ != State::Configuring || !waitingAck_ || ack.command != stepCommand(step_)) return;
  waitingAck_ = false;
  if (!ack.ok) {
    say("指令 0x%02X 失敗", ack.command);
    finishConfig(nowMs, false);
    return;
  }

  const uint8_t* d = ack.data;
  switch (step_) {
    case Step::ReadFirmware:
      if (ack.dataLen >= 8) {
        snprintf(firmware_, sizeof(firmware_), "V%u.%02u.%02X%02X%02X%02X", d[3], d[2], d[7], d[6], d[5], d[4]);
        say("韌體 %s", firmware_);
      }
      break;
    case Step::GetTarget:
      if (ack.dataLen >= 4) {
        say("讀回目標參數：最大距離 %u m、方向 %u、最低速度 %u km/h、延遲 %u s", d[0], d[1], d[2], d[3]);
        needTarget_ = d[0] != detection_.maxDistanceM || d[1] != detection_.direction ||
                      d[2] != detection_.minSpeedKmh || d[3] != kDelayS;
      }
      break;
    case Step::GetSensitivity:
      if (ack.dataLen >= 2) {
        say("讀回靈敏度：累計觸發 %u 次、訊噪比門檻 %u", d[0], d[1]);
        needSens_ = d[0] != kTriggerCount || d[1] != detection_.snr;
      }
      break;
    case Step::SetTarget:
      say("已寫入目標參數：%u m、%s、%u km/h、延遲 %u s", detection_.maxDistanceM, directionName(detection_.direction),
          detection_.minSpeedKmh, kDelayS);
      break;
    case Step::SetSensitivity:
      say("已寫入靈敏度：累計觸發 %u 次、訊噪比門檻 %u", kTriggerCount, detection_.snr);
      break;
    case Step::Enable:
    case Step::End:
      break;
  }
  nextStep(nowMs);
}

// ---------------------------------------------------------------- 找鮑率
void LD2451Radar::startSearch(uint32_t nowMs, bool fromBeginning) {
  state_        = State::Searching;
  stateSinceMs_ = nowMs;
  baudIndex_    = fromBeginning ? 0 : goodBaudIndex_;  // 重試從上次成功的鮑率開始（還沒成功過就是原廠的 115200）
  baudTried_    = 0;
  heardReport_  = false;
  receiveOnly_  = false;
  lastEnableMs_ = nowMs - kEnableEveryMs;  // 馬上送第一次
  openPort(kBauds[baudIndex_]);
}

void LD2451Radar::runSearch(uint32_t nowMs) {
  if (settings_.txPin >= 0 && nowMs - lastEnableMs_ >= kEnableEveryMs) {
    lastEnableMs_ = nowMs;
    sendEnableProbe(nowMs);
  }
  // 收得到資料框（鮑率對了）、但指令等了一陣子都沒有回覆：只接了 LD2451 TX
  if (heardReport_ && (settings_.txPin < 0 || nowMs - firstReportMs_ >= kAckGraceMs)) {
    goodBaudIndex_    = baudIndex_;
    receiveOnly_      = true;
    lastRxOnlyTryMs_  = nowMs;
    state_            = State::Online;
    stateSinceMs_     = nowMs;
    failures_         = 0;
    say("%lu bps 收得到資料，但指令沒有回覆：只接收，使用雷達目前存的設定"
        "（要讓 ESP32 寫入設定，把 LD2451 RX 接到 GPIO%d）",
        static_cast<unsigned long>(baud_), settings_.txPin);
    return;
  }
  if (heardReport_ || nowMs - stateSinceMs_ < kSearchWindowMs) return;

  if (baudBytes_ > 0) {
    // 有收到東西但解不出資料框：鮑率不對，或線路有位元錯誤（原廠 115200 時多半是後者）
    say("%lu bps：收到 %lu bytes、%lu 個格式錯誤的資料框，沒有解出資料框", static_cast<unsigned long>(baud_),
        static_cast<unsigned long>(baudBytes_), static_cast<unsigned long>(badFrames() - badAtOpen_));
  }
  if (++baudTried_ >= kBaudCount) {
    goOffline(nowMs, "每個鮑率都沒有收到資料（檢查 5V、GND、LD2451 TX 是否接到 ESP32 RX）");
    return;
  }
  baudIndex_    = static_cast<uint8_t>((baudIndex_ + 1) % kBaudCount);
  stateSinceMs_ = nowMs;
  lastEnableMs_ = nowMs - kEnableEveryMs;
  openPort(kBauds[baudIndex_]);
}

// ---------------------------------------------------------------- 寫入設定
uint8_t LD2451Radar::stepCommand(Step s) {
  switch (s) {
    case Step::Enable:         return ld2451::kCmdEnableConfig;
    case Step::ReadFirmware:   return ld2451::kCmdReadFirmware;
    case Step::GetTarget:      return ld2451::kCmdGetTarget;
    case Step::GetSensitivity: return ld2451::kCmdGetSensitivity;
    case Step::SetTarget:      return ld2451::kCmdSetTarget;
    case Step::SetSensitivity: return ld2451::kCmdSetSensitivity;
    case Step::End:            return ld2451::kCmdEndConfig;
  }
  return 0;
}

void LD2451Radar::startConfig(Step first, uint32_t nowMs) {
  state_        = State::Configuring;
  stateSinceMs_ = nowMs;
  needTarget_   = false;
  needSens_     = false;
  step_         = first;
  tries_        = 0;
  sendStep(nowMs);
}

void LD2451Radar::sendStep(uint32_t nowMs) {
  switch (step_) {
    case Step::Enable:
      sendCommand(ld2451::kCmdEnableConfig, kEnableValue, sizeof(kEnableValue));
      break;
    case Step::SetTarget: {
      const uint8_t v[4] = {detection_.maxDistanceM, detection_.direction, detection_.minSpeedKmh, kDelayS};
      sendCommand(ld2451::kCmdSetTarget, v, sizeof(v));
      break;
    }
    case Step::SetSensitivity: {
      const uint8_t v[4] = {kTriggerCount, detection_.snr, 0, 0};
      sendCommand(ld2451::kCmdSetSensitivity, v, sizeof(v));
      break;
    }
    default:
      sendCommand(stepCommand(step_), nullptr, 0);
      break;
  }
  waitingAck_ = true;
  stepSentMs_ = nowMs;
}

void LD2451Radar::runConfig(uint32_t nowMs) {
  if (!waitingAck_ || nowMs - stepSentMs_ < kAckTimeoutMs) return;
  if (++tries_ < kMaxTries) {
    sendStep(nowMs);
    return;
  }
  say("指令 0x%02X 沒有回覆", stepCommand(step_));
  finishConfig(nowMs, false);
}

void LD2451Radar::nextStep(uint32_t nowMs) {
  switch (step_) {
    case Step::Enable:         step_ = Step::ReadFirmware; break;
    case Step::ReadFirmware:   step_ = Step::GetTarget; break;
    case Step::GetTarget:      step_ = Step::GetSensitivity; break;
    case Step::GetSensitivity: step_ = needTarget_ ? Step::SetTarget : (needSens_ ? Step::SetSensitivity : Step::End); break;
    case Step::SetTarget:      step_ = needSens_ ? Step::SetSensitivity : Step::End; break;
    case Step::SetSensitivity: step_ = Step::End; break;
    case Step::End:
      finishConfig(nowMs, true);
      return;
  }
  tries_ = 0;
  sendStep(nowMs);
}

void LD2451Radar::finishConfig(uint32_t nowMs, bool ok) {
  waitingAck_ = false;
  if (!ok) sendCommand(ld2451::kCmdEndConfig, nullptr, 0);  // 盡量讓雷達離開設定狀態、恢復輸出
  state_        = State::Online;
  stateSinceMs_ = nowMs;
  lastFrameMs_  = nowMs;  // 設定期間雷達不送資料框，從現在開始重新計算
  lastByteMs_   = nowMs;
  failures_     = 0;
  say("%s", ok ? "設定完成，開始讀取資料" : "設定沒有完成，先用雷達目前的設定讀取資料");
}

void LD2451Radar::goOffline(uint32_t nowMs, const char* reason) {
  state_        = State::Offline;
  stateSinceMs_ = nowMs;
  queueCount_   = 0;
  receiveOnly_  = false;
  if (failures_ < 8) failures_++;
  retryDelayMs_ = kRetryMs << (failures_ - 1);
  if (retryDelayMs_ > kMaxRetryMs) retryDelayMs_ = kMaxRetryMs;
  say("離線：%s；%lu 秒後重試", reason, static_cast<unsigned long>(retryDelayMs_ / 1000));
}
