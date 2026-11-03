/*!
 * @file   CommandParser.h
 * @brief  【通訊層】文字指令解析（藍牙與序列埠共用，純 C++，可單元測試）。
 *
 * 指令（大小寫不拘，數值可用空白、'=' 或 ':' 分隔）：
 *   GET            回覆目前設定（CFG ...）
 *   ANGLE 45       雷達視軸俯角（度，15 ~ 75）
 *   HEIGHT 0.70    雷達離地高度（m，0.15 ~ 1.50）
 *   DIR 1|-1       雷達朝向：1 = 朝後、-1 = 朝前
 *   MODEL 0|1      速度模型：0 = 固定角度、1 = 距離幾何
 *   CAL 1.0425     校正係數（0.5 ~ 2.0）
 *   RTHR 5         C4001 雷達本身的偵測門檻（整數 1 ~ 50，越大越不靈敏）
 *   WHEEL 2105     輪周長（mm，整數 1000 ~ 3000），輪速感測器（參考值）用
 *   VMAX 10        C4001 徑向速度上限（m/s，2 ~ 20），實測決定（docs/ALGORITHM.md §2）
 *   RANGE 15       後方來車警示距離（m，整數 5 ~ 50）
 *   RSPD 5         後方來車最低接近速度（km/h，整數 1 ~ 30），寫進 LD2451
 *   TTC 2.5        到達時間低於這個值算危險（s，1.0 ~ 6.0）
 *   RSNR 4         LD2451 的訊噪比門檻（整數 3 ~ 8，越大越不靈敏）
 *   DEFAULTS       恢復預設值
 *   REBOOT         重新開機
 *   HELP           列出指令
 * ANGLE、HEIGHT、RTHR 會改變寫進雷達的設定：ESP32 重新設定雷達，約 4 秒內沒有資料。
 * RANGE、RSPD、RSNR 會重新寫入後方雷達（接了 LD2451 RX 才寫得進去，約 1 秒內沒有資料）。
 */
#pragma once
#include <stdint.h>

#include "../core/SpeedConfig.h"

enum class CommandType : uint8_t {
  None,  // 空白行
  Get,
  Help,
  Angle,
  Height,
  Direction,
  Model,
  Calibration,
  RadarThreshold,
  Wheel,
  RadialLimit,
  RearRange,
  RearMinSpeed,
  RearTtc,
  RearSnr,
  Defaults,
  Reboot,
  Unknown,
};

struct Command {
  CommandType type      = CommandType::None;
  bool        hasValue  = false;
  double      value     = 0.0;
  bool        malformed = false;  // 數值後面有多餘文字，例如 "ANGLE 45abc"
};

Command parseCommand(const char* text);

// 會修改設定的指令（ANGLE/HEIGHT/DIR/MODEL/CAL/RTHR/WHEEL/VMAX/RANGE/RSPD/TTC/RSNR/DEFAULTS）
bool isConfigCommand(CommandType type);

// 驗證並套用到 cfg。成功回傳 true；失敗回傳 false，error 指向錯誤說明（cfg 不變）
bool applyCommand(const Command& cmd, SpeedConfig& cfg, const char** error);

// HELP 的回覆內容
extern const char* const kHelpText;
