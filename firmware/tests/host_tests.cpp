// 電腦端單元測試：驗證不依賴硬體的模組（資料框解析、來車判斷演算法、指令、輸出格式）
// 執行：firmware/tests/run_tests.sh（需要 g++）
#include <math.h>
#include <stdio.h>
#include <string.h>

#include "comm/CommandParser.h"
#include "comm/Telemetry.h"
#include "core/DetectionConfig.h"
#include "core/ThreatTracker.h"
#include "drivers/C4001Protocol.h"

static int gChecks = 0;
static int gFailures = 0;

#define CHECK(cond)                                                       \
  do {                                                                    \
    gChecks++;                                                            \
    if (!(cond)) {                                                        \
      gFailures++;                                                        \
      printf("  FAIL %s:%d  %s\n", __FILE__, __LINE__, #cond);            \
    }                                                                     \
  } while (0)

#define CHECK_NEAR(a, b, tol) CHECK(fabs((double)(a) - (double)(b)) <= (tol))

// ------------------------------------------------------------ 工具
static C4001FrameType feedAll(C4001FrameParser& p, const char* s, RadarMeasurement& out, int* frames = nullptr) {
  C4001FrameType last = C4001FrameType::None;
  for (const char* c = s; *c; c++) {
    const C4001FrameType t = p.feed(*c, out);
    if (t != C4001FrameType::None) {
      last = t;
      if (frames) (*frames)++;
    }
  }
  return last;
}

static RadarMeasurement target(float range, float speed, uint32_t energy) {
  RadarMeasurement m;
  m.targets  = 1;
  m.rangeM   = range;
  m.speedMps = speed;
  m.energy   = energy;
  return m;
}

static DetectionConfig roadConfig() {
  DetectionConfig c = DetectionConfig::defaults();
  c.testMode = false;  // 上路模式：接近速度 ≥ 1.5 m/s
  return c;
}

struct RunResult {
  AlertLevel maxLevel      = AlertLevel::Safe;
  float      firstWarnM    = -1;  // 第一次警示（注意或危險）時的真實距離
  float      firstCautionM = -1;  // 第一次「注意」時的真實距離
  float      firstDangerM  = -1;  // 第一次「危險」時的真實距離
  float      maxDistErrM   = 0;   // 追蹤距離與真實距離的最大誤差（已確認期間）
};

// 模擬一個以等速接近的目標：每 periodMs 一筆資料
static RunResult runApproach(ThreatTracker& t, const DetectionConfig& cfg, float startM, float speedMps,
                             uint32_t energy, uint32_t periodMs, uint32_t durationMs, uint32_t t0 = 1000) {
  RunResult r;
  for (uint32_t ms = 0; ms <= durationMs; ms += periodMs) {
    const float trueRange = startM - (-speedMps) * (ms / 1000.0f);  // speed 為負代表接近
    if (trueRange < 0.3f) break;
    t.onMeasurement(target(trueRange, speedMps, energy), t0 + ms, cfg);
    t.update(t0 + ms, cfg);
    const ThreatState& s = t.state();
    if (s.level > r.maxLevel) r.maxLevel = s.level;
    if (s.warning() && r.firstWarnM < 0) r.firstWarnM = trueRange;
    if (s.level == AlertLevel::Caution && r.firstCautionM < 0) r.firstCautionM = trueRange;
    if (s.level == AlertLevel::Danger && r.firstDangerM < 0) r.firstDangerM = trueRange;
    if (s.tracking) {
      const float err = fabsf(s.distanceM - trueRange);
      if (err > r.maxDistErrM) r.maxDistErrM = err;
    }
  }
  return r;
}

// ------------------------------------------------------------ 資料框解析
static void testFrameParser() {
  printf("[C4001FrameParser]\n");
  C4001FrameParser p;
  RadarMeasurement m;

  CHECK(feedAll(p, "$DFDMD,1,0,8.50,-6.31,52000,0,0*\r\n", m) == C4001FrameType::Speed);
  CHECK(m.targets == 1);
  CHECK_NEAR(m.rangeM, 8.50, 1e-4);
  CHECK_NEAR(m.speedMps, -6.31, 1e-4);
  CHECK(m.energy == 52000);

  // 半截資料框後面接新的資料框：舊的算壞資料，新的要能正常解析
  int frames = 0;
  CHECK(feedAll(p, "$DFDMD,1,0,3.2", m, &frames) == C4001FrameType::None);
  CHECK(feedAll(p, "$DFDMD,1,0,4.00,0.50,900,0,0*", m, &frames) == C4001FrameType::Speed);
  CHECK(frames == 2);  // 一個 Invalid + 一個 Speed
  CHECK_NEAR(m.rangeM, 4.0, 1e-4);

  // 指令回覆夾在中間，不影響
  CHECK(feedAll(p, "sensorStart\r\nDone\r\n$DFDMD,0,0,0.00,0.00,0,0,0*", m) == C4001FrameType::Speed);
  CHECK(m.targets == 0);

  CHECK(feedAll(p, "$DFHPD,1,0,0*", m) == C4001FrameType::Presence);
  CHECK(feedAll(p, "$DFDMD,1,0,abc,0.5,10,0,0*", m) == C4001FrameType::Invalid);
  CHECK(feedAll(p, "$DFDMD,1,0*", m) == C4001FrameType::Invalid);              // 欄位不足
  CHECK(feedAll(p, "$DFDMD,1,0,8.5x,1,1,0,0*", m) == C4001FrameType::Invalid);  // 數字後有雜字
  CHECK(feedAll(p, "$DFDMD,1,0,500,1,1,0,0*", m) == C4001FrameType::Invalid);   // 距離不合理
  CHECK(feedAll(p, "$DFDMD,0,0,,,,*", m) == C4001FrameType::Speed);             // 沒目標時欄位可空
  CHECK(feedAll(p, "$DFDMD,1,0, 8.00,-3.00,50000,0,0*", m) == C4001FrameType::Speed);  // 數字前有空白
  CHECK_NEAR(m.rangeM, 8.0, 1e-4);
  CHECK(feedAll(p, "hello world\r\n", m) == C4001FrameType::None);

  // 超長資料：丟掉，之後的資料框照常解析
  char longFrame[200] = "$DFDMD,1,0,";
  for (int i = 0; i < 150; i++) strcat(longFrame, "9");
  CHECK(feedAll(p, longFrame, m) == C4001FrameType::Invalid);
  CHECK(feedAll(p, "$DFDMD,1,0,2.00,-1.00,100,0,0*", m) == C4001FrameType::Speed);
  CHECK_NEAR(m.rangeM, 2.0, 1e-4);
}

// ------------------------------------------------------------ 來車判斷
static void testTracker() {
  printf("[ThreatTracker]\n");
  const DetectionConfig road = roadConfig();

  {  // 汽車以相對 7 m/s 從 20 m 接近（10 Hz）：15 m 內要警示，TTC ≤ 1.5 s 要危險
    ThreatTracker t;
    const RunResult r = runApproach(t, road, 20.0f, -7.0f, 60000, 100, 3000);
    CHECK(r.maxLevel == AlertLevel::Danger);
    CHECK(r.firstCautionM <= 15.0f && r.firstCautionM >= 14.0f);
    CHECK(r.firstDangerM <= 10.5f && r.firstDangerM >= 9.5f);
    CHECK(r.maxDistErrM < 0.3f);
    printf("  car 7 m/s @10Hz: caution at %.2f m, danger at %.2f m, max track error %.3f m\n", r.firstCautionM,
           r.firstDangerM, r.maxDistErrM);
  }
  {  // 同一台車但雷達只有 5 Hz：結果不能差太多（演算法不綁定資料頻率）
    ThreatTracker t;
    const RunResult r = runApproach(t, road, 20.0f, -7.0f, 60000, 200, 3000);
    CHECK(r.maxLevel == AlertLevel::Danger);
    CHECK(r.firstCautionM <= 15.0f && r.firstCautionM >= 13.5f);
  }
  {  // 機車 10 m/s（C4001 測速上限）：15 m 時 TTC 剛好 1.5 s → 一進警示範圍就是「危險」
    ThreatTracker t;
    const RunResult r = runApproach(t, road, 20.0f, -10.0f, 40000, 100, 2500);
    CHECK(r.maxLevel == AlertLevel::Danger);
    CHECK(r.firstWarnM <= 15.0f && r.firstWarnM >= 14.0f);
    CHECK(r.firstDangerM == r.firstWarnM);
  }
  {  // 上路模式：走路的人（1.2 m/s）不警示
    ThreatTracker t;
    const RunResult r = runApproach(t, road, 8.0f, -1.2f, 8000, 100, 5000);
    CHECK(r.maxLevel == AlertLevel::Safe);
    CHECK(t.state().distanceM < 0);
  }
  {  // 測試模式：人走近要警示（室內驗證功能用）
    DetectionConfig test = DetectionConfig::defaults();
    test.testMode = true;
    ThreatTracker t;
    const RunResult r = runApproach(t, test, 6.0f, -1.2f, 8000, 100, 4000);
    CHECK(r.maxLevel != AlertLevel::Safe);
  }
  {  // 靜止物體、遠離的車都不警示
    ThreatTracker t1, t2;
    CHECK(runApproach(t1, road, 10.0f, 0.0f, 90000, 100, 3000).maxLevel == AlertLevel::Safe);
    for (uint32_t ms = 0; ms < 2000; ms += 100) {
      t2.onMeasurement(target(3.0f + ms / 200.0f, +5.0f, 90000), 1000 + ms, road);  // 越來越遠
      CHECK(t2.state().level == AlertLevel::Safe);
    }
  }
  {  // 單一筆雜訊：不警示
    ThreatTracker t;
    t.onMeasurement(target(8.0f, -6.0f, 50000), 1000, road);
    RadarMeasurement none;
    for (uint32_t ms = 100; ms < 1500; ms += 100) {
      t.onMeasurement(none, 1000 + ms, road);
      t.update(1000 + ms, road);
      CHECK(t.state().level == AlertLevel::Safe);
    }
  }
  {  // 每 4 筆掉 1 筆：仍要確認並警示（漏資料只扣分不歸零）
    ThreatTracker t;
    AlertLevel maxLevel = AlertLevel::Safe;
    RadarMeasurement none;
    for (uint32_t i = 0; i < 25; i++) {
      const uint32_t now = 1000 + i * 100;
      const float range = 16.0f - 0.6f * i;
      if (i % 4 == 3) t.onMeasurement(none, now, road);
      else t.onMeasurement(target(range, -6.0f, 50000), now, road);
      t.update(now, road);
      if (t.state().level > maxLevel) maxLevel = t.state().level;
    }
    CHECK(maxLevel == AlertLevel::Danger);
  }
  {  // 車子超過去後雷達看不到：警示保持約 1 s 再解除，距離回到 -1
    ThreatTracker t;
    runApproach(t, road, 12.0f, -7.0f, 60000, 100, 1200, 1000);
    CHECK(t.state().warning());
    CHECK(t.consumeLevelChange());  // 安全 → 危險
    const uint32_t lastData = 1000 + 1200;
    t.update(lastData + 500, road);
    CHECK(t.state().warning());  // 0.5 s：還在保持
    t.update(lastData + 1300, road);
    CHECK(!t.state().warning());  // 1.3 s：已解除
    CHECK(t.state().distanceM < 0);
    CHECK(t.consumeLevelChange());  // 等級有變化，要立即通知手機
    CHECK(!t.consumeLevelChange());
  }
  {  // 追蹤中突然一筆跳到 3 m：被擋掉，追蹤距離不受影響
    ThreatTracker t;
    for (uint32_t i = 0; i < 6; i++) t.onMeasurement(target(14.0f - 0.5f * i, -5.0f, 50000), 1000 + i * 100, road);
    const float before = t.state().distanceM;
    t.onMeasurement(target(3.0f, -5.0f, 50000), 1600, road);
    CHECK(t.state().distanceM > before - 1.0f);  // 不會跳到 3 m
    CHECK_NEAR(t.state().distanceM, 11.0f, 0.3f);
  }
  {  // 能量門檻：小東西（人）不算，大的（車）才算
    DetectionConfig cfg = roadConfig();
    cfg.minEnergy = 30000;
    ThreatTracker small, big;
    CHECK(runApproach(small, cfg, 12.0f, -3.0f, 8000, 100, 3000).maxLevel == AlertLevel::Safe);
    CHECK(runApproach(big, cfg, 12.0f, -3.0f, 80000, 100, 3000).maxLevel != AlertLevel::Safe);
  }
  {  // 每 4 筆夾一筆「0 個目標」：等級不能在危險 / 注意之間來回跳（只應該變化 2 次）
    ThreatTracker t;
    RadarMeasurement none;
    int changes = 0;
    for (uint32_t i = 0; i < 18; i++) {
      const uint32_t now = 1000 + i * 100;
      if (i % 4 == 3) t.onMeasurement(none, now, road);
      else t.onMeasurement(target(14.0f - 0.7f * i, -7.0f, 50000), now, road);
      t.update(now, road);
      if (t.consumeLevelChange()) changes++;
    }
    CHECK(t.state().level == AlertLevel::Danger);
    CHECK(changes == 2);  // 安全 → 注意 → 危險
  }
  {  // 車子過去後雷達持續送「0 個目標」：警示在最後一次偵測後約 HOLD（1 秒）解除
    ThreatTracker t;
    runApproach(t, road, 12.0f, -7.0f, 60000, 100, 1200, 1000);
    const uint32_t last = 1000 + 1200;
    RadarMeasurement none;
    bool warnAt700 = false;
    for (uint32_t dt = 100; dt <= 1500; dt += 100) {
      t.onMeasurement(none, last + dt, road);
      t.update(last + dt, road);
      if (dt == 700) warnAt700 = t.state().warning();
    }
    CHECK(warnAt700);
    CHECK(!t.state().warning());
  }
  {  // 執行期參數：CONFIRM=1 第一筆就確認；DTTC=3 一進警示範圍就是危險
    DetectionConfig cfg = roadConfig();
    cfg.confirmHits = 1;
    cfg.dangerTtcS  = 3.0f;
    ThreatTracker t;
    t.onMeasurement(target(14.0f, -7.0f, 60000), 1000, cfg);
    CHECK(t.state().level == AlertLevel::Danger);  // 14 m / 7 m/s = 2 s ≤ 3 s
  }
  {  // SIGN = +1（雷達裝反、正號代表接近）
    DetectionConfig cfg = roadConfig();
    cfg.approachSign = 1;
    ThreatTracker t;
    CHECK(runApproach(t, cfg, 12.0f, +7.0f * -1.0f, 60000, 100, 1500).maxLevel == AlertLevel::Safe);
    ThreatTracker t2;
    RunResult r;
    for (uint32_t ms = 0; ms <= 1500; ms += 100) {
      t2.onMeasurement(target(12.0f - 7.0f * ms / 1000.0f, +7.0f, 60000), 1000 + ms, cfg);
      if (t2.state().level > r.maxLevel) r.maxLevel = t2.state().level;
    }
    CHECK(r.maxLevel == AlertLevel::Danger);
  }
}

// ------------------------------------------------------------ 指令
static void testCommands() {
  printf("[CommandParser]\n");
  DetectionConfig c = DetectionConfig::defaults();
  const char* err = nullptr;

  CHECK(parseCommand("GET").type == CommandType::Get);
  CHECK(parseCommand("  help\r\n").type == CommandType::Help);
  CHECK(parseCommand("?").type == CommandType::Help);
  CHECK(parseCommand("").type == CommandType::None);
  CHECK(parseCommand("GETX").type == CommandType::Unknown);
  CHECK(parseCommand("FOO 1").type == CommandType::Unknown);

  CHECK(applyCommand(parseCommand("test 0"), c, &err) && !c.testMode);
  CHECK(applyCommand(parseCommand("TEST=1"), c, &err) && c.testMode);
  CHECK(!applyCommand(parseCommand("TEST 2"), c, &err) && c.testMode);
  CHECK(!applyCommand(parseCommand("TEST"), c, &err));

  CHECK(applyCommand(parseCommand("MINSPD 2.5"), c, &err));
  CHECK_NEAR(c.minSpeedMps, 2.5, 1e-6);
  CHECK(!applyCommand(parseCommand("MINSPD 20"), c, &err));
  CHECK(!applyCommand(parseCommand("MINSPD 1.5abc"), c, &err));
  CHECK_NEAR(c.minSpeedMps, 2.5, 1e-6);  // 失敗時設定不變

  CHECK(applyCommand(parseCommand("MINE: 50000"), c, &err) && c.minEnergy == 50000);
  CHECK(!applyCommand(parseCommand("MINE 1.5"), c, &err));
  CHECK(!applyCommand(parseCommand("MINE -1"), c, &err));

  CHECK(applyCommand(parseCommand("RANGE 12"), c, &err));
  CHECK_NEAR(c.warnRangeM, 12.0, 1e-6);
  CHECK(!applyCommand(parseCommand("RANGE 0.5"), c, &err));
  CHECK(!applyCommand(parseCommand("RANGE 25"), c, &err));

  CHECK(applyCommand(parseCommand("SIGN 1"), c, &err) && c.approachSign == 1);
  CHECK(applyCommand(parseCommand("SIGN 0"), c, &err) && c.approachSign == 0);
  CHECK(!applyCommand(parseCommand("SIGN 2"), c, &err));

  CHECK(applyCommand(parseCommand("DTTC 2.5"), c, &err));
  CHECK_NEAR(c.dangerTtcS, 2.5, 1e-6);
  CHECK(!applyCommand(parseCommand("DTTC 9"), c, &err));
  CHECK(applyCommand(parseCommand("DDIST 6"), c, &err));
  CHECK_NEAR(c.dangerDistM, 6.0, 1e-6);
  CHECK(!applyCommand(parseCommand("DDIST 0.2"), c, &err));
  CHECK(applyCommand(parseCommand("HOLD 1500"), c, &err) && c.holdMs == 1500);
  CHECK(!applyCommand(parseCommand("HOLD 99999"), c, &err));
  CHECK(!applyCommand(parseCommand("HOLD 1500.5"), c, &err));
  CHECK(applyCommand(parseCommand("CONFIRM 2"), c, &err) && c.confirmHits == 2);
  CHECK(!applyCommand(parseCommand("CONFIRM 7"), c, &err));

  CHECK(applyCommand(parseCommand("DEFAULTS"), c, &err));
  CHECK(c.testMode && c.approachSign == -1 && c.minEnergy == 0);
  CHECK(c.holdMs == 1000 && c.confirmHits == 3);
  CHECK(c.isValid());

  DetectionConfig bad = DetectionConfig::defaults();
  bad.minSpeedMps = NAN;
  CHECK(!bad.isValid());
}

// ------------------------------------------------------------ 輸出格式
static void testTelemetry() {
  printf("[Telemetry]\n");
  char line[160];

  TelemetrySnapshot s;
  s.radarOnline      = true;
  s.threat.level     = AlertLevel::Danger;
  s.threat.tracking  = true;
  s.threat.distanceM = 8.42f;
  s.threat.closingMps = 6.2f;
  s.threat.ttcS      = 1.36f;
  s.hasRaw           = true;
  s.raw              = target(8.5f, -6.31f, 52000);
  s.energyMedian     = 52000;
  s.uptimeS          = 35;
  CHECK(formatTelemetry(s, line, sizeof(line)) > 0);
  CHECK(strcmp(line, "R=1 W=1 L=2 D=8.42 V=6.20 TTC=1.4 N=1 RD=8.50 RV=-6.31 E=52000 T=35\n") == 0);
  printf("  %s", line);

  TelemetrySnapshot idle;  // 雷達離線、沒目標
  idle.uptimeS = 7;
  CHECK(formatTelemetry(idle, line, sizeof(line)) > 0);
  CHECK(strcmp(line, "R=0 W=0 L=0 D=-1.00 V=0.00 TTC=-1.0 N=0 RD=-1.00 RV=0.00 E=0 T=7\n") == 0);

  CHECK(formatTelemetry(s, line, 20) == 0);  // 空間不夠：不輸出半行

  // 最長的情況也要放得進韌體實際使用的緩衝區（kConfigLineMax / kTelemetryLineMax）
  DetectionConfig worst = DetectionConfig::defaults();
  worst.minEnergy    = limits::kMinEnergyHi;
  worst.minSpeedMps  = limits::kMinSpeedHi;
  worst.warnRangeM   = limits::kWarnRangeHi;
  worst.approachSign = -1;
  worst.dangerTtcS   = limits::kDangerTtcHi;
  worst.dangerDistM  = limits::kDangerDistHi;
  worst.holdMs       = limits::kHoldHi;
  worst.confirmHits  = limits::kConfirmHi;
  char cfgLine[kConfigLineMax];
  CHECK(formatConfig(worst, "2.0.0", cfgLine, sizeof(cfgLine)) > 0);
  CHECK(formatConfig(DetectionConfig::defaults(), "2.0.0", cfgLine, sizeof(cfgLine)) > 0);

  TelemetrySnapshot big = s;
  big.threat.distanceM  = 20.0f;
  big.threat.closingMps = -10.0f;
  big.threat.ttcS       = 99.9f;
  big.raw               = target(100.0f, -50.0f, 4000000000UL);
  big.energyMedian      = 4000000000UL;
  big.uptimeS           = 4294967295UL;
  char telLine[kTelemetryLineMax];
  CHECK(formatTelemetry(big, telLine, sizeof(telLine)) > 0);

  CHECK(formatConfig(DetectionConfig::defaults(), "2.0.0", line, sizeof(line)) > 0);
  CHECK(strcmp(line, "CFG TEST=1 MINSPD=1.50 MINE=0 RANGE=15.0 SIGN=-1 DTTC=1.5 DDIST=4.0 HOLD=1000 CONFIRM=3 FW=2.0.0\n") == 0);
  printf("  %s", line);
}

int main() {
  testFrameParser();
  testTracker();
  testCommands();
  testTelemetry();
  printf("\n%d checks, %d failures\n", gChecks, gFailures);
  return gFailures == 0 ? 0 : 1;
}
