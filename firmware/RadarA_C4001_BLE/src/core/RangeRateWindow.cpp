#include "RangeRateWindow.h"

#include <math.h>

void RangeRateWindow::push(uint32_t tMs, float rangeM) {
  buf_[head_] = Sample{tMs, rangeM, 0.0f, false};
  head_       = static_cast<uint8_t>((head_ + 1) % kCapacity);
  if (count_ < kCapacity) count_++;
}

void RangeRateWindow::setLatestDoppler(float rateMps) {
  if (count_ == 0) return;
  Sample& s    = buf_[(head_ + kCapacity - 1) % kCapacity];
  s.doppler    = rateMps;
  s.hasDoppler = true;
}

const RangeRateWindow::Sample& RangeRateWindow::at(uint8_t ageIndex) const {
  return buf_[(head_ + kCapacity - 1 - ageIndex) % kCapacity];
}

RateFit RangeRateWindow::fit(float rangeSigmaM, uint32_t windowMs, uint8_t minCount, float minSpanS) const {
  RateFit f;
  if (count_ == 0) return f;
  const uint32_t newest = at(0).tMs;

  // 只取時間窗內的樣本；時間以「距最新一筆幾秒前」表示（≤ 0）
  float   t[kCapacity];
  float   r[kCapacity];
  uint8_t n = 0;
  float   dSum = 0.0f;
  for (uint8_t i = 0; i < count_; i++) {
    const Sample&  s   = at(i);
    const uint32_t age = newest - s.tMs;  // 無號相減，millis() 溢位也正確
    if (age > windowMs) break;
    t[n] = -static_cast<float>(age) / 1000.0f;
    r[n] = s.rangeM;
    n++;
    if (s.hasDoppler) {
      dSum += s.doppler;
      f.dopplerCount++;
    }
  }
  f.count = n;
  if (f.dopplerCount > 0) f.dopplerMean = dSum / f.dopplerCount;
  if (n < 2) return f;

  float tMean = 0.0f, rMean = 0.0f;
  for (uint8_t i = 0; i < n; i++) {
    tMean += t[i];
    rMean += r[i];
  }
  tMean /= n;
  rMean /= n;

  float sxx = 0.0f, sxy = 0.0f;
  for (uint8_t i = 0; i < n; i++) {
    const float dt = t[i] - tMean;
    sxx += dt * dt;
    sxy += dt * (r[i] - rMean);
  }
  f.spanS      = -t[n - 1];
  f.centerAgeS = -tMean;
  if (sxx <= 1e-9f) return f;  // 時間全部一樣，算不出斜率

  f.rate = sxy / sxx;

  // 雜訊變異數：預設用感測器的距離量測變異數。至少 5 筆（殘差自由度 ≥ 3）時，殘差若比較大
  // （例如車身反射點飄移）才改用殘差；筆數太少時殘差變異數本身很不可靠，不拿來放大或縮小。
  float var = rangeSigmaM * rangeSigmaM;
  if (n >= 5) {
    const float a   = rMean - f.rate * tMean;
    float       sse = 0.0f;
    for (uint8_t i = 0; i < n; i++) {
      const float e = r[i] - (a + f.rate * t[i]);
      sse += e * e;
    }
    const float resVar = sse / static_cast<float>(n - 2);
    if (resVar > var) var = resVar;
  }
  f.sigma        = sqrtf(var / sxx);
  f.rangeNow     = rMean - f.rate * tMean;  // t = 0 是最新一筆
  f.varRangeNow  = var * (1.0f / n + tMean * tMean / sxx);
  f.covRangeRate = -tMean * var / sxx;
  f.valid = n >= minCount && f.spanS >= minSpanS;
  return f;
}
