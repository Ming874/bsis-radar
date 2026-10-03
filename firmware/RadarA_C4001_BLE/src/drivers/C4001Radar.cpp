#include "C4001Radar.h"

#include <string.h>

namespace {

constexpr uint32_t kRetryMs          = 3000;   // 失敗後隔多久重試
constexpr uint32_t kMaxRetryMs       = 60000;  // 完整設定連續失敗時，重試間隔上限
constexpr uint16_t kStopWaitMs       = 1100;   // sensorStop 後等待（同函式庫：delay 1000 + 讀取 100）
constexpr uint16_t kStopRetryWaitMs  = 500;    // sensorStop 沒回覆時，隔多久再送（同函式庫：400 + 100）
constexpr uint8_t  kMaxStopTries     = 8;      // sensorStop 最多送幾次
constexpr uint8_t  kNoBytesFailTries = 2;      // 送了幾次都「完全沒收到任何位元組」→ 判定沒接上
constexpr uint32_t kVerifyMs         = 3000;   // 設定完成後，最多等多久確認雷達有輸出
constexpr uint32_t kQuietMs          = 5000;   // 雷達本來就安靜時：多久沒資料才送心跳
constexpr uint32_t kQuietStreamingMs = 1000;   // 雷達本來持續輸出、突然停了：1 秒就送心跳
constexpr uint32_t kStreamingGapMs   = 1000;   // 最後一個位元組離上一個測速資料框多近，算「持續輸出中」
constexpr uint32_t kProbeTimeoutMs   = 1500;   // 心跳送出後多久沒回應判定離線
constexpr uint32_t kPresenceReinit   = 3;      // 上線中收到幾個「存在模式」資料框就重新完整設定
constexpr uint32_t kBadFrameFault    = 10;     // 連續這麼多壞資料框、又超過 2 秒沒有好資料 → 判定異常
constexpr uint32_t kBadFrameFaultMs  = 2000;
constexpr uint16_t kMaxBytesPerPump  = 256;    // 每次 update 最多處理幾個位元組，避免占用太久

constexpr const char* kStopCommand  = "sensorStop";
constexpr const char* kStartCommand = "sensorStart";
constexpr const char* kSaveCommand  = "saveConfig";

}  // namespace

C4001Radar::C4001Radar(HardwareSerial& port, const Settings& settings, Print& log)
    : port_(port), settings_(settings), log_(log) {
  snprintf(rangeCmd_, sizeof(rangeCmd_), "setRange %.1f %.1f", settings_.minRangeM, settings_.maxRangeM);
  snprintf(thrCmd_, sizeof(thrCmd_), "setThrFactor %u", static_cast<unsigned>(settings_.thrFactor));

  // 與 DFRobot 函式庫 setSensorMode() / setDetectThres() / setFrettingDetection()
  // 送出的指令字串、順序、間隔相同（每組：停止 → 設定 → 存檔 → 啟動）
  const Step full[kFullStepCount] = {
      {kStopCommand, kStopWaitMs, true},  {"setRunApp 1", 100, false},      {kSaveCommand, 500, false},
      {kStartCommand, 100, false},                                          // ① 切到測速測距模式
      {kStopCommand, kStopWaitMs, true},  {rangeCmd_, 200, false},          {thrCmd_, 100, false},
      {kSaveCommand, 100, false},         {kStartCommand, 100, false},      // ② 偵測範圍與門檻
      {kStopCommand, kStopWaitMs, true},  {"setMicroMotion 0", 100, false}, {kSaveCommand, 100, false},
      {kStartCommand, 100, false},                                          // ③ 關閉微動偵測，減少靜物誤報
  };
  memcpy(fullPlan_, full, sizeof(fullPlan_));
  quickPlan_[0] = {kStartCommand, 100, false};  // 快速重連：設定已存在雷達裡，只要確保它在量測
}

void C4001Radar::begin(uint32_t nowMs) {
  port_.setRxBufferSize(512);  // 必須在 begin() 之前設定
  port_.begin(settings_.baud, SERIAL_8N1, settings_.rxPin, settings_.txPin);
  startConfiguring(nowMs);
}

const char* C4001Radar::stateName() const {
  switch (state_) {
    case State::Offline:     return "OFFLINE";
    case State::Configuring: return "CONFIG";
    case State::Verifying:   return "VERIFY";
    case State::Online:      return "ONLINE";
    case State::Probing:     return "PROBE";
  }
  return "?";
}

bool C4001Radar::readMeasurement(RadarMeasurement& out) {
  if (queueCount_ == 0) return false;
  out        = queue_[queueHead_];
  queueHead_ = (queueHead_ + 1) % kQueueSize;
  queueCount_--;
  return true;
}

