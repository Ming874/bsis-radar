param(
  [string]$Port = 'COM3',
  # radar thresholds (RTHR) to compare, one round each
  [int[]]$Thresholds = @(5, 15, 30),
  [string]$OutDir = '.',
  # restore this RTHR at the end
  [int]$Restore = 5
)
# Guided walking test against the production firmware (v2.2.0+): sets RTHR over USB,
# speaks instructions (zh-TW voice), and records the 5 Hz debug lines with phase markers.
Add-Type -AssemblyName System.Speech
$voice = New-Object System.Speech.Synthesis.SpeechSynthesizer
try { $voice.SelectVoice('Microsoft Hanhan Desktop') } catch { }
$voice.Volume = 100

$sp = New-Object System.IO.Ports.SerialPort $Port, 115200, 'None', 8, 'One'
$sp.Encoding = [System.Text.Encoding]::UTF8
$sp.DtrEnable = $false
$sp.RtsEnable = $false
$sp.Open()

$script:buf = New-Object System.Text.StringBuilder
function Pump([int]$ms) {
  $sw = [Diagnostics.Stopwatch]::StartNew()
  while ($sw.ElapsedMilliseconds -lt $ms) {
    if ($sp.BytesToRead -gt 0) { [void]$script:buf.Append($sp.ReadExisting()) }
    Start-Sleep -Milliseconds 20
  }
}
function Mark([string]$text) { [void]$script:buf.Append("`n#PHASE $text`n") }

# prompts.txt lines: 0 intro, 1 away ({0} = round), 2 stand, 3 walk, 4 round end, 5 all done
$prompts = [IO.File]::ReadAllLines((Join-Path $PSScriptRoot 'prompts.txt'), [Text.Encoding]::UTF8)
$voice.Speak($prompts[0])
$n = 0
foreach ($thr in $Thresholds) {
  $n++
  $script:buf = New-Object System.Text.StringBuilder
  Mark "RTHR=$thr"
  $sp.Write("RTHR $thr`n")
  Pump 6000   # radar reconfigures (~4 s)
  $voice.SpeakAsync(($prompts[1] -f $n)) | Out-Null
  Pump 7000
  Mark 'away'
  Pump 20000
  $voice.SpeakAsync($prompts[2]) | Out-Null
  Pump 5000
  Mark 'stand'
  Pump 15000
  $voice.SpeakAsync($prompts[3]) | Out-Null
  Pump 4000
  Mark 'walk'
  Pump 30000
  Mark 'end'
  $voice.SpeakAsync(($prompts[4] -f $n)) | Out-Null
  Pump 3000
  $text = $script:buf.ToString() -replace "`r", ''
  [IO.File]::WriteAllText((Join-Path $OutDir "guided_fw_rthr$thr.txt"), $text, [Text.Encoding]::UTF8)
}
$sp.Write("RTHR $Restore`n")
Pump 6000
$sp.Close()
$voice.Speak($prompts[5])
'done'
