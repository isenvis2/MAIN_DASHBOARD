@echo off
setlocal

cd /d "%~dp0"

set "DASH_URL=http://localhost:3000/"
set "HEALTH_URL=http://localhost:3005/api/health"
set "MODE=NORMAL"

if /I "%~1"=="--kiosk" set "MODE=KIOSK"

echo [MODE] %MODE%
echo [DASH] %DASH_URL%
echo [HEALTH] %HEALTH_URL%

where node >nul 2>nul
if errorlevel 1 (
  echo "[ERROR] Node.js not found. Install Node.js 18+ (recommended 20 LTS)."
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo "[ERROR] npm not found. Reinstall Node.js (includes npm)."
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo "[SETUP] Running npm install..."
  call npm install
  if errorlevel 1 (
    echo "[ERROR] npm install failed."
    pause
    exit /b 1
  )
)

REM Open browser (after 2 seconds) in a separate process
if "%MODE%"=="KIOSK" (
  echo "[BROWSER] Edge kiosk fullscreen...."
  start "" powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Sleep 2; Start-Process msedge.exe -ArgumentList '--user-data-dir=%~dp0edge_kiosk_profile','--kiosk','%DASH_URL%','--edge-kiosk-type=fullscreen','--no-first-run','--disable-features=Translate,TranslateUI','--disable-translate','--lang=ko-KR','--accept-lang=ko-KR,ko','--disable-session-crashed-bubble','--no-default-browser-check'"
) else (
  echo "[BROWSER] Normal mode..."
  start "" powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Sleep 2; Start-Process '%DASH_URL%'"
)

REM Start dev servers (keep logs in this window)
call npm run dev:all

echo "[INFO] dev:all finished (or stopped)."
pause
endlocal
