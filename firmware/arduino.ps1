<#
.SYNOPSIS
  用指令操作 Arduino（不必開 IDE）：編譯、燒錄、序列埠監看、電腦端單元測試。

.DESCRIPTION
  使用 Arduino IDE 內建的 arduino-cli，與 IDE 共用已安裝的開發板與函式庫。
  在 VS Code 終端機（PowerShell）於 firmware 資料夾執行。

.EXAMPLE
  .\arduino.ps1 setup            # 第一次：安裝 ESP32 開發板套件
  .\arduino.ps1 compile          # 編譯（顯示所有警告）
  .\arduino.ps1 upload           # 編譯並燒錄（自動找 ESP32 的 COM 埠）
  .\arduino.ps1 upload -Port COM5
  .\arduino.ps1 monitor          # 序列埠監看（115200），可直接輸入 HELP、GET、TEST 0 等指令
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

$Cli = Join-Path $env:LOCALAPPDATA 'Programs\Arduino IDE\resources\app\lib\backend\resources\arduino-cli.exe'
if (-not (Test-Path $Cli)) { $Cli = 'arduino-cli' }   # 沒裝 IDE 時改用 PATH 上的 arduino-cli
$Config = Join-Path $env:USERPROFILE '.arduinoIDE\arduino-cli.yaml'
$Common = @()
if (Test-Path $Config) { $Common = @('--config-file', $Config) }

$Sketch = Join-Path $PSScriptRoot 'RadarA_C4001_BLE'
$Build  = Join-Path $PSScriptRoot '.build'

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
  if ($found.Count -eq 0) { throw '找不到 ESP32：請確認 USB 線有接好（要能傳資料的線），或用 -Port COMx 指定' }
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
      'bootloader.bin' = 'RadarA_C4001_BLE.ino.bootloader.bin'
      'partitions.bin' = 'RadarA_C4001_BLE.ino.partitions.bin'
      'boot_app0.bin'  = 'boot_app0.bin'
      'firmware.bin'   = 'RadarA_C4001_BLE.ino.bin'
    }
    foreach ($name in $files.Keys) { Copy-Item (Join-Path $Build $files[$name]) (Join-Path $rel $name) -Force }
    $version = (Select-String -Path (Join-Path $Sketch 'AppConfig.h') -Pattern '#define FW_VERSION "([^"]+)"').Matches[0].Groups[1].Value
    $hash = (Get-FileHash (Join-Path $rel 'firmware.bin') -Algorithm SHA256).Hash.ToLower()
    @(
      "RadarA_C4001_BLE v$version",
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
    $exe = Join-Path $tests 'host_tests.exe'
    & g++ -std=c++14 -Wall -Wextra -O1 "-I$src" `
      (Join-Path $tests 'host_tests.cpp') `
      (Join-Path $src 'core\DetectionConfig.cpp') `
      (Join-Path $src 'core\ThreatTracker.cpp') `
      (Join-Path $src 'drivers\C4001Protocol.cpp') `
      (Join-Path $src 'comm\CommandParser.cpp') `
      (Join-Path $src 'comm\Telemetry.cpp') `
      -o $exe
    if ($LASTEXITCODE -ne 0) { throw 'g++ 編譯失敗' }
    & $exe
    if ($LASTEXITCODE -ne 0) { throw '單元測試有失敗項目' }
  }
}
