// 電腦端單元測試：驗證不依賴硬體的模組（資料框解析、來車判斷演算法、指令、輸出格式）
// 執行：firmware/tests/run_tests.sh（需要 g++）
#include <math.h>
#include <stdio.h>
#include <string.h>

#include "comm/CommandParser.h"
#include "comm/Telemetry.h"
#include "core/DetectionConfig.h"
#include "core/RangeKalman.h"
#include "core/RangeRateWindow.h"
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
    // SIGN 設錯（雷達其實是負號 = 接近）：距離明明在變近，交叉核對會發現正負號相反，照樣警示並回報
    ThreatTracker t;
    CHECK(runApproach(t, cfg, 12.0f, -7.0f, 60000, 100, 1500).maxLevel == AlertLevel::Danger);
    CHECK(t.state().velocitySource == VelocitySource::SignFlip);
    ThreatTracker t2;
    RunResult r;
    for (uint32_t ms = 0; ms <= 1500; ms += 100) {
      t2.onMeasurement(target(12.0f - 7.0f * ms / 1000.0f, +7.0f, 60000), 1000 + ms, cfg);
      if (t2.state().level > r.maxLevel) r.maxLevel = t2.state().level;
    }
    CHECK(r.maxLevel == AlertLevel::Danger);
  }
}

// ------------------------------------------------------------ 速度交叉核對（都卜勒 × 距離變化率）
// 可重現的亂數（LCG + Box-Muller）：雜訊測試每次結果都一樣
struct Rng {
  uint32_t s;
  explicit Rng(uint32_t seed) : s(seed) {}
  float uniform() {
    s = s * 1664525u + 1013904223u;
    return (static_cast<float>(s >> 8) + 0.5f) / 16777216.0f;
  }
  float gauss() { return sqrtf(-2.0f * logf(uniform())) * cosf(6.2831853f * uniform()); }
};

// C4001 速度輸出的幾種「出錯」模型（雷達座標：負 = 接近）
enum class DopplerModel { Ideal, Wrap, Clamp, Zero };
static float radarSpeed(float v, DopplerModel model) {
  switch (model) {
    case DopplerModel::Wrap: {  // 超過 ±10 m/s 折疊（週期 20 m/s）
      float w = fmodf(v + 10.0f, 20.0f);
      if (w < 0.0f) w += 20.0f;
      return w - 10.0f;
    }
    case DopplerModel::Clamp:  // 超過 ±10 m/s 就停在 10
      return v > 10.0f ? 10.0f : (v < -10.0f ? -10.0f : v);
    case DopplerModel::Zero:  // 速度欄位一直是 0
      return 0.0f;
    default:
      return v;
  }
}

struct Scenario {
  float        startM      = 20.0f;
  float        closingMps  = 7.0f;   // 起始接近速度（正 = 接近）
  float        accel       = 0.0f;   // 接近速度每秒變化（m/s²）
  DopplerModel model       = DopplerModel::Ideal;
  float        rangeNoise  = 0.2f;   // 距離雜訊 σ（m）
  float        speedNoise  = 0.15f;  // 都卜勒雜訊 σ（m/s）
  float        outlierRate = 0.0f;   // 每筆有多少機率跳 ±2.5 m（車身反射點跳動）
  uint32_t     durationMs  = 3000;
};

struct ScenarioResult {
  AlertLevel     maxLevel   = AlertLevel::Safe;
  float          firstWarnM = -1.0f;
  float          rmsClosing = 0.0f;  // 追蹤 1 秒後的接近速度均方根誤差
  float          rmsDist    = 0.0f;
  float          finalErr   = 0.0f;  // 最後一筆的接近速度誤差
  VelocitySource lastSource = VelocitySource::None;
};

