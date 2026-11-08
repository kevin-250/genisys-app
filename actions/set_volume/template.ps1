# Windows has no built-in volume command: drive the media keys. Each key press moves the volume by 2%.
$level = {{LEVEL}}
$w = New-Object -ComObject WScript.Shell
1..50 | ForEach-Object { $w.SendKeys([char]174) }
$steps = [int][math]::Round($level / 2)
if ($steps -gt 0) { 1..$steps | ForEach-Object { $w.SendKeys([char]175) } }
Write-Output "volume set to about $level%"
