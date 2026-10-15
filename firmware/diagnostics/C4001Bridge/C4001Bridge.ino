// 診斷用：USB（115200）<-> C4001 UART（9600，RX=16、TX=17）直通，每行加上 ESP32 時間戳記（ms）
// USB 輸入一行：
//   text   -> 原樣送給雷達（不加換行，與 DFRobot 函式庫相同）
//   >text  -> 送 text + "\r\n"（資料手冊寫的格式）
#include <Arduino.h>

static char     lineBuf[160];
static size_t   lineLen     = 0;
static uint32_t lastByteMs  = 0;
static char     usbBuf[96];
static size_t   usbLen      = 0;

static void flushLine() {
  if (lineLen == 0) return;
  lineBuf[lineLen] = '\0';
  Serial.printf("%lu %s\n", static_cast<unsigned long>(millis()), lineBuf);
  lineLen = 0;
}

void setup() {
  Serial.begin(115200);
  Serial2.setRxBufferSize(2048);
  Serial2.begin(9600, SERIAL_8N1, 16, 17);
  Serial.println("BRIDGE READY");
}

void loop() {
  while (Serial2.available() > 0) {
    const char c = static_cast<char>(Serial2.read());
    lastByteMs   = millis();
    if (c == '\r' || c == '\n') {
      flushLine();
      continue;
    }
    if (c == '$') flushLine();  // 新資料框開始
    if (lineLen < sizeof(lineBuf) - 1) lineBuf[lineLen++] = c;
    if (c == '*') flushLine();  // 資料框結束
  }
  if (lineLen > 0 && millis() - lastByteMs > 30) flushLine();  // 沒有換行的提示字元等

  while (Serial.available() > 0) {
    const char c = static_cast<char>(Serial.read());
    if (c == '\r') continue;
    if (c == '\n') {
      usbBuf[usbLen] = '\0';
      if (usbLen > 0) {
        if (usbBuf[0] == '>') {
          Serial2.print(usbBuf + 1);
          Serial2.print("\r\n");
          Serial.printf("%lu >> [CRLF] %s\n", static_cast<unsigned long>(millis()), usbBuf + 1);
        } else {
          Serial2.print(usbBuf);
          Serial.printf("%lu >> %s\n", static_cast<unsigned long>(millis()), usbBuf);
        }
      }
      usbLen = 0;
    } else if (usbLen < sizeof(usbBuf) - 1) {
      usbBuf[usbLen++] = c;
    }
  }
}
