/*!
 * @file   CommandParser.h
 * @brief  【通訊層】文字指令解析（藍牙與序列埠共用，純 C++，可單元測試）。
 *
 * 指令（大小寫不拘，數值可用空白、'=' 或 ':' 分隔）：
 *   GET            回覆目前設定（CFG ...）
 *   TEST 0|1       室內測試模式開關
 *   MINSPD 1.5     上路模式的接近速度門檻（m/s，0.05 ~ 10）
 *   MINE 50000     反射能量門檻（整數，0 = 不過濾）
 *   RANGE 15       警示距離（m，1 ~ 20）
 *   SIGN -1|0|1    哪個速度正負號代表接近（0 = 不判斷方向）
 *   DTTC 1.5       到達時間 ≤ 此值為危險（s，0.5 ~ 5）
 *   DDIST 4        距離 ≤ 此值為危險（m，1 ~ 10）
 *   HOLD 1000      目標消失後警示保持（ms，200 ~ 5000）
 *   CONFIRM 3      累積幾筆才確認是來車（1 ~ 6）
 *   DEFAULTS       恢復預設值
 *   REBOOT         重新開機
 *   HELP           列出指令
 */
#pragma once
#include <stdint.h>

#include "../core/DetectionConfig.h"

enum class CommandType : uint8_t {
  None,  // 空白行
  Get,
  Help,
  TestMode,
  MinSpeed,
  MinEnergy,
  WarnRange,
  ApproachSign,
  DangerTtc,
  DangerDist,
  Hold,
  Confirm,
  Defaults,
  Reboot,
  Unknown,
};

struct Command {
  CommandType type     = CommandType::None;
  bool        hasValue = false;
  double      value    = 0.0;
  bool        malformed = false;  // 數值後面有多餘文字，例如 "MINSPD 1.5abc"
};

Command parseCommand(const char* text);

// 會修改設定的指令（TEST/MINSPD/MINE/RANGE/SIGN/DTTC/DDIST/HOLD/CONFIRM/DEFAULTS）
bool isConfigCommand(CommandType type);

// 驗證並套用到 cfg。成功回傳 true；失敗回傳 false，error 指向錯誤說明（cfg 不變）
bool applyCommand(const Command& cmd, DetectionConfig& cfg, const char** error);
