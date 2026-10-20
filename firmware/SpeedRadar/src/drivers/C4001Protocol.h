/*!
 * @file   C4001Protocol.h
 * @brief  【驅動層】C4001 UART 資料框解析（純 C++，不依賴 Arduino，可單元測試）。
 *
 * 測速模式資料框：$DFDMD,<目標數>,<保留>,<距離 m>,<速度 m/s>,<能量>,<保留>,<保留>*
 * 存在模式資料框：$DFHPD,<有無人>,...*
 *
 * 為什麼不用 DFRobot 函式庫的 getTargetNumber()：
 *   - 每次呼叫都會「卡住等 100 ms」收資料，整個 loop 跟著停
 *   - 只解析緩衝區裡「最舊」的一筆，資料會落後
 *   - 收到半截資料框時會讀到未初始化的指標，可能讓 ESP32 當機重開
 * 這裡改成「一次餵一個字元」的組裝器：不阻塞、能處理半截資料框、欄位逐一檢查。
 */
#pragma once
#include <stddef.h>
#include <stdint.h>

#include "../core/RadarMeasurement.h"

enum class C4001FrameType : uint8_t {
  None,      // 還沒組好一個資料框（或不是資料框的文字，例如指令回覆）
  Speed,     // 測速模式資料框，量測值已寫入 out
  Presence,  // 存在模式資料框（代表雷達模式不對）
  Invalid,   // 資料框損壞（欄位不足、數字格式錯、太長、被截斷）
};

class C4001FrameParser {
 public:
  // 餵入一個位元組；組好一個資料框時回傳它的類型（Speed 時 out 已填好）
  C4001FrameType feed(char c, RadarMeasurement& out);

  void reset();

  // 解析一個完整資料框字串（'$' 開頭，結尾的 '*' 可有可無）
  static C4001FrameType parse(const char* frame, RadarMeasurement& out);

  static constexpr size_t kMaxFrameLen = 95;

 private:
  char   buf_[kMaxFrameLen + 1] = {};
  size_t len_     = 0;
  bool   inFrame_ = false;
};
