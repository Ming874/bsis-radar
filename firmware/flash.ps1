<#
.SYNOPSIS
  一鍵燒錄 Radar A 韌體到 ESP32（不需要安裝 Arduino IDE）。

.DESCRIPTION
  雙擊同資料夾的 flash.bat 即可。流程：
    1. 檢查 release\ 裡預先編譯好的韌體
    2. 找 esptool：tools\ → Arduino IDE 已安裝的版本 → 自動從 Espressif 官方 GitHub 下載
    3. 自動找出 ESP32 的 COM 埠（CH340 / CP210x / FTDI / ESP32 原生 USB）；沒有驅動時可協助安裝
    4. 燒錄（只寫程式區，ESP32 上已存的偵測設定會保留），並讀取開機訊息確認成功

.EXAMPLE
  .\flash.ps1               # 自動找 COM 埠
  .\flash.ps1 -Port COM7    # 指定 COM 埠
#>
param(
  [string]$Port = '',
  [switch]$NoVerify
)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch { }

$Root    = $PSScriptRoot
$Release = Join-Path $Root 'release'
$Tools   = Join-Path $Root 'tools'

# 燒錄位址 → 檔案（與 Arduino IDE 相同；不含 NVS 區，所以設定會保留）
$Images = [ordered]@{
  '0x1000'  = 'bootloader.bin'
  '0x8000'  = 'partitions.bin'
  '0xe000'  = 'boot_app0.bin'
  '0x10000' = 'firmware.bin'
}
$UsbSerialVids = @('1A86', '10C4', '0403', '303A')  # CH340、CP210x、FTDI、Espressif

function Step([int]$n, [string]$text) { Write-Host ''; Write-Host "[$n/4] $text" -ForegroundColor Cyan }
function Ok([string]$text) { Write-Host "      ✓ $text" -ForegroundColor Green }
function Info([string]$text) { Write-Host "      $text" }
function Fail([string]$text, [string[]]$tips = @()) {
  Write-Host ''
  Write-Host "✗ $text" -ForegroundColor Red
  foreach ($t in $tips) { Write-Host "   • $t" -ForegroundColor Yellow }
  exit 1
}

Write-Host '==============================================' -ForegroundColor DarkCyan
Write-Host '  Radar A 韌體燒錄工具（ESP32 + C4001 雷達）' -ForegroundColor White
Write-Host '==============================================' -ForegroundColor DarkCyan

# ---------------------------------------------------------------- 1. 韌體檔
Step 1 '檢查韌體檔'
foreach ($name in $Images.Values) {
  if (-not (Test-Path (Join-Path $Release $name))) {
    Fail "找不到 release\$name" @('請在有 Arduino IDE 的電腦執行：.\arduino.ps1 release', '再把整個 firmware 資料夾複製過來')
  }
}
$versionFile = Join-Path $Release 'VERSION.txt'
if (Test-Path $versionFile) { Ok ((Get-Content $versionFile -Encoding UTF8 | Select-Object -First 2) -join '，') } else { Ok '韌體檔齊全' }

# ---------------------------------------------------------------- 2. esptool
Step 2 '準備燒錄工具 esptool'
function Find-Esptool {
  if (Test-Path $Tools) {
    $local = Get-ChildItem -Path $Tools -Recurse -Filter 'esptool.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($local) { return $local.FullName }
  }
  $arduino = Join-Path $env:LOCALAPPDATA 'Arduino15\packages\esp32\tools\esptool_py'
  if (Test-Path $arduino) {
    $exe = Get-ChildItem -Path $arduino -Recurse -Filter 'esptool.exe' -ErrorAction SilentlyContinue | Sort-Object FullName -Descending | Select-Object -First 1
    if ($exe) { return $exe.FullName }
  }
  return $null
}

