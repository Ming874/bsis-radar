// 電腦端單元測試：驗證不依賴硬體的模組（資料框解析、對地速度估計、指令、輸出格式、輪速、後方來車）
// 執行：firmware/arduino.ps1 test 或 firmware/tests/run_tests.sh（需要 g++）
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include <initializer_list>

#include "comm/CommandParser.h"
#include "comm/Telemetry.h"
#include "core/GroundSpeedEstimator.h"
#include "core/RearThreat.h"
#include "core/SpeedConfig.h"
#include "core/WheelSpeed.h"
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
static double deg(double r) { return r * 180.0 / kPi; }

// ------------------------------------------------------------ 工具：亂數
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

// ------------------------------------------------------------ 工具：LD2451 的目標與資料框
static RadarTarget makeTarget(int distanceM, int speedKmh, bool approaching, int angle = 0, int snr = 30) {
  RadarTarget t;
  t.angleDeg  = static_cast<int8_t>(angle);
  t.distanceM = static_cast<uint8_t>(distanceM < 0 ? 0 : (distanceM > 255 ? 255 : distanceM));
  t.speedKmh  = static_cast<uint8_t>(speedKmh < 0 ? 0 : (speedKmh > 255 ? 255 : speedKmh));
  t.direction = approaching ? kApproachByte : 0;
  t.snr       = static_cast<uint8_t>(snr < 0 ? 0 : (snr > 255 ? 255 : snr));
  return t;
}

static RadarFrame frameOf(std::initializer_list<RadarTarget> targets) {
  RadarFrame f;
  for (const RadarTarget& t : targets) {
    if (f.count < kRadarMaxTargets) f.targets[f.count++] = t;
  }
  return f;
}

static RadarFrame none() { return RadarFrame(); }

// 路面上的一個點：距離 r（m）、有號徑向速度 vr（m/s，正 = 遠離雷達）。
// LD2451 回報整數公尺、整數 km/h（文件沒寫是四捨五入還是捨去，這裡用四捨五入）
static RadarTarget groundTarget(double rangeM, double radialMps, int angle = 0, int snr = 30) {
  return makeTarget(static_cast<int>(lround(rangeM)), static_cast<int>(lround(fabs(radialMps) * 3.6)), radialMps < 0, angle,
                    snr);
}

// 理想量測：視軸正中央的路面點（距離 h / sin θ、徑向速度 v cos θ）
static RadarFrame ideal(const SpeedConfig& c, double v) {
  const double a = rad(c.angleDeg);
  return frameOf({groundTarget(c.heightM / sin(a), c.direction * v * cos(a))});
}

// 估計器對 ideal(c, v) 應該算出的對地速度：雷達的速度只有整數 km/h
static double quantized(const SpeedConfig& c, double v) {
  const double a = rad(c.angleDeg);
  return c.calibration * static_cast<double>(lround(v * cos(a) * 3.6)) / 3.6 / cos(a);
}

// 模擬斜照路面的 LD2451：每個資料框回報波束內 1～maxPoints 個路面散射點（整數公尺、整數 km/h、整數度）。
// 散射點的俯角 α = 視軸 + 加權偏移（路面越光滑、越偏向正下方）+ 隨機分散，水平角 φ = 隨機分散；
// 距離 r = h / (cos φ · sin α)；徑向速度 vr = v · cos φ · cos α + 上下震動 + 雷達雜訊。
// 低於 1 km/h 的點雷達不回報（寫進雷達的最低速度）
struct GroundRadarSim {
  double heightM        = 0.70;
  double angleDeg       = 30.0;  // 實際安裝角度
  double shiftDeg       = 0.0;   // 功率加權造成的偏移（正 = 偏向正下方，都卜勒變小）
  double spreadDeg      = 0.0;   // 散射點俯角的標準差
  double azSpreadDeg    = 0.0;   // 散射點水平角的標準差
  double rangeBiasM     = 0.0;
  double radialNoiseMps = 0.0;
  double bounceMps      = 0.0;   // 雷達上下震動的速度標準差
  double pDetect        = 1.0;   // 每個資料框有路面回波的機率
  int    maxPoints      = 1;     // 每個資料框最多幾個路面點
  double pOutlier       = 0.0;   // 每個資料框多一個雜散目標（車、行人、車輪）的機率
  int    radarSign      = 1;     // 朝後安裝：地面遠離

  RadarFrame frame(double v, Rng& rng) {
    RadarFrame f;
    if (v > 0.05 && rng.uniform() < pDetect) {
      int points = 1 + static_cast<int>(rng.uniform() * maxPoints);
      if (points > maxPoints) points = maxPoints;
      for (int i = 0; i < points && f.count < kRadarMaxTargets; i++) {
        double a = angleDeg + shiftDeg + spreadDeg * rng.gauss();
        double az = azSpreadDeg * rng.gauss();
        if (a < 3) a = 3;
        if (a > 88) a = 88;
        if (az > 25) az = 25;
        if (az < -25) az = -25;
        const double r  = heightM / (cos(rad(az)) * sin(rad(a))) + rangeBiasM;
        const double vr = v * cos(rad(az)) * cos(rad(a)) + bounceMps * sin(rad(a)) * rng.gauss() +
                          radialNoiseMps * rng.gauss();
        const RadarTarget t = groundTarget(r, radarSign * vr, static_cast<int>(lround(az)),
                                           10 + static_cast<int>(rng.uniform() * 40));
        if (t.speedKmh == 0) continue;
        f.targets[f.count++] = t;
      }
    }
    if (f.count < kRadarMaxTargets && rng.uniform() < pOutlier) {
      const int kmh = static_cast<int>(lround(-10 + rng.uniform() * 40));  // −10～30 km/h（負 = 靠近）
      if (kmh != 0) {
        f.targets[f.count++] = makeTarget(static_cast<int>(rng.uniform() * 9), abs(kmh), kmh < 0,
                                          static_cast<int>(lround(-20 + rng.uniform() * 40)),
                                          10 + static_cast<int>(rng.uniform() * 40));
      }
    }
    return f;
  }
};

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

