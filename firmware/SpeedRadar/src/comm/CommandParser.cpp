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
    {"GET", CommandType::Get},          {"HELP", CommandType::Help},
    {"ANGLE", CommandType::Angle},      {"HEIGHT", CommandType::Height},
    {"DIR", CommandType::Direction},    {"MODEL", CommandType::Model},
    {"CAL", CommandType::Calibration},  {"RTHR", CommandType::RadarThreshold},
    {"WHEEL", CommandType::Wheel},      {"DEFAULTS", CommandType::Defaults},
    {"REBOOT", CommandType::Reboot},    {"VMAX", CommandType::RadialLimit},
};

// 上下限是 float（例如 0.15f 實際是 0.1500000060），留一點容許誤差，邊界值才不會被誤判超出範圍
bool inRange(double v, double lo, double hi) { return v >= lo - 1e-6 && v <= hi + 1e-6; }
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
    case CommandType::Angle:
    case CommandType::Height:
    case CommandType::Direction:
    case CommandType::Model:
    case CommandType::Calibration:
    case CommandType::RadarThreshold:
    case CommandType::Wheel:
    case CommandType::RadialLimit:
    case CommandType::Defaults:
      return true;
    default:
      return false;
  }
}

const char* const kHelpText =
    "OK commands: GET, ANGLE <deg>, HEIGHT <m>, DIR 1|-1, MODEL 0|1, CAL <factor>, RTHR <1-50>, WHEEL <mm>, "
    "VMAX <m/s>, DEFAULTS, REBOOT\n";

bool applyCommand(const Command& cmd, SpeedConfig& cfg, const char** error) {
  const char* err = nullptr;
  SpeedConfig next = cfg;
  const double v = cmd.value;

  if (!isConfigCommand(cmd.type)) {
    err = "not a setting";
  } else if (cmd.type == CommandType::Defaults) {
    next = SpeedConfig::defaults();
  } else if (!cmd.hasValue || cmd.malformed) {
    err = "missing or bad value";
  } else {
    switch (cmd.type) {
      case CommandType::Angle:
        if (inRange(v, limits::kAngleLoDeg, limits::kAngleHiDeg)) next.angleDeg = static_cast<float>(v);
        else err = "ANGLE must be 15-75 (deg)";
        break;
      case CommandType::Height:
        if (inRange(v, limits::kHeightLoM, limits::kHeightHiM)) next.heightM = static_cast<float>(v);
        else err = "HEIGHT must be 0.15-1.50 (m)";
        break;
      case CommandType::Direction:
        if (v == 1.0 || v == -1.0) next.direction = static_cast<int8_t>(v);
        else err = "DIR must be 1 or -1";
        break;
      case CommandType::Model:
        if (v == 0.0 || v == 1.0) next.model = static_cast<SpeedModel>(static_cast<uint8_t>(v));
        else err = "MODEL must be 0 or 1";
        break;
      case CommandType::Calibration:
        if (inRange(v, limits::kCalLo, limits::kCalHi)) next.calibration = static_cast<float>(v);
        else err = "CAL must be 0.5-2.0";
        break;
      case CommandType::RadarThreshold:
        if (inRange(v, limits::kRadarThrLo, limits::kRadarThrHi) && isWhole(v)) next.radarThreshold = static_cast<uint8_t>(v);
        else err = "RTHR must be an integer 1-50";
        break;
      case CommandType::Wheel:
        if (inRange(v, limits::kWheelMmLo, limits::kWheelMmHi) && isWhole(v)) next.wheelMm = static_cast<uint16_t>(v);
        else err = "WHEEL must be an integer 1000-3000 (mm)";
        break;
      case CommandType::RadialLimit:
        if (inRange(v, limits::kVmaxLo, limits::kVmaxHi)) next.radialLimitMps = static_cast<float>(v);
        else err = "VMAX must be 2-20 (m/s)";
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
