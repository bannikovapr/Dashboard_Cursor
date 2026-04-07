param(
  [int]$Port = 5173,
  [switch]$NoRefresh
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Split-Path -Parent $scriptDir

Set-Location $root

Write-Host "=== TOIR Dashboard Start ===" -ForegroundColor Cyan
Write-Host "Project folder: $root"

$dataDir = Join-Path $root "data"
$xlsxCount = 0
if (Test-Path -LiteralPath $dataDir -PathType Container) {
  $xlsxCount = (Get-ChildItem -LiteralPath $dataDir -Filter "*.xlsx" -File | Measure-Object).Count
}
if ($xlsxCount -ge 7) {
  Write-Host "Detected $xlsxCount xlsx files in data/ (multi-report mode expected)." -ForegroundColor Green
} else {
  Write-Warning "Less than 7 xlsx files in data/. Analyzer may use legacy fallback file."
}

function Get-PythonLauncher {
  if (Get-Command py -ErrorAction SilentlyContinue) { return "py" }
  if (Get-Command python -ErrorAction SilentlyContinue) { return "python" }
  return $null
}

if (-not $NoRefresh) {
  $pyCmd = Get-PythonLauncher
  if (-not $pyCmd) {
    Write-Warning "Python is not found. Skip data/toir.json refresh."
  } else {
    Write-Host "Refreshing data/toir.json ..." -ForegroundColor Yellow
    & $pyCmd "scripts/analyze_toir.py"
    if ($LASTEXITCODE -ne 0) {
      throw "scripts/analyze_toir.py failed (exit code: $LASTEXITCODE)"
    }
    Write-Host "Done: data/toir.json updated." -ForegroundColor Green
  }
} else {
  Write-Host "No refresh mode (-NoRefresh)." -ForegroundColor DarkYellow
}

Write-Host "Starting local server..." -ForegroundColor Yellow
Write-Host "Stop: Ctrl+C" -ForegroundColor DarkGray
& ".\scripts\serve.ps1" -Port $Port -OpenBrowser
