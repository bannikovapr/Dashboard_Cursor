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

function Get-PortOwnerPid {
  param([int]$Port)
  try {
    $conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($null -eq $conn) { return $null }
    return [int]$conn.OwningProcess
  } catch {
    return $null
  }
}

function Get-ProcessCommandLine {
  param([int]$ProcessId)
  try {
    $p = Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -eq $ProcessId } | Select-Object -First 1
    if ($null -eq $p) { return "" }
    return [string]$p.CommandLine
  } catch {
    return ""
  }
}

function Get-ProcessNameById {
  param([int]$ProcessId)
  try {
    $p = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($null -eq $p) { return "" }
    return [string]$p.ProcessName
  } catch {
    return ""
  }
}

function Get-NodeLauncher {
  if (Get-Command node -ErrorAction SilentlyContinue) { return "node" }
  $candidates = @(
    (Join-Path ${env:ProgramFiles} "nodejs\node.exe"),
    (Join-Path ${env:LOCALAPPDATA} "Programs\nodejs\node.exe")
  )
  foreach ($c in $candidates) {
    if ($c -and (Test-Path -LiteralPath $c -PathType Leaf)) { return $c }
  }
  return $null
}

function Get-NpmLauncher {
  if (Get-Command npm -ErrorAction SilentlyContinue) { return "npm" }
  $candidates = @(
    (Join-Path ${env:ProgramFiles} "nodejs\npm.cmd"),
    (Join-Path ${env:LOCALAPPDATA} "Programs\nodejs\npm.cmd")
  )
  foreach ($c in $candidates) {
    if ($c -and (Test-Path -LiteralPath $c -PathType Leaf)) { return $c }
  }
  return $null
}

$dataDir = Join-Path $root "data"
$xlsxCount = 0
if (Test-Path -LiteralPath $dataDir -PathType Container) {
  $xlsxCount = (Get-ChildItem -LiteralPath $dataDir -Filter "*.xlsx" -File | Measure-Object).Count
}
if ($xlsxCount -ge 7) {
  Write-Host "Detected $xlsxCount xlsx files in data/ (multi-report mode expected)." -ForegroundColor Green
} else {
  Write-Warning "Less than 7 xlsx files in data/. Dashboard build will fail until all reports are present."
}

if (-not $NoRefresh) {
  $nodeCmdForBuild = Get-NodeLauncher
  if (-not $nodeCmdForBuild) {
    Write-Warning "Node.js is not found. Skip data/toir.json refresh."
  } else {
    Write-Host "Building JSON: data/toir.json (+ personnel JSON from Excel when sources exist) ..." -ForegroundColor Yellow
    & $nodeCmdForBuild "scripts/build-dashboard-json.js"
    if ($LASTEXITCODE -ne 0) {
      throw "scripts/build-dashboard-json.js failed (exit code: $LASTEXITCODE)"
    }
    Write-Host "Done: JSON built (main dashboard + optional personnel)." -ForegroundColor Green
  }
} else {
  Write-Host "No refresh mode (-NoRefresh)." -ForegroundColor DarkYellow
}

Write-Host "Starting local server..." -ForegroundColor Yellow
Write-Host "Stop: Ctrl+C" -ForegroundColor DarkGray

$nodeCmd = Get-NodeLauncher
$startedApiProcess = $null
if ($nodeCmd) {
  $apiEntry = Join-Path $root "server\index.js"
  $apiEntryExists = Test-Path -LiteralPath $apiEntry -PathType Leaf
  if ($apiEntryExists) {
    $nm = Join-Path $root "node_modules"
    if (-not (Test-Path -LiteralPath $nm -PathType Container)) {
      $npmCmd = Get-NpmLauncher
      if ($npmCmd) {
        Write-Host "First run: npm install (dependencies for API) ..." -ForegroundColor Yellow
        Push-Location $root
        try {
          & $npmCmd install
          if ($LASTEXITCODE -ne 0) {
            Write-Warning "npm install failed (exit $LASTEXITCODE). Start API manually after fixing."
          }
        } finally {
          Pop-Location
        }
      } else {
        Write-Warning "node_modules missing and npm not found. Run npm install in project root, then npm run start:api."
      }
    }
    Write-Host "Starting API on http://localhost:8787 (separate window) ..." -ForegroundColor Yellow
    $existingPid = Get-PortOwnerPid -Port 8787
    if ($existingPid) {
      $existingCmd = Get-ProcessCommandLine -ProcessId $existingPid
      $existingName = Get-ProcessNameById -ProcessId $existingPid
      $canStopByCommand = $existingCmd -match "server/index\.js"
      $canStopByName = $existingName -match "^(node|cmd)$"
      if ($canStopByCommand -or $canStopByName) {
        try {
          Stop-Process -Id $existingPid -Force -ErrorAction Stop
          Start-Sleep -Milliseconds 500
        } catch {
          Write-Warning "Failed to stop existing process on port 8787 (PID $existingPid): $($_.Exception.Message)"
        }
      }
    }
    $startedApiProcess = Start-Process -FilePath $nodeCmd -WorkingDirectory $root -ArgumentList @("server/index.js") -PassThru
    Start-Sleep -Seconds 2
  } else {
    Write-Warning "server/index.js not found. Cloud AI mode via OpenRouter API will be unavailable."
  }
} else {
  Write-Warning "Node.js is not found. Cloud AI mode via OpenRouter API will be unavailable."
}

if ($startedApiProcess -and -not $global:DashboardApiCleanupRegistered) {
  Register-EngineEvent -SourceIdentifier PowerShell.Exiting -Action {
    try {
      if ($null -ne $startedApiProcess -and -not $startedApiProcess.HasExited) {
        Stop-Process -Id $startedApiProcess.Id -Force -ErrorAction Stop
      }
    } catch {}
  } | Out-Null
  $global:DashboardApiCleanupRegistered = $true
}

try {
  & ".\scripts\serve.ps1" -Port $Port -OpenBrowser
} finally {
  if ($startedApiProcess) {
    try {
      if (-not $startedApiProcess.HasExited) {
        Stop-Process -Id $startedApiProcess.Id -Force -ErrorAction Stop
      }
    } catch {
      Write-Warning "Failed to stop API child process (PID $($startedApiProcess.Id)): $($_.Exception.Message)"
    }
  }
}
