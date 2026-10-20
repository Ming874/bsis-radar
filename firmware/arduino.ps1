<#
.SYNOPSIS
  用指令操作 Arduino（不必開 IDE）：編譯、燒錄、序列埠監看、電腦端單元測試、輸出一鍵燒錄檔。

.DESCRIPTION
  使用 arduino-cli，與 Arduino IDE 共用已安裝的開發板套件（%LOCALAPPDATA%\Arduino15）。
  找 arduino-cli 的順序：環境變數 ARDUINO_CLI → Arduino IDE 內建 → PATH。
  在 firmware 資料夾執行。

.EXAMPLE
  .\arduino.ps1 setup            # 第一次：安裝 ESP32 開發板套件
  .\arduino.ps1 compile          # 編譯（顯示所有警告）
  .\arduino.ps1 upload           # 編譯並燒錄（自動找 ESP32 的 COM 埠）
  .\arduino.ps1 upload -Port COM7
  .\arduino.ps1 monitor          # 序列埠監看（115200），可直接輸入 HELP、GET、ANGLE 45 等指令
  .\arduino.ps1 ports            # 列出所有 COM 埠
  .\arduino.ps1 test             # 在電腦上跑單元測試（需要 g++）
  .\arduino.ps1 release          # 編譯並輸出到 release\，給 flash.bat 一鍵燒錄（不需要 Arduino IDE）
#>
param(
  [Parameter(Position = 0)]
  [ValidateSet('setup', 'compile', 'upload', 'monitor', 'ports', 'test', 'release')]
  [string]$Action = 'compile',
  [string]$Port = '',
  [string]$Fqbn = 'esp32:esp32:esp32'   # ESP32 Dev Module
)

$ErrorActionPreference = 'Stop'

$Cli = $env:ARDUINO_CLI
if (-not $Cli -or -not (Test-Path $Cli)) {
  $Cli = Join-Path $env:LOCALAPPDATA 'Programs\Arduino IDE\resources\app\lib\backend\resources\arduino-cli.exe'
}
if (-not (Test-Path $Cli)) { $Cli = 'arduino-cli' }   # 沒裝 IDE 時改用 PATH 上的 arduino-cli
$Config = Join-Path $env:USERPROFILE '.arduinoIDE\arduino-cli.yaml'
$Common = @()
if (Test-Path $Config) { $Common = @('--config-file', $Config) }

$SketchName = 'SpeedRadar'
$Sketch     = Join-Path $PSScriptRoot $SketchName
$Build      = Join-Path $PSScriptRoot '.build'

# 電腦端單元測試編譯的純邏輯檔案（新增 .cpp 時兩邊都要加：這裡與 tests/run_tests.sh）
$TestSources = @(
  'core\SpeedConfig.cpp',
  'core\GroundSpeedEstimator.cpp',
  'core\WheelSpeed.cpp',
  'drivers\C4001Protocol.cpp',
  'comm\CommandParser.cpp',
  'comm\Telemetry.cpp'
)

function Invoke-Cli {
  & $Cli @Common @args
  if ($LASTEXITCODE -ne 0) { throw "arduino-cli 失敗（exit $LASTEXITCODE）" }
}

# 依 USB 晶片廠商 ID 找出 ESP32 的 COM 埠：CH340、CP210x、FTDI、Espressif 原生 USB
function Find-Esp32Port {
  $knownVids = @('0x1A86', '0x10C4', '0x0403', '0x303A')
  $json = & $Cli @Common board list --format json | ConvertFrom-Json
  $found = @()
  foreach ($p in $json.detected_ports) {
    $vid = $p.port.properties.vid
    if ($vid -and ($knownVids -contains $vid.ToUpper().Replace('0X', '0x'))) { $found += $p.port.address }
  }
  if ($found.Count -eq 1) { return $found[0] }
  if ($found.Count -eq 0) { throw '找不到 ESP32：USB 線要插在 ESP32 板子本身的孔、要能傳資料，或用 -Port COMx 指定' }
  throw "找到多個可能的埠（$($found -join ', ')），請用 -Port 指定"
}

