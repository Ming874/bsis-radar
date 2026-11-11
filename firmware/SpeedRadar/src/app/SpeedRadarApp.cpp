#include "SpeedRadarApp.h"

#include "../comm/CommandParser.h"
#include "../comm/Telemetry.h"

namespace {
constexpr uint32_t kFrameStaleMs     = 1000;  // 超過 1 秒沒有新資料框，不再送舊的原始值
constexpr uint32_t kRearBusyMs       = 100;   // 後方有目標或警示中：REAR 行每 0.1 秒
constexpr uint32_t kRearIdleMs       = 500;   // 後方沒有目標：每 0.5 秒（網頁用來確認後方雷達還在）
constexpr uint32_t kRearOfflineMs    = 1000;  // 後方雷達離線：每 1 秒送一行 REAR ON=0
}

SpeedRadarApp::SpeedRadarApp(const Wiring& w)
    : console_(w.console),
      radar_(w.radarPort, w.radar, w.console),
      rear_(w.rearPort, w.rear, w.console),
      bleConfig_(w.ble),
      led_(w.ledPin),
      wheel_(w.wheelPin),
      config_(SpeedConfig::defaults()),
      heartbeatMs_(w.heartbeatMs),
      firmwareVersion_(w.firmwareVersion),
      allowBleConfig_(w.allowBleConfig) {}

void SpeedRadarApp::begin() {
  led_.begin();
  console_.printf("\n=== BSIS 對地測速雷達 v%s ===\n", firmwareVersion_);

  store_.begin();
  config_ = store_.load();
  console_.print("[設定] ");
  sendConfig(Channel::Usb);

  ble_.begin(bleConfig_);  // 先開藍牙：雷達還沒接好也能用手機確認 ESP32 有在跑
  console_.printf("[藍牙] 已開始廣播：%s\n", bleConfig_.deviceName);

  applyRadarDetection(millis());  // 地面距離窗口與門檻：begin() 前只記下來，begin() 時一起寫入
  radar_.begin(millis());
  applyRearDetection(millis());   // 後方雷達的偵測距離、最低速度、訊噪比
  rear_.begin(millis());
  wheel_.begin();  // 輪速感測器（參考值）：收到第一個脈衝後才開始回報
  console_.println("輸入 HELP 查看指令。每一筆雷達資料框輸出一行遙測，欄位見 docs/PROTOCOL.md");
}

void SpeedRadarApp::loop() {
  const uint32_t now = millis();

  pumpRadar(now);
  pumpRear(now);
  estimator_.update(now);  // 逾時（保持 → 靜止 / 訊號中斷）與里程
  uint32_t pulseMs;
  while (wheel_.popPulse(pulseMs)) wheelSpeed_.onPulse(pulseMs);
  pumpCommands();

  if (now - lastPublishMs_ >= heartbeatMs_) publishTelemetry(now);  // 雷達沒資料時的心跳
  led_.update(now, ledPattern());
}

// ---------------------------------------------------------------- 雷達資料
void SpeedRadarApp::pumpRadar(uint32_t nowMs) {
  radar_.update(nowMs);

  const bool online = radar_.online();
  if (!online) {
    if (radarWasOnline_) estimator_.setRadarOffline(nowMs);  // 離線：速度改為未知，避免網頁顯示過時的值
    hasFrame_ = false;
  }
  radarWasOnline_ = online;

  RadarMeasurement m;
  while (radar_.readMeasurement(m)) {
    lastResult_  = estimator_.onFrame(m, nowMs, config_);
    if (lastResult_.limitExceeded) raiseRadialLimit(fabsf(m.speedMps));
    lastRaw_     = m;
    hasFrame_    = true;
    lastFrameMs_ = nowMs;
    publishTelemetry(nowMs);  // 每一筆資料框送一行：網頁才能完整記錄
  }
  if (hasFrame_ && nowMs - lastFrameMs_ > kFrameStaleMs) hasFrame_ = false;
}

// 量到明顯超過 VMAX 的徑向速度，證明 C4001 的上限比設定高（會折疊的雷達不可能回報超過上限的值）：
// 先調到資料框說明的 10 m/s，量到更大再往上；存進 NVS 並通知網頁（docs/ALGORITHM.md §2）
void SpeedRadarApp::raiseRadialLimit(float observedMps) {
  float next = observedMps < 10.0f ? 10.0f : ceilf(observedMps * 1.1f);
  if (next > limits::kVmaxHi) next = limits::kVmaxHi;
  if (next <= config_.radialLimitMps) return;
  console_.printf("[雷達] 量到徑向速度 %.2f m/s，超過 VMAX %.2f：雷達的測速上限比設定高，自動把 VMAX 調為 %.1f\n",
                  observedMps, config_.radialLimitMps, next);
  config_.radialLimitMps = next;
  store_.save(config_);
  broadcastConfig();
}