// ------------------------------------------------------------ 幾何：距離窗口與換算倍率
static void testGeometry() {
  printf("[GroundGeometry]\n");
  SpeedConfig c = SpeedConfig::defaults();
  CHECK(c.isValid());
  CHECK_NEAR(c.angleDeg, 30.0, 1e-6);
  CHECK(c.model == SpeedModel::FixedAngle);
  CHECK(c.radarSnr == 4);

  // 預設 30°、0.70 m：視軸打在 1.4 m；窗口 5°～60° → 0.71～8.13 m（各留 0.10 m）→ LD2451 的整數距離 0～9 m
  const GroundWindow w = groundWindow(c);
  CHECK_NEAR(w.minRangeM, 0.70 / sin(rad(60)) - 0.10, 0.005);
  CHECK_NEAR(w.maxRangeM, 0.70 / sin(rad(5)) + 0.10, 0.01);
  CHECK(w.minDistanceM == 0 && w.maxDistanceM == 9);

  // 3.x（C4001）時期的 45°：20°～75° → 0.62～2.15 m → 0～3 m
  SpeedConfig steep = c;
  steep.angleDeg = 45.0f;
  const GroundWindow ws = groundWindow(steep);
  CHECK_NEAR(ws.minRangeM, 0.70 / sin(rad(75)) - 0.10, 0.005);
  CHECK_NEAR(ws.maxRangeM, 0.70 / sin(rad(20)) + 0.10, 0.005);
  CHECK(ws.minDistanceM == 0 && ws.maxDistanceM == 3);

  // 很高、很淺：遠端是雷達的偵測距離 10 m；近端 40° → 2.23 m → 2 m
  SpeedConfig high = c;
  high.heightM  = 1.5f;
  high.angleDeg = 10.0f;
  const GroundWindow wh = groundWindow(high);
  CHECK_NEAR(wh.maxRangeM, ground_tuning::kMaxRangeM, 1e-4);
  CHECK(wh.maxDistanceM == 10);
  CHECK_NEAR(wh.minRangeM, 1.5 / sin(rad(40)) - 0.10, 0.005);
  CHECK(wh.minDistanceM == 2);

  // 固定角度：倍率 = 1 / (cos θ · cos φ)，與距離無關
  float f = 0, a = 0;
  CHECK(groundFactor(c, 1.0f, 0.0f, &f, &a));
  CHECK_NEAR(f, 1.0 / cos(rad(30)), 1e-4);
  CHECK_NEAR(a, 30.0, 1e-4);
  CHECK(groundFactor(c, 1.0f, -20.0f, &f, &a));
  CHECK_NEAR(f, 1.0 / (cos(rad(30)) * cos(rad(20))), 1e-4);
  CHECK(groundFactor(c, 1.0f, 30.0f, &f, &a));
  CHECK(!groundFactor(c, 1.0f, 31.0f, &f, &a));   // 波束外：多半是位元錯誤或旁瓣
  CHECK(!groundFactor(c, 1.0f, -45.0f, &f, &a));

  // 距離幾何：cos φ · sin α = h / r
  SpeedConfig g = c;
  g.model = SpeedModel::RangeGeometry;
  CHECK(groundFactor(g, static_cast<float>(0.70 / sin(rad(30))), 0.0f, &f, &a));
  CHECK_NEAR(a, 30.0, 0.01);
  CHECK_NEAR(f, 1.0 / cos(rad(30)), 1e-3);
  CHECK(groundFactor(g, 2.0f, 0.0f, &f, &a));  // LD2451 的整數距離
  CHECK_NEAR(a, deg(asin(0.35)), 0.01);
  CHECK(groundFactor(g, 2.0f, 20.0f, &f, &a));
  const double s20 = 0.70 / (2.0 * cos(rad(20)));
  CHECK_NEAR(a, deg(asin(s20)), 0.01);
  CHECK_NEAR(f, 1.0 / (cos(rad(20)) * sqrt(1 - s20 * s20)), 1e-3);
  CHECK(!groundFactor(g, 0.69f, 0.0f, &f, &a));   // 比雷達高度還近：不是地面
  CHECK(!groundFactor(g, 0.701f, 0.0f, &f, &a));  // 幾乎正下方：都卜勒趨近 0、倍率發散
  CHECK(!groundFactor(g, 0.0f, 0.0f, &f, &a));    // LD2451 回報 0 m
  CHECK(!groundFactor(g, 2.0f, 35.0f, &f, &a));

  // 徑向速度的正負：遠離為正
  CHECK_NEAR(radialMps(makeTarget(2, 18, false)), 5.0, 1e-5);
  CHECK_NEAR(radialMps(makeTarget(2, 18, true)), -5.0, 1e-5);
  CHECK(radialMps(makeTarget(2, 0, false)) == 0.0f);
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
  const SpeedConfig c = SpeedConfig::defaults();
  GroundSpeedEstimator est;
  uint32_t ms = 1000;

  CHECK(est.state() == SpeedState::NoRadar);
  CHECK(!est.hasSpeed());

  // 剛上線、沒有回波：視為停著（速度 0）
  feedNone(est, c, ms, 3);
  CHECK(est.state() == SpeedState::Stopped);
  CHECK(est.hasSpeed() && est.speedMps() == 0.0f);

  // 5 m/s、30°：徑向 15.6 km/h → 雷達回報 16 km/h → 5.13 m/s（整數 km/h 的量化，CAL 與濾波會處理）
  const double v5 = quantized(c, 5.0);
  CHECK(fabs(v5 - 5.0) < 0.15);

  // 擷取：前兩筆還在確認（速度仍是 0），第三筆一致才開始追蹤
  ms += 100;
  FrameResult r = est.onFrame(ideal(c, 5.0), ms, c);
  CHECK(r.verdict == FrameVerdict::Acquiring);
  CHECK(r.hasGround && r.target == 0 && r.candidates == 1);
  CHECK_NEAR(r.groundMps, v5, 1e-3);
  CHECK_NEAR(r.depressionDeg, 30.0, 1e-3);
  CHECK(est.state() == SpeedState::Acquiring);
  CHECK(est.speedMps() == 0.0f);
  feedFor(est, c, 5.0, ms, 1);
  CHECK(est.state() == SpeedState::Acquiring);
  ms += 100;
  r = est.onFrame(ideal(c, 5.0), ms, c);
  CHECK(r.verdict == FrameVerdict::Accepted);
  CHECK(est.state() == SpeedState::Tracking);
  CHECK_NEAR(est.speedMps(), v5, 1e-3);
  CHECK(est.sigmaMps() > 0.0f);

  // 等速 10 秒：速度不變、里程 ≈ 速度 × 時間（擷取的那段也補回）。
  // LD2451 的速度是整數，連續好幾筆完全一樣是正常的（C4001 時期的「外插資料框」判斷不再適用）
  const double before = est.distanceM();
  feedFor(est, c, 5.0, ms, 100);
  CHECK_NEAR(est.speedMps(), v5, 1e-3);
  CHECK_NEAR(est.distanceM() - before, v5 * 10.0, 0.05);
  CHECK(est.qualityPct() == 100);
  CHECK(est.wrongDirectionPct() == 0);
  CHECK(est.frames() == 3 + 3 + 100);

  // CAL：速度與里程等比例
  SpeedConfig cal = c;
  cal.calibration = 1.10f;
  GroundSpeedEstimator e2;
  uint32_t ms2 = 1000;
  feedFor(e2, cal, 5.0, ms2, 50);
  CHECK_NEAR(e2.speedMps(), quantized(cal, 5.0), 0.01);
  CHECK_NEAR(quantized(cal, 5.0), 1.10 * v5, 1e-6);

  // 朝前安裝（DIR = -1）：路面靠近雷達，同樣量得到
  SpeedConfig fwd = c;
  fwd.direction = -1;
  GroundSpeedEstimator e3;
  uint32_t ms3 = 1000;
  feedFor(e3, fwd, 4.0, ms3, 20);
  CHECK(e3.state() == SpeedState::Tracking);
  CHECK_NEAR(e3.speedMps(), quantized(fwd, 4.0), 0.01);
}