function Get-TargetPort {
  if ($Port) { return $Port }
  return Find-Esp32Port
}

switch ($Action) {
  'setup' {
    Invoke-Cli config add board_manager.additional_urls https://espressif.github.io/arduino-esp32/package_esp32_index.json
    Invoke-Cli core update-index
    Invoke-Cli core install esp32:esp32
  }
  'compile' {
    Invoke-Cli compile --fqbn $Fqbn --warnings all --build-path $Build $Sketch
  }
  'upload' {
    $target = Get-TargetPort
    Write-Host "燒錄到 $target ..."
    Invoke-Cli compile --fqbn $Fqbn --build-path $Build $Sketch
    Invoke-Cli upload --fqbn $Fqbn --port $target --input-dir $Build $Sketch
  }
  'monitor' {
    $target = Get-TargetPort
    Write-Host "監看 $target（115200），按 Ctrl+C 離開"
    Invoke-Cli monitor --port $target --config baudrate=115200
  }
  'ports' {
    Invoke-Cli board list
  }
  'release' {
    Invoke-Cli compile --fqbn $Fqbn --warnings all --build-path $Build $Sketch
    $rel = Join-Path $PSScriptRoot 'release'
    New-Item -ItemType Directory -Force $rel | Out-Null
    # 檔名 → 燒錄位址（與 Arduino IDE 燒錄時相同，不包含 NVS，所以 ESP32 上的設定會保留）
    $files = [ordered]@{
      'bootloader.bin' = "$SketchName.ino.bootloader.bin"
      'partitions.bin' = "$SketchName.ino.partitions.bin"
      'boot_app0.bin'  = 'boot_app0.bin'
      'firmware.bin'   = "$SketchName.ino.bin"
    }
    foreach ($name in $files.Keys) {
      $src = Join-Path $Build $files[$name]
      if ($name -eq 'boot_app0.bin' -and -not (Test-Path $src)) {
        # 有些核心版本不會把 boot_app0.bin 複製到建置資料夾，改從開發板套件取得
        $src = Get-ChildItem (Join-Path $env:LOCALAPPDATA 'Arduino15\packages\esp32\hardware\esp32') -Recurse -Filter 'boot_app0.bin' | Select-Object -First 1 -ExpandProperty FullName
      }
      Copy-Item $src (Join-Path $rel $name) -Force
    }
    $version = (Select-String -Path (Join-Path $Sketch 'AppConfig.h') -Pattern '#define FW_VERSION "([^"]+)"').Matches[0].Groups[1].Value
    $hash = (Get-FileHash (Join-Path $rel 'firmware.bin') -Algorithm SHA256).Hash.ToLower()
    @(
      "BSIS SpeedRadar v$version",
      "built   : $(Get-Date -Format 'yyyy-MM-dd HH:mm')",
      "board   : $Fqbn (ESP32 Dev Module)",
      "flash   : bootloader.bin@0x1000 partitions.bin@0x8000 boot_app0.bin@0xe000 firmware.bin@0x10000",
      "sha256  : $hash (firmware.bin)"
    ) | Set-Content -Encoding utf8 (Join-Path $rel 'VERSION.txt')
    Write-Host "已輸出韌體 v$version 到 $rel；把整個 firmware 資料夾給別人，雙擊 flash.bat 就能燒錄"
  }
  'test' {
    $src = Join-Path $Sketch 'src'
    $tests = Join-Path $PSScriptRoot 'tests'
    $exe = Join-Path $tests 'host_tests.exe'   # 放在 tests\（已排除在 git 外）：Windows 會擋暫存資料夾裡新編出來的 exe
    $sources = @((Join-Path $tests 'host_tests.cpp')) + ($TestSources | ForEach-Object { Join-Path $src $_ })
    & g++ -std=c++14 -Wall -Wextra -O1 "-I$src" @sources -o $exe
    if ($LASTEXITCODE -ne 0) { throw 'g++ 編譯失敗' }
    & $exe
    if ($LASTEXITCODE -ne 0) { throw '單元測試有失敗項目' }
  }
}
