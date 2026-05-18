param(
  [int]$Port = 5173,
  [switch]$NoRefresh
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Split-Path -Parent $scriptDir
$log = Join-Path $env:TEMP "toir-dashboard-launch.log"

try {
  Start-Transcript -Path $log -Append -Force | Out-Null
} catch {
  # возможен сбой транскрипта в нестандартном хосте — основной сценарий всё равно запускаем
}

try {
  Set-Location -LiteralPath $root
  $entry = Join-Path $scriptDir "start-dashboard.ps1"
  if ($NoRefresh) {
    & $entry -Port $Port -NoRefresh
  } else {
    & $entry -Port $Port
  }
} finally {
  try {
    Stop-Transcript | Out-Null
  } catch {
    # ignore
  }
}
