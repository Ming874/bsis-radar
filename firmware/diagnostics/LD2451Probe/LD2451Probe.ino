// 診斷用：找出 HLK-LD2451 接在 ESP32 的哪兩支腳、用哪個鮑率，然後持續印出解碼後的資料框。
//
// 1. 被動：同時監看所有候選腳位 2 秒，電位有變化的腳就是 LD2451 TX（接 ESP32 的 RX）
// 2. 在有變化的腳上依序試鮑率，收到 F4 F3 F2 F1 資料框或 FD FC FB FA 回覆就算找到
// 3. 被動找不到（LD2451 沒有目標時可能完全不送）：輪流在候選腳上送「進入設定」指令，
//    看哪一支腳有回覆。送指令的腳用開汲極輸出（只往下拉），避免和別的裝置的輸出互相推擠
// 4. 找到之後讀韌體版本、目標參數、靈敏度，接著每個資料框印一行
//
// 不碰 C4001（GPIO16/17）、輪速感測器（GPIO27）、LED（GPIO2）、USB（GPIO1/3）、flash（GPIO6～11）、GPIO0。
// USB（115200）可輸入：
//   R                 讀回目標參數與靈敏度
//   T <dist> <dir> <spd> <delay>   設定目標參數（距離 m、方向 0 遠離 1 靠近 2 都要、最低速度 km/h、延遲 s）
//   S <trigger> <snr>              設定靈敏度
// 用完一定要燒回正式韌體（..\flash.bat 或 ..\arduino.ps1 upload）；正式韌體開機時會重新寫入它要的雷達設定。
#include <Arduino.h>
#include <driver/gpio.h>
#include <soc/gpio_reg.h>

static const int8_t kCandidates[] = {4, 5, 12, 13, 14, 15, 18, 19, 21, 22, 23, 25, 26, 32, 33, 34, 35, 36, 39};
static const size_t kCandidateCount = sizeof(kCandidates) / sizeof(kCandidates[0]);
static const uint32_t kBauds[] = {115200, 256000, 230400, 460800, 57600, 38400, 19200, 9600};
static const size_t kBaudCount = sizeof(kBauds) / sizeof(kBauds[0]);

static bool inputOnly(int8_t pin) { return pin >= 34; }

// 下拉：沒接的腳固定在低電位（LD2451 TX 閒置是高電位）。GPIO34～39 沒有內建上下拉
static void listenPin(int8_t pin) { pinMode(pin, inputOnly(pin) ? INPUT : INPUT_PULLDOWN); }

static bool readPin(int8_t pin) {
  if (pin < 32) return (REG_READ(GPIO_IN_REG) >> pin) & 1U;
  return (REG_READ(GPIO_IN1_REG) >> (pin - 32)) & 1U;
}

// ---------------------------------------------------------------- 資料框解析（與正式韌體 LD2451Protocol 相同的格式）
struct Parser {
  uint8_t  buf[80];
  size_t   len    = 0;
  uint16_t need   = 0;
  bool     report = false;
  int      state  = 0;  // 0 找表頭、1 長度、2 內容、3 表尾

  // 回傳 1 = 資料框、2 = 指令回覆、0 = 還沒完成
  int push(uint8_t b) {
    static const uint8_t kRep[4] = {0xF4, 0xF3, 0xF2, 0xF1};
    static const uint8_t kAck[4] = {0xFD, 0xFC, 0xFB, 0xFA};
    static const uint8_t kRepEnd[4] = {0xF8, 0xF7, 0xF6, 0xF5};
    static const uint8_t kAckEnd[4] = {0x04, 0x03, 0x02, 0x01};
    if (state == 0) {
      if (len == 0) {
        if (b == kRep[0] || b == kAck[0]) {
          report = b == kRep[0];
          buf[len++] = b;
        }
        return 0;
      }
      const uint8_t* h = report ? kRep : kAck;
      if (b == h[len]) {
        buf[len++] = b;
        if (len == 4) state = 1;
      } else {
        len = 0;
        return push(b);
      }
      return 0;
    }
    buf[len++] = b;
    if (state == 1) {
      if (len == 6) {
        need = buf[4] | (buf[5] << 8);
        if (need > 64) {
          reset();
          return 0;
        }
        state = need == 0 ? 3 : 2;
      }
      return 0;
    }
    if (state == 2) {
      if (len == 6u + need) state = 3;
      return 0;
    }
    const uint8_t* e = report ? kRepEnd : kAckEnd;
    const size_t   k = len - 7 - need;
    if (b != e[k]) {
      reset();
      return 0;
    }
    if (k == 3) {
      const int kind = report ? 1 : 2;
      state = 0;
      len   = 0;
      return kind;
    }
    return 0;
  }
  void reset() {
    state = 0;
    len   = 0;
  }
  const uint8_t* payload() const { return buf + 6; }
};