// ------------------------------------------------------------ 估計器：一個資料框多個目標
static void testEstimatorTargets() {
  printf("[GroundSpeedEstimator：一個資料框多個目標]\n");
  const SpeedConfig c = SpeedConfig::defaults();
  const double perKmh = 1.0 / 3.6 / cos(rad(30));  // 視軸上 1 km/h 徑向 = 多少 m/s 對地

  // 三個路面點 ＋ 遠離中的車（快很多）＋ 路邊晃動的東西（很慢）：取中位數 → 中間那個路面點
  GroundSpeedEstimator est;
  uint32_t ms = 1000;
  FrameResult r;
  const RadarFrame mixed = frameOf({makeTarget(6, 45, false, 10, 50), makeTarget(1, 17, false, 0, 20),
                                    makeTarget(2, 18, false, 0, 35), makeTarget(1, 3, false, 0, 15),
                                    makeTarget(1, 19, false, 0, 25)});
  for (int i = 0; i < 3; i++) {
    ms += 100;
    r = est.onFrame(mixed, ms, c);
  }
  CHECK(r.verdict == FrameVerdict::Accepted);
  CHECK(r.target == 2 && r.candidates == 5);
  CHECK_NEAR(r.groundMps, 18 * perKmh, 1e-3);
  CHECK(est.state() == SpeedState::Tracking);
  CHECK_NEAR(est.speedMps(), 18 * perKmh, 1e-3);

  // 偶數個：中間兩個的平均；代表目標取訊噪比較高的那個
  ms += 100;
  r = est.onFrame(frameOf({makeTarget(1, 17, false, 0, 40), makeTarget(2, 19, false, 0, 20)}), ms, c);
  CHECK(r.verdict == FrameVerdict::Accepted && r.candidates == 2);
  CHECK_NEAR(r.groundMps, 18 * perKmh, 1e-3);
  CHECK(r.target == 0);

  // 水平角要換算：φ = 20° 的點，徑向速度只有視軸上的 cos 20°
  ms += 100;
  r = est.onFrame(frameOf({makeTarget(2, 17, false, 20)}), ms, c);
  CHECK(r.verdict == FrameVerdict::Accepted);
  CHECK_NEAR(r.groundMps, 17 * perKmh / cos(rad(20)), 1e-3);

  // 路面 ＋ 從後面追上來的車：只用路面，不算「方向相反」
  ms += 100;
  r = est.onFrame(frameOf({makeTarget(5, 12, true, -4, 60), makeTarget(1, 18, false)}), ms, c);
  CHECK(r.verdict == FrameVerdict::Accepted && r.target == 1 && r.candidates == 1);

  // 只有追上來的車：方向相反（代表目標是那台車）
  ms += 100;
  r = est.onFrame(frameOf({makeTarget(5, 12, true, -4, 60)}), ms, c);
  CHECK(r.verdict == FrameVerdict::WrongDirection && r.target == 0 && r.hasGround);

  // 只有窗口外的目標：代表目標是訊噪比最高的
  ms += 100;
  r = est.onFrame(frameOf({makeTarget(15, 18, false, 0, 20), makeTarget(1, 18, false, 40, 30)}), ms, c);
  CHECK(r.verdict == FrameVerdict::OutOfGate && r.target == 1 && !r.hasGround && r.candidates == 0);

  // 目標數超過 5（位元錯誤時不該發生）：只看前 5 個，不會讀到陣列外
  RadarFrame overflow = mixed;
  overflow.count = 9;
  ms += 100;
  r = est.onFrame(overflow, ms, c);
  CHECK(r.verdict == FrameVerdict::Accepted || r.verdict == FrameVerdict::Outlier);
  CHECK(r.target >= 0 && r.target < static_cast<int8_t>(kRadarMaxTargets));
}

