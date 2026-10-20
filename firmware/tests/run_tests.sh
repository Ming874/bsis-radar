#!/usr/bin/env sh
# 在電腦上編譯並執行韌體的單元測試（不需要 ESP32）
set -e
cd "$(dirname "$0")"
SRC=../SpeedRadar/src
g++ -std=c++14 -Wall -Wextra -O1 -I"$SRC" \
  host_tests.cpp \
  "$SRC/core/SpeedConfig.cpp" \
  "$SRC/core/GroundSpeedEstimator.cpp" \
  "$SRC/core/WheelSpeed.cpp" \
  "$SRC/drivers/C4001Protocol.cpp" \
  "$SRC/comm/CommandParser.cpp" \
  "$SRC/comm/Telemetry.cpp" \
  -o host_tests.exe
./host_tests.exe