static Parser   gParser;
static int8_t   gRx = -1, gTx = -1;
static uint32_t gBaud = 0;
static uint8_t  gLastPayload[80];
static uint16_t gLastLen = 0;

static void dumpHex(const uint8_t* p, size_t n) {
  for (size_t i = 0; i < n; i++) Serial.printf("%02X ", p[i]);
}

static void sendCommand(uint8_t cmd, const uint8_t* value, uint8_t n) {
  uint8_t frame[24];
  size_t  k = 0;
  const uint8_t head[4] = {0xFD, 0xFC, 0xFB, 0xFA};
  memcpy(frame, head, 4);
  k = 4;
  frame[k++] = static_cast<uint8_t>(2 + n);
  frame[k++] = 0;
  frame[k++] = cmd;
  frame[k++] = 0;
  for (uint8_t i = 0; i < n; i++) frame[k++] = value[i];
  const uint8_t tail[4] = {0x04, 0x03, 0x02, 0x01};
  memcpy(frame + k, tail, 4);
  k += 4;
  Serial1.write(frame, k);
  Serial1.flush();
}

// 收資料直到逾時；收到指定的回覆就提早返回。回傳收到的完整資料框數（資料框 + 回覆）
static int pump(uint32_t ms, int wantAckCmd = -1, bool print = false) {
  int frames = 0;
  const uint32_t start = millis();
  while (millis() - start < ms) {
    while (Serial1.available() > 0) {
      const int kind = gParser.push(static_cast<uint8_t>(Serial1.read()));
      if (kind == 0) continue;
      frames++;
      const uint8_t* p = gParser.payload();
      const uint16_t n = gParser.need;
      if (kind == 2) {  // 只記指令回覆：資料框的第一個位元組（目標數）可能剛好等於指令碼
        memcpy(gLastPayload, p, n);
        gLastLen = n;
      }
      if (print) {
        Serial.printf("%lu %s len=%u: ", static_cast<unsigned long>(millis()), kind == 1 ? "REPORT" : "ACK", n);
        dumpHex(p, n);
        Serial.println();
      }
      if (kind == 2 && wantAckCmd >= 0 && n >= 2 && p[0] == wantAckCmd && p[1] == 0x01) return frames;
    }
    delay(1);
  }
  return frames;
}

static bool command(uint8_t cmd, const uint8_t* value, uint8_t n, bool print = true) {
  sendCommand(cmd, value, n);
  const uint32_t start = millis();
  while (millis() - start < 600) {
    gLastLen = 0;
    pump(600 - (millis() - start), cmd, false);
    if (gLastLen >= 4 && gLastPayload[0] == cmd && gLastPayload[1] == 0x01) {
      if (print) {
        Serial.printf("  ack 0x%02X status=%u data: ", cmd, gLastPayload[2] | (gLastPayload[3] << 8));
        dumpHex(gLastPayload + 4, gLastLen - 4);
        Serial.println();
      }
      return (gLastPayload[2] | (gLastPayload[3] << 8)) == 0;
    }
  }
  if (print) Serial.printf("  no ack for 0x%02X\n", cmd);
  return false;
}

static const uint8_t kEnable[2] = {0x01, 0x00};

static void readParams() {
  if (!command(0xFF, kEnable, 2)) return;
  if (command(0xA0, nullptr, 0) && gLastLen >= 12) {
    const uint8_t* d = gLastPayload + 4;
    Serial.printf("FIRMWARE type=0x%02X%02X V%u.%02u.%02X%02X%02X%02X\n", d[1], d[0], d[3], d[2], d[7], d[6], d[5], d[4]);
  }
  if (command(0x12, nullptr, 0) && gLastLen >= 8) {
    const uint8_t* d = gLastPayload + 4;
    Serial.printf("TARGET maxDist=%u m dir=%u minSpeed=%u km/h delay=%u s\n", d[0], d[1], d[2], d[3]);
  }
  if (command(0x13, nullptr, 0) && gLastLen >= 6) {
    const uint8_t* d = gLastPayload + 4;
    Serial.printf("SENSITIVITY trigger=%u snr=%u ext=%u,%u\n", d[0], d[1], gLastLen >= 8 ? d[2] : 0, gLastLen >= 8 ? d[3] : 0);
  }
  command(0xFE, nullptr, 0);
}