void SpeedRadarApp::applyRadarDetection(uint32_t nowMs) {
  const GroundWindow w = groundWindow(config_);
  radar_.setDetection({w.radarMinM, w.radarMaxM, config_.radarThreshold}, nowMs);
}

// ---------------------------------------------------------------- 後方來車
void SpeedRadarApp::pumpRear(uint32_t nowMs) {
  rear_.update(nowMs);
  if (!rear_.enabled()) return;

  const bool online = rear_.online();
  if (!online && rearWasOnline_) {
    threat_.reset();  // 離線：不能說後面沒車，也不能沿用舊的警示；網頁另外顯示「後方雷達離線」
    hasRearFrame_ = false;
  }
  rearWasOnline_ = online;

  RearFrame f;
  while (rear_.readFrame(f)) {
    threat_.onFrame(f, nowMs, config_.rear);
    lastRearFrame_   = f;
    hasRearFrame_    = true;
    lastRearFrameMs_ = nowMs;
    rearFrames_++;
  }
  if (hasRearFrame_ && nowMs - lastRearFrameMs_ > kFrameStaleMs) hasRearFrame_ = false;
  threat_.update(nowMs, config_.rear);

  if (threat_.trendDisagree() != rearDisagreeSeen_) {
    rearDisagreeSeen_ = threat_.trendDisagree();
    console_.printf("[後方] 一台回報為「靠近」的目標距離卻在變遠（第 %lu 次，已排除）：方向判斷可能有誤，見 docs/REAR_RADAR.md §2\n",
                    static_cast<unsigned long>(rearDisagreeSeen_));
  }

  if (threat_.consumeLevelChange()) {
    logRearLevel();
    publishRear(nowMs);  // 等級改變立刻通知，不等下一個週期
    return;
  }
  const bool busy = threat_.state().level != RearLevel::Safe || (hasRearFrame_ && lastRearFrame_.count > 0);
  const uint32_t period = !online ? kRearOfflineMs : (busy ? kRearBusyMs : kRearIdleMs);
  if (nowMs - lastRearPublishMs_ >= period) publishRear(nowMs);
}

void SpeedRadarApp::applyRearDetection(uint32_t nowMs) {
  rear_.setDetection({config_.rear.detectRangeM(), config_.rear.minSpeedKmh, config_.rear.snr}, nowMs);
}

void SpeedRadarApp::logRearLevel() {
  const RearState& r = threat_.state();
  switch (r.level) {
    case RearLevel::Safe:
      console_.println("[後方] 安全");
      break;
    case RearLevel::Caution:
    case RearLevel::Danger:
      if (r.hasLead) {
        console_.printf("[後方] %s：來車 %.0f m、接近 %.0f km/h、%.1f 秒到達（第 %lu 次警示）\n",
                        r.level == RearLevel::Danger ? "危險" : "注意", r.distanceM, r.closingMps * 3.6f,
                        r.ttcS, static_cast<unsigned long>(r.alerts));
      } else {
        console_.printf("[後方] %s（保持中）\n", r.level == RearLevel::Danger ? "危險" : "注意");
      }
      break;
  }
}

void SpeedRadarApp::publishRear(uint32_t nowMs) {
  lastRearPublishMs_ = nowMs;
  RearSnapshot s;
  s.online      = rear_.online();
  s.receiveOnly = rear_.receiveOnly();
  s.state       = threat_.state();
  s.frame       = rearFrames_;
  s.hasFrame    = hasRearFrame_;
  s.raw         = lastRearFrame_;
  char line[kRearLineMax];
  if (formatRear(s, line, sizeof(line)) == 0) return;
  ble_.sendLine(line);
  console_.print(line);
}

// ---------------------------------------------------------------- 指令
void SpeedRadarApp::pumpCommands() {
  if (ble_.consumeConnectEvent()) console_.println("[藍牙] 手機已連線");
  if (ble_.consumeDisconnectEvent()) console_.println("[藍牙] 手機已斷線，重新廣播中");

  char text[BleLink::kMaxCommandLen + 1];
  while (ble_.popCommand(text, sizeof(text))) handleCommand(text, Channel::Ble);
  pollUsbSerial();
}

