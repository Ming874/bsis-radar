// 電腦端單元測試：驗證不依賴硬體的模組（資料框解析、對地速度估計、指令、輸出格式、輪速）
// 執行：firmware/arduino.ps1 test 或 firmware/tests/run_tests.sh（需要 g++）
#include <math.h>
#include <stdio.h>
#include <string.h>

#include <initializer_list>

#include "comm/CommandParser.h"
#include "comm/Telemetry.h"
#include "core/GroundSpeedEstimator.h"
#include "core/RearThreat.h"
#include "core/SpeedConfig.h"
#include "core/WheelSpeed.h"
#include "drivers/C4001Protocol.h"
#include "drivers/LD2451Protocol.h"

static int gChecks   = 0;
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

static const double kPi = 3.14159265358979;
static double rad(double deg) { return deg * kPi / 180.0; }

// ------------------------------------------------------------ 工具：亂數與 C4001 地面回波模擬
struct Rng {
  uint32_t s;
  explicit Rng(uint32_t seed) : s(seed ? seed : 1) {}
  double uniform() {  // xorshift32
    s ^= s << 13;
    s ^= s >> 17;
    s ^= s << 5;
    return (s >> 8) / 16777216.0;
  }
  double gauss() {  // Box–Muller
    const double u1 = uniform() + 1e-12, u2 = uniform();
    return sqrt(-2.0 * log(u1)) * cos(2.0 * kPi * u2);
  }
};

// C4001 超過上限時的行為沒有官方文件：可能折疊到另一側、也可能截斷在上限（docs/ALGORITHM.md §2）
static float foldRadial(double vr, double limit) {
  double x = fmod(vr + limit, 2 * limit);
  if (x < 0) x += 2 * limit;
  return static_cast<float>(x - limit);
}

// 模擬朝地面的 C4001：每一筆資料框回報波束內「最強」的一個路面散射點。
// 散射點的俯角 α = 視軸 + 加權偏移（路面越光滑、越偏向正下方）+ 隨機分散；
// 距離 r = h / sin α（加雜訊與偏差）；徑向速度 vr = v cos α + 上下震動 + 雷達雜訊。
struct GroundRadarSim {
  double heightM        = 0.70;
  double angleDeg       = 45.0;  // 實際安裝角度
  double shiftDeg       = 0.0;   // 功率加權造成的偏移（正 = 偏向正下方，都卜勒變小）
  double spreadDeg      = 0.0;   // 散射點俯角的標準差
  double rangeNoiseM    = 0.0;
  double rangeBiasM     = 0.0;
  double radialNoiseMps = 0.0;
  double bounceMps      = 0.0;   // 雷達上下震動的速度標準差
  double pDetect        = 1.0;   // 每一筆有路面回波的機率
  double pOutlier       = 0.0;   // 雜散目標（車輪、腳、路人）
  bool   extrapolate    = true;  // 失去目標時多送一筆外插資料框（C4001 實測行為）
  int    radarSign      = 1;     // 朝後安裝：地面遠離 → C4001 回報正值
  double foldLimit      = 0;     // > 0：雷達的徑向上限，超過時折疊（FFT 混疊）

  bool             hadTarget = false;
  RadarMeasurement last;

  RadarMeasurement frame(double v, Rng& rng) {
    RadarMeasurement m;
    if (v > 0.05 && rng.uniform() < pDetect) {
      double a = angleDeg + shiftDeg + spreadDeg * rng.gauss();
      if (a < 5) a = 5;
      if (a > 88) a = 88;
      const double r  = heightM / sin(rad(a)) + rangeBiasM + rangeNoiseM * rng.gauss();
      const double vr = v * cos(rad(a)) + bounceMps * sin(rad(a)) * rng.gauss() + radialNoiseMps * rng.gauss();
      m.targets  = 1;
      m.rangeM   = static_cast<float>(r);
      m.speedMps = foldLimit > 0 ? foldRadial(radarSign * vr, foldLimit) : static_cast<float>(radarSign * vr);
      m.energy   = 20000 + static_cast<uint32_t>(rng.uniform() * 500000);
    } else if (rng.uniform() < pOutlier) {
      m.targets  = 1;
      m.rangeM   = static_cast<float>(0.8 + rng.uniform() * 1.0);
      m.speedMps = static_cast<float>(-3.0 + rng.uniform() * 12.0);
      m.energy   = 5000 + static_cast<uint32_t>(rng.uniform() * 100000);
    } else if (hadTarget && extrapolate) {
      m = last;  // 外插：速度、能量不變，距離往前推
      m.rangeM += m.speedMps * 0.1f;
      hadTarget = false;
      return m;
    }
    hadTarget = m.targets > 0;
    if (hadTarget) last = m;
    return m;
  }
};

// 不會折疊的雷達（測速上限 10 m/s）：一般情境用；C4001 的上限與折疊另外在 testRadialLimit 測
static SpeedConfig noFold() {
  SpeedConfig c    = SpeedConfig::defaults();
  c.radialLimitMps = 10.0f;
  return c;
}

static RadarMeasurement target(float range, float speed, uint32_t energy) {
  RadarMeasurement m;
  m.targets  = 1;
  m.rangeM   = range;
  m.speedMps = speed;
  m.energy   = energy;
  return m;
}

static RadarMeasurement none() { return RadarMeasurement(); }

// 理想量測：視軸正中央的散射點（距離 h / sin θ、徑向速度 v cos θ），能量每筆不同（避免被當成外插）
static RadarMeasurement ideal(const SpeedConfig& c, double v) {
  static uint32_t e = 30000;
  e += 7;
  const double a = rad(c.angleDeg);
  return target(static_cast<float>(c.heightM / sin(a)), static_cast<float>(c.direction * v * cos(a)), e);
}

struct RunStats {
  double rmsErr      = 0;  // 對地速度誤差 RMS（m/s），只算「追蹤中」且已過暫態的時間
  double meanErrPct  = 0;  // 平均相對誤差（%）
  double distErrPct  = 0;  // 里程相對誤差（%）
  double trackingPct = 0;  // 「速度已知」的時間比例
  int    n           = 0;
};

// 速度曲線：給定時間（s）回傳真實速度（m/s）
typedef double (*Profile)(double t);

static double cruise6(double) { return 6.0; }
static double accelBrake(double t) {  // 0 → 8 m/s（2 m/s²）→ 等速 → 急煞 −4 m/s² → 停
  if (t < 1) return 0;
  if (t < 5) return 2.0 * (t - 1);
  if (t < 12) return 8.0;
  if (t < 14) return 8.0 - 4.0 * (t - 12);
  return 0;
}
static double cruiseFromRest(double t) {  // 起步 1.5 m/s² 到 6 m/s 後巡航
  if (t < 1) return 0;
  return t < 5 ? 1.5 * (t - 1) : 6.0;
}
static double calibrationRun(double t) {  // 距離校正一趟：停 → 1.5 m/s² 加速 → 6 m/s 巡航 → −2 m/s² 停在 100 m
  // 加速 4 s（12 m）＋ 巡航 79 m（13.17 s）＋ 減速 3 s（9 m）＝ 100 m
  const double cruiseEnd = 5 + 79.0 / 6.0;
  if (t < 1) return 0;
  if (t < 5) return 1.5 * (t - 1);
  if (t < cruiseEnd) return 6.0;
  return fmax(0.0, 6.0 - 2.0 * (t - cruiseEnd));
}
static double rideMix(double t) {  // 城市騎乘：起步、巡航、緩和變速、停等、再起步
  if (t < 1) return 0;
  if (t < 4) return 1.6 * (t - 1);
  if (t < 20) return 4.8 + 1.2 * sin((t - 4) * 0.4);
  if (t < 23) return (4.8 + 1.2 * sin(16 * 0.4)) * (23 - t) / 3.0;
  if (t < 26) return 0;
  if (t < 30) return 1.5 * (t - 26);
  return 6.0;
}

static RunStats runProfile(GroundRadarSim& sim, const SpeedConfig& cfg, Profile v, double seconds, uint32_t seed,
                           double settleS = 1.0) {
  GroundSpeedEstimator est;
  Rng                  rng(seed);
  RunStats             st;
  double               trueDist = 0, sumSq = 0, sumRel = 0, known = 0;
  int                  nRel = 0;
  const uint32_t       t0   = 5000;
  for (int k = 0; k <= static_cast<int>(seconds * 10); k++) {
    const double   t  = k * 0.1;
    const uint32_t ms = t0 + static_cast<uint32_t>(k * 100);
    const double   vt = v(t);
    if (k > 0) trueDist += 0.5 * (v(t - 0.1) + vt) * 0.1;
    est.onFrame(sim.frame(vt, rng), ms, cfg);
    if (est.hasSpeed()) known++;
    if (t >= settleS && est.state() == SpeedState::Tracking && vt > 0.5) {
      const double e = est.speedMps() - vt;
      sumSq += e * e;
      sumRel += e / vt;
      nRel++;
    }
  }
  st.n           = nRel;
  st.rmsErr      = nRel ? sqrt(sumSq / nRel) : 99;
  st.meanErrPct  = nRel ? 100.0 * sumRel / nRel : 99;
  st.distErrPct  = trueDist > 0 ? 100.0 * (est.distanceM() - trueDist) / trueDist : 0;
  st.trackingPct = 100.0 * known / (seconds * 10 + 1);
  return st;
}

// ------------------------------------------------------------ 資料框解析
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