static void testEstimatorStopAndDropout() {
  printf("[GroundSpeedEstimator：停車、失去回波、恢復]\n");
  const SpeedConfig c = SpeedConfig::defaults();

  // 慢速時失去回波 → 停車：0.4 秒後保持、0.6 秒判定靜止，保持期間的距離算一半
  {
    GroundSpeedEstimator est;
    uint32_t ms = 1000;
    feedFor(est, c, 1.0, ms, 20);
    CHECK(est.state() == SpeedState::Tracking);
    const double v1 = quantized(c, 1.0);
    const double d0 = est.distanceM();
    feedNone(est, c, ms, 4);
    CHECK(est.state() == SpeedState::Holding);
    CHECK(est.hasSpeed());
    CHECK_NEAR(est.speedMps(), v1, 0.01);  // 保持：暫時沿用
    feedNone(est, c, ms, 3);
    CHECK(est.state() == SpeedState::Stopped);
    CHECK(est.speedMps() == 0.0f);
    // 最後一筆之後 0.4 s 照算（≈ 0.4 m），保持期間 0.2 s 算一半（≈ 0.1 m）
    CHECK(est.distanceM() - d0 > 0.3 && est.distanceM() - d0 < 0.75);
    feedNone(est, c, ms, 50);
    CHECK(est.state() == SpeedState::Stopped);  // 一直停著
  }

  // 慢速時看到靜止回波（雷達回報 0 km/h，只接收模式下雷達用自己的設定時可能出現）→ 判定靜止
  {
    GroundSpeedEstimator est;
    uint32_t ms = 1000;
    feedFor(est, c, 0.8, ms, 20);
    CHECK(est.state() == SpeedState::Tracking);
    ms += 100;
    CHECK(est.onFrame(frameOf({makeTarget(1, 0, false)}), ms, c).verdict == FrameVerdict::Static);
    ms += 100;
    est.onFrame(frameOf({makeTarget(2, 0, true)}), ms, c);
    CHECK(est.state() == SpeedState::Stopped);
  }

  // 高速時看到靜止回波（跟著車子走的擋泥板、車架）：忽略，不會誤判停車
  {
    GroundSpeedEstimator est;
    uint32_t ms = 1000;
    feedFor(est, c, 6.0, ms, 20);
    for (int i = 0; i < 2; i++) {
      ms += 100;
      est.onFrame(frameOf({makeTarget(1, 0, false)}), ms, c);
    }
    CHECK(est.state() == SpeedState::Tracking);
    feedFor(est, c, 6.0, ms, 1);
    CHECK_NEAR(est.speedMps(), quantized(c, 6.0), 0.05);
  }

  // 高速時短暫失去回波（1 秒）→ 保持，回來後繼續；保持期間的距離要算進去
  {
    GroundSpeedEstimator est;
    uint32_t ms = 1000;
    feedFor(est, c, 6.0, ms, 20);
    const double v6 = quantized(c, 6.0);
    const double d0 = est.distanceM();
    feedNone(est, c, ms, 10);
    CHECK(est.state() == SpeedState::Holding);
    CHECK_NEAR(est.speedMps(), v6, 0.01);
    feedFor(est, c, 6.0, ms, 10);
    CHECK(est.state() == SpeedState::Tracking);
    CHECK_NEAR(est.distanceM() - d0, v6 * 2.0, 0.1);
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
    CHECK_NEAR(est.speedMps(), quantized(c, 5.0), 0.01);
  }

  // 保持期間速度變了（例如急煞）：回來的量測連續 3 筆彼此一致 → 重新初始化，不會卡在舊速度
  {
    GroundSpeedEstimator est;
    uint32_t ms = 1000;
    feedFor(est, c, 7.0, ms, 20);
    feedNone(est, c, ms, 12);
    CHECK(est.state() == SpeedState::Holding);
    const double v2 = quantized(c, 2.0);
    int frames = 0;
    while (fabs(est.speedMps() - v2) > 0.2 && frames < 10) {
      feedFor(est, c, 2.0, ms, 1);
      frames++;
    }
    CHECK(frames <= 4);
    CHECK(est.state() == SpeedState::Tracking);
  }

  // LD2451 沒有目標時約每 1.4 秒才送一個空資料框：中間完全沒有資料框，逾時照樣由 update() 處理
  {
    GroundSpeedEstimator est;
    uint32_t ms = 1000;
    feedFor(est, c, 6.0, ms, 20);
    for (int i = 0; i < 25; i++) est.update(ms += 100);
    CHECK(est.state() == SpeedState::Lost);
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
  const SpeedConfig c = SpeedConfig::defaults();
  const double v5 = quantized(c, 5.0);

  GroundSpeedEstimator est;
  uint32_t ms = 1000;
  feedFor(est, c, 5.0, ms, 20);

  // 距離窗口外（後方 12 m 的物體）、水平角太大
  ms += 100;
  CHECK(est.onFrame(frameOf({makeTarget(12, 16, false)}), ms, c).verdict == FrameVerdict::OutOfGate);
  ms += 100;
  CHECK(est.onFrame(frameOf({makeTarget(1, 16, false, 45)}), ms, c).verdict == FrameVerdict::OutOfGate);

  // 方向相反（從後面追上來的車）
  ms += 100;
  const FrameResult wrong = est.onFrame(frameOf({makeTarget(2, 10, true)}), ms, c);
  CHECK(wrong.verdict == FrameVerdict::WrongDirection);
  CHECK(wrong.hasGround);

  // 單筆離群值（車輪、腳）：剔除，速度不受影響
  ms += 100;
  CHECK(est.onFrame(frameOf({makeTarget(1, 22, false)}), ms, c).verdict == FrameVerdict::Outlier);
  CHECK_NEAR(est.speedMps(), v5, 0.05);
  feedFor(est, c, 5.0, ms, 1);
  CHECK_NEAR(est.speedMps(), v5, 0.05);
  CHECK(est.state() == SpeedState::Tracking);

  // 停著時偶爾出現的雜散目標：一兩筆不會讓車速跳起來（要 3 筆一致）
  GroundSpeedEstimator idle;
  uint32_t ms2 = 1000;
  feedNone(idle, c, ms2, 5);
  ms2 += 100;
  idle.onFrame(frameOf({makeTarget(1, 8, false)}), ms2, c);
  ms2 += 100;
  idle.onFrame(frameOf({makeTarget(2, 2, false)}), ms2, c);
  ms2 += 100;
  idle.onFrame(frameOf({makeTarget(1, 13, false)}), ms2, c);
  CHECK(idle.state() != SpeedState::Tracking);
  CHECK(idle.speedMps() == 0.0f);
  feedNone(idle, c, ms2, 12);
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
}

// ------------------------------------------------------------ 估計器：雜訊下的精度（模擬）
// 典型情境：散射點俯角分散 7°、水平角分散 8°、雷達雜訊 0.1 m/s、上下震動 0.1 m/s、每框 1～3 個路面點、90% 有回波
static GroundRadarSim typicalSim() {
  GroundRadarSim sim;
  sim.spreadDeg      = 7;
  sim.azSpreadDeg    = 8;
  sim.radialNoiseMps = 0.10;
  sim.bounceMps      = 0.10;
  sim.pDetect        = 0.9;
  sim.maxPoints      = 3;
  return sim;
}

static void testEstimatorAccuracy() {
  printf("[GroundSpeedEstimator：雜訊、加減速、雜散目標]\n");
  const SpeedConfig c = SpeedConfig::defaults();

  // 平均誤差看的是「沒有偏移」時估計器本身有沒有偏差（實際路面的偏移由 CAL 校正，見模擬報告）
  GroundRadarSim sim = typicalSim();
  RunStats s = runProfile(sim, c, cruise6, 60, 11);
  CHECK(s.rmsErr < 0.35);
  CHECK(fabs(s.meanErrPct) < 3.0);
  CHECK(fabs(s.distErrPct) < 3.0);
  CHECK(s.trackingPct > 95);

  // 加速 2 m/s²、急煞 −4 m/s² 到停：跟得上，停下後判定靜止，里程誤差小
  RunStats ab = runProfile(sim, c, accelBrake, 20, 12);
  CHECK(ab.rmsErr < 0.7);
  CHECK(fabs(ab.distErrPct) < 4.0);

  // 城市騎乘：起步、變速、停等、再起步
  RunStats mix = runProfile(sim, c, rideMix, 45, 13);
  CHECK(mix.rmsErr < 0.5);
  CHECK(fabs(mix.distErrPct) < 4.0);

  // 15% 雜散目標（車、行人、車輪）
  GroundRadarSim noisy = sim;
  noisy.pOutlier = 0.15;
  noisy.pDetect  = 0.8;
  RunStats o = runProfile(noisy, c, cruise6, 60, 14);
  CHECK(o.rmsErr < 0.5);
  CHECK(fabs(o.distErrPct) < 4.0);

  // 回波斷斷續續（只有 50% 有回波）：仍然追蹤，不會一直掉到「訊號中斷」
  GroundRadarSim sparse = sim;
  sparse.pDetect = 0.5;
  RunStats sp = runProfile(sparse, c, cruise6, 60, 15);
  CHECK(sp.trackingPct > 90);
  CHECK(sp.rmsErr < 0.5);

  // 每框只有 1 個路面點（沒有中位數可取）：雜訊大一些，但仍可用
  GroundRadarSim single = sim;
  single.maxPoints = 1;
  RunStats one = runProfile(single, c, cruise6, 60, 17);
  CHECK(one.rmsErr < 0.5);
  CHECK(one.trackingPct > 95);

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
  SpeedConfig fixedCfg = SpeedConfig::defaults();
  SpeedConfig geomCfg  = fixedCfg;
  geomCfg.model        = SpeedModel::RangeGeometry;

  // 散射點偏向正下方 10°（光滑路面）：固定角度模型低估約 cos 40° / cos 30° = 0.885（−11.5%），可用 CAL 校正
  GroundRadarSim smooth;
  smooth.shiftDeg       = 10;
  smooth.spreadDeg      = 6;
  smooth.radialNoiseMps = 0.05;
  smooth.maxPoints      = 3;
  const RunStats f = runProfile(smooth, fixedCfg, cruise6, 30, 21);
  CHECK(f.meanErrPct < -8 && f.meanErrPct > -15);

  // 距離幾何：LD2451 的距離只有整數公尺（1.4 m 報成 1 m 時俯角 30° 變 44°），未校正前有明顯偏差，
  // 偏差大小取決於雷達怎麼取整數（文件沒寫）；校正後與固定角度差不多（模擬報告）。所以預設固定角度（MODEL 0）
  const RunStats g = runProfile(smooth, geomCfg, cruise6, 30, 21);
  CHECK(g.trackingPct > 95);
  CHECK(fabs(g.meanErrPct) < 20);
}

// 印出各情境的平均表現（docs/ALGORITHM.md §9 的數據來源）：每種情境 20 次
static void printScenarioReport() {
  printf("\n[情境報告] LD2451 斜照路面 30°：俯角分散 7°、水平角分散 8°、雷達雜訊 0.1 m/s、上下震動 0.1 m/s、"
         "每框 1～3 個路面點、90%% 有回波；每種 20 次的平均\n");
  printf("  %-34s %10s %10s %10s %10s\n", "情境", "RMS m/s", "平均誤差%", "里程誤差%", "有速度%");
  struct Scenario {
    const char* name;
    Profile     profile;
    double      seconds;
    double      pDetect;
    double      pOutlier;
    int         maxPoints;
  };
  const Scenario scenarios[] = {
      {"起步後 6 m/s 巡航", cruiseFromRest, 60, 0.9, 0.0, 3},
      {"加速 2 m/s² 到 8 m/s、急煞 −4 m/s²", accelBrake, 20, 0.9, 0.0, 3},
      {"城市騎乘（變速、停等、再起步）", rideMix, 45, 0.9, 0.0, 3},
      {"15% 雜散目標（車、行人、車輪）", cruiseFromRest, 60, 0.8, 0.15, 3},
      {"只有 50% 的資料框有回波", cruiseFromRest, 60, 0.5, 0.0, 3},
      {"每框只有 1 個路面點", cruiseFromRest, 60, 0.9, 0.0, 1},
  };
  const SpeedConfig cfg = SpeedConfig::defaults();
  for (const Scenario& sc : scenarios) {
    double rms = 0, mean = 0, dist = 0, known = 0;
    for (int rep = 0; rep < 20; rep++) {
      GroundRadarSim sim = typicalSim();
      sim.pDetect = sc.pDetect, sim.pOutlier = sc.pOutlier, sim.maxPoints = sc.maxPoints;
      const RunStats r = runProfile(sim, cfg, sc.profile, sc.seconds, 500 + rep * 13);
      rms += r.rmsErr / 20;
      mean += r.meanErrPct / 20;
      dist += r.distErrPct / 20;
      known += r.trackingPct / 20;
    }
    printf("  %-34s %10.3f %10.2f %10.2f %10.1f\n", sc.name, rms, mean, dist, known);
  }
}

// 印出模擬比較表（docs/ALGORITHM.md §9 的數據來源）：功率加權讓散射點偏向正下方（C4001 時期的文獻回顧：
// 漫射路面約 +7.5°、平滑／潮濕約 +14°），CAL 在乾柏油上以 3 趟 100 m 距離校正後換到其他路面
static void printSimulationReport() {
  printf("\n[模擬報告] 起步後 6 m/s 巡航 60 s × 20 次；CAL 在乾柏油上以 3 趟 100 m 距離校正（起終點停住），再換到其他路面\n");
  printf("  %-30s %-10s %10s %10s %10s\n", "路面（等效偏移）", "模型", "平均誤差%", "RMS m/s", "里程誤差%");
  struct Surface {
    const char* name;
    double      shiftDeg;
  };
  const Surface surfaces[] = {
      {"乾柏油 +7.5°（校正用）", 7.5},
      {"粗糙漫射面 +6.5°", 6.5},
      {"平滑／潮濕 +14°", 14.0},
  };
  for (int model = 0; model < 2; model++) {
    SpeedConfig cfg = SpeedConfig::defaults();
    cfg.model       = model == 0 ? SpeedModel::FixedAngle : SpeedModel::RangeGeometry;
    GroundRadarSim base = typicalSim();
    base.shiftDeg = 7.5;
    // 校正：乾柏油上 3 趟 100 m（與實際程序相同：起點停住 → 加速 → 巡航 → 在終點停住），
    // CAL = 真實總距離 / 量到的總距離
    double measured = 0;
    for (int run = 0; run < 3; run++) measured += 100.0 * (1.0 + runProfile(base, cfg, calibrationRun, 25, 90 + run).distErrPct / 100.0);
    cfg.calibration = static_cast<float>(300.0 / measured);
    for (const Surface& sf : surfaces) {
      double mean = 0, rms = 0, dist = 0;
      for (int rep = 0; rep < 20; rep++) {
        GroundRadarSim s = base;
        s.shiftDeg       = sf.shiftDeg;
        const RunStats r = runProfile(s, cfg, cruiseFromRest, 60, 1000 + rep * 7);
        mean += r.meanErrPct / 20;
        rms += r.rmsErr / 20;
        dist += r.distErrPct / 20;
      }
      printf("  %-30s %-10s %10.2f %10.3f %10.2f\n", sf.name, model == 0 ? "固定角度" : "距離幾何", mean, rms, dist);
    }
    printf("  %-30s %-10s CAL = %.4f\n", "", model == 0 ? "固定角度" : "距離幾何", cfg.calibration);
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

  CHECK(applyCommand(parseCommand("angle 40"), c, &err));
  CHECK_NEAR(c.angleDeg, 40.0, 1e-6);
  CHECK(applyCommand(parseCommand("ANGLE=10"), c, &err));   // 邊界值
  CHECK(applyCommand(parseCommand("ANGLE 75"), c, &err));
  CHECK(!applyCommand(parseCommand("ANGLE 9.9"), c, &err));
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

  CHECK(isConfigCommand(CommandType::RadarSnr));
  CHECK(applyCommand(parseCommand("gsnr 6"), c, &err) && c.radarSnr == 6);
  CHECK(applyCommand(parseCommand("GSNR 3"), c, &err) && applyCommand(parseCommand("GSNR 8"), c, &err));
  CHECK(!applyCommand(parseCommand("GSNR 2"), c, &err));
  CHECK(!applyCommand(parseCommand("GSNR 9"), c, &err));
  CHECK(!applyCommand(parseCommand("GSNR 5.5"), c, &err));
  CHECK(c.radarSnr == 8);
  // C4001 時期的指令（4.0 起拿掉）
  CHECK(parseCommand("RTHR 5").type == CommandType::Unknown);
  CHECK(parseCommand("VMAX 10").type == CommandType::Unknown);

  CHECK(isConfigCommand(CommandType::Wheel));
  CHECK(applyCommand(parseCommand("WHEEL 2070"), c, &err) && c.wheelMm == 2070);
  CHECK(!applyCommand(parseCommand("WHEEL 999"), c, &err));
  CHECK(!applyCommand(parseCommand("WHEEL 2105.5"), c, &err));
  CHECK(c.wheelMm == 2070);

  CHECK(!isConfigCommand(CommandType::Get));
  CHECK(!isConfigCommand(CommandType::Reboot));
  CHECK(!applyCommand(parseCommand("GET"), c, &err));

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
  CHECK(strstr(kHelpText, "GSNR") != nullptr);
  CHECK(strstr(kHelpText, "RTHR") == nullptr && strstr(kHelpText, "VMAX") == nullptr);

  CHECK(applyCommand(parseCommand("DEFAULTS"), c, &err));
  CHECK(c.rear.rangeM == 15 && c.rear.minSpeedKmh == 5 && c.rear.snr == 4);
  CHECK_NEAR(c.rear.ttcS, 2.5, 1e-6);
  CHECK_NEAR(c.angleDeg, 30.0, 1e-6);
  CHECK_NEAR(c.heightM, 0.70, 1e-6);
  CHECK(c.direction == 1 && c.model == SpeedModel::FixedAngle);
  CHECK_NEAR(c.calibration, 1.0, 1e-6);
  CHECK(c.radarSnr == 4 && c.wheelMm == 2105);
  CHECK(c.isValid());

  SpeedConfig bad = SpeedConfig::defaults();
  bad.calibration = NAN;
  CHECK(!bad.isValid());
  bad = SpeedConfig::defaults();
  bad.radarSnr = 9;
  CHECK(!bad.isValid());
  bad = SpeedConfig::defaults();
  bad.angleDeg = 9.0f;
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
static RadarFrame  rearFrame(std::initializer_list<RadarTarget> targets);
static RadarTarget rearTarget(double distanceM, double speedKmh, bool approaching = true, int angle = 0);

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
  s.raw              = frameOf({makeTarget(6, 40, false, 9, 50), makeTarget(2, 14, false, -2, 12), makeTarget(1, 15, false)});
  s.result.verdict   = FrameVerdict::Accepted;
  s.result.target    = 1;
  s.result.candidates = 3;
  s.result.hasGround = true;
  s.result.groundMps = 5.40f;
  s.radarDistanceM   = 1234.56;
  s.uptimeS          = 812;
  size_t n = formatTelemetry(s, line, sizeof(line));
  CHECK(n > 0 && line[n - 1] == '\n');
  CHECK(strcmp(line, "R=1 RO=0 ST=3 V=5.43 SD=0.12 Q=95 WD=0 FN=1234 N=3 A=-2 RD=2 RV=3.89 S=12 G=5.40 FV=0 DR=1234.6 T=812\n") == 0);
  CHECK(!hasToken(line, "W=5.51"));  // 沒接輪速感測器就不送 W、DW

  // 只接收模式、代表目標是靠近中的（方向相反）：RV 為負
  TelemetrySnapshot ro = s;
  ro.receiveOnly    = true;
  ro.raw            = frameOf({makeTarget(5, 18, true, 4, 33)});
  ro.result.target  = 0;
  ro.result.verdict = FrameVerdict::WrongDirection;
  n = formatTelemetry(ro, line, sizeof(line));
  CHECK(hasToken(line, "RO=1") && hasToken(line, "A=4") && hasToken(line, "RD=5") && hasToken(line, "RV=-5.00"));
  CHECK(hasToken(line, "S=33") && hasToken(line, "FV=4") && hasToken(line, "N=1"));
  // 代表目標的位置不合理（不該發生）：當作沒有目標，不會讀到陣列外
  ro.result.target = 7;
  n = formatTelemetry(ro, line, sizeof(line));
  CHECK(n > 0 && hasToken(line, "RD=-1") && hasToken(line, "A=0") && hasToken(line, "S=0"));

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
  CHECK(hasToken(line, "ST=1") && hasToken(line, "V=0.00") && hasToken(line, "N=0") && hasToken(line, "RD=-1"));
  CHECK(hasToken(line, "G=-1.00") && hasToken(line, "FV=1") && hasToken(line, "RO=0"));

  // 訊號中斷：速度未知 → V=-1
  TelemetrySnapshot lost = idle;
  lost.state    = SpeedState::Lost;
  lost.hasSpeed = false;
  n = formatTelemetry(lost, line, sizeof(line));
  CHECK(hasToken(line, "ST=5") && hasToken(line, "V=-1.00"));

  // 雷達離線：狀態 0、速度未知、不送舊的原始值；輪速照送
  TelemetrySnapshot off = s;
  off.radarOnline = false;
  off.receiveOnly = true;
  n = formatTelemetry(off, line, sizeof(line));
  CHECK(hasToken(line, "R=0") && hasToken(line, "ST=0") && hasToken(line, "V=-1.00") && hasToken(line, "N=0"));
  CHECK(hasToken(line, "RD=-1") && hasToken(line, "RO=0"));
  CHECK(hasToken(line, "W=5.51"));

  // 最長的一行也放得下（含輪速）
  TelemetrySnapshot big = s;
  big.speedMps       = 123.0f;
  big.sigmaMps       = 123.0f;
  big.qualityPct     = 100;
  big.wrongDirPct    = 100;
  big.frame          = 4294967295UL;
  big.receiveOnly    = true;
  big.raw            = frameOf({makeTarget(255, 255, true, -128, 255), makeTarget(255, 255, true, -128, 255),
                                makeTarget(255, 255, true, -128, 255), makeTarget(255, 255, true, -128, 255),
                                makeTarget(255, 255, true, -128, 255)});
  big.result.target  = 4;
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
  n = formatConfig(d, "4.0.0", cfgLine, sizeof(cfgLine));
  CHECK(n > 0);
  const char* cfgPrefix = "CFG ANGLE=30.0 HEIGHT=0.70 DIR=1 MODEL=0 CAL=1.0000 GSNR=4 WHEEL=2105 RMIN=0.71 RMAX=8.13 ";
  CHECK(strncmp(cfgLine, cfgPrefix, strlen(cfgPrefix)) == 0);
  CHECK(hasToken(cfgLine, "FW=4.0.0"));
  CHECK(strstr(cfgLine, "RTHR=") == nullptr && strstr(cfgLine, "VMAX=") == nullptr);
  CHECK(hasToken(cfgLine, "RANGE=15") && hasToken(cfgLine, "RSPD=5") && hasToken(cfgLine, "TTC=2.5"));
  CHECK(hasToken(cfgLine, "RSNR=4") && hasToken(cfgLine, "RDET=25"));
  CHECK(strstr(cfgLine, "TEST=") == nullptr && strstr(cfgLine, "MINSPD=") == nullptr);  // 網頁用這兩個鍵判斷 2.x 舊韌體
  SpeedConfig wide = d;
  wide.angleDeg = 10, wide.heightM = 1.5f, wide.calibration = 1.9999f, wide.radarSnr = 8, wide.wheelMm = 3000;
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
  RadarFrame f;
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
static RadarFrame rearFrame(std::initializer_list<RadarTarget> targets) {
  RadarFrame f;
  for (const RadarTarget& t : targets) {
    if (f.count < kRadarMaxTargets) f.targets[f.count++] = t;
  }
  return f;
}

static RadarTarget rearTarget(double distanceM, double speedKmh, bool approaching, int angle) {
  RadarTarget t;
  t.angleDeg  = static_cast<int8_t>(angle);
  t.distanceM = static_cast<uint8_t>(lround(distanceM < 0 ? 0 : distanceM));  // LD2451 的距離是整數公尺
  t.speedKmh  = static_cast<uint8_t>(lround(speedKmh));
  t.direction = approaching ? kApproachByte : 0;
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
  testGeometry();
  testEstimatorBasics();
  testEstimatorTargets();
  testEstimatorStopAndDropout();
  testEstimatorRejection();
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
