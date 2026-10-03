/*!
 * @file   MedianWindow.h
 * @brief  【核心層】固定長度的滑動中位數。
 *
 * 取最近 N 筆的中間值：單一筆突然跳很大或很小會被忽略。
 */
#pragma once
#include <stddef.h>

template <typename T, size_t N>
class MedianWindow {
 public:
  void push(T value) {
    buf_[next_] = value;
    next_ = (next_ + 1) % N;
    if (count_ < N) count_++;
  }

  void clear() {
    count_ = 0;
    next_  = 0;
  }

  size_t size() const { return count_; }

  // 沒資料時回傳 T()（數字型別就是 0）
  T median() const {
    if (count_ == 0) return T();
    T sorted[N];
    for (size_t i = 0; i < count_; i++) sorted[i] = buf_[i];
    for (size_t i = 1; i < count_; i++) {  // 插入排序：N 很小時最快
      T key = sorted[i];
      size_t j = i;
      while (j > 0 && sorted[j - 1] > key) {
        sorted[j] = sorted[j - 1];
        j--;
      }
      sorted[j] = key;
    }
    return sorted[count_ / 2];
  }

 private:
  T      buf_[N] = {};
  size_t next_   = 0;
  size_t count_  = 0;
};
