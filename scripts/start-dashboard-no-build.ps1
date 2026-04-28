param(
  [int]$Port = 5173
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Split-Path -Parent $scriptDir
Set-Location $root

& ".\scripts\start-dashboard.ps1" -Port $Port -NoRefresh