// ---------------------------------------------------------------- 1. 被動：哪些腳有電位變化
static void passiveScan(uint32_t edges[]) {
  for (size_t i = 0; i < kCandidateCount; i++) {
    listenPin(kCandidates[i]);
    edges[i] = 0;
  }
  bool last[kCandidateCount];
  for (size_t i = 0; i < kCandidateCount; i++) last[i] = readPin(kCandidates[i]);
  const uint32_t start = millis();
  while (millis() - start < 2500) {
    for (size_t i = 0; i < kCandidateCount; i++) {
      const bool v = readPin(kCandidates[i]);
      if (v != last[i]) {
        edges[i]++;
        last[i] = v;
      }
    }
  }
}

static bool tryRx(int8_t rx, uint32_t baud) {
  Serial1.end();
  Serial1.setRxBufferSize(1024);
  Serial1.begin(baud, SERIAL_8N1, rx, -1);
  delay(20);
  while (Serial1.available()) Serial1.read();
  gParser.reset();
  return pump(800) >= 2;
}

// ---------------------------------------------------------------- 3. 主動：送指令，看哪一支腳回覆
static void openDrainTx(int8_t tx) {
  gpio_set_pull_mode(static_cast<gpio_num_t>(tx), GPIO_PULLUP_ONLY);
  gpio_set_direction(static_cast<gpio_num_t>(tx), GPIO_MODE_INPUT_OUTPUT_OD);
}

static int8_t activeProbe(uint32_t& baudOut, int8_t& txOut) {
  for (size_t b = 0; b < 2; b++) {  // 原廠 115200；有些模組被改成 256000
    const uint32_t baud = kBauds[b];
    for (size_t t = 0; t < kCandidateCount; t++) {
      const int8_t tx = kCandidates[t];
      if (inputOnly(tx)) continue;
      Serial1.end();
      Serial1.begin(baud, SERIAL_8N1, -1, tx);
      openDrainTx(tx);
      for (size_t i = 0; i < kCandidateCount; i++)
        if (kCandidates[i] != tx) listenPin(kCandidates[i]);
      delay(5);
      bool last[kCandidateCount];
      uint32_t edges[kCandidateCount] = {};
      for (size_t i = 0; i < kCandidateCount; i++) last[i] = readPin(kCandidates[i]);
      sendCommand(0xFF, kEnable, 2);
      const uint32_t start = millis();
      while (millis() - start < 80) {
        for (size_t i = 0; i < kCandidateCount; i++) {
          if (kCandidates[i] == tx) continue;
          const bool v = readPin(kCandidates[i]);
          if (v != last[i]) {
            edges[i]++;
            last[i] = v;
          }
        }
      }
      for (size_t i = 0; i < kCandidateCount; i++) {
        if (kCandidates[i] == tx || edges[i] < 20) continue;
        // 有變化：用真的 UART 確認是 LD2451 的回覆
        const int8_t rx = kCandidates[i];
        Serial1.end();
        Serial1.setRxBufferSize(1024);
        Serial1.begin(baud, SERIAL_8N1, rx, tx);
        openDrainTx(tx);
        delay(20);
        gParser.reset();
        if (command(0xFF, kEnable, 2, false)) {
          command(0xFE, nullptr, 0, false);
          baudOut = baud;
          txOut   = tx;
          return rx;
        }
      }
    }
  }
  return -1;
}

// 已知 RX 與鮑率之後找 TX：輪流在候選腳上送指令，收得到回覆的就是
static bool gPushPull = false;

