#include "C4001Protocol.h"

#include <float.h>
#include <stdlib.h>
#include <string.h>

namespace {

constexpr size_t kMaxFields = 10;

bool isFieldEnd(char c) { return c == '\0' || c == '*' || c == '\r' || c == '\n' || c == ' '; }

bool isFinite(double x) { return x == x && x <= DBL_MAX && x >= -DBL_MAX; }

// 整個欄位都必須是數字（"8.5abc"、空欄位都算失敗）；前面的空白可以接受（" 8.00"）
bool parseNumber(const char* s, double& out) {
  if (s == nullptr) return false;
  while (*s == ' ') s++;
  if (isFieldEnd(*s)) return false;
  char* end = nullptr;
  const double v = strtod(s, &end);
  if (end == s || !isFieldEnd(*end) || !isFinite(v)) return false;
  out = v;
  return true;
}

}  // namespace

void C4001FrameParser::reset() {
  len_     = 0;
  inFrame_ = false;
}

C4001FrameType C4001FrameParser::feed(char c, RadarMeasurement& out) {
  if (c == '$') {  // 新資料框開始；若上一個還沒收完，代表它被截斷了
    const bool truncated = inFrame_;
    len_          = 0;
    buf_[len_++]  = c;
    inFrame_      = true;
    return truncated ? C4001FrameType::Invalid : C4001FrameType::None;
  }
  if (!inFrame_) return C4001FrameType::None;  // 資料框以外的文字（例如指令回覆）直接略過

  if (c == '*' || c == '\r' || c == '\n') {
    buf_[len_] = '\0';
    inFrame_   = false;
    return parse(buf_, out);
  }
  if (len_ >= kMaxFrameLen) {  // 太長一定是壞資料，丟掉等下一個 '$'
    inFrame_ = false;
    return C4001FrameType::Invalid;
  }
  buf_[len_++] = c;
  return C4001FrameType::None;
}

C4001FrameType C4001FrameParser::parse(const char* frame, RadarMeasurement& out) {
  if (frame == nullptr) return C4001FrameType::Invalid;
  if (strncmp(frame, "$DFHPD", 6) == 0) return C4001FrameType::Presence;
  if (strncmp(frame, "$DFDMD", 6) != 0) return C4001FrameType::None;

  // 複製一份再切欄位（不改到呼叫者的字串）
  char tmp[kMaxFrameLen + 1];
  strncpy(tmp, frame, kMaxFrameLen);
  tmp[kMaxFrameLen] = '\0';

  const char* fields[kMaxFields];
  size_t count = 0;
  fields[count++] = tmp;
  for (char* p = tmp; *p != '\0' && *p != '*' && count < kMaxFields; p++) {
    if (*p == ',') {
      *p = '\0';
      fields[count++] = p + 1;
    }
  }
  if (count < 2) return C4001FrameType::Invalid;

  double targets = 0;
  if (!parseNumber(fields[1], targets) || targets < 0 || targets > 255) return C4001FrameType::Invalid;

  RadarMeasurement m;
  m.targets = static_cast<uint8_t>(targets);
  if (m.targets == 0) {  // 沒目標時其他欄位不重要（有些韌體版本會留空）
    out = m;
    return C4001FrameType::Speed;
  }

  if (count < 6) return C4001FrameType::Invalid;
  double range = 0, speed = 0, energy = 0;
  if (!parseNumber(fields[3], range) || !parseNumber(fields[4], speed) || !parseNumber(fields[5], energy)) {
    return C4001FrameType::Invalid;
  }
  // 物理上不合理的值直接丟掉（25 m 版雷達、測速上限 10 m/s，留一些餘裕）
  if (range < 0 || range > 100 || speed < -50 || speed > 50 || energy < 0) return C4001FrameType::Invalid;

  m.rangeM   = static_cast<float>(range);
  m.speedMps = static_cast<float>(speed);
  m.energy   = energy > 4.0e9 ? 4000000000UL : static_cast<uint32_t>(energy);
  out        = m;
  return C4001FrameType::Speed;
}