void C4001Radar::update(uint32_t nowMs) {
  pumpBytes(nowMs);

  switch (state_) {
    case State::Offline:
      if (nowMs - stateSinceMs_ >= retryDelayMs_) startConfiguring(nowMs);
      break;

    case State::Configuring:
      runConfigStep(nowMs);
      break;

    case State::Verifying:
      if (presenceFrames_ - presenceFramesAtVerify_ >= 2) {
        needFullConfig_ = true;
        fail("雷達在存在模式，需要重新完整設定", nowMs);
      } else if (speedFrames_ != speedFramesAtVerify_) {
        goOnline(nowMs, fullAttempt_ ? "初始化完成，開始讀取測速資料" : "重新連線成功");
      } else if (nowMs - stateSinceMs_ >= kVerifyMs) {
        // 有回應但沒有資料框：C4001 前方沒有移動物體時可能不輸出，先視為上線
        if (bytesReceived_ != bytesAtVerify_) goOnline(nowMs, "雷達有回應，尚未輸出測速資料框（前方可能沒有移動物體）");
        else fail("雷達沒有任何回應", nowMs);
      }
      break;

    case State::Online: {
      if (presenceWhileOnline_ >= kPresenceReinit) {
        log_.println("[Radar A] 收到存在模式資料框，重新完整設定雷達");
        needFullConfig_ = true;
        startConfiguring(nowMs);
        break;
      }
      if (badFrames_ - badFramesAtLastSpeed_ >= kBadFrameFault && nowMs - lastSpeedFrameMs_ > kBadFrameFaultMs) {
        fail("收到的資料框都無法解析", nowMs);
        break;
      }
      // 原本持續輸出、突然停了 → 很快就確認；本來就安靜 → 5 秒才確認
      const bool     streaming = speedFrames_ > 0 && (lastByteMs_ - lastSpeedFrameMs_) <= kStreamingGapMs;
      const uint32_t quiet     = streaming ? kQuietStreamingMs : kQuietMs;
      if (nowMs - lastByteMs_ >= quiet) {
        send(kStartCommand);  // 心跳：確保雷達在量測，任何回覆都代表連線正常
        bytesAtProbe_ = bytesReceived_;
        enterState(State::Probing, nowMs);
      }
      break;
    }

    case State::Probing:
      if (bytesReceived_ != bytesAtProbe_) {
        enterState(State::Online, nowMs);
      } else if (nowMs - stateSinceMs_ >= kProbeTimeoutMs) {
        fail("雷達沒有回應心跳（接線鬆脫或斷電？）", nowMs);
      }
      break;
  }
}

void C4001Radar::pumpBytes(uint32_t nowMs) {
  for (uint16_t budget = kMaxBytesPerPump; budget > 0 && port_.available() > 0; budget--) {
    const int value = port_.read();
    if (value < 0) break;
    const char c = static_cast<char>(value);
    bytesReceived_++;
    lastByteMs_ = nowMs;
    rememberEcho(c);

    RadarMeasurement m;
    const C4001FrameType type = parser_.feed(c, m);
    if (type != C4001FrameType::None) handleFrame(type, m, nowMs);
  }
}

void C4001Radar::handleFrame(C4001FrameType type, const RadarMeasurement& m, uint32_t nowMs) {
  switch (type) {
    case C4001FrameType::Speed:
      speedFrames_++;
      lastSpeedFrameMs_     = nowMs;
      badFramesAtLastSpeed_ = badFrames_;
      if (!online()) return;  // 設定過程中的資料不交給演算法
      if (queueCount_ == kQueueSize) {  // 佇列滿了：丟掉最舊的，永遠保留最新資料
        queueHead_ = (queueHead_ + 1) % kQueueSize;
        queueCount_--;
      }
      queue_[(queueHead_ + queueCount_) % kQueueSize] = m;
      queueCount_++;
      break;
    case C4001FrameType::Presence:
      presenceFrames_++;
      if (online()) presenceWhileOnline_++;
      break;
    case C4001FrameType::Invalid:
      badFrames_++;
      break;
    case C4001FrameType::None:
      break;
  }
}

// 記住最近收到的文字，用來偵測雷達對 sensorStop 的回覆
void C4001Radar::rememberEcho(char c) {
  if (echoLen_ == sizeof(echo_) - 1) {
    memmove(echo_, echo_ + 1, echoLen_ - 1);
    echoLen_--;
  }
  echo_[echoLen_++] = c;
  echo_[echoLen_]   = '\0';

  const size_t n = strlen(kStopCommand);
  if (c == kStopCommand[n - 1] && echoLen_ >= n && strcmp(echo_ + echoLen_ - n, kStopCommand) == 0) {
    stopEchoSeen_ = true;
  }
}