static int8_t findTx(int8_t rx, uint32_t baud) {
  for (int mode = 0; mode < 2; mode++) {  // 先開汲極（安全），再一般推挽
    for (size_t t = 0; t < kCandidateCount; t++) {
      const int8_t tx = kCandidates[t];
      if (inputOnly(tx) || tx == rx) continue;
      Serial1.end();
      Serial1.setRxBufferSize(1024);
      Serial1.begin(baud, SERIAL_8N1, rx, tx);
      if (mode == 0) openDrainTx(tx);
      delay(10);
      gParser.reset();
      const bool ok = command(0xFF, kEnable, 2, false);
      Serial.printf("TRY TX=GPIO%d %s: %s\n", tx, mode == 0 ? "open-drain" : "push-pull", ok ? "ACK" : "-");
      if (ok) {
        command(0xFE, nullptr, 0, false);
        gPushPull = mode == 1;
        return tx;
      }
      Serial1.end();
      listenPin(tx);
    }
  }
  // 一般不碰的腳（輪速 27、LED 2、BOOT 0）：只用開汲極試，別的裝置也只會往下拉，不會互相推擠
  static const int8_t kExtra[] = {27, 2, 0};
  for (int8_t tx : kExtra) {
    Serial1.end();
    Serial1.setRxBufferSize(1024);
    Serial1.begin(baud, SERIAL_8N1, rx, tx);
    openDrainTx(tx);
    delay(10);
    gParser.reset();
    const bool ok = command(0xFF, kEnable, 2, false);
    Serial.printf("TRY TX=GPIO%d open-drain: %s\n", tx, ok ? "ACK" : "-");
    Serial1.end();
    pinMode(tx, INPUT);
    if (ok) return tx;
  }
  return -1;
}

static void printTargets(const uint8_t* p, uint16_t n) {
  if (n < 2) {
    Serial.printf("%lu FRAME targets=0\n", static_cast<unsigned long>(millis()));
    return;
  }
  const uint8_t count = p[0];
  Serial.printf("%lu FRAME targets=%u alarm=%u", static_cast<unsigned long>(millis()), count, p[1]);
  for (uint8_t i = 0; i < count && 2 + 5 * (i + 1) <= n; i++) {
    const uint8_t* t = p + 2 + 5 * i;
    Serial.printf(" | angle=%d dist=%u dir=%u speed=%u snr=%u", static_cast<int>(t[0]) - 0x80, t[1], t[2], t[3], t[4]);
  }
  Serial.println();
}

void setup() {
  Serial.begin(115200);
  delay(300);
  Serial.println();
  Serial.println("LD2451 PROBE");

  uint32_t edges[kCandidateCount];
  passiveScan(edges);
  Serial.print("PASSIVE edges:");
  for (size_t i = 0; i < kCandidateCount; i++) Serial.printf(" %d=%lu", kCandidates[i], static_cast<unsigned long>(edges[i]));
  Serial.println();

  // 有變化但不多的腳：LD2451 沒有目標時可能很久才送一個空資料框，每個鮑率聽久一點並印出原始位元組
  for (size_t i = 0; i < kCandidateCount; i++) {
    if (edges[i] < 10) continue;
    for (size_t b = 0; b < kBaudCount; b++) {
      Serial1.end();
      Serial1.setRxBufferSize(2048);
      Serial1.begin(kBauds[b], SERIAL_8N1, kCandidates[i], -1);
      delay(20);
      while (Serial1.available()) Serial1.read();
      gParser.reset();
      uint8_t raw[24];
      size_t  nRaw = 0, total = 0;
      int     frames = 0;
      const uint32_t start = millis();
      while (millis() - start < 2500) {
        while (Serial1.available() > 0) {
          const uint8_t c = static_cast<uint8_t>(Serial1.read());
          if (nRaw < sizeof(raw)) raw[nRaw++] = c;
          total++;
          if (gParser.push(c) != 0) frames++;
        }
        delay(1);
      }
      Serial.printf("SNIFF GPIO%d %lu: bytes=%u frames=%d first:", kCandidates[i], static_cast<unsigned long>(kBauds[b]),
                    static_cast<unsigned>(total), frames);
      dumpHex(raw, nRaw);
      Serial.println();
      bool header = false;  // 看得到 F4 F3 F2 F1：鮑率對了，但資料框可能有位元錯誤
      for (size_t k = 0; k + 3 < nRaw; k++)
        if (raw[k] == 0xF4 && raw[k + 1] == 0xF3 && raw[k + 2] == 0xF2 && raw[k + 3] == 0xF1) header = true;
      if ((frames >= 1 || header) && gRx < 0) {
        gRx   = kCandidates[i];
        gBaud = kBauds[b];
        Serial.printf("FOUND RX(LD2451 TX)=GPIO%d baud=%lu (sniff)\n", gRx, static_cast<unsigned long>(gBaud));
      }
    }
  }

  for (size_t i = 0; i < kCandidateCount && gRx < 0; i++) {
    if (edges[i] < 50) continue;
    for (size_t b = 0; b < kBaudCount; b++) {
      if (tryRx(kCandidates[i], kBauds[b])) {
        gRx   = kCandidates[i];
        gBaud = kBauds[b];
        Serial.printf("FOUND RX(LD2451 TX)=GPIO%d baud=%lu (passive)\n", gRx, static_cast<unsigned long>(gBaud));
        break;
      }
    }
  }

  if (gRx >= 0) {
    gTx = findTx(gRx, gBaud);
    if (gTx >= 0) Serial.printf("FOUND TX(LD2451 RX)=GPIO%d\n", gTx);
    else Serial.println("TX NOT FOUND: LD2451 RX may be unconnected (data is received but commands cannot be sent)");
  } else {
    Serial.println("PASSIVE: no LD2451 data. Trying active probe...");
    uint32_t baud = 0;
    int8_t   tx   = -1;
    const int8_t rx = activeProbe(baud, tx);
    if (rx >= 0) {
      gRx = rx, gTx = tx, gBaud = baud;
      Serial.printf("FOUND RX(LD2451 TX)=GPIO%d TX(LD2451 RX)=GPIO%d baud=%lu (active)\n", gRx, gTx, static_cast<unsigned long>(gBaud));
    }
  }

  if (gRx < 0) {
    Serial.println("RESULT NOT_FOUND: check 5V/GND and that LD2451 TX/RX go to two free GPIOs");
    return;
  }
  Serial.printf("RESULT rx=%d tx=%d baud=%lu\n", gRx, gTx, static_cast<unsigned long>(gBaud));
  Serial1.end();
  Serial1.setRxBufferSize(2048);
  Serial1.begin(gBaud, SERIAL_8N1, gRx, gTx);
  if (gTx >= 0 && !gPushPull) openDrainTx(gTx);
  {  // 原始位元組 10 秒：看資料框的間隔與位元錯誤
    Serial.print("RAW 10s:");
    uint32_t lastMs = 0;
    const uint32_t start = millis();
    while (millis() - start < 30000) {
      while (Serial1.available() > 0) {
        const uint32_t now = millis();
        if (now - lastMs > 20) Serial.printf("\nRAW %lu:", static_cast<unsigned long>(now));
        lastMs = now;
        Serial.printf(" %02X", Serial1.read());
      }
      delay(1);
    }
    Serial.println();
  }
  gParser.reset();
  if (gTx >= 0) readParams();
  Serial.println("STREAM");
}