function Get-Esptool {
  Info '這台電腦沒有 esptool，從 Espressif 官方 GitHub 下載中…'
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  $latest = Invoke-RestMethod -Uri 'https://api.github.com/repos/espressif/esptool/releases/latest' -Headers @{ 'User-Agent' = 'RadarA-flash' }
  $asset = $latest.assets | Where-Object { $_.name -match 'windows-amd64\.zip$' } | Select-Object -First 1
  if (-not $asset) { return $null }
  New-Item -ItemType Directory -Force $Tools | Out-Null
  $zip = Join-Path $Tools $asset.name
  Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $zip -UseBasicParsing
  Expand-Archive -Path $zip -DestinationPath $Tools -Force
  Remove-Item $zip -Force
  $exe = Get-ChildItem -Path $Tools -Recurse -Filter 'esptool.exe' | Select-Object -First 1
  if ($exe) { return $exe.FullName }
  return $null
}

$esptool = Find-Esptool
if (-not $esptool) {
  try { $esptool = Get-Esptool } catch { $esptool = $null }
  if (-not $esptool) {
    Fail '無法取得 esptool' @('確認電腦有連上網路後再試一次', '或安裝 Arduino IDE 與 ESP32 開發板套件')
  }
}
$versionText = (& $esptool version 2>$null | Select-Object -Last 1)
$major = 4
if ("$versionText" -match '^(\d+)\.') { $major = [int]$Matches[1] }
Ok "esptool $versionText"

# esptool v5 起指令改用連字號（write-flash），v4 用底線（write_flash）
if ($major -ge 5) { $writeCmd = 'write-flash'; $before = 'default-reset'; $after = 'hard-reset' }
else { $writeCmd = 'write_flash'; $before = 'default_reset'; $after = 'hard_reset' }

# ---------------------------------------------------------------- 3. COM 埠
Step 3 '尋找 ESP32'
function Install-Ch340Driver {
  $exe = Join-Path $env:TEMP 'CH341SER.EXE'
  Info '從 WCH（沁恒）官方網站下載 CH340 驅動…'
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  Invoke-WebRequest -Uri 'https://www.wch-ic.com/download/file?id=65' -OutFile $exe -UserAgent 'Mozilla/5.0' -UseBasicParsing
  $sig = Get-AuthenticodeSignature $exe
  if ($sig.Status -ne 'Valid' -or $sig.SignerCertificate.Subject -notmatch 'Nanjing Qinheng') {
    Fail '下載的驅動簽章不正確，已停止安裝' @('請到 https://www.wch-ic.com/downloads/CH341SER_EXE.html 手動下載')
  }
  Ok '簽章正確（Nanjing Qinheng Microelectronics）'
  Info '接下來會跳出「使用者帳戶控制」請按「是」，再在安裝視窗按「INSTALL」…'
  Start-Process -FilePath $exe -Verb RunAs -Wait
}

$devices = @(Get-CimInstance Win32_PnPEntity | Where-Object { $_.PNPDeviceID -match 'VID_([0-9A-F]{4})' -and $UsbSerialVids -contains $Matches[1] })
$ports = @($devices | ForEach-Object { if ($_.Name -match '\((COM\d+)\)') { [pscustomobject]@{ Port = $Matches[1]; Name = $_.Name } } })
$noDriver = @($devices | Where-Object { $_.Name -notmatch '\(COM\d+\)' })

if (-not $Port) {
  if ($ports.Count -eq 1) {
    $Port = $ports[0].Port
  } elseif ($ports.Count -gt 1) {
    Info '找到多個裝置：'
    for ($i = 0; $i -lt $ports.Count; $i++) { Info ("  {0}) {1}" -f ($i + 1), $ports[$i].Name) }
    $pick = Read-Host '      請輸入編號'
    $idx = 0
    if (-not [int]::TryParse($pick, [ref]$idx) -or $idx -lt 1 -or $idx -gt $ports.Count) { Fail '編號不正確' }
    $Port = $ports[$idx - 1].Port
  } elseif ($noDriver.Count -gt 0) {
    Write-Host '      ESP32 已經接上，但這台電腦沒有它的 USB 驅動程式（CH340）。' -ForegroundColor Yellow
    $answer = Read-Host '      要自動下載並安裝官方驅動嗎？(Y/N)'
    if ($answer -match '^[Yy]') {
      Install-Ch340Driver
      Fail '驅動安裝完成，請拔掉 USB 線再插回去，然後重新執行 flash.bat'
    }
    Fail '沒有驅動無法燒錄' @('手動下載：https://www.wch-ic.com/downloads/CH341SER_EXE.html')
  } else {
    Fail '找不到 ESP32' @(
      'USB 線要插在 ESP32 板子本身的 USB-C 孔（EN / BOOT 按鈕旁邊），擴充底板的孔只能供電',
      '換一條確定能傳資料的線（有些線只能充電）',
      '插好後重新執行 flash.bat'
    )
  }
}
$label = ($ports | Where-Object { $_.Port -eq $Port } | Select-Object -First 1).Name
if (-not $label) { $label = $Port }
Ok "使用 $label"

