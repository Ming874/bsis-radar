/*!
 * @file   LD2451Protocol.h
 * @brief  【驅動層】HLK-LD2451 序列協定：資料框解析與指令組裝（純 C++，可在電腦上做單元測試）。
 *
 * 資料框（雷達 → ESP32，持續輸出；沒有目標時約每 1.4 秒送一個空資料框，實測）：
 *   F4 F3 F2 F1 | 長度（2 bytes，小端） | 目標數 警報 [角度 距離 方向 速度 訊噪比] × 目標數 | F8 F7 F6 F5
 *   沒有目標時長度 = 0（沒有內容）。角度 = 位元組 − 0x80（度）、距離 m、方向 1 靠近 0 遠離、速度 km/h。
 * 指令（ESP32 → 雷達）：FD FC FB FA | 長度 | 指令碼 00 [參數] | 04 03 02 01
 * 回覆（雷達 → ESP32）：FD FC FB FA | 長度 | 指令碼 01 狀態（2 bytes，0 = 成功）[資料] | 04 03 02 01
 *
 * 協定沒有檢查碼：位元錯誤只能靠格式檢查擋下（長度要剛好、目標數 ≤ 5、方向只能 0／1、速度 ≤ 120 km/h、
 * 角度 ±90° 內）。實測 3.3 V 線路偶爾有 1 → 0 的位元錯誤（docs/REAR_RADAR.md §2），所以這些檢查很重要。
 */
#pragma once
#include <stddef.h>
#include <stdint.h>

#include "../core/RearFrame.h"

namespace ld2451 {
constexpr uint8_t kCmdEnableConfig   = 0xFF;  // 參數 01 00；回覆含協定版本、緩衝區大小
constexpr uint8_t kCmdEndConfig      = 0xFE;
constexpr uint8_t kCmdReadFirmware   = 0xA0;
constexpr uint8_t kCmdSetTarget      = 0x02;  // 參數：最大距離 m、方向（0 遠離 1 靠近 2 都要）、最低速度 km/h、延遲 s
constexpr uint8_t kCmdGetTarget      = 0x12;
constexpr uint8_t kCmdSetSensitivity = 0x03;  // 參數：累計觸發次數、訊噪比門檻、0、0
constexpr uint8_t kCmdGetSensitivity = 0x13;

constexpr uint8_t kDirectionApproach = 1;     // 目標參數的「方向」：只回報靠近的目標
constexpr size_t  kMaxPayload        = 32;    // 最長：韌體版本回覆 12 bytes、5 個目標的資料框 27 bytes
constexpr size_t  kMaxCommandFrame   = 4 + 2 + 2 + 4 + 4;

// 組一個指令框，回傳長度（空間不足回傳 0）
size_t buildCommand(uint8_t command, const uint8_t* value, size_t valueLen, uint8_t* out, size_t cap);
}  // namespace ld2451

enum class LD2451FrameType : uint8_t { None, Report, Ack };

struct LD2451Ack {
  uint8_t        command = 0;
  bool           ok      = false;    // 狀態 0 = 成功
  const uint8_t* data    = nullptr;  // 狀態之後的資料
  uint16_t       dataLen = 0;
};

class LD2451FrameParser {
 public:
  // 一次餵一個位元組；完成一個格式正確的資料框或回覆時回傳它的類型
  LD2451FrameType push(uint8_t b);

  const uint8_t* payload() const { return buf_; }
  uint16_t       length() const { return need_; }

  uint32_t badFrames() const { return bad_; }  // 長度不合理、表尾不對（多半是位元錯誤）
  void     reset();

 private:
  enum class State : uint8_t { Header, LenLo, LenHi, Payload, Footer };
  State    state_  = State::Header;
  bool     report_ = false;
  uint8_t  pos_    = 0;  // 表頭或表尾已比對的位元組數、或內容已收的位元組數
  uint16_t need_   = 0;
  uint8_t  buf_[ld2451::kMaxPayload] = {};
  uint32_t bad_    = 0;
};

// 解出資料框內容；格式不對（多半是位元錯誤）回傳 false
bool decodeLD2451Report(const uint8_t* payload, uint16_t len, RearFrame& out);

// 解出指令回覆；格式不對回傳 false
bool decodeLD2451Ack(const uint8_t* payload, uint16_t len, LD2451Ack& out);