void C4001Radar::startConfiguring(uint32_t nowMs) {
  initAttempts_++;
  fullAttempt_      = needFullConfig_;
  savedThisAttempt_ = false;
  plan_             = fullAttempt_ ? fullPlan_ : quickPlan_;
  planLength_       = fullAttempt_ ? kFullStepCount : 1;
  log_.printf(fullAttempt_ ? "[Radar A] 初始化中（第 %lu 次，寫入設定）...\n" : "[Radar A] 重新連線中（第 %lu 次）...\n",
              static_cast<unsigned long>(initAttempts_));

  clearQueue();
  stepIndex_          = 0;
  stepTries_          = 0;
  bytesAtConfigStart_ = bytesReceived_;
  parser_.reset();
  enterState(State::Configuring, nowMs);
  sendStep(nowMs);
}

void C4001Radar::sendStep(uint32_t nowMs) {
  const Step& step = plan_[stepIndex_];
  if (step.needStopEcho) stopEchoSeen_ = false;
  if (stepIndex_ + 1 == planLength_) {
    // 最後一步（sensorStart）送出「之前」記下計數：雷達對它的回覆也算有回應
    speedFramesAtVerify_    = speedFrames_;
    presenceFramesAtVerify_ = presenceFrames_;
    bytesAtVerify_          = bytesReceived_;
  }
  if (strcmp(step.command, kSaveCommand) == 0) savedThisAttempt_ = true;
  send(step.command);
  stepSentMs_ = nowMs;
  stepWaitMs_ = (stepTries_ == 0) ? step.waitMs : kStopRetryWaitMs;
}

void C4001Radar::runConfigStep(uint32_t nowMs) {
  if (nowMs - stepSentMs_ < stepWaitMs_) return;

  const Step& step = plan_[stepIndex_];
  if (step.needStopEcho && !stopEchoSeen_) {
    stepTries_++;
    if (stepTries_ >= kNoBytesFailTries && bytesReceived_ == bytesAtConfigStart_) {
      fail("雷達沒有回應（檢查接線與電源）", nowMs);
    } else if (stepTries_ >= kMaxStopTries) {
      fail("雷達沒有回覆 sensorStop", nowMs);
    } else {
      sendStep(nowMs);  // 再送一次同一步
    }
    return;
  }

  stepIndex_++;
  stepTries_ = 0;
  if (stepIndex_ < planLength_) {
    sendStep(nowMs);
    return;
  }

  if (fullAttempt_) log_.printf("[Radar A] 設定完成：%s，%s，關閉微動偵測\n", rangeCmd_, thrCmd_);
  enterState(State::Verifying, nowMs);  // 確認雷達真的有在輸出
}

void C4001Radar::goOnline(uint32_t nowMs, const char* message) {
  log_.printf("[Radar A] %s\n", message);
  if (fullAttempt_) {
    needFullConfig_ = false;  // 設定已存進雷達，之後斷線重連不必再寫 flash
    fullFailures_   = 0;
  }
  badFramesAtLastSpeed_ = badFrames_;
  lastSpeedFrameMs_     = nowMs;
  enterState(State::Online, nowMs);
}

void C4001Radar::enterState(State s, uint32_t nowMs) {
  state_        = s;
  stateSinceMs_ = nowMs;
  if (s == State::Online) presenceWhileOnline_ = 0;
}

void C4001Radar::fail(const char* reason, uint32_t nowMs) {
  // 寫過 flash 的完整設定失敗：重試間隔加倍，避免一直寫壞雷達的 flash
  if (savedThisAttempt_ && (state_ == State::Configuring || state_ == State::Verifying)) {
    if (fullFailures_ < 5) fullFailures_++;
    retryDelayMs_ = kRetryMs << (fullFailures_ - 1);
    if (retryDelayMs_ > kMaxRetryMs) retryDelayMs_ = kMaxRetryMs;
  } else {
    retryDelayMs_ = kRetryMs;
  }
  savedThisAttempt_ = false;
  log_.printf("[Radar A] %s，%lu 秒後重試\n", reason, static_cast<unsigned long>(retryDelayMs_ / 1000));
  clearQueue();
  enterState(State::Offline, nowMs);
}

void C4001Radar::clearQueue() {
  queueHead_  = 0;
  queueCount_ = 0;
}

void C4001Radar::send(const char* command) {
  port_.print(command);  // 與函式庫相同：不加換行，雷達以停頓分隔指令
}
