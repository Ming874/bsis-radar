#!/usr/bin/env sh
# 在電腦上編譯並執行韌體的單元測試（不需要 ESP32）
set -e
cd "$(dirname "$0")"
SRC=../RadarA_C4001_BLE/src
g++ -std=c++14 -Wall -Wextra -O1 -I"$SRC" \
  host_tests.cpp \
  "$SRC/core/DetectionConfig.cpp" \
  "$SRC/core/ThreatTracker.cpp" \
  "$SRC/core/RangeKalman.cpp" \
  "$SRC/core/RangeRateWindow.cpp" \
  "$SRC/core/VelocityCheck.cpp" \
  "$SRC/drivers/C4001Protocol.cpp" \
  "$SRC/comm/CommandParser.cpp" \
  "$SRC/comm/Telemetry.cpp" \
  -o host_tests.exe
./host_tests.exe
