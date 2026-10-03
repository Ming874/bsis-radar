#include "CommandParser.h"

#include <ctype.h>
#include <math.h>
#include <stdlib.h>
#include <string.h>

namespace {

struct Keyword {
  const char* name;
  CommandType type;
};

const Keyword kKeywords[] = {
    {"GET", CommandType::Get},           {"HELP", CommandType::Help},
    {"TEST", CommandType::TestMode},     {"MINSPD", CommandType::MinSpeed},
    {"MINE", CommandType::MinEnergy},    {"RANGE", CommandType::WarnRange},
    {"SIGN", CommandType::ApproachSign}, {"DTTC", CommandType::DangerTtc},
    {"DDIST", CommandType::DangerDist},  {"HOLD", CommandType::Hold},
    {"CONFIRM", CommandType::Confirm},   {"DEFAULTS", CommandType::Defaults},
    {"REBOOT", CommandType::Reboot},
};

bool inRange(double v, double lo, double hi) { return v >= lo && v <= hi; }
bool isWhole(double v) { return floor(v) == v; }

bool isSeparator(char c) { return c == ' ' || c == '\t' || c == '=' || c == ':'; }
bool isLineEnd(char c) { return c == '\0' || c == '\r' || c == '\n'; }

const char* skip(const char* p, bool (*pred)(char)) {
  while (pred(*p)) p++;
  return p;
}

bool isBlank(char c) { return c == ' ' || c == '\t' || c == '\r' || c == '\n'; }

}  // namespace

Command parseCommand(const char* text) {
  Command cmd;
  if (text == nullptr) return cmd;

  const char* p = skip(text, isBlank);
  if (*p == '\0') return cmd;  // 空白行

  char word[12] = {};
  size_t n = 0;
  while (isalpha(static_cast<unsigned char>(*p)) && n < sizeof(word) - 1) {
    word[n++] = static_cast<char>(toupper(static_cast<unsigned char>(*p)));
    p++;
  }
  if (*p == '?' && n == 0) {  // "?" 也當作 HELP
    cmd.type = CommandType::Help;
    return cmd;
  }

  cmd.type = CommandType::Unknown;
  for (const Keyword& k : kKeywords) {
    if (strcmp(word, k.name) == 0) {
      cmd.type = k.type;
      break;
    }
  }
  if (cmd.type == CommandType::Unknown) return cmd;
  if (isalpha(static_cast<unsigned char>(*p))) {  // 關鍵字後面還黏著字母，例如 "GETX"
    cmd.type = CommandType::Unknown;
    return cmd;
  }

  p = skip(p, isSeparator);
  if (isLineEnd(*p)) return cmd;  // 沒有數值

  char* end = nullptr;
  const double v = strtod(p, &end);
  if (end == p) {
    cmd.malformed = true;
    return cmd;
  }
  const char* rest = skip(end, isBlank);
  cmd.hasValue  = true;
  cmd.value     = v;
  cmd.malformed = !isLineEnd(*rest);
  return cmd;
}

bool isConfigCommand(CommandType type) {
  switch (type) {
    case CommandType::TestMode:
    case CommandType::MinSpeed:
    case CommandType::MinEnergy:
    case CommandType::WarnRange:
    case CommandType::ApproachSign:
    case CommandType::DangerTtc:
    case CommandType::DangerDist:
    case CommandType::Hold:
    case CommandType::Confirm:
    case CommandType::Defaults:
      return true;
    default:
      return false;
  }
}

bool applyCommand(const Command& cmd, DetectionConfig& cfg, const char** error) {
  const char* err = nullptr;
  DetectionConfig next = cfg;
  const double v = cmd.value;

  if (!isConfigCommand(cmd.type)) {
    err = "not a setting";
  } else if (cmd.type == CommandType::Defaults) {
    next = DetectionConfig::defaults();
  } else if (!cmd.hasValue || cmd.malformed) {
    err = "missing or bad value";
  } else {
    switch (cmd.type) {
      case CommandType::TestMode:
        if (v == 0.0 || v == 1.0) next.testMode = (v == 1.0);
        else err = "TEST must be 0 or 1";
        break;
      case CommandType::MinSpeed:
        if (inRange(v, limits::kMinSpeedLo, limits::kMinSpeedHi)) next.minSpeedMps = static_cast<float>(v);
        else err = "MINSPD must be 0.05-10";
        break;
      case CommandType::MinEnergy:
        if (inRange(v, 0, limits::kMinEnergyHi) && isWhole(v)) next.minEnergy = static_cast<uint32_t>(v);
        else err = "MINE must be an integer 0-100000000";
        break;
      case CommandType::WarnRange:
        if (inRange(v, limits::kWarnRangeLo, limits::kWarnRangeHi)) next.warnRangeM = static_cast<float>(v);
        else err = "RANGE must be 1-20";
        break;
      case CommandType::ApproachSign:
        if (v == -1.0 || v == 0.0 || v == 1.0) next.approachSign = static_cast<int8_t>(v);
        else err = "SIGN must be -1, 0 or 1";
        break;
      case CommandType::DangerTtc:
        if (inRange(v, limits::kDangerTtcLo, limits::kDangerTtcHi)) next.dangerTtcS = static_cast<float>(v);
        else err = "DTTC must be 0.5-5";
        break;
      case CommandType::DangerDist:
        if (inRange(v, limits::kDangerDistLo, limits::kDangerDistHi)) next.dangerDistM = static_cast<float>(v);
        else err = "DDIST must be 1-10";
        break;
      case CommandType::Hold:
        if (inRange(v, limits::kHoldLo, limits::kHoldHi) && isWhole(v)) next.holdMs = static_cast<uint16_t>(v);
        else err = "HOLD must be an integer 200-5000";
        break;
      case CommandType::Confirm:
        if (inRange(v, limits::kConfirmLo, limits::kConfirmHi) && isWhole(v)) next.confirmHits = static_cast<uint8_t>(v);
        else err = "CONFIRM must be an integer 1-6";
        break;
      default:
        err = "not a setting";
        break;
    }
  }

  if (err != nullptr) {
    if (error != nullptr) *error = err;
    return false;
  }
  cfg = next;
  return true;
}
