#include "LD2451Protocol.h"

#include <string.h>

namespace {
constexpr uint8_t kReportHead[4] = {0xF4, 0xF3, 0xF2, 0xF1};
constexpr uint8_t kReportTail[4] = {0xF8, 0xF7, 0xF6, 0xF5};
constexpr uint8_t kAckHead[4]    = {0xFD, 0xFC, 0xFB, 0xFA};
constexpr uint8_t kAckTail[4]    = {0x04, 0x03, 0x02, 0x01};

constexpr uint8_t kMaxSpeedKmh = 120;  // 規格的測速範圍
constexpr int     kMaxAngleDeg = 90;   // 規格 ±20°；超過 ±90° 一定是位元錯誤
}  // namespace

size_t ld2451::buildCommand(uint8_t command, const uint8_t* value, size_t valueLen, uint8_t* out, size_t cap) {
  const size_t total = 4 + 2 + 2 + valueLen + 4;
  if (out == nullptr || cap < total || (valueLen > 0 && value == nullptr)) return 0;
  size_t k = 0;
  memcpy(out, kAckHead, 4);
  k += 4;
  const size_t inner = 2 + valueLen;
  out[k++] = static_cast<uint8_t>(inner & 0xFF);
  out[k++] = static_cast<uint8_t>(inner >> 8);
  out[k++] = command;
  out[k++] = 0x00;
  if (valueLen > 0) memcpy(out + k, value, valueLen);
  k += valueLen;
  memcpy(out + k, kAckTail, 4);
  return k + 4;
}

void LD2451FrameParser::reset() {
  state_ = State::Header;
  pos_   = 0;
  need_  = 0;
}

LD2451FrameType LD2451FrameParser::push(uint8_t b) {
  switch (state_) {
    case State::Header: {
      if (pos_ == 0) {
        if (b == kReportHead[0] || b == kAckHead[0]) {
          report_ = b == kReportHead[0];
          pos_    = 1;
        }
        return LD2451FrameType::None;
      }
      const uint8_t* head = report_ ? kReportHead : kAckHead;
      if (b == head[pos_]) {
        if (++pos_ == 4) state_ = State::LenLo;
        return LD2451FrameType::None;
      }
      pos_ = 0;
      return push(b);  // 這個位元組可能是新表頭的第一個
    }
    case State::LenLo:
      need_  = b;
      state_ = State::LenHi;
      return LD2451FrameType::None;
    case State::LenHi:
      need_ = static_cast<uint16_t>(need_ | (b << 8));
      pos_  = 0;
      if (need_ > ld2451::kMaxPayload) {
        bad_++;
        state_ = State::Header;
      } else {
        state_ = need_ == 0 ? State::Footer : State::Payload;
      }
      return LD2451FrameType::None;
    case State::Payload:
      buf_[pos_++] = b;
      if (pos_ >= need_) {
        state_ = State::Footer;
        pos_   = 0;
      }
      return LD2451FrameType::None;
    case State::Footer: {
      const uint8_t* tail = report_ ? kReportTail : kAckTail;
      if (b != tail[pos_]) {
        bad_++;
        state_ = State::Header;
        pos_   = 0;
        return push(b);
      }
      if (++pos_ < 4) return LD2451FrameType::None;
      state_ = State::Header;
      pos_   = 0;
      return report_ ? LD2451FrameType::Report : LD2451FrameType::Ack;
    }
  }
  return LD2451FrameType::None;
}

bool decodeLD2451Report(const uint8_t* payload, uint16_t len, RadarFrame& out) {
  out = RadarFrame();
  if (len == 0) return true;  // 沒有目標
  if (payload == nullptr || len < 2) return false;
  const uint8_t count = payload[0];
  if (count > kRadarMaxTargets || len < 2u + 5u * count) return false;
  out.alarm = payload[1];
  for (uint8_t i = 0; i < count; i++) {
    const uint8_t* p     = payload + 2 + 5 * i;
    const int      angle = static_cast<int>(p[0]) - 0x80;
    if (angle < -kMaxAngleDeg || angle > kMaxAngleDeg) return false;
    if (p[2] > 1 || p[3] > kMaxSpeedKmh) return false;
    RadarTarget& t = out.targets[i];
    t.angleDeg  = static_cast<int8_t>(angle);
    t.distanceM = p[1];
    t.direction = p[2];
    t.speedKmh  = p[3];
    t.snr       = p[4];
  }
  out.count = count;
  return true;
}

bool decodeLD2451Ack(const uint8_t* payload, uint16_t len, LD2451Ack& out) {
  out = LD2451Ack();
  if (payload == nullptr || len < 4 || payload[1] != 0x01) return false;
  out.command = payload[0];
  out.ok      = (payload[2] | (payload[3] << 8)) == 0;
  out.data    = payload + 4;
  out.dataLen = static_cast<uint16_t>(len - 4);
  return true;
}
