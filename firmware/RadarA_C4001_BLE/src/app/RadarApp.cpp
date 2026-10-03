#include "RadarApp.h"

#include "../comm/CommandParser.h"
#include "../comm/Telemetry.h"

RadarApp::RadarApp(const Wiring& w)
    : console_(w.console),
      radar_(w.radarPort, w.radar, w.console),
      bleConfig_(w.ble),
      led_(w.ledPin),
      config_(DetectionConfig::defaults()),
      telemetryPeriodMs_(w.telemetryPeriodMs),
      debugPeriodMs_(w.debugPeriodMs),
      firmwareVersion_(w.firmwareVersion),
      allowBleConfig_(w.allowBleConfig) {}

void RadarApp::begin() {
  led_.begin();
  console_.printf("\n=== Radar A 後方來車偵測 v%s ===\n", firmwareVersion_);

  store_.begin();
  config_ = store_.load();
  console_.print("[設定] ");
  sendConfig(Channel::Usb);

  ble_.begin(bleConfig_);  // 先開藍牙：雷達還沒接好也能用手機確認 ESP32 有在跑
  console_.printf("[藍牙] 已開始廣播：%s\n", bleConfig_.deviceName);

  radar_.begin(millis());
  console_.println("輸入 HELP 查看指令。欄位：狀態 | 原始 目標數/距離/速度/能量 | 追蹤 距離/接近速度/TTC | 等級");
}

void RadarApp::loop() {
  const uint32_t now = millis();

  pumpRadar(now);                 // 驅動層 → 核心層
  tracker_.update(now, config_);  // 處理目標消失、警示保持的逾時
  pumpCommands();                 // 手機 / 序列埠指令

  publishTelemetry(now, tracker_.consumeLevelChange());  // 等級一變就立刻送，不等週期
  printDebug(now);
  led_.update(now, ledPattern());
}

// ---------------------------------------------------------------- 雷達資料
void RadarApp::pumpRadar(uint32_t nowMs) {
  radar_.update(nowMs);

  RadarMeasurement m;
  while (radar_.readMeasurement(m)) {
    lastRaw_   = m;
    hasRaw_    = true;
    lastRawMs_ = nowMs;
    tracker_.onMeasurement(m, nowMs, config_);
  }
  if (hasRaw_ && nowMs - lastRawMs_ > 1000) hasRaw_ = false;  // 超過 1 秒沒新資料，不再送舊的原始值
  if (!radar_.online()) {  // 雷達離線：清掉舊判斷，避免手機顯示過時的來車
    tracker_.reset();
    hasRaw_ = false;
  }
}

// ---------------------------------------------------------------- 指令
void RadarApp::pumpCommands() {
  if (ble_.consumeConnectEvent()) console_.println("[藍牙] 手機已連線");
  if (ble_.consumeDisconnectEvent()) console_.println("[藍牙] 手機已斷線，重新廣播中");

  char text[BleLink::kMaxCommandLen + 1];
  while (ble_.popCommand(text, sizeof(text))) handleCommand(text, Channel::Ble);
  pollUsbSerial();
}

void RadarApp::pollUsbSerial() {
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

void RadarApp::handleCommand(const char* text, Channel from) {
  if (from == Channel::Ble) console_.printf("[藍牙指令] %s\n", text);

  const Command cmd = parseCommand(text);
  switch (cmd.type) {
    case CommandType::None:
      return;
    case CommandType::Get:
      sendConfig(from);
      return;
    case CommandType::Help:
      reply(from,
            "OK commands: GET, TEST 0|1, MINSPD <m/s>, MINE <int>, RANGE <m>, SIGN -1|0|1, DTTC <s>, DDIST <m>, "
            "HOLD <ms>, CONFIRM <n>, DEFAULTS, REBOOT\n");
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
  tracker_.reset();  // 參數改了，舊的追蹤狀態作廢
  reply(from, saved ? "OK saved\n" : "OK applied (flash save failed)\n");
  broadcastConfig();  // 網頁與序列埠都更新成新設定
}

void RadarApp::reply(Channel to, const char* line) {
  if (to == Channel::Ble) {
    ble_.sendLine(line);
    console_.print("[回覆手機] ");
  }
  console_.print(line);
}

void RadarApp::sendConfig(Channel to) {
  char line[kConfigLineMax];
  if (formatConfig(config_, firmwareVersion_, line, sizeof(line)) > 0) reply(to, line);
}

void RadarApp::broadcastConfig() {
  char line[kConfigLineMax];
  if (formatConfig(config_, firmwareVersion_, line, sizeof(line)) == 0) return;
  if (ble_.connected()) ble_.sendLine(line);
  console_.print(line);
}

// ---------------------------------------------------------------- 輸出
void RadarApp::publishTelemetry(uint32_t nowMs, bool urgent) {
  if (!urgent && nowMs - lastTelemetryMs_ < telemetryPeriodMs_) return;
  lastTelemetryMs_ = nowMs;

  TelemetrySnapshot s;
  s.radarOnline  = radar_.online();
  s.threat       = tracker_.state();
  s.hasRaw       = hasRaw_;
  s.raw          = lastRaw_;
  s.energyMedian = tracker_.energyMedian();
  s.uptimeS      = nowMs / 1000;

  char line[kTelemetryLineMax];
  if (formatTelemetry(s, line, sizeof(line)) > 0) ble_.sendLine(line);
}

void RadarApp::printDebug(uint32_t nowMs) {
  if (nowMs - lastDebugMs_ < debugPeriodMs_) return;
  lastDebugMs_ = nowMs;
  if (!radar_.online()) return;  // 離線時驅動層會自己印出原因

  static const char* const kLevelText[] = {"安全", "注意", "!! 危險 !!"};
  const ThreatState&       t = tracker_.state();
  const bool               raw = hasRaw_ && lastRaw_.targets > 0;
  console_.printf("%-6s | N=%u RD=%5.2f RV=%6.2f E=%-8lu | D=%5.2f V=%5.2f TTC=%4.1f | %s%s\n",
                  radar_.stateName(),
                  raw ? 1U : 0U,
                  raw ? lastRaw_.rangeM : -1.0f,
                  raw ? lastRaw_.speedMps : 0.0f,
                  static_cast<unsigned long>(tracker_.energyMedian()),
                  t.distanceM,
                  t.closingMps,
                  t.ttcS,
                  kLevelText[static_cast<uint8_t>(t.level)],
                  ble_.connected() ? "  [手機已連]" : "");
}

LedPattern RadarApp::ledPattern() const {
  if (tracker_.state().warning()) return LedPattern::Solid;
  if (!radar_.online()) return LedPattern::DoubleBlink;
  return ble_.connected() ? LedPattern::FastBlink : LedPattern::SlowBlink;
}