static void testFrameParser() {
  printf("[C4001FrameParser]\n");
  C4001FrameParser p;
  RadarMeasurement m;

  CHECK(feedAll(p, "$DFDMD,1,0,0.86,3.84,52000,0,0*\r\n", m) == C4001FrameType::Speed);
  CHECK(m.targets == 1);
  CHECK_NEAR(m.rangeM, 0.86, 1e-4);
  CHECK_NEAR(m.speedMps, 3.84, 1e-4);
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
  CHECK(feedAll(p, "$DFDMD,0, , , , , , *", m) == C4001FrameType::Speed);       // 實測：沒目標時是空白欄位
  CHECK(m.targets == 0);
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

// ------------------------------------------------------------ 幾何：距離窗口與換算倍率
static void testGeometry() {
  printf("[GroundGeometry]\n");
  SpeedConfig c = SpeedConfig::defaults();
  CHECK(c.isValid());
  CHECK_NEAR(c.angleDeg, 45.0, 1e-6);
  CHECK(c.model == SpeedModel::FixedAngle);

  // 預設 45°、0.70 m：視軸打在 0.99 m；窗口 20°～75° → 0.725～2.047 m，再各留 0.10 m
  const GroundWindow w = groundWindow(c);
  CHECK_NEAR(w.minRangeM, 0.70 / sin(rad(75)) - 0.10, 0.005);
  CHECK_NEAR(w.maxRangeM, 0.70 / sin(rad(20)) + 0.10, 0.005);
  CHECK(w.radarMinM == w.minRangeM);
  CHECK(w.radarMaxM >= ground_tuning::kRadarMinMaxRangeM);  // C4001 的最遠距離有下限
  CHECK(w.radarMaxM >= w.maxRangeM);

  // 很低的安裝：最近距離不小於 C4001 的 0.3 m
  SpeedConfig low = c;
  low.heightM = 0.15f;
  low.angleDeg = 30.0f;
  CHECK(groundWindow(low).minRangeM >= ground_tuning::kRadarMinRangeM - 1e-6);
  CHECK(groundWindow(low).maxRangeM > groundWindow(low).minRangeM);

  // 固定角度：倍率 = 1 / cos θ，與距離無關
  float f = 0, a = 0;
  CHECK(groundFactor(c, 0.5f, &f, &a));
  CHECK_NEAR(f, 1.0 / cos(rad(45)), 1e-4);
  CHECK_NEAR(a, 45.0, 1e-4);

  // 距離幾何：sin α = h / r
  SpeedConfig g = c;
  g.model = SpeedModel::RangeGeometry;
  CHECK(groundFactor(g, static_cast<float>(0.70 / sin(rad(30))), &f, &a));
  CHECK_NEAR(a, 30.0, 0.01);
  CHECK_NEAR(f, 1.0 / cos(rad(30)), 1e-3);
  CHECK(groundFactor(g, 0.70f / static_cast<float>(sin(rad(60))), &f, &a));
  CHECK_NEAR(a, 60.0, 0.01);
  CHECK(!groundFactor(g, 0.69f, &f, &a));   // 比雷達高度還近：不是地面
  CHECK(!groundFactor(g, 0.701f, &f, &a));  // 幾乎正下方：都卜勒趨近 0、倍率發散
  CHECK(!groundFactor(g, 0.0f, &f, &a));
}

// ------------------------------------------------------------ 估計器：基本行為
static void feedFor(GroundSpeedEstimator& est, const SpeedConfig& c, double v, uint32_t& ms, int frames) {
  for (int i = 0; i < frames; i++) {
    ms += 100;
    est.onFrame(ideal(c, v), ms, c);
  }
}

static void feedNone(GroundSpeedEstimator& est, const SpeedConfig& c, uint32_t& ms, int frames) {
  for (int i = 0; i < frames; i++) {
    ms += 100;
    est.onFrame(none(), ms, c);
  }
}

static void testEstimatorBasics() {
  printf("[GroundSpeedEstimator：基本行為]\n");
  const SpeedConfig c = noFold();
  GroundSpeedEstimator est;
  uint32_t ms = 1000;

  CHECK(est.state() == SpeedState::NoRadar);
  CHECK(!est.hasSpeed());

  // 剛上線、沒有回波：視為停著（速度 0）
  feedNone(est, c, ms, 3);
  CHECK(est.state() == SpeedState::Stopped);
  CHECK(est.hasSpeed() && est.speedMps() == 0.0f);

  // 擷取：前兩筆還在確認（速度仍是 0），第三筆一致才開始追蹤
  ms += 100;
  FrameResult r = est.onFrame(ideal(c, 5.0), ms, c);
  CHECK(r.verdict == FrameVerdict::Acquiring);
  CHECK(r.hasGround);
  CHECK_NEAR(r.groundMps, 5.0, 1e-3);
  CHECK_NEAR(r.depressionDeg, 45.0, 1e-3);
  CHECK(est.state() == SpeedState::Acquiring);
  CHECK(est.speedMps() == 0.0f);
  feedFor(est, c, 5.0, ms, 1);
  CHECK(est.state() == SpeedState::Acquiring);
  ms += 100;
  r = est.onFrame(ideal(c, 5.0), ms, c);
  CHECK(r.verdict == FrameVerdict::Accepted);
  CHECK(est.state() == SpeedState::Tracking);
  CHECK_NEAR(est.speedMps(), 5.0, 1e-3);
  CHECK(est.sigmaMps() > 0.0f);

  // 等速 10 秒：速度不變、里程 ≈ 5 × 時間（擷取的那段也補回）
  const double before = est.distanceM();
  feedFor(est, c, 5.0, ms, 100);
  CHECK_NEAR(est.speedMps(), 5.0, 1e-3);
  CHECK_NEAR(est.distanceM() - before, 50.0, 0.05);
  CHECK(est.qualityPct() == 100);
  CHECK(est.wrongDirectionPct() == 0);
  CHECK(est.frames() == 3 + 3 + 100);

  // CAL：速度與里程等比例
  SpeedConfig cal = c;
  cal.calibration = 1.10f;
  GroundSpeedEstimator e2;
  uint32_t ms2 = 1000;
  feedFor(e2, cal, 5.0, ms2, 50);
  CHECK_NEAR(e2.speedMps(), 5.5, 0.01);

  // 朝前安裝（DIR = -1）：C4001 回報負值，同樣量得到
  SpeedConfig fwd = c;
  fwd.direction = -1;
  GroundSpeedEstimator e3;
  uint32_t ms3 = 1000;
  feedFor(e3, fwd, 4.0, ms3, 20);
  CHECK(e3.state() == SpeedState::Tracking);
  CHECK_NEAR(e3.speedMps(), 4.0, 0.01);
}

static void testEstimatorStopAndDropout() {
  printf("[GroundSpeedEstimator：停車、失去回波、恢復]\n");
  const SpeedConfig c = noFold();

  // 慢速時失去回波 → 停車：0.6 秒內判定靜止，保持期間的距離算一半
  {
    GroundSpeedEstimator est;
    uint32_t ms = 1000;
    feedFor(est, c, 1.0, ms, 20);
    CHECK(est.state() == SpeedState::Tracking);
    const double d0 = est.distanceM();
    feedNone(est, c, ms, 3);
    CHECK(est.state() == SpeedState::Holding);
    CHECK(est.hasSpeed());
    CHECK_NEAR(est.speedMps(), 1.0, 0.01);  // 保持：暫時沿用
    feedNone(est, c, ms, 4);
    CHECK(est.state() == SpeedState::Stopped);
    CHECK(est.speedMps() == 0.0f);
    // 最後一筆之後 0.7 s：保持期間 ≈ 0.4 s × 1 m/s，算一半 ≈ 0.2 m（+ 最後一筆到保持前的 0.3 m）
    CHECK(est.distanceM() - d0 > 0.25 && est.distanceM() - d0 < 0.75);
    feedNone(est, c, ms, 50);
    CHECK(est.state() == SpeedState::Stopped);  // 一直停著
  }

  // 慢速時看到靜止回波（雷達回報速度 ≈ 0 的路面）→ 立刻判定靜止
  {
    GroundSpeedEstimator est;
    uint32_t ms = 1000;
    feedFor(est, c, 0.8, ms, 20);
    ms += 100;
    CHECK(est.onFrame(target(0.99f, 0.02f, 9001), ms, c).verdict == FrameVerdict::Static);
    ms += 100;
    est.onFrame(target(0.99f, 0.03f, 9002), ms, c);
    CHECK(est.state() == SpeedState::Stopped);
  }

  // 高速時看到靜止回波（跟著車子走的擋泥板、車架）：忽略，不會誤判停車
  {
    GroundSpeedEstimator est;
    uint32_t ms = 1000;
    feedFor(est, c, 6.0, ms, 20);
    for (int i = 0; i < 2; i++) {
      ms += 100;
      est.onFrame(target(0.9f, 0.01f, 8000 + i), ms, c);
    }
    CHECK(est.state() == SpeedState::Tracking);
    feedFor(est, c, 6.0, ms, 1);
    CHECK_NEAR(est.speedMps(), 6.0, 0.05);
  }

  // 高速時短暫失去回波（1 秒）→ 保持，回來後繼續；保持期間的距離要算進去
  {
    GroundSpeedEstimator est;
    uint32_t ms = 1000;
    feedFor(est, c, 6.0, ms, 20);
    const double d0 = est.distanceM();
    feedNone(est, c, ms, 10);
    CHECK(est.state() == SpeedState::Holding);
    CHECK_NEAR(est.speedMps(), 6.0, 0.01);
    feedFor(est, c, 6.0, ms, 10);
    CHECK(est.state() == SpeedState::Tracking);
    CHECK_NEAR(est.distanceM() - d0, 6.0 * 2.0, 0.1);
  }

  // 失去回波超過 2 秒 → 訊號中斷（速度未知）；回波回來後重新擷取
  {
    GroundSpeedEstimator est;
    uint32_t ms = 1000;
    feedFor(est, c, 6.0, ms, 20);
    feedNone(est, c, ms, 21);
    CHECK(est.state() == SpeedState::Lost);
    CHECK(!est.hasSpeed());
    CHECK(est.speedMps() == 0.0f);
    feedFor(est, c, 5.0, ms, 2);
    CHECK(est.state() == SpeedState::Acquiring);
    feedFor(est, c, 5.0, ms, 1);
    CHECK(est.state() == SpeedState::Tracking);
    CHECK_NEAR(est.speedMps(), 5.0, 0.01);
  }

  // 保持期間速度變了（例如急煞）：回來的量測連續 3 筆彼此一致 → 重新初始化，不會卡在舊速度
  {
    GroundSpeedEstimator est;
    uint32_t ms = 1000;
    feedFor(est, c, 7.0, ms, 20);
    feedNone(est, c, ms, 12);
    CHECK(est.state() == SpeedState::Holding);
    int frames = 0;
    while (fabsf(est.speedMps() - 2.0f) > 0.2f && frames < 10) {
      feedFor(est, c, 2.0, ms, 1);
      frames++;
    }
    CHECK(frames <= 4);
    CHECK(est.state() == SpeedState::Tracking);
  }

  // 雷達離線：速度未知
  {
    GroundSpeedEstimator est;
    uint32_t ms = 1000;
    feedFor(est, c, 6.0, ms, 20);
    est.setRadarOffline(ms + 50);
    CHECK(est.state() == SpeedState::NoRadar);
    CHECK(!est.hasSpeed());
  }
}

static void testEstimatorRejection() {
  printf("[GroundSpeedEstimator：剔除不是路面的量測]\n");
  const SpeedConfig c = noFold();
  const GroundWindow w = groundWindow(c);

  GroundSpeedEstimator est;
  uint32_t ms = 1000;
  feedFor(est, c, 5.0, ms, 20);

  // 外插資料框（速度、能量都與上一筆相同）：不算量測
  ms += 100;
  const RadarMeasurement real = target(0.99f, 3.50f, 77777);
  CHECK(est.onFrame(real, ms, c).verdict == FrameVerdict::Accepted);
  ms += 100;
  RadarMeasurement echo = real;
  echo.rangeM += 0.35f;
  CHECK(est.onFrame(echo, ms, c).verdict == FrameVerdict::Repeated);

  // 距離窗口外（後方 5 m 的車、太近的擋泥板）
  ms += 100;
  CHECK(est.onFrame(target(5.0f, 4.0f, 1234), ms, c).verdict == FrameVerdict::OutOfGate);
  ms += 100;
  CHECK(est.onFrame(target(w.minRangeM - 0.05f, 4.0f, 1235), ms, c).verdict == FrameVerdict::OutOfGate);

  // 方向相反（迎面接近的物體）
  ms += 100;
  const FrameResult wrong = est.onFrame(target(0.99f, -3.0f, 1236), ms, c);
  CHECK(wrong.verdict == FrameVerdict::WrongDirection);
  CHECK(wrong.hasGround);

  // 單筆離群值（車輪、腳）：剔除，速度不受影響
  ms += 100;
  CHECK(est.onFrame(target(0.99f, 6.5f, 1237), ms, c).verdict == FrameVerdict::Outlier);
  CHECK_NEAR(est.speedMps(), 5.0, 0.05);
  feedFor(est, c, 5.0, ms, 1);
  CHECK_NEAR(est.speedMps(), 5.0, 0.05);
  CHECK(est.state() == SpeedState::Tracking);

  // 停著時偶爾出現的雜散目標：一兩筆不會讓車速跳起來（要 3 筆一致）
  GroundSpeedEstimator idle;
  uint32_t ms2 = 1000;
  feedNone(idle, c, ms2, 5);
  ms2 += 100;
  idle.onFrame(target(1.2f, 2.5f, 501), ms2, c);
  ms2 += 100;
  idle.onFrame(target(1.4f, 0.6f, 502), ms2, c);
  ms2 += 100;
  idle.onFrame(target(1.1f, 4.0f, 503), ms2, c);
  CHECK(idle.state() != SpeedState::Tracking);
  CHECK(idle.speedMps() == 0.0f);
  feedNone(idle, c, ms2, 8);
  CHECK(idle.state() == SpeedState::Stopped);

  // DIR 設反：地面回波全部「方向相反」→ 不會量到速度，但 WD 會提示
  SpeedConfig flipped = c;
  flipped.direction = -1;
  GroundSpeedEstimator f;
  uint32_t ms3 = 1000;
  for (int i = 0; i < 20; i++) {
    ms3 += 100;
    f.onFrame(ideal(c, 5.0), ms3, flipped);  // 雷達照 DIR = +1 的方式回報
  }
  CHECK(f.state() == SpeedState::Stopped);
  CHECK(f.wrongDirectionPct() == 100);
  CHECK(f.qualityPct() == 0);

  // 接近 C4001 測速上限：不採用；一直超過 → 「超過測速上限」而不是一般的訊號中斷
  GroundSpeedEstimator fast;
  uint32_t ms4 = 1000;
  feedFor(fast, c, 12.0, ms4, 20);
  CHECK(fast.state() == SpeedState::Tracking);
  const double vLimit = (c.radialLimitMps - 0.02) / cos(rad(45));  // 截斷的雷達：讀值停在上限
  ms4 += 100;
  CHECK(fast.onFrame(ideal(c, vLimit), ms4, c).verdict == FrameVerdict::AtLimit);
  for (int i = 0; i < 25; i++) {
    ms4 += 100;
    fast.onFrame(ideal(c, vLimit), ms4, c);
  }
  CHECK(fast.state() == SpeedState::OverRange);
  CHECK(!fast.hasSpeed());
}

// ------------------------------------------------------------ 估計器：雷達測速上限（VMAX）

static void testRadialLimit() {
  printf("[GroundSpeedEstimator：測速上限、折疊]\n");
  SpeedConfig c = SpeedConfig::defaults();
  CHECK_NEAR(c.radialLimitMps, 3.28, 1e-6);  // 預設：假設 C4001 的上限只有 3.28 m/s（45° 時約 16.7 km/h）
  const double cos45 = cos(rad(45));

  // 會折疊的雷達：2 → 8 m/s（1 m/s²），徑向 1.41 → 5.66，在 4.5 m/s 越過上限
  GroundSpeedEstimator fold;
  uint32_t ms = 1000;
  int unfolded = 0, wrong = 0;
  for (int k = 0; k <= 60; k++) {
    const double v = 2.0 + 0.1 * k;
    ms += 100;
    const FrameResult r = fold.onFrame(target(0.99f, foldRadial(v * cos45, 3.28), 3000 + k), ms, c);
    CHECK(!r.limitExceeded);  // 會折疊的雷達不會回報超過上限的值：不會誤觸自動調高
    unfolded += r.verdict == FrameVerdict::Unfolded;
    wrong += r.verdict == FrameVerdict::WrongDirection;
  }
  CHECK(fold.state() == SpeedState::Tracking);
  CHECK_NEAR(fold.speedMps(), 8.0, 0.3);
  CHECK(unfolded > 20);
  CHECK(wrong == 0);
  CHECK(fold.qualityPct() >= 80);  // 折疊還原的也算可用量測

  // 會截斷的雷達：超過上限後一直回報 3.2 → 「超出測速上限」，不會卡在 16 km/h 當成真的速度
  GroundSpeedEstimator cap;
  ms = 1000;
  for (int k = 0; k <= 60; k++) {
    const double v  = 2.0 + 0.1 * k;
    const double vr = v * cos45 < 3.25 ? v * cos45 : 3.26 + 0.005 * (k % 3);
    ms += 100;
    cap.onFrame(target(0.99f, static_cast<float>(vr), 4000 + k), ms, c);
  }
  CHECK(cap.state() == SpeedState::OverRange);
  CHECK(!cap.hasSpeed());

  // 雷達其實能量到更高（不折疊、上限 10）：量到 |vr| > VMAX + 0.3 就回報 limitExceeded，
  // SpeedRadarApp 會把 VMAX 調為 10；調整前估計器照樣追蹤（候選值只往上加 2·VMAX，不會誤還原）
  GroundSpeedEstimator high;
  ms = 1000;
  int exceeded = 0;
  for (int i = 0; i < 30; i++) {
    ms += 100;
    exceeded += high.onFrame(ideal(c, 6.0), ms, c).limitExceeded;  // 徑向 4.24 m/s
  }
  CHECK(exceeded == 30);
  CHECK(high.state() == SpeedState::Tracking);
  CHECK_NEAR(high.speedMps(), 6.0, 0.05);

  // 訊號中斷後重新擷取：用中斷前的速度還原折疊（不然高速時折疊的讀值會被當成「方向相反」而永遠接不回來）
  GroundSpeedEstimator relock;
  ms = 1000;
  for (int k = 0; k <= 40; k++) {  // 加速到 7 m/s（徑向 4.95，已折疊）
    ms += 100;
    relock.onFrame(target(0.99f, foldRadial(fmin(7.0, 2.0 + 0.2 * k) * cos45, 3.28), 5000 + k), ms, c);
  }
  CHECK(relock.state() == SpeedState::Tracking);
  CHECK_NEAR(relock.speedMps(), 7.0, 0.3);
  feedNone(relock, c, ms, 25);  // 2.5 秒沒有回波
  CHECK(relock.state() == SpeedState::Lost);
  for (int k = 0; k < 4; k++) {
    ms += 100;
    relock.onFrame(target(0.99f, foldRadial(6.8 * cos45, 3.28), 6000 + k), ms, c);
  }
  CHECK(relock.state() == SpeedState::Tracking);
  CHECK_NEAR(relock.speedMps(), 6.8, 0.3);

  // 折疊的雷達上，追蹤中看到的負值會被解釋成折疊（與真正迎面而來的物體無法分辨，這是折疊本身的限制）
  GroundSpeedEstimator amb;
  ms = 1000;
  for (int k = 0; k <= 40; k++) {
    ms += 100;
    amb.onFrame(target(0.99f, foldRadial(fmin(5.0, 2.0 + 0.2 * k) * cos45, 3.28), 7000 + k), ms, c);
  }
  ms += 100;
  CHECK(amb.onFrame(target(0.99f, -3.0f, 7999), ms, c).verdict != FrameVerdict::WrongDirection);
}

// ------------------------------------------------------------ 估計器：雜訊下的精度（模擬）
static void testEstimatorAccuracy() {
  printf("[GroundSpeedEstimator：雜訊、加減速、雜散目標]\n");
  SpeedConfig c = noFold();

  // 典型雜訊：散射點俯角分散 6°、雷達雜訊 0.1 m/s、上下震動 0.1 m/s、90% 有回波
  GroundRadarSim sim;
  sim.spreadDeg      = 6;
  sim.radialNoiseMps = 0.10;
  sim.bounceMps      = 0.10;
  sim.pDetect        = 0.9;
  sim.rangeNoiseM    = 0.03;
  RunStats s = runProfile(sim, c, cruise6, 60, 11);
  CHECK(s.rmsErr < 0.30);
  CHECK(fabs(s.meanErrPct) < 1.5);
  CHECK(fabs(s.distErrPct) < 1.5);
  CHECK(s.trackingPct > 95);

  // 加速 2 m/s²、急煞 −4 m/s² 到停：跟得上，停下後判定靜止，里程誤差小
  RunStats ab = runProfile(sim, c, accelBrake, 20, 12);
  CHECK(ab.rmsErr < 0.6);
  CHECK(fabs(ab.distErrPct) < 3.0);

  // 城市騎乘：起步、變速、停等、再起步
  RunStats mix = runProfile(sim, c, rideMix, 45, 13);
  CHECK(mix.rmsErr < 0.45);
  CHECK(fabs(mix.distErrPct) < 3.0);

  // 15% 雜散目標（車輪、腳、路人）
  GroundRadarSim noisy = sim;
  noisy.pOutlier = 0.15;
  noisy.pDetect  = 0.8;
  RunStats o = runProfile(noisy, c, cruise6, 60, 14);
  CHECK(o.rmsErr < 0.45);
  CHECK(fabs(o.distErrPct) < 3.0);

  // 回波斷斷續續（只有 50% 有回波）：仍然追蹤，不會一直掉到「訊號中斷」
  GroundRadarSim sparse = sim;
  sparse.pDetect = 0.5;
  RunStats sp = runProfile(sparse, c, cruise6, 60, 15);
  CHECK(sp.trackingPct > 90);
  CHECK(sp.rmsErr < 0.45);  // 一半的資料框沒有回波：可用量測少一半，雜訊約 √2 倍

  // 停車時不會亂跳：靜止 30 秒（沒有回波 + 偶爾雜散目標）
  GroundRadarSim idleSim;
  idleSim.pOutlier = 0.05;
  GroundSpeedEstimator est;
  Rng rng(16);
  int moving = 0;
  for (int k = 0; k < 300; k++) {
    est.onFrame(idleSim.frame(0.0, rng), 1000 + k * 100, c);
    if (est.speedMps() > 0.0f) moving++;
  }
  CHECK(moving < 10);  // < 1 秒
}

// ------------------------------------------------------------ 模型比較：固定角度 vs 距離幾何
static void testModels() {
  printf("[速度模型：固定角度 vs 距離幾何]\n");
  SpeedConfig fixedCfg = noFold();
  SpeedConfig geomCfg  = fixedCfg;
  geomCfg.model        = SpeedModel::RangeGeometry;

  // 散射點偏向正下方 10°（光滑路面）：固定角度模型低估（cos 55° / cos 45° = 0.81），距離幾何不受影响
  GroundRadarSim smooth;
  smooth.shiftDeg       = 10;
  smooth.spreadDeg      = 6;
  smooth.radialNoiseMps = 0.05;
  smooth.rangeNoiseM    = 0.01;
  const RunStats f = runProfile(smooth, fixedCfg, cruise6, 30, 21);
  const RunStats g = runProfile(smooth, geomCfg, cruise6, 30, 21);
  CHECK(f.meanErrPct < -15 && f.meanErrPct > -22);
  CHECK(fabs(g.meanErrPct) < 2.0);

  // 距離量測有偏差（+5 cm）時，距離幾何也會偏，但仍可用 CAL 校正（偏差固定）
  GroundRadarSim biased = smooth;
  biased.rangeBiasM = 0.05;
  const RunStats gb = runProfile(biased, geomCfg, cruise6, 30, 22);
  CHECK(gb.meanErrPct < 0 && gb.meanErrPct > -10);
}

// 印出各情境的平均表現（docs/ALGORITHM.md §9 的數據來源）：每種情境 20 次
static void printScenarioReport() {
  printf("\n[情境報告] 俯角分散 7°、雷達雜訊 0.1 m/s、上下震動 0.1 m/s、90%% 有回波；每種 20 次的平均\n");
  printf("  %-34s %10s %10s %10s %10s\n", "情境", "RMS m/s", "平均誤差%", "里程誤差%", "有速度%");
  struct Scenario {
    const char* name;
    Profile     profile;
    double      seconds;
    double      pDetect;
    double      pOutlier;
    double      foldLimit;
  };
  const Scenario scenarios[] = {
      {"起步後 6 m/s 巡航", cruiseFromRest, 60, 0.9, 0.0, 0},
      {"加速 2 m/s² 到 8 m/s、急煞 −4 m/s²", accelBrake, 20, 0.9, 0.0, 0},
      {"城市騎乘（變速、停等、再起步）", rideMix, 45, 0.9, 0.0, 0},
      {"15% 雜散目標（車輪、腳、路人）", cruiseFromRest, 60, 0.8, 0.15, 0},
      {"只有 50% 的資料框有回波", cruiseFromRest, 60, 0.5, 0.0, 0},
      {"折疊的雷達（上限 3.28 m/s）城市騎乘", rideMix, 45, 0.9, 0.0, 3.28},
  };
  for (const Scenario& sc : scenarios) {
    SpeedConfig cfg = sc.foldLimit > 0 ? SpeedConfig::defaults() : noFold();
    double rms = 0, mean = 0, dist = 0, known = 0;
    for (int rep = 0; rep < 20; rep++) {
      GroundRadarSim sim;
      sim.spreadDeg = 7, sim.radialNoiseMps = 0.1, sim.bounceMps = 0.1, sim.rangeNoiseM = 0.03;
      sim.pDetect = sc.pDetect, sim.pOutlier = sc.pOutlier, sim.foldLimit = sc.foldLimit;
      const RunStats r = runProfile(sim, cfg, sc.profile, sc.seconds, 500 + rep * 13);
      rms += r.rmsErr / 20;
      mean += r.meanErrPct / 20;
      dist += r.distErrPct / 20;
      known += r.trackingPct / 20;
    }
    printf("  %-34s %10.3f %10.2f %10.2f %10.1f\n", sc.name, rms, mean, dist, known);
  }
}

// 印出模擬比較表（docs/ALGORITHM.md §9 的數據來源）。
// 散射點的加權偏移取自文獻回顧的物理模型（高斯波束 40°×100°、Viikari 2009 的 24 GHz 柏油 σ0）：
// 漫射路面的峰值偏差約 −14%（等效偏移 +7.5°），平滑／潮濕路面約 −27%（+14°）。單框散佈 ±12%（俯角分散 7°）
static void printSimulationReport() {
  printf("\n[模擬報告] 起步後 6 m/s 巡航 60 s × 20 次；CAL 在乾柏油上以 3 趟 100 m 距離校正（起終點停住），再換到其他路面\n");
  printf("  %-30s %-10s %10s %10s %10s\n", "路面（等效偏移）", "模型", "平均誤差%", "RMS m/s", "里程誤差%");
  struct Surface {
    const char* name;
    double      shiftDeg;
    double      rangeBiasM;
  };
  const Surface surfaces[] = {
      {"乾柏油 +7.5°（校正用）", 7.5, 0.0},
      {"粗糙漫射面 +6.5°", 6.5, 0.0},
      {"平滑／潮濕 +14°", 14.0, 0.0},
      {"乾柏油、距離偏差 +3 cm", 7.5, 0.03},
  };
  for (int model = 0; model < 2; model++) {
    SpeedConfig cfg = noFold();
    cfg.model       = model == 0 ? SpeedModel::FixedAngle : SpeedModel::RangeGeometry;
    GroundRadarSim base;
    base.shiftDeg = 7.5, base.spreadDeg = 7, base.radialNoiseMps = 0.1, base.bounceMps = 0.1, base.rangeNoiseM = 0.03;
    base.pDetect = 0.9;
    // 校正：乾柏油上 3 趟 100 m（與實際程序相同：起點停住 → 加速 → 巡航 → 在終點停住），
    // CAL = 真實總距離 / 量到的總距離
    double measured = 0;
    for (int run = 0; run < 3; run++) measured += 100.0 * (1.0 + runProfile(base, cfg, calibrationRun, 25, 90 + run).distErrPct / 100.0);
    cfg.calibration = static_cast<float>(300.0 / measured);
    for (const Surface& sf : surfaces) {
      if (model == 0 && sf.rangeBiasM != 0.0) continue;  // 固定角度模型不用距離，不受影響
      double mean = 0, rms = 0, dist = 0;
      for (int rep = 0; rep < 20; rep++) {
        GroundRadarSim s = base;
        s.shiftDeg       = sf.shiftDeg;
        s.rangeBiasM     = sf.rangeBiasM;
        const RunStats r = runProfile(s, cfg, cruiseFromRest, 60, 1000 + rep * 7);
        mean += r.meanErrPct / 20;
        rms += r.rmsErr / 20;
        dist += r.distErrPct / 20;
      }
      printf("  %-30s %-10s %10.2f %10.3f %10.2f\n", sf.name, model == 0 ? "固定角度" : "距離幾何", mean, rms, dist);
    }
  }
  printf("\n");
}

// ------------------------------------------------------------ 輪速感測器（參考值）
static void testWheelSpeed() {
  printf("[WheelSpeed]\n");
  const uint16_t c700 = 2105;  // 700×25C 輪周長（mm）
  const float    kmh  = 1 / 3.6f;
  WheelSpeed w;
  CHECK(!w.seen());
  CHECK(w.speedMps(1000, c700) == 0.0f);  // 沒接感測器
  CHECK(w.revolutions() == 0);

  // 20 km/h：每圈 2.105 m ÷ 5.556 m/s ≈ 379 ms
  CHECK(w.onPulse(1000));
  CHECK(w.seen());
  CHECK(w.revolutions() == 0);
  CHECK(w.speedMps(1100, c700) == 0.0f);  // 只有一個脈衝：還不知道速度
  for (uint32_t i = 1; i <= 5; i++) CHECK(w.onPulse(1000 + i * 379));
  CHECK(w.revolutions() == 5);
  const uint32_t last = 1000 + 5 * 379;
  CHECK_NEAR(w.speedMps(last + 10, c700), 20.0f * kmh, 0.03f);
  CHECK_NEAR(w.speedMps(last + 10, 1500), 20.0f * kmh * 1500 / 2105, 0.03f);  // 輪周長不同 → 等比例

  CHECK(!w.onPulse(last + 10));  // 間隔太短（雜訊、彈跳）：不採用，速度與圈數不變
  CHECK(w.revolutions() == 5);
  CHECK_NEAR(w.speedMps(last + 20, c700), 20.0f * kmh, 0.03f);

  // 減速：下一圈還沒到，就用「已經過了多久」當間隔 → 2 倍時間時約剩一半
  CHECK_NEAR(w.speedMps(last + 758, c700), 10.0f * kmh, 0.03f);
  CHECK(w.speedMps(last + wheel_tuning::kStopMs + 1, c700) == 0.0f);  // 太久沒有脈衝：停止

  // 停車後再出發：停車那段間隔不算速度，但輪子確實轉了一圈
  CHECK(w.onPulse(last + 5000));
  CHECK(w.revolutions() == 6);
  CHECK(w.speedMps(last + 5100, c700) == 0.0f);
  CHECK(w.onPulse(last + 5000 + 758));  // 10 km/h
  CHECK_NEAR(w.speedMps(last + 5000 + 760, c700), 10.0f * kmh, 0.03f);
}

// ------------------------------------------------------------ 指令
static void testCommands() {
  printf("[CommandParser]\n");
  SpeedConfig c = SpeedConfig::defaults();
  const char* err = nullptr;

  CHECK(parseCommand("GET").type == CommandType::Get);
  CHECK(parseCommand("  help\r\n").type == CommandType::Help);
  CHECK(parseCommand("?").type == CommandType::Help);
  CHECK(parseCommand("").type == CommandType::None);
  CHECK(parseCommand("GETX").type == CommandType::Unknown);
  CHECK(parseCommand("FOO 1").type == CommandType::Unknown);
  CHECK(parseCommand("MINSPD 1.5").type == CommandType::Unknown);  // 舊版（後方來車）的指令

  CHECK(applyCommand(parseCommand("angle 30"), c, &err));
  CHECK_NEAR(c.angleDeg, 30.0, 1e-6);
  CHECK(applyCommand(parseCommand("ANGLE=15"), c, &err));   // 邊界值
  CHECK(applyCommand(parseCommand("ANGLE 75"), c, &err));
  CHECK(!applyCommand(parseCommand("ANGLE 80"), c, &err));
  CHECK(!applyCommand(parseCommand("ANGLE 45abc"), c, &err));
  CHECK(!applyCommand(parseCommand("ANGLE"), c, &err));
  CHECK_NEAR(c.angleDeg, 75.0, 1e-6);  // 失敗時設定不變

  CHECK(applyCommand(parseCommand("HEIGHT: 0.55"), c, &err));
  CHECK_NEAR(c.heightM, 0.55, 1e-6);
  CHECK(applyCommand(parseCommand("HEIGHT 0.15"), c, &err));  // float 下限 0.15f 也要接受
  CHECK(applyCommand(parseCommand("HEIGHT 1.5"), c, &err));
  CHECK(!applyCommand(parseCommand("HEIGHT 0.1"), c, &err));
  CHECK(!applyCommand(parseCommand("HEIGHT 2"), c, &err));

  CHECK(applyCommand(parseCommand("DIR -1"), c, &err) && c.direction == -1);
  CHECK(applyCommand(parseCommand("dir 1"), c, &err) && c.direction == 1);
  CHECK(!applyCommand(parseCommand("DIR 0"), c, &err));

  CHECK(applyCommand(parseCommand("MODEL 1"), c, &err) && c.model == SpeedModel::RangeGeometry);
  CHECK(applyCommand(parseCommand("MODEL 0"), c, &err) && c.model == SpeedModel::FixedAngle);
  CHECK(!applyCommand(parseCommand("MODEL 2"), c, &err));
  CHECK(!applyCommand(parseCommand("MODEL 0.5"), c, &err));

  CHECK(applyCommand(parseCommand("CAL 1.0425"), c, &err));
  CHECK_NEAR(c.calibration, 1.0425, 1e-6);
  CHECK(applyCommand(parseCommand("CAL 0.5"), c, &err));
  CHECK(applyCommand(parseCommand("CAL 2"), c, &err));
  CHECK(!applyCommand(parseCommand("CAL 2.01"), c, &err));
  CHECK(!applyCommand(parseCommand("CAL 0"), c, &err));

  CHECK(isConfigCommand(CommandType::RadarThreshold));
  CHECK(applyCommand(parseCommand("rthr 10"), c, &err) && c.radarThreshold == 10);
  CHECK(!applyCommand(parseCommand("RTHR 0"), c, &err));
  CHECK(!applyCommand(parseCommand("RTHR 51"), c, &err));
  CHECK(!applyCommand(parseCommand("RTHR 5.5"), c, &err));
  CHECK(c.radarThreshold == 10);

  CHECK(isConfigCommand(CommandType::Wheel));
  CHECK(applyCommand(parseCommand("WHEEL 2070"), c, &err) && c.wheelMm == 2070);
  CHECK(!applyCommand(parseCommand("WHEEL 999"), c, &err));
  CHECK(!applyCommand(parseCommand("WHEEL 2105.5"), c, &err));
  CHECK(c.wheelMm == 2070);

  CHECK(!isConfigCommand(CommandType::Get));
  CHECK(!isConfigCommand(CommandType::Reboot));
  CHECK(!applyCommand(parseCommand("GET"), c, &err));

  CHECK(isConfigCommand(CommandType::RadialLimit));
  CHECK(applyCommand(parseCommand("VMAX 3.2"), c, &err));
  CHECK_NEAR(c.radialLimitMps, 3.2, 1e-6);
  CHECK(applyCommand(parseCommand("vmax 20"), c, &err));
  CHECK(!applyCommand(parseCommand("VMAX 1.5"), c, &err));
  CHECK(!applyCommand(parseCommand("VMAX 25"), c, &err));
  CHECK_NEAR(c.radialLimitMps, 20.0, 1e-6);

  // 後方來車
  CHECK(isConfigCommand(CommandType::RearRange) && isConfigCommand(CommandType::RearTtc));
  CHECK(applyCommand(parseCommand("RANGE 20"), c, &err) && c.rear.rangeM == 20);
  CHECK(applyCommand(parseCommand("range=5"), c, &err) && c.rear.rangeM == 5);
  CHECK(applyCommand(parseCommand("RANGE 50"), c, &err) && c.rear.rangeM == 50);
  CHECK(!applyCommand(parseCommand("RANGE 4"), c, &err));
  CHECK(!applyCommand(parseCommand("RANGE 51"), c, &err));
  CHECK(!applyCommand(parseCommand("RANGE 15.5"), c, &err));
  CHECK(c.rear.rangeM == 50);
  CHECK(applyCommand(parseCommand("RSPD 8"), c, &err) && c.rear.minSpeedKmh == 8);
  CHECK(!applyCommand(parseCommand("RSPD 0"), c, &err));
  CHECK(!applyCommand(parseCommand("RSPD 31"), c, &err));
  CHECK(applyCommand(parseCommand("TTC 3.5"), c, &err));
  CHECK_NEAR(c.rear.ttcS, 3.5, 1e-6);
  CHECK(applyCommand(parseCommand("TTC 1"), c, &err) && applyCommand(parseCommand("TTC 6"), c, &err));
  CHECK(!applyCommand(parseCommand("TTC 0.9"), c, &err));
  CHECK(!applyCommand(parseCommand("TTC 6.5"), c, &err));
  CHECK(applyCommand(parseCommand("RSNR 6"), c, &err) && c.rear.snr == 6);
  CHECK(!applyCommand(parseCommand("RSNR 2"), c, &err));
  CHECK(!applyCommand(parseCommand("RSNR 9"), c, &err));
  CHECK(!applyCommand(parseCommand("RSNR 4.5"), c, &err));
  CHECK(strstr(kHelpText, "RANGE") != nullptr && strstr(kHelpText, "TTC") != nullptr);

  CHECK(applyCommand(parseCommand("DEFAULTS"), c, &err));
  CHECK(c.rear.rangeM == 15 && c.rear.minSpeedKmh == 5 && c.rear.snr == 4);
  CHECK_NEAR(c.rear.ttcS, 2.5, 1e-6);
  CHECK_NEAR(c.radialLimitMps, 3.28, 1e-6);
  CHECK_NEAR(c.angleDeg, 45.0, 1e-6);
  CHECK_NEAR(c.heightM, 0.70, 1e-6);
  CHECK(c.direction == 1 && c.model == SpeedModel::FixedAngle);
  CHECK_NEAR(c.calibration, 1.0, 1e-6);
  CHECK(c.radarThreshold == 5 && c.wheelMm == 2105);
  CHECK(c.isValid());

  SpeedConfig bad = SpeedConfig::defaults();
  bad.calibration = NAN;
  CHECK(!bad.isValid());
  bad = SpeedConfig::defaults();
  bad.radialLimitMps = 0.5f;
  CHECK(!bad.isValid());
  bad = SpeedConfig::defaults();
  bad.direction = 0;
  CHECK(!bad.isValid());
  bad = SpeedConfig::defaults();
  bad.model = static_cast<SpeedModel>(7);
  CHECK(!bad.isValid());
  // 後方設定壞掉：整體不合法，但對地測速的欄位仍合法（讀回 NVS 時分開處理，不會清掉校正係數）
  bad = SpeedConfig::defaults();
  bad.rear.ttcS = NAN;
  CHECK(!bad.isValid() && bad.speedFieldsValid() && !bad.rear.isValid());
  bad.rear = RearConfig::defaults();
  bad.rear.rangeM = 2;
  CHECK(!bad.rear.isValid());
  bad.rear = RearConfig::defaults();
  bad.rear.snr = 9;
  CHECK(!bad.rear.isValid());
}

// ------------------------------------------------------------ 輸出格式
static RearFrame  rearFrame(std::initializer_list<RearTarget> targets);
static RearTarget rearTarget(double distanceM, double speedKmh, bool approaching = true, int angle = 0);

static bool hasToken(const char* line, const char* token) {
  const size_t n = strlen(token);
  for (const char* p = strstr(line, token); p; p = strstr(p + 1, token)) {
    const bool startOk = p == line || p[-1] == ' ';
    const char end     = p[n];
    if (startOk && (end == ' ' || end == '\n' || end == '\0')) return true;
  }
  return false;
}

static void testTelemetry() {
  printf("[Telemetry]\n");
  char line[kTelemetryLineMax];

  // 一般追蹤中
  TelemetrySnapshot s;
  s.radarOnline      = true;
  s.state            = SpeedState::Tracking;
  s.hasSpeed         = true;
  s.speedMps         = 5.4321f;
  s.sigmaMps         = 0.12f;
  s.qualityPct       = 95;
  s.frame            = 1234;
  s.hasFrame         = true;
  s.raw              = target(0.86f, 3.84f, 52000);
  s.result.verdict   = FrameVerdict::Accepted;
  s.result.hasGround = true;
  s.result.groundMps = 5.40f;
  s.radarDistanceM   = 1234.56;
  s.uptimeS          = 812;
  size_t n = formatTelemetry(s, line, sizeof(line));
  CHECK(n > 0 && line[n - 1] == '\n');
  CHECK(strcmp(line, "R=1 ST=3 V=5.43 SD=0.12 Q=95 WD=0 FN=1234 N=1 RD=0.86 RV=3.84 E=52000 G=5.40 FV=0 DR=1234.6 T=812\n") == 0);
  CHECK(!hasToken(line, "W=5.51"));  // 沒接輪速感測器就不送 W、DW

  // 有輪速感測器
  s.hasWheel       = true;
  s.wheelMps       = 5.51f;
  s.wheelDistanceM = 1240.2;
  n = formatTelemetry(s, line, sizeof(line));
  CHECK(hasToken(line, "W=5.51") && hasToken(line, "DW=1240.2"));

  // 靜止、這一筆沒目標
  TelemetrySnapshot idle;
  idle.radarOnline = true;
  idle.state       = SpeedState::Stopped;
  idle.hasSpeed    = true;
  idle.hasFrame    = true;
  idle.frame       = 7;
  n = formatTelemetry(idle, line, sizeof(line));
  CHECK(hasToken(line, "ST=1") && hasToken(line, "V=0.00") && hasToken(line, "N=0") && hasToken(line, "RD=-1.00"));
  CHECK(hasToken(line, "G=-1.00") && hasToken(line, "FV=1"));

  // 訊號中斷：速度未知 → V=-1
  TelemetrySnapshot lost = idle;
  lost.state    = SpeedState::Lost;
  lost.hasSpeed = false;
  n = formatTelemetry(lost, line, sizeof(line));
  CHECK(hasToken(line, "ST=5") && hasToken(line, "V=-1.00"));

  // 雷達離線：狀態 0、速度未知、不送舊的原始值；輪速照送
  TelemetrySnapshot off = s;
  off.radarOnline = false;
  n = formatTelemetry(off, line, sizeof(line));
  CHECK(hasToken(line, "R=0") && hasToken(line, "ST=0") && hasToken(line, "V=-1.00") && hasToken(line, "N=0"));
  CHECK(hasToken(line, "W=5.51"));

  // 最長的一行也放得下（含輪速）
  TelemetrySnapshot big = s;
  big.speedMps       = 123.0f;
  big.sigmaMps       = 123.0f;
  big.qualityPct     = 100;
  big.wrongDirPct    = 100;
  big.frame          = 4294967295UL;
  big.raw            = target(99.0f, -99.0f, 4000000000UL);
  big.result.verdict = FrameVerdict::Acquiring;
  big.result.groundMps = 500.0f;
  big.radarDistanceM = 1e9;
  big.wheelMps       = 500.0f;
  big.wheelDistanceM = 1e9;
  big.uptimeS        = 4294967;
  n = formatTelemetry(big, line, sizeof(line));
  CHECK(n > 0 && n < kTelemetryLineMax - 1);
  CHECK(n <= 180 - 3);  // 一個 BLE 通知送得完（BleLink 每段最多 180 bytes）
  char tiny[20];
  CHECK(formatTelemetry(s, tiny, sizeof(tiny)) == 0);  // 放不下就不送半行

  // 設定
  char cfgLine[kConfigLineMax];
  const SpeedConfig d = SpeedConfig::defaults();
  n = formatConfig(d, "3.0.0", cfgLine, sizeof(cfgLine));
  CHECK(n > 0);
  const char* cfgPrefix = "CFG ANGLE=45.0 HEIGHT=0.70 DIR=1 MODEL=0 CAL=1.0000 RTHR=5 WHEEL=2105 VMAX=3.28 RMIN=";
  CHECK(strncmp(cfgLine, cfgPrefix, strlen(cfgPrefix)) == 0);
  CHECK(hasToken(cfgLine, "FW=3.0.0"));
  CHECK(hasToken(cfgLine, "RANGE=15") && hasToken(cfgLine, "RSPD=5") && hasToken(cfgLine, "TTC=2.5"));
  CHECK(hasToken(cfgLine, "RSNR=4") && hasToken(cfgLine, "RDET=25"));
  CHECK(strstr(cfgLine, "TEST=") == nullptr && strstr(cfgLine, "MINSPD=") == nullptr);  // 網頁用這兩個鍵判斷 2.x 舊韌體
  SpeedConfig wide = d;
  wide.angleDeg = 15, wide.heightM = 1.5f, wide.calibration = 1.9999f, wide.radarThreshold = 50, wide.wheelMm = 3000;
  wide.radialLimitMps = 20.0f;
  wide.rear.rangeM = 50, wide.rear.minSpeedKmh = 30, wide.rear.ttcS = 6.0f, wide.rear.snr = 8;
  n = formatConfig(wide, "10.20.30-beta", cfgLine, sizeof(cfgLine));
  CHECK(n > 0 && n <= 180 - 3);  // 一個 BLE 通知送得完
  CHECK(hasToken(cfgLine, "RDET=60"));

  // 後方來車
  char rear[kRearLineMax];
  RearSnapshot rs;
  n = formatRear(rs, rear, sizeof(rear));
  CHECK(n > 0 && strcmp(rear, "REAR ON=0\n") == 0);
  rs.online             = true;
  rs.frame              = 812;
  n = formatRear(rs, rear, sizeof(rear));
  CHECK(strcmp(rear, "REAR ON=1 RO=0 LV=0 D=-1.0 V=0.00 TTC=-1.0 HOLD=0 N=0 CNT=0 FN=812\n") == 0);
  rs.receiveOnly        = true;
  rs.state.level        = RearLevel::Caution;
  rs.state.hasLead      = true;
  rs.state.distanceM    = 12.43f;
  rs.state.closingMps   = 4.1667f;
  rs.state.ttcS         = 2.98f;
  rs.state.alerts       = 3;
  rs.hasFrame           = true;
  rs.raw                = rearFrame({rearTarget(12, 15, true, -3), rearTarget(31, 40, false, 6)});
  n = formatRear(rs, rear, sizeof(rear));
  CHECK(strcmp(rear, "REAR ON=1 RO=1 LV=1 D=12.4 V=4.17 TTC=3.0 HOLD=0 N=2 CNT=3 FN=812 X=-3/12/15,6/31/-40\n") == 0);
  // 保持中：沒有主要來車 → D/V/TTC 為「沒有」，但等級還在
  rs.state.hasLead = false;
  rs.state.holding = true;
  rs.hasFrame      = false;
  n = formatRear(rs, rear, sizeof(rear));
  CHECK(hasToken(rear, "LV=1") && hasToken(rear, "HOLD=1") && hasToken(rear, "D=-1.0") && hasToken(rear, "N=0"));
  CHECK(strstr(rear, " X=") == nullptr);
  // 最長的一行：5 個目標、最大的數字
  RearSnapshot big2 = rs;
  big2.state.hasLead    = true;
  big2.state.level      = RearLevel::Danger;
  big2.state.distanceM  = 5000.0f;
  big2.state.closingMps = 500.0f;
  big2.state.ttcS       = 500.0f;
  big2.state.alerts     = 4294967295UL;
  big2.frame            = 4294967295UL;
  big2.hasFrame         = true;
  big2.raw              = rearFrame({rearTarget(255, 120, false, -90), rearTarget(255, 120, false, -90), rearTarget(255, 120, false, -90),
                                     rearTarget(255, 120, false, -90), rearTarget(255, 120, false, -90)});
  n = formatRear(big2, rear, sizeof(rear));
  CHECK(n > 0 && n <= 180 - 3);
  CHECK(hasToken(rear, "D=999.9") && hasToken(rear, "TTC=99.9"));
}

// ------------------------------------------------------------ 後方來車雷達 LD2451：協定
// 餵一串位元組，回傳最後一個完成的資料框類型與完成的數量
static int feedLD2451(LD2451FrameParser& p, const uint8_t* bytes, size_t n, LD2451FrameType* last = nullptr) {
  int done = 0;
  for (size_t i = 0; i < n; i++) {
    const LD2451FrameType t = p.push(bytes[i]);
    if (t != LD2451FrameType::None) {
      done++;
      if (last) *last = t;
    }
  }
  return done;
}

static void testLD2451Protocol() {
  printf("[LD2451Protocol]\n");
  uint8_t cmd[ld2451::kMaxCommandFrame];

  // 指令框：與三套開源驅動、協定文件相同的位元組
  const uint8_t enable[] = {0xFD, 0xFC, 0xFB, 0xFA, 0x04, 0x00, 0xFF, 0x00, 0x01, 0x00, 0x04, 0x03, 0x02, 0x01};
  const uint8_t ev[2]    = {0x01, 0x00};
  size_t n = ld2451::buildCommand(ld2451::kCmdEnableConfig, ev, 2, cmd, sizeof(cmd));
  CHECK(n == sizeof(enable) && memcmp(cmd, enable, n) == 0);
  const uint8_t endCfg[] = {0xFD, 0xFC, 0xFB, 0xFA, 0x02, 0x00, 0xFE, 0x00, 0x04, 0x03, 0x02, 0x01};
  n = ld2451::buildCommand(ld2451::kCmdEndConfig, nullptr, 0, cmd, sizeof(cmd));
  CHECK(n == sizeof(endCfg) && memcmp(cmd, endCfg, n) == 0);
  const uint8_t tv[4]     = {25, 1, 5, 1};
  const uint8_t setTgt[]  = {0xFD, 0xFC, 0xFB, 0xFA, 0x06, 0x00, 0x02, 0x00, 25, 1, 5, 1, 0x04, 0x03, 0x02, 0x01};
  n = ld2451::buildCommand(ld2451::kCmdSetTarget, tv, 4, cmd, sizeof(cmd));
  CHECK(n == sizeof(setTgt) && memcmp(cmd, setTgt, n) == 0);
  CHECK(ld2451::buildCommand(ld2451::kCmdSetTarget, tv, 4, cmd, 10) == 0);  // 空間不足

  // 沒有目標時的空資料框（實機擷取，約每 1.4 秒一個）
  LD2451FrameParser p;
  const uint8_t idle[] = {0xF4, 0xF3, 0xF2, 0xF1, 0x00, 0x00, 0xF8, 0xF7, 0xF6, 0xF5};
  LD2451FrameType type = LD2451FrameType::None;
  CHECK(feedLD2451(p, idle, sizeof(idle), &type) == 1 && type == LD2451FrameType::Report && p.length() == 0);
  RearFrame f;
  CHECK(decodeLD2451Report(p.payload(), p.length(), f) && f.count == 0);

  // 兩個目標：正後方偏左 3° 12 m 靠近 30 km/h；偏右 6° 31 m 遠離 40 km/h
  const uint8_t two[] = {0xF4, 0xF3, 0xF2, 0xF1, 12, 0x00, 2, 1, 0x7D, 12, 1, 30, 50, 0x86, 31, 0, 40, 20,
                         0xF8, 0xF7, 0xF6, 0xF5};
  CHECK(feedLD2451(p, two, sizeof(two), &type) == 1 && type == LD2451FrameType::Report);
  CHECK(decodeLD2451Report(p.payload(), p.length(), f));
  CHECK(f.count == 2 && f.alarm == 1);
  CHECK(f.targets[0].angleDeg == -3 && f.targets[0].distanceM == 12 && f.targets[0].approaching() && f.targets[0].speedKmh == 30);
  CHECK(f.targets[0].snr == 50);
  CHECK(f.targets[1].angleDeg == 6 && f.targets[1].distanceM == 31 && !f.targets[1].approaching() && f.targets[1].speedKmh == 40);

  // 實機擷取到的位元錯誤：表尾 F6 F5 變成 F4 F1、表頭 F2 變成 F0 → 整筆丟掉，下一筆照常解出
  const uint32_t badBefore = p.badFrames();
  const uint8_t badTail[] = {0xF4, 0xF3, 0xF2, 0xF1, 0x00, 0x00, 0xF8, 0xF7, 0xF4, 0xF1};
  CHECK(feedLD2451(p, badTail, sizeof(badTail)) == 0);
  CHECK(p.badFrames() == badBefore + 1);
  const uint8_t badHead[] = {0xF4, 0xF3, 0xF0, 0xF1, 0x00, 0x00, 0xF8, 0xF7, 0xF6, 0xF5};
  CHECK(feedLD2451(p, badHead, sizeof(badHead)) == 0);
  CHECK(feedLD2451(p, idle, sizeof(idle)) == 1);
  // 表尾錯的那個位元組剛好是下一個表頭的開始：不能漏掉下一筆
  const uint8_t glued[] = {0xF4, 0xF3, 0xF2, 0xF1, 0x00, 0x00, 0xF8, 0xF7, 0xF4, 0xF3, 0xF2, 0xF1, 0x00, 0x00, 0xF8, 0xF7, 0xF6, 0xF5};
  CHECK(feedLD2451(p, glued, sizeof(glued)) == 1);
  // 雜訊裡有表頭的第一個位元組、長度不合理（位元錯誤）→ 重新同步
  const uint8_t junk[] = {0x00, 0xF4, 0x12, 0xFD, 0xFC, 0xF4, 0xF3, 0xF2, 0xF1, 0xFF, 0x00};
  CHECK(feedLD2451(p, junk, sizeof(junk)) == 0);
  CHECK(feedLD2451(p, idle, sizeof(idle)) == 1);

  // 指令回覆：進入設定成功（協定版本 1、緩衝區 0x40）
  const uint8_t ack[] = {0xFD, 0xFC, 0xFB, 0xFA, 0x08, 0x00, 0xFF, 0x01, 0x00, 0x00, 0x01, 0x00, 0x40, 0x00, 0x04, 0x03, 0x02, 0x01};
  CHECK(feedLD2451(p, ack, sizeof(ack), &type) == 1 && type == LD2451FrameType::Ack);
  LD2451Ack a;
  CHECK(decodeLD2451Ack(p.payload(), p.length(), a) && a.command == 0xFF && a.ok && a.dataLen == 4);
  const uint8_t nack[] = {0xFD, 0xFC, 0xFB, 0xFA, 0x04, 0x00, 0x02, 0x01, 0x01, 0x00, 0x04, 0x03, 0x02, 0x01};
  CHECK(feedLD2451(p, nack, sizeof(nack)) == 1);
  CHECK(decodeLD2451Ack(p.payload(), p.length(), a) && a.command == 0x02 && !a.ok);
  // 讀回目標參數：25 m、只回報靠近、5 km/h、延遲 1 s
  const uint8_t getTgt[] = {0xFD, 0xFC, 0xFB, 0xFA, 0x08, 0x00, 0x12, 0x01, 0x00, 0x00, 25, 1, 5, 1, 0x04, 0x03, 0x02, 0x01};
  CHECK(feedLD2451(p, getTgt, sizeof(getTgt)) == 1);
  CHECK(decodeLD2451Ack(p.payload(), p.length(), a) && a.command == 0x12 && a.dataLen == 4 && a.data[0] == 25 && a.data[1] == 1);

  // 格式檢查（擋位元錯誤）
  const uint8_t six[] = {6, 0};
  CHECK(!decodeLD2451Report(six, 2, f));                          // 目標數 > 5
  const uint8_t shortP[] = {2, 0, 0x80, 10, 1, 20, 9};
  CHECK(!decodeLD2451Report(shortP, sizeof(shortP), f));          // 長度不夠 2 個目標
  const uint8_t badDir[] = {1, 0, 0x80, 10, 2, 20, 9};
  CHECK(!decodeLD2451Report(badDir, sizeof(badDir), f));          // 方向只能 0／1
  const uint8_t fast[] = {1, 0, 0x80, 10, 1, 121, 9};
  CHECK(!decodeLD2451Report(fast, sizeof(fast), f));              // 超過 120 km/h
  const uint8_t wide[] = {1, 0, 0x05, 10, 1, 20, 9};              // 0x85 的最高位元掉成 0 → −123°
  CHECK(!decodeLD2451Report(wide, sizeof(wide), f));
  CHECK(!decodeLD2451Report(two, 1, f));
  const uint8_t ackShort[] = {0xFF, 0x01, 0x00};
  CHECK(!decodeLD2451Ack(ackShort, 3, a));
}

// ------------------------------------------------------------ 後方來車：警示判斷
static RearFrame rearFrame(std::initializer_list<RearTarget> targets) {
  RearFrame f;
  for (const RearTarget& t : targets) {
    if (f.count < kRearMaxTargets) f.targets[f.count++] = t;
  }
  return f;
}

static RearTarget rearTarget(double distanceM, double speedKmh, bool approaching, int angle) {
  RearTarget t;
  t.angleDeg  = static_cast<int8_t>(angle);
  t.distanceM = static_cast<uint8_t>(lround(distanceM < 0 ? 0 : distanceM));  // LD2451 的距離是整數公尺
  t.speedKmh  = static_cast<uint8_t>(lround(speedKmh));
  t.direction = approaching ? kRearApproachByte : 0;
  t.snr       = 30;
  return t;
}

static void testRearThreat() {
  printf("[RearThreat]\n");
  const RearConfig cfg = RearConfig::defaults();
  CHECK(cfg.rangeM == 15 && cfg.minSpeedKmh == 5 && cfg.snr == 4);
  CHECK_NEAR(cfg.ttcS, 2.5, 1e-6);
  CHECK(cfg.detectRangeM() == 25);
  RearConfig far = cfg;
  far.rangeM = 50;
  CHECK(far.detectRangeM() == 60);
  far.rangeM = 95;  // 不合法，但偵測距離仍夾在 100 以內
  CHECK(far.detectRangeM() == 100);

  // 1. 一台車以接近速度 20 km/h 從 24 m 追上來，到 2 m 時從視野消失（在旁邊超車）
  {
    RearThreat th;
    const double v = 20 / 3.6;
    uint32_t t = 1000;
    double   d = 24.0;
    bool sawSafeFar = false, sawCaution = false, sawDanger = false;
    double cautionAt = -1, dangerAt = -1;
    int changes = 0;
    bool firstFrameSafe = false;
    for (int i = 0; d > 2.0; i++, t += 100, d -= v * 0.1) {
      th.onFrame(rearFrame({rearTarget(d, 20)}), t, cfg);
      th.update(t, cfg);
      if (th.consumeLevelChange()) changes++;
      const RearState& s = th.state();
      if (i == 0) firstFrameSafe = s.level == RearLevel::Safe && !s.hasLead;  // 單一筆還沒確認
      if (d > 16 && s.level == RearLevel::Safe) sawSafeFar = true;
      if (s.level == RearLevel::Caution && cautionAt < 0) cautionAt = d, sawCaution = true;
      if (s.level == RearLevel::Danger && dangerAt < 0) dangerAt = d, sawDanger = true;
    }
    CHECK(firstFrameSafe);
    CHECK(sawSafeFar && sawCaution && sawDanger);
    CHECK(cautionAt <= 15.6 && cautionAt >= 14.0);            // 進入 15 m 才注意
    CHECK(dangerAt <= 14.5 && dangerAt >= 12.5);              // 到達時間 ≤ 2.5 s（約 13.9 m）才危險
    const RearState& s = th.state();
    CHECK(s.hasLead && s.level == RearLevel::Danger);
    CHECK_NEAR(s.closingMps, v, 0.15);
    CHECK(s.ttcS > 0 && s.ttcS < 1.0);
    // 車子不在視野了：資料框沒有目標 → 警示保持 1.5 秒
    for (int i = 0; i < 5; i++, t += 100) {
      th.onFrame(rearFrame({}), t, cfg);
      th.update(t, cfg);
    }
    CHECK(th.state().level == RearLevel::Danger && th.state().holding && !th.state().hasLead);
    CHECK(th.state().distanceM < 0 && th.state().ttcS < 0);
    for (int i = 0; i < 20; i++, t += 100) th.update(t, cfg);
    CHECK(th.state().level == RearLevel::Safe && !th.state().holding);
    CHECK(th.consumeLevelChange() || changes > 0);
    CHECK(th.state().alerts == 1);  // 一次警示（注意 → 危險不重複算）
    CHECK(th.trendAgree() == 1 && th.trendDisagree() == 0);  // 距離趨勢與「靠近」一致
  }

  // 2. 單一筆雜訊（很近的目標）不會警示
  {
    RearThreat th;
    th.onFrame(rearFrame({rearTarget(4, 30)}), 1000, cfg);
    th.update(1000, cfg);
    CHECK(th.state().level == RearLevel::Safe && !th.state().hasLead);
    th.onFrame(rearFrame({}), 1100, cfg);
    th.onFrame(rearFrame({}), 1200, cfg);
    for (uint32_t t = 1200; t < 4000; t += 100) th.update(t, cfg);
    CHECK(th.state().level == RearLevel::Safe && th.state().alerts == 0);
  }

  // 3. 遠離的目標、太慢、太遠的目標都不算
  {
    RearThreat th;
    uint32_t t = 1000;
    for (int i = 0; i < 10; i++, t += 100) {
      th.onFrame(rearFrame({rearTarget(8, 30, false), rearTarget(10, 3), rearTarget(40, 60)}), t, cfg);
      th.update(t, cfg);
    }
    CHECK(th.state().level == RearLevel::Safe && !th.state().hasLead && th.state().alerts == 0);
  }

  // 4. 很近（≤ 5 m）就算接近得慢也是危險
  {
    RearThreat th;
    uint32_t t = 1000;
    for (int i = 0; i < 3; i++, t += 100) th.onFrame(rearFrame({rearTarget(4, 6)}), t, cfg);
    CHECK(th.state().level == RearLevel::Danger);
  }

  // 5. 位元錯誤造成單筆距離變近：不會讓追蹤跳過去（接近速度 10 km/h、真實 14 m → 注意；錯誤的 6 m 會變危險）
  {
    RearThreat th;
    const double v = 10 / 3.6;
    uint32_t t = 1000;
    double   d = 15.0;
    for (int i = 0; i < 4; i++, t += 100, d -= v * 0.1) th.onFrame(rearFrame({rearTarget(d, 10)}), t, cfg);
    CHECK(th.state().level == RearLevel::Caution);
    th.onFrame(rearFrame({rearTarget(6, 10)}), t, cfg);  // 14 → 6：位元錯誤
    th.update(t, cfg);
    CHECK(th.state().level == RearLevel::Caution);
    CHECK(th.state().distanceM > 13.0);
    t += 100, d -= v * 0.1;
    th.onFrame(rearFrame({rearTarget(d, 10)}), t, cfg);
    CHECK(th.state().level == RearLevel::Caution && th.state().distanceM > 13.0);
  }

  // 6. 第二台更快的車：連續兩筆一致才換成追蹤它
  {
    RearThreat th;
    uint32_t t = 1000;
    for (int i = 0; i < 5; i++, t += 100) th.onFrame(rearFrame({rearTarget(14, 8)}), t, cfg);
    CHECK(th.state().level == RearLevel::Caution);
    th.onFrame(rearFrame({rearTarget(14, 8), rearTarget(20, 60)}), t, cfg);  // 到達時間 1.2 s：主要威脅換人，第一筆先當跳值
    CHECK(th.state().distanceM > 13.0 && th.state().distanceM < 14.5);
    t += 100;
    th.onFrame(rearFrame({rearTarget(14, 8), rearTarget(18.3, 60)}), t, cfg);
    CHECK(th.state().distanceM > 17.5 && th.state().level == RearLevel::Danger);
  }

  // 7. 回報「靠近」但距離明確在變遠（方向判斷錯、或雷達設定沒寫進去）：排除，不再警示
  {
    RearThreat th;
    uint32_t t = 1000;
    double   d = 9.0;
    for (int i = 0; i < 15; i++, t += 100, d += 0.4) {  // 4 m/s 變遠
      th.onFrame(rearFrame({rearTarget(d, 15)}), t, cfg);
      th.update(t, cfg);
    }
    CHECK(th.trendDisagree() == 1);
    CHECK(!th.state().hasLead);
    for (int i = 0; i < 20; i++, t += 100, d += 0.4) {
      th.onFrame(rearFrame({rearTarget(d, 15)}), t, cfg);
      th.update(t, cfg);
    }
    CHECK(th.state().level == RearLevel::Safe);
    CHECK(th.trendDisagree() == 1);  // 同一台車只算一次
  }

  // 8. LD2451 沒目標時可能完全不送資料框：靠逾時放棄追蹤
  {
    RearThreat th;
    uint32_t t = 1000;
    for (int i = 0; i < 4; i++, t += 100) th.onFrame(rearFrame({rearTarget(12, 12)}), t, cfg);
    CHECK(th.state().hasLead && th.state().level == RearLevel::Caution);
    t += rear_tuning::kLeadLostMs + 50;
    th.update(t, cfg);
    CHECK(!th.state().hasLead && th.state().level == RearLevel::Caution && th.state().holding);
    t += rear_tuning::kHoldMs + 50;
    th.update(t, cfg);
    CHECK(th.state().level == RearLevel::Safe);
  }

  // 9. 雷達離線 reset：警示清除、次數保留，等級變化回報一次
  {
    RearThreat th;
    uint32_t t = 1000;
    for (int i = 0; i < 3; i++, t += 100) th.onFrame(rearFrame({rearTarget(10, 20)}), t, cfg);
    CHECK(th.consumeLevelChange());
    CHECK(!th.consumeLevelChange());
    th.reset();
    CHECK(th.state().level == RearLevel::Safe && th.state().alerts == 1);
    CHECK(th.consumeLevelChange());
  }

  // 10. 參數：RANGE 30 → 25 m 就注意；TTC 1.0 → 危險晚一點
  {
    RearConfig c2 = cfg;
    c2.rangeM = 30;
    c2.ttcS   = 1.0f;
    RearThreat th;
    uint32_t t = 1000;
    for (int i = 0; i < 3; i++, t += 100) th.onFrame(rearFrame({rearTarget(25, 20)}), t, c2);
    CHECK(th.state().level == RearLevel::Caution);
  }
}

int main() {
  testFrameParser();
  testGeometry();
  testEstimatorBasics();
  testEstimatorStopAndDropout();
  testEstimatorRejection();
  testRadialLimit();
  testEstimatorAccuracy();
  testModels();
  testWheelSpeed();
  testCommands();
  testTelemetry();
  testLD2451Protocol();
  testRearThreat();
  printScenarioReport();
  printSimulationReport();

  printf("%d checks, %d failures\n", gChecks, gFailures);
  return gFailures == 0 ? 0 : 1;
}