static char   usbBuf[64];
static size_t usbLen = 0;

static void handleUsb(const char* line) {
  int a = 0, b = 0, c = 0, d = 0;
  if (line[0] == 'R' || line[0] == 'r') {
    readParams();
  } else if ((line[0] == 'T' || line[0] == 't') && sscanf(line + 1, "%d %d %d %d", &a, &b, &c, &d) == 4) {
    const uint8_t v[4] = {static_cast<uint8_t>(a), static_cast<uint8_t>(b), static_cast<uint8_t>(c), static_cast<uint8_t>(d)};
    if (command(0xFF, kEnable, 2)) {
      command(0x02, v, 4);
      command(0xFE, nullptr, 0);
    }
  } else if ((line[0] == 'S' || line[0] == 's') && sscanf(line + 1, "%d %d", &a, &b) == 2) {
    const uint8_t v[4] = {static_cast<uint8_t>(a), static_cast<uint8_t>(b), 0, 0};
    if (command(0xFF, kEnable, 2)) {
      command(0x03, v, 4);
      command(0xFE, nullptr, 0);
    }
  }
}

void loop() {
  if (gRx < 0) {
    delay(100);
    return;
  }
  while (Serial1.available() > 0) {
    const int kind = gParser.push(static_cast<uint8_t>(Serial1.read()));
    if (kind == 1) printTargets(gParser.payload(), gParser.need);
    else if (kind == 2) {
      Serial.printf("%lu ACK: ", static_cast<unsigned long>(millis()));
      dumpHex(gParser.payload(), gParser.need);
      Serial.println();
    }
  }
  while (Serial.available() > 0 && gTx >= 0) {
    const char ch = static_cast<char>(Serial.read());
    if (ch == '\r') continue;
    if (ch == '\n') {
      usbBuf[usbLen] = '\0';
      if (usbLen > 0) handleUsb(usbBuf);
      usbLen = 0;
    } else if (usbLen < sizeof(usbBuf) - 1) {
      usbBuf[usbLen++] = ch;
    }
  }
  delay(1);
}
