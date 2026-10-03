/*!
 * @file   RangeKalman.h
 * @brief  【核心層】距離 / 距離變化率的卡爾曼濾波器（等速模型 + 離散白雜訊加速度 DWNA）。
 *
 * 狀態 x = [r, ṙ]：r = 距離（m），ṙ = 距離變化率（m/s，負值 = 越來越近）。
 * 量測有兩種，可分開更新（量測誤差互相獨立時，依序做純量更新與一次做矩陣更新的結果相同）：
 *   - 雷達距離 r_m          → updateRange()
 *   - 都卜勒速度換算的 ṙ_D  → updateRate()（通過交叉核對才用）
 *
 * 模型與公式：Bar-Shalom, Li, Kirubarajan,《Estimation with Applications to Tracking and
 * Navigation》(Wiley, 2001)：§6.3.2 離散白雜訊加速度模型、§5.2 卡爾曼更新、§5.4 NIS 閘門。
 */
#pragma once

class RangeKalman {
 public:
  // 以一筆量測建立追蹤（varRange / varRate 為初始變異數）
  void init(float rangeM, float rateMps, float varRange, float varRate);
  void clear() { active_ = false; }
  bool active() const { return active_; }

  // 時間往前推 dt 秒；accelVar = 加速度變異數 σa²（m²/s⁴）
  void predict(float dtS, float accelVar);

  // 正規化新息平方（NIS）＝ 新息² ÷ 新息變異數；用來判斷量測是否落在驗證閘門內
  float rangeNis(float rangeM, float varRange) const;
  float rateNis(float rateMps, float varRate) const;
  float rangeInnovationSigma(float varRange) const;  // √(P₀₀ + R)

  void updateRange(float rangeM, float varRange);
  void updateRate(float rateMps, float varRate);

  // 直接改寫速度（例如換了都卜勒的解釋），距離與速度的相關歸零
  void resetRate(float rateMps, float varRate);
  // 整個狀態改寫（例如都卜勒不可信、改用距離變化率時，直接採用最小平方擬合的結果）
  void resetState(float rangeM, float rateMps, float varRange, float covRangeRate, float varRate);

  float range() const { return r_; }
  float rate() const { return v_; }
  float varRange() const { return p00_; }
  float varRate() const { return p11_; }

 private:
  void keepValid();

  bool  active_ = false;
  float r_      = 0.0f;
  float v_      = 0.0f;
  float p00_    = 0.0f;  // 共變異數矩陣 P（對稱，只存三個元素）
  float p01_    = 0.0f;
  float p11_    = 0.0f;
};
