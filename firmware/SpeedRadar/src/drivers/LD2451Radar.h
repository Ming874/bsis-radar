/*!
 * @file   LD2451Radar.h
 * @brief  【驅動層】HLK-LD2451 的非阻塞驅動：自動找鮑率、寫入偵測設定、斷線自動重試。
 *         兩顆雷達各用一個實例：測速雷達（斜照路面）與後方來車雷達（朝正後方），差別只在名稱與偵測設定。
 *
 * 狀態：
 *   Searching ──找到鮑率、指令有回覆──> Configuring ──> Online（完整模式）
 *       │      └─收得到資料、1.2 秒內指令沒回覆──────> Online（只接收模式）
 *       └─每個鮑率聽 3.2 秒都沒資料──> Offline ──(5～30 秒後重試，從上次成功的鮑率開始)──> Searching
 *   Online 超過 4 秒完全沒收到位元組（沒有目標時約每 1.4 秒也有一個空資料框）→ Offline；
 *          有位元組但 15 秒都解不出格式正確的資料框 → Offline（重新找鮑率）
 *
 * 只接收模式：只接了 LD2451 TX → ESP32 RX（後方雷達實測就是這樣接）。雷達照它目前存的設定輸出，
 * 距離、速度、方向的篩選全部在 ESP32 再做一次，所以照樣能用；每 30 秒再試一次指令，
 * 之後接上 LD2451 RX → ESP32 TX 就會自動改成完整模式並寫入設定。
 *
 * 保護雷達的 flash：設定先讀回來比對，不同才寫。
 */
#pragma once
#include <Arduino.h>

#include "../core/RadarFrame.h"
#include "LD2451Protocol.h"

class LD2451Radar {
 public:
  enum class State : uint8_t { Disabled, Searching, Configuring, Online, Offline };

  struct Settings {
    int8_t      rxPin;  // ESP32 接收腳（接 LD2451 TX），-1 = 不使用這顆雷達
    int8_t      txPin;  // ESP32 傳送腳（接 LD2451 RX），-1 = 只接收
    const char* name;   // 序列埠訊息的前綴，例如 "測速雷達"、"後方雷達"
  };

  // 寫進雷達的偵測設定（延遲 1 s、累計觸發 1 次固定）
  struct Detection {
    uint8_t maxDistanceM;  // 10～100
    uint8_t direction;     // ld2451::kDirectionAway / Approach / Both
    uint8_t minSpeedKmh;
    uint8_t snr;
  };

  LD2451Radar(HardwareSerial& port, const Settings& settings, Print& log);

  // begin() 之前呼叫只記下來；運作中改值會重新寫入（約 1 秒內沒有資料框）
  void setDetection(const Detection& detection, uint32_t nowMs);

  void begin(uint32_t nowMs);

  // 非阻塞：收資料、推進狀態機；每次 loop 呼叫
  void update(uint32_t nowMs);

  // 取出一個新的資料框（沒有就回傳 false）
  bool readFrame(RadarFrame& out);

  bool        enabled() const { return state_ != State::Disabled; }
  bool        online() const { return state_ == State::Online || state_ == State::Configuring; }
  bool        receiveOnly() const { return receiveOnly_; }
  State       state() const { return state_; }
  uint32_t    baud() const { return baud_; }
  uint32_t    frames() const { return frames_; }
  uint32_t    badFrames() const { return parser_.badFrames() + decodeErrors_; }
  const char* firmware() const { return firmware_; }

 private:
  enum class Step : uint8_t { Enable, ReadFirmware, GetTarget, GetSensitivity, SetTarget, SetSensitivity, End };

  void openPort(uint32_t baud);
  void pumpBytes(uint32_t nowMs);
  void handleReport(uint32_t nowMs);
  void handleAck(const LD2451Ack& ack, uint32_t nowMs);
  void say(const char* format, ...) __attribute__((format(printf, 2, 3)));

  void sendEnableProbe(uint32_t nowMs);
  void startSearch(uint32_t nowMs, bool fromBeginning);
  void runSearch(uint32_t nowMs);
  void startConfig(Step first, uint32_t nowMs);
  void runConfig(uint32_t nowMs);
  void sendStep(uint32_t nowMs);
  void nextStep(uint32_t nowMs);
  void finishConfig(uint32_t nowMs, bool ok);
  void goOffline(uint32_t nowMs, const char* reason);
  void sendCommand(uint8_t command, const uint8_t* value, size_t len);
  static uint8_t stepCommand(Step s);

  HardwareSerial&   port_;
  Settings          settings_;
  Print&            log_;
  LD2451FrameParser parser_;
  Detection         detection_ = {25, ld2451::kDirectionApproach, 5, 4};
  bool              begun_     = false;

  State    state_        = State::Disabled;
  uint32_t stateSinceMs_ = 0;
  uint32_t retryDelayMs_ = 0;
  uint8_t  failures_     = 0;

  // 找鮑率
  uint8_t  baudIndex_     = 0;
  uint8_t  goodBaudIndex_ = 0;  // 上次成功的鮑率（重試從這裡開始）
  uint8_t  baudTried_     = 0;
  uint32_t baud_          = 0;
  uint32_t lastEnableMs_  = 0;
  bool     heardReport_   = false;
  uint32_t firstReportMs_ = 0;
  bool     receiveOnly_   = false;
  uint32_t lastRxOnlyTryMs_ = 0;
  bool     enablePending_ = false;  // 送了「進入設定」還沒收到回覆（逾時就補送「離開設定」）
  uint32_t enableSentMs_  = 0;

  // 設定
  Step     step_         = Step::Enable;
  bool     waitingAck_   = false;
  uint8_t  tries_        = 0;
  uint32_t stepSentMs_   = 0;
  bool     needTarget_   = false;
  bool     needSens_     = false;
  char     firmware_[24] = "";

  // 收到的資料
  static constexpr size_t kQueueSize = 4;
  RadarFrame queue_[kQueueSize];
  size_t     queueHead_  = 0;
  size_t     queueCount_ = 0;

  uint32_t lastFrameMs_  = 0;  // 最後一個格式正確的資料框或回覆
  uint32_t lastByteMs_   = 0;  // 最後收到任何位元組（判斷在線用）
  uint32_t baudBytes_    = 0;  // 這個鮑率收到的位元組數（找鮑率時的診斷訊息）
  uint32_t badAtOpen_    = 0;
  uint32_t frames_       = 0;
  uint32_t decodeErrors_ = 0;
};
