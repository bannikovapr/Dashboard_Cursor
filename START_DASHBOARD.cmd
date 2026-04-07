@echo off
setlocal
cd /d "%~dp0"

echo ==========================================
echo   TOIR Dashboard - quick start
echo ==========================================
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\start-dashboard.ps1"

if errorlevel 1 (
  echo.
  echo [ERROR] Не удалось запустить дашборд.
  echo Проверьте сообщения выше.
  pause
)
