@echo off
setlocal
cd /d "%~dp0"

echo ==========================================
echo   TOIR Dashboard - start without build
echo ==========================================
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\start-dashboard.ps1" -NoRefresh

if errorlevel 1 (
  echo.
  echo [ERROR] Не удалось запустить дашборд.
  echo Проверьте сообщения выше.
  pause
)
