/*!
 * @file   RangeRateWindow.h
 * @brief  【核心層】由最近一段時間的「距離」算出距離變化率（最小平方法斜率），作為都卜勒速度的獨立對照。
 *
 * 都卜勒速度精確但可能出錯（超過量測範圍時折疊、正負號設定相反、偶發雜訊）；
 * 距離變化率只用距離算，雜訊較大但不會折疊，兩者互相核對（見 VelocityCheck.h）。
 *
 * 斜率 b = Σ(t−t̄)(r−r̄) / Σ(t−t̄)²，
 * 標準差 σb = √( s² / Σ(t−t̄)² )，s² = 距離量測變異數；≥ 5 筆時若殘差變異數更大則改用它（不會因樣本少而過度自信或過度保守）。
 * 等間隔 T、N 筆時 Σ(t−t̄)² = T²·N(N²−1)/12 → σb ≈ σr·√12 / (T·√(N(N²−1)))。
 *
 * 同一視窗也記錄每筆實際採用的都卜勒值；「斜率」與「都卜勒平均」都代表視窗中點的速度，
 * 比較兩者不受加減速造成的時間落差影響。
 */
#pragma once
#include <stdint.h>

struct RateFit {
  bool    valid        = false;  // 筆數與時間跨度足夠才有效
  uint8_t count        = 0;      // 視窗內筆數
  float   spanS        = 0.0f;   // 最舊到最新的時間跨度（s）
  float   rate         = 0.0f;   // 距離變化率 ṙ（m/s，負值 = 越來越近）
  float   sigma        = 0.0f;   // ṙ 的標準差（m/s）
  float   centerAgeS   = 0.0f;   // 視窗時間中點距最新一筆多久（s）
  float   rangeNow     = 0.0f;   // 擬合直線在「最新一筆時刻」的距離（m）
  float   varRangeNow  = 0.0f;   // 上式的變異數：σ²(1/n + t̄²/Σ(t−t̄)²)
  float   covRangeRate = 0.0f;   // 距離與斜率的共變異數：−t̄·σ²/Σ(t−t̄)²
  uint8_t dopplerCount = 0;      // 視窗內有採用都卜勒的筆數
  float   dopplerMean  = 0.0f;   // 這些都卜勒 ṙ 的平均（m/s）
};

class RangeRateWindow {
 public:
  static constexpr uint8_t kCapacity = 12;

  void clear() { count_ = 0; }
  uint8_t size() const { return count_; }

  // 加入一筆已通過關聯閘門的距離；超過容量時丟掉最舊的
  void push(uint32_t tMs, float rangeM);
  // 記下「最新一筆」實際採用的都卜勒 ṙ（沒採用就不呼叫）
  void setLatestDoppler(float rateMps);

  // windowMs：只用最近這段時間的資料；minCount / minSpanS：有效的最低要求
  RateFit fit(float rangeSigmaM, uint32_t windowMs, uint8_t minCount, float minSpanS) const;

 private:
  struct Sample {
    uint32_t tMs;
    float    rangeM;
    float    doppler;
    bool     hasDoppler;
  };
  const Sample& at(uint8_t ageIndex) const;  // 0 = 最新

  Sample  buf_[kCapacity];
  uint8_t head_  = 0;  // 下一筆寫入的位置
  uint8_t count_ = 0;
};
