param(
  [string]$Port = 'COM3',
  # each step: "delayMs|command" (delay since previous step); empty command = just wait
  [string[]]$Steps = @(),
  # keep capturing this long after the last step
  [int]$TailSeconds = 5,
  [string]$Out = ''
)
$sp = New-Object System.IO.Ports.SerialPort $Port, 115200, 'None', 8, 'One'
$sp.DtrEnable = $false
$sp.RtsEnable = $false
$sp.Open()

$atList  = @()
$cmdList = @()
$acc = 0
foreach ($step in $Steps) {
  $parts = $step.Split('|', 2)
  $acc += [int]$parts[0]
  $atList += $acc
  if ($parts.Count -gt 1) { $cmdList += $parts[1] } else { $cmdList += '' }
}
$endAt = $acc + $TailSeconds * 1000

$sw = [Diagnostics.Stopwatch]::StartNew()
$all = New-Object System.Text.StringBuilder
$next = 0
while ($sw.ElapsedMilliseconds -lt $endAt) {
  while ($next -lt $atList.Count -and $sw.ElapsedMilliseconds -ge $atList[$next]) {
    if ($cmdList[$next]) { $sp.Write($cmdList[$next] + "`n") }
    $next++
  }
  if ($sp.BytesToRead -gt 0) { [void]$all.Append($sp.ReadExisting()) }
  Start-Sleep -Milliseconds 20
}
if ($sp.BytesToRead -gt 0) { [void]$all.Append($sp.ReadExisting()) }
$sp.Close()
$text = $all.ToString() -replace "`r", ''
if ($Out) { [IO.File]::WriteAllText($Out, $text, [Text.Encoding]::UTF8) }
$text