static ScenarioResult runScenario(const Scenario& sc, const DetectionConfig& cfg, uint32_t seed) {
  Rng            rng(seed);
  ThreatTracker  t;
  ScenarioResult r;
  double         seC = 0.0, seD = 0.0;
  int            n           = 0;
  float          firstTrackS = -1.0f;
  for (uint32_t ms = 0; ms <= sc.durationMs; ms += 100) {
    const float ts      = ms / 1000.0f;
    const float closing = sc.closingMps + sc.accel * ts;
    const float range   = sc.startM - (sc.closingMps * ts + 0.5f * sc.accel * ts * ts);
    if (range < 1.0f || closing < 0.5f) break;
    float measured = range + sc.rangeNoise * rng.gauss();
    if (sc.outlierRate > 0.0f && rng.uniform() < sc.outlierRate) measured += rng.uniform() < 0.5f ? -2.5f : 2.5f;
    const float speed = radarSpeed(-closing + sc.speedNoise * rng.gauss(), sc.model);
    t.onMeasurement(target(measured, speed, 60000), 1000 + ms, cfg);
    t.update(1000 + ms, cfg);

    const ThreatState& s = t.state();
    if (s.level > r.maxLevel) r.maxLevel = s.level;
    if (s.warning() && r.firstWarnM < 0.0f) r.firstWarnM = range;
    if (s.tracking) {
      if (firstTrackS < 0.0f) firstTrackS = ts;
      if (ts - firstTrackS >= 1.0f) {
        seC += (s.closingMps - closing) * (s.closingMps - closing);
        seD += (s.distanceM - range) * (s.distanceM - range);
        n++;
      }
      r.finalErr = s.closingMps - closing;
    }
    r.lastSource = s.velocitySource;
  }
  if (n > 0) {
    r.rmsClosing = static_cast<float>(sqrt(seC / n));
    r.rmsDist    = static_cast<float>(sqrt(seD / n));
  }
  return r;
}

static void testEstimators() {
  printf("[RangeRateWindow / RangeKalman]\n");
  {  // 等速直線：斜率要精確，標準差符合 σr·√12 / (T·√(N(N²−1)))
    RangeRateWindow w;
    for (uint32_t i = 0; i < 8; i++) w.push(1000 + i * 100, 15.0f - 0.7f * i);
    const RateFit f = w.fit(0.2f, 1000, 6, 0.45f);
    CHECK(f.valid && f.count == 8);
    CHECK_NEAR(f.rate, -7.0f, 1e-3);
    CHECK_NEAR(f.sigma, 0.2f * sqrtf(12.0f) / (0.1f * sqrtf(8.0f * 63.0f)), 1e-3);
    CHECK_NEAR(f.centerAgeS, 0.35f, 1e-4);
    CHECK(!w.fit(0.2f, 250, 6, 0.45f).valid);  // 只看最近 0.25 s：筆數不夠
  }
  {  // 卡爾曼：只用距離更新也能收斂到正確速度
    RangeKalman kf;
    kf.init(20.0f, 0.0f, 0.04f, 36.0f);
    for (int i = 1; i <= 15; i++) {
      kf.predict(0.1f, 9.0f);
      kf.updateRange(20.0f - 0.6f * i, 0.04f);
    }
    CHECK_NEAR(kf.rate(), -6.0f, 0.3f);
    CHECK(kf.varRange() > 0.0f && kf.varRate() > 0.0f);
  }
}

