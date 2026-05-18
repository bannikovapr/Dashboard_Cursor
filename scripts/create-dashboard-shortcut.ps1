param(
  [ValidateSet("User", "Common")]
  [string]$Scope = "User",

  # Default ASCII: PS 5.1 may mis-parse Cyrillic in param defaults without UTF-8 BOM. Pass -ShortcutName for Russian label.
  [string]$ShortcutName = "TOIR-Dashboard.lnk",

  [switch]$NoRefresh
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Split-Path -Parent $scriptDir

$vbs = Join-Path $root "Launch-TOIR-Dashboard.vbs"
if (-not (Test-Path -LiteralPath $vbs -PathType Leaf)) {
  throw "Launcher not found: $vbs"
}

$ico = Join-Path $root "assets\toir-dashboard.ico"
if (-not (Test-Path -LiteralPath $ico -PathType Leaf)) {
  Write-Warning "Icon not found ($ico). Shortcut uses default icon."
  $ico = $null
}

$wscript = Join-Path $env:SystemRoot "System32\wscript.exe"
if (-not (Test-Path -LiteralPath $wscript -PathType Leaf)) {
  throw "wscript.exe not found: $wscript"
}

$desktop = if ($Scope -eq "Common") {
  [Environment]::GetFolderPath([Environment+SpecialFolder]::CommonDesktopDirectory)
} else {
  [Environment]::GetFolderPath([Environment+SpecialFolder]::Desktop)
}

$lnkPath = Join-Path $desktop $ShortcutName

$argLine = """$vbs"""
if ($NoRefresh) {
  $argLine = "$argLine -NoRefresh"
}

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($lnkPath)
$shortcut.TargetPath = $wscript
$shortcut.Arguments = $argLine
$shortcut.WorkingDirectory = $root
if ($ico) {
  $shortcut.IconLocation = "$ico,0"
}
$shortcut.Save()

Write-Host "Shortcut created: $lnkPath" -ForegroundColor Green
Write-Host "Log: $env:TEMP\toir-dashboard-launch.log" -ForegroundColor DarkGray