# ---------------------------------------------------------------- 4. 燒錄
Step 4 '燒錄中（約 20 秒，請不要拔線）'
function Invoke-Flash([int]$baud) {
  $arguments = @('--chip', 'esp32', '--port', $Port, '--baud', "$baud", '--before', $before, '--after', $after, $writeCmd)
  foreach ($addr in $Images.Keys) { $arguments += @($addr, (Join-Path $Release $Images[$addr])) }
  # 輸出直接顯示在畫面上；不能讓它變成函式的回傳值（PowerShell 會把外部程式的輸出當成回傳內容）
  & $esptool @arguments | Out-Host
  return [int]$LASTEXITCODE
}
$code = Invoke-Flash 921600
if ($code -ne 0) {
  Write-Host '      高速燒錄失敗，改用較慢的速度再試一次…' -ForegroundColor Yellow
  $code = Invoke-Flash 115200
}
if ($code -ne 0) {
  Fail '燒錄失敗' @(
    '關掉 Arduino IDE 的序列埠監控視窗或其他正在使用這個 COM 埠的程式',
    '按住 ESP32 板子上的 BOOT 鍵，再執行一次（看到 Connecting... 後放開）',
    '換一個 USB 孔或換一條線'
  )
}
Ok '燒錄完成'

# ---------------------------------------------------------------- 確認開機
if (-not $NoVerify) {
  Write-Host ''
  Write-Host '確認 ESP32 開機訊息…' -ForegroundColor Cyan
  $serial = New-Object System.IO.Ports.SerialPort $Port, 115200, 'None', 8, 'One'
  $serial.DtrEnable = $false
  $serial.RtsEnable = $false
  $serial.ReadTimeout = 300
  $serial.Encoding = [Text.Encoding]::UTF8
  $seenConfig = $false
  try {
    $serial.Open()
    $askedConfig = $false
    $deadline = (Get-Date).AddSeconds(9)
    $start = Get-Date
    while ((Get-Date) -lt $deadline) {
      if (-not $askedConfig -and ((Get-Date) - $start).TotalSeconds -gt 2) { $serial.Write("GET`n"); $askedConfig = $true }
      try {
        $line = $serial.ReadLine().TrimEnd()
        if ($line -match '^=== Radar A|^\[藍牙\]|^\[Radar A\]|^CFG |^\[設定\]') {
          Write-Host "      $line"
          if ($line -match 'CFG ') { $seenConfig = $true }
        }
      } catch [TimeoutException] { }
    }
  } catch {
    Write-Host "      （無法開啟 $Port 讀取訊息：$($_.Exception.Message)）" -ForegroundColor Yellow
  } finally {
    if ($serial.IsOpen) { $serial.Close() }
  }
  if ($seenConfig) { Write-Host ''; Write-Host '✓ ESP32 已經在執行新韌體！' -ForegroundColor Green }
  else { Write-Host ''; Write-Host '燒錄已完成，但沒有讀到開機訊息；可以用手機網頁連線確認。' -ForegroundColor Yellow }
}

Write-Host ''
Write-Host '下一步：手機用 Chrome 開啟 https://bsis.iosoftware.ai ，按「連線雷達」。' -ForegroundColor White