void SpeedRadarApp::pollUsbSerial() {
  while (console_.available() > 0) {
    const char c = static_cast<char>(console_.read());
    if (c == '\n' || c == '\r') {
      usbLine_[usbLen_] = '\0';
      if (usbLen_ > 0) handleCommand(usbLine_, Channel::Usb);
      usbLen_ = 0;
    } else if (usbLen_ < sizeof(usbLine_) - 1) {
      usbLine_[usbLen_++] = c;
    }
  }
}

void SpeedRadarApp::handleCommand(const char* text, Channel from) {
  if (from == Channel::Ble) console_.printf("[藍牙指令] %s\n", text);

  const Command cmd = parseCommand(text);
  switch (cmd.type) {
    case CommandType::None:
      return;
    case CommandType::Get:
      sendConfig(from);
      return;
    case CommandType::Help:
      reply(from, kHelpText);
      return;
    default:
      break;
  }

  // 安全：可以關閉「藍牙改設定」，避免附近的人用手機亂改
  if (from == Channel::Ble && !allowBleConfig_ && (isConfigCommand(cmd.type) || cmd.type == CommandType::Reboot)) {
    reply(from, "ERR settings over Bluetooth are disabled, use USB\n");
    return;
  }

  switch (cmd.type) {
    case CommandType::Reboot:
      reply(from, "OK reboot\n");
      delay(200);  // 讓回覆送出去
      ESP.restart();
      return;
    case CommandType::Unknown:
      reply(from, "ERR unknown command, try HELP\n");
      return;
    default:
      break;
  }

  const char* error = nullptr;
  if (!applyCommand(cmd, config_, &error)) {
    char line[72];
    snprintf(line, sizeof(line), "ERR %s\n", error);
    reply(from, line);
    return;
  }

  const bool saved = store_.save(config_);
  reply(from, saved ? "OK saved\n" : "OK applied (flash save failed)\n");
  broadcastConfig();  // 網頁與序列埠都更新成新設定
  // 安裝幾何或門檻改了：地面距離窗口要重新寫進雷達（約 4 秒內沒有資料，網頁會短暫顯示雷達離線）
  applyRadarDetection(millis());
  applyRearDetection(millis());  // 後方雷達的設定沒變就不會重寫
}

void SpeedRadarApp::reply(Channel to, const char* line) {
  if (to == Channel::Ble) {
    ble_.sendLine(line);
    console_.print("[回覆手機] ");
  }
  console_.print(line);
}

void SpeedRadarApp::sendConfig(Channel to) {
  char line[kConfigLineMax];
  if (formatConfig(config_, firmwareVersion_, line, sizeof(line)) > 0) reply(to, line);
}

void SpeedRadarApp::broadcastConfig() {
  char line[kConfigLineMax];
  if (formatConfig(config_, firmwareVersion_, line, sizeof(line)) == 0) return;
  if (ble_.connected()) ble_.sendLine(line);
  console_.print(line);
}

// ---------------------------------------------------------------- 輸出
void SpeedRadarApp::publishTelemetry(uint32_t nowMs) {
  lastPublishMs_ = nowMs;

  TelemetrySnapshot s;
  s.radarOnline    = radar_.online();
  s.state          = estimator_.state();
  s.hasSpeed       = estimator_.hasSpeed();
  s.speedMps       = estimator_.speedMps();
  s.sigmaMps       = estimator_.sigmaMps();
  s.qualityPct     = estimator_.qualityPct();
  s.wrongDirPct    = estimator_.wrongDirectionPct();
  s.frame          = estimator_.frames();
  s.hasFrame       = hasFrame_;
  s.raw            = lastRaw_;
  s.result         = lastResult_;
  s.radarDistanceM = estimator_.distanceM();
  s.hasWheel       = wheelSpeed_.seen();
  s.wheelMps       = wheelSpeed_.speedMps(nowMs, config_.wheelMm);
  s.wheelDistanceM = wheelSpeed_.revolutions() * (config_.wheelMm / 1000.0);
  s.uptimeS        = nowMs / 1000;

  char line[kTelemetryLineMax];
  if (formatTelemetry(s, line, sizeof(line)) == 0) return;
  ble_.sendLine(line);
  console_.print(line);  // USB 也輸出同一行：序列埠記錄可以用同一套工具分析
}

LedPattern SpeedRadarApp::ledPattern() const {
  if (!radar_.online()) return LedPattern::DoubleBlink;
  if (estimator_.state() == SpeedState::Tracking) return LedPattern::Solid;  // 雷達正在量到地面速度
  return ble_.connected() ? LedPattern::FastBlink : LedPattern::SlowBlink;
}
