/*!
 * @file   C4001Radar.h
 * @brief  【驅動層】DFRobot C4001 25m（UART）非阻塞驅動。
 *
 * 不再使用 DFRobot_C4001 函式庫，原因：
 *   - sensorStop()/getStatus() 在雷達沒回應時會 while(1) 無限等待 → 整台卡死
 *   - 每次讀資料都卡 100 ms，藍牙、LED、指令全部跟著延遲
 * 這裡用「狀態機」做同樣的事：送出與函式庫相同的指令字串、順序與間隔，
 * 但每次 update() 只做一小步就返回，任何一步失敗都會自動重試，不會卡住。
 *
 * 狀態：
 *   Offline ──(重試)──> Configuring ──> Verifying ──> Online <──> Probing
 *      ^                    │ 失敗          │ 失敗         │ 沒回應
 *      └────────────────────┴───────────────┴──────────────┘
 *
 * 保護雷達的 flash：完整設定（含 saveConfig）每次開機只做一次；之後斷線重連
 * 只送 sensorStart 再確認輸出。只有雷達模式真的不對才重新完整設定，
 * 而且連續失敗時重試間隔加倍（3 → 6 → 12 … 最多 60 秒）。
 */
#pragma once
#include <Arduino.h>

#include "C4001Protocol.h"

class C4001Radar {
 public:
  enum class State : uint8_t {
    Offline,      // 沒接上或失去連線，等待重試
    Configuring,  // 正在送設定指令
    Verifying,    // 設定完成，確認開始輸出測速資料
    Online,       // 正常運作
    Probing,      // 太久沒資料，送心跳確認雷達還在
  };

  struct Settings {
    int8_t   rxPin;      // ESP32 接收腳（接雷達 TX）
    int8_t   txPin;      // ESP32 傳送腳（接雷達 RX）
    uint32_t baud;       // C4001 固定 9600
    float    minRangeM;  // 寫進雷達的最近偵測距離
    float    maxRangeM;  // 寫進雷達的最遠偵測距離
    uint16_t thrFactor;  // 雷達內部偵測門檻（越大越不靈敏）
  };

  C4001Radar(HardwareSerial& port, const Settings& settings, Print& log);

  void begin(uint32_t nowMs);

  // 非阻塞：收資料、推進狀態機；每次 loop 呼叫
  void update(uint32_t nowMs);

  // 取出一筆新的量測（沒有就回傳 false）
  bool readMeasurement(RadarMeasurement& out);

  bool        online() const { return state_ == State::Online || state_ == State::Probing; }
  State       state() const { return state_; }
  const char* stateName() const;

  uint32_t speedFrames() const { return speedFrames_; }
  uint32_t badFrames() const { return badFrames_; }
  uint32_t initAttempts() const { return initAttempts_; }

 private:
  struct Step {
    const char* command;
    uint16_t    waitMs;        // 送出後等多久再做下一步
    bool        needStopEcho;  // 這一步要等到雷達回覆 "sensorStop" 才算成功
  };

  void pumpBytes(uint32_t nowMs);
  void handleFrame(C4001FrameType type, const RadarMeasurement& m, uint32_t nowMs);
  void rememberEcho(char c);

  void startConfiguring(uint32_t nowMs);
  void runConfigStep(uint32_t nowMs);
  void sendStep(uint32_t nowMs);
  void goOnline(uint32_t nowMs, const char* message);
  void enterState(State s, uint32_t nowMs);
  void fail(const char* reason, uint32_t nowMs);
  void clearQueue();
  void send(const char* command);

  HardwareSerial&  port_;
  Settings         settings_;
  Print&           log_;
  C4001FrameParser parser_;

  State    state_        = State::Offline;
  uint32_t stateSinceMs_ = 0;

  // 設定流程：完整設定（開機一次）與快速重連兩套步驟
  static constexpr size_t kFullStepCount = 13;
  Step        fullPlan_[kFullStepCount];
  Step        quickPlan_[1];
  const Step* plan_         = nullptr;
  size_t      planLength_   = 0;
  char        rangeCmd_[32] = {};
  char        thrCmd_[24]   = {};
  size_t      stepIndex_    = 0;
  uint8_t     stepTries_    = 0;
  uint32_t    stepSentMs_   = 0;
  uint32_t    stepWaitMs_   = 0;
  uint32_t    bytesAtConfigStart_ = 0;

  bool     needFullConfig_  = true;   // 開機後第一次，或雷達模式不對時
  bool     fullAttempt_     = false;  // 這次是完整設定
  bool     savedThisAttempt_ = false; // 這次已送出 saveConfig（寫入雷達 flash）
  uint8_t  fullFailures_    = 0;      // 完整設定連續失敗次數（用來加長重試間隔）
  uint32_t retryDelayMs_    = 0;

  // 驗證與心跳
  uint32_t speedFramesAtVerify_    = 0;
  uint32_t presenceFramesAtVerify_ = 0;
  uint32_t bytesAtVerify_          = 0;
  uint32_t bytesAtProbe_           = 0;
  uint32_t presenceWhileOnline_    = 0;
  uint32_t badFramesAtLastSpeed_   = 0;

  // 收到的資料
  static constexpr size_t kQueueSize = 4;
  RadarMeasurement queue_[kQueueSize];
  size_t   queueHead_  = 0;
  size_t   queueCount_ = 0;

  char     echo_[24]     = {};  // 最近收到的文字（偵測 sensorStop 回覆用）
  size_t   echoLen_      = 0;
  bool     stopEchoSeen_ = false;

  uint32_t bytesReceived_    = 0;
  uint32_t lastByteMs_       = 0;
  uint32_t lastSpeedFrameMs_ = 0;
  uint32_t speedFrames_      = 0;
  uint32_t presenceFrames_   = 0;
  uint32_t badFrames_        = 0;
  uint32_t initAttempts_     = 0;
};