static void testVelocityCrossCheck() {
  printf("[速度交叉核對]\n");
  const DetectionConfig road = roadConfig();

  {  // 一般情況（雜訊 σr 0.2 m、σv 0.15 m/s，20 組亂數）：都卜勒經核對後採用，誤差小
    float worstC = 0.0f, worstD = 0.0f;
    bool  allDanger = true, allDoppler = true;
    for (uint32_t seed = 1; seed <= 20; seed++) {
      Scenario             sc;
      const ScenarioResult r = runScenario(sc, road, seed);
      worstC                 = fmaxf(worstC, r.rmsClosing);
      worstD                 = fmaxf(worstD, r.rmsDist);
      allDanger              = allDanger && r.maxLevel == AlertLevel::Danger;
      allDoppler             = allDoppler && r.lastSource == VelocitySource::Doppler;
    }
    CHECK(allDanger);
    CHECK(allDoppler);
    CHECK(worstC < 0.25f);
    CHECK(worstD < 0.2f);
    printf("  car 7 m/s, noisy: worst RMS closing %.3f m/s, worst RMS distance %.3f m\n", worstC, worstD);
  }
  {  // 13 m/s 的車：都卜勒折疊成 +7（看起來在遠離）→ 依距離變化率還原，照樣警示
    Scenario sc;
    sc.closingMps          = 13.0f;
    sc.model               = DopplerModel::Wrap;
    sc.durationMs          = 1500;
    const ScenarioResult r = runScenario(sc, road, 7);
    CHECK(r.maxLevel == AlertLevel::Danger);
    CHECK(r.firstWarnM >= 12.0f);
    CHECK(r.lastSource == VelocitySource::Unfolded);
    CHECK(fabsf(r.finalErr) < 0.5f);
    printf("  car 13 m/s, Doppler wraps: first warning at %.1f m, final speed error %.2f m/s\n", r.firstWarnM,
           r.finalErr);
  }
  {  // 都卜勒卡在 10 m/s（不折疊、飽和）→ 長期核對發現不一致，改用距離變化率
    Scenario sc;
    sc.closingMps          = 13.0f;
    sc.model               = DopplerModel::Clamp;
    sc.durationMs          = 1500;
    const ScenarioResult r = runScenario(sc, road, 11);
    CHECK(r.maxLevel == AlertLevel::Danger);
    CHECK(r.lastSource == VelocitySource::RangeRate);
    CHECK(fabsf(r.finalErr) < 1.0f);
    printf("  car 13 m/s, Doppler clamps at 10: final speed error %.2f m/s\n", r.finalErr);
  }
  {  // 都卜勒一直報 0：舊演算法永遠不警示；改用距離變化率後照樣警示
    Scenario sc;
    sc.closingMps          = 6.0f;
    sc.model               = DopplerModel::Zero;
    const ScenarioResult r = runScenario(sc, road, 3);
    CHECK(r.maxLevel == AlertLevel::Danger);
    CHECK(r.lastSource == VelocitySource::RangeRate);
    CHECK(fabsf(r.finalErr) < 0.8f);
  }
  {  // 加速超過 10 m/s（8 → 12 m/s）：中途開始折疊，追蹤不中斷
    Scenario sc;
    sc.closingMps          = 8.0f;
    sc.accel               = 2.0f;
    sc.model               = DopplerModel::Wrap;
    sc.durationMs          = 1800;
    const ScenarioResult r = runScenario(sc, road, 5);
    CHECK(r.maxLevel == AlertLevel::Danger);
    CHECK(r.lastSource == VelocitySource::Unfolded);
    CHECK(fabsf(r.finalErr) < 0.6f);
  }
  {  // 煞車（8 → 2 m/s）：追蹤沒有明顯落後
    Scenario sc;
    sc.startM              = 18.0f;
    sc.closingMps          = 8.0f;
    sc.accel               = -4.0f;
    sc.durationMs          = 1500;
    const ScenarioResult r = runScenario(sc, road, 9);
    CHECK(r.rmsClosing < 0.4f);
  }
  {  // 車身反射點偶爾跳 ±2.5 m（10%）：跳值被擋掉，距離與速度仍準
    Scenario sc;
    sc.outlierRate         = 0.1f;
    const ScenarioResult r = runScenario(sc, road, 21);
    CHECK(r.maxLevel == AlertLevel::Danger);
    CHECK(r.rmsDist < 0.35f);
    CHECK(r.rmsClosing < 0.35f);
  }
  {  // 真的換了目標（另一台車在 5 m 出現並持續）：連續 3 筆彼此一致的跳值 → 改追新目標
    ThreatTracker t;
    for (uint32_t i = 0; i < 8; i++) t.onMeasurement(target(15.0f - 0.6f * i, -6.0f, 60000), 1000 + i * 100, road);
    for (uint32_t i = 8; i < 14; i++) {
      t.onMeasurement(target(5.0f - 0.4f * (i - 8), -4.0f, 60000), 1000 + i * 100, road);
      t.update(1000 + i * 100, road);
    }
    CHECK_NEAR(t.state().distanceM, 3.0f, 0.5f);
    CHECK(t.state().level == AlertLevel::Danger);
  }
  {  // SIGN = 0（不判斷方向）：遠離的物體不再誤報（距離變化率判斷出方向）
    DetectionConfig cfg = roadConfig();
    cfg.approachSign    = 0;
    ThreatTracker t;
    AlertLevel    maxLevel = AlertLevel::Safe;
    for (uint32_t ms = 0; ms <= 2000; ms += 100) {
      t.onMeasurement(target(3.0f + 5.0f * ms / 1000.0f, +5.0f, 90000), 1000 + ms, cfg);
      t.update(1000 + ms, cfg);
      if (t.state().level > maxLevel) maxLevel = t.state().level;
    }
    CHECK(maxLevel == AlertLevel::Safe);
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
  s.threat.velocitySource = VelocitySource::Doppler;
  s.threat.hasRangeRate   = true;
  s.threat.rangeRateMps   = 6.11f;
  CHECK(formatTelemetry(s, line, sizeof(line)) > 0);
  CHECK(strcmp(line, "R=1 W=1 L=2 D=8.42 V=6.20 TTC=1.4 N=1 RD=8.50 RV=-6.31 E=52000 T=35 VS=2 RR=6.11\n") == 0);
  printf("  %s", line);

  TelemetrySnapshot idle;  // 雷達離線、沒目標
  idle.uptimeS = 7;
  CHECK(formatTelemetry(idle, line, sizeof(line)) > 0);
  CHECK(strcmp(line, "R=0 W=0 L=0 D=-1.00 V=0.00 TTC=-1.0 N=0 RD=-1.00 RV=0.00 E=0 T=7 VS=0\n") == 0);

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
  CHECK(formatConfig(worst, "2.1.0", cfgLine, sizeof(cfgLine)) > 0);
  CHECK(formatConfig(DetectionConfig::defaults(), "2.1.0", cfgLine, sizeof(cfgLine)) > 0);

  TelemetrySnapshot big = s;
  big.threat.distanceM  = 20.0f;
  big.threat.closingMps = -10.0f;
  big.threat.ttcS       = 99.9f;
  big.raw               = target(100.0f, -50.0f, 4000000000UL);
  big.energyMedian      = 4000000000UL;
  big.uptimeS           = 4294967295UL;
  big.threat.velocitySource = VelocitySource::SignFlip;
  big.threat.hasRangeRate   = true;
  big.threat.rangeRateMps   = -150.0f;  // 超出範圍：夾在 -99.99
  char telLine[kTelemetryLineMax];
  CHECK(formatTelemetry(big, telLine, sizeof(telLine)) > 0);
  CHECK(strstr(telLine, " VS=5 RR=-99.99\n") != nullptr);

  CHECK(formatConfig(DetectionConfig::defaults(), "2.1.0", line, sizeof(line)) > 0);
  CHECK(strcmp(line, "CFG TEST=1 MINSPD=1.50 MINE=0 RANGE=15.0 SIGN=-1 DTTC=1.5 DDIST=4.0 HOLD=1000 CONFIRM=3 FW=2.1.0\n") == 0);
  printf("  %s", line);
}

int main() {
  testFrameParser();
  testTracker();
  testEstimators();
  testVelocityCrossCheck();
  testCommands();
  testTelemetry();
  printf("\n%d checks, %d failures\n", gChecks, gFailures);
  return gFailures == 0 ? 0 : 1;
}
