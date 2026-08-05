@echo off
setlocal

cd /d "%~dp0"

REM =========================================================
REM Weather_DashBoard Runner
REM - Default: normal browser mode
REM - With option: --kiosk  -> Edge kiosk fullscreen
REM - Starts backend via: npm run start  (wrapper -> python app.py)
REM =========================================================

set "DASH_URL=http://localhost:8100/"
set "MODE=NORMAL"
if /I "%~1"=="--kiosk" set "MODE=KIOSK"

echo [MODE] %MODE%
echo [DASH] %DASH_URL%

REM Check Node/npm (required to run npm scripts)
where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js not found. Install Node.js 18+ recommended 20 LTS.
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo [ERROR] npm not found. Reinstall Node.js includes npm.
  pause
  exit /b 1
)

REM Check Python required by app.py
where python >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Python not found. Install Python 3.10+ and ensure python is on PATH.
  pause
  exit /b 1
)

REM Install Python dependencies before running app.py
if not exist "requirements.txt" (
  echo [ERROR] requirements.txt not found in %CD%
  pause
  exit /b 1
)

echo [SETUP] Installing Weather Python packages...
python -m pip install -r requirements.txt
if errorlevel 1 (
  echo [ERROR] Weather Python package install failed.
  pause
  exit /b 1
)

echo [CHECK] Verifying Weather Python imports...
python -c "from dotenv import load_dotenv; import flask, requests; print('Weather dependencies OK')"
if errorlevel 1 (
  echo [ERROR] Weather Python import check failed.
  pause
  exit /b 1
)

REM Install node deps if needed this project is a light wrapper may be fast/no-op
if not exist "node_modules" (
  echo [SETUP] Running npm install...
  call npm install
  if errorlevel 1 (
    echo [ERROR] npm install failed.
    pause
    exit /b 1
  )
)

REM Open browser after a short delay best-effort
if "%MODE%"=="KIOSK" (
  echo [BROWSER] Edge kiosk fullscreen...
  start "" powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Sleep 2; Start-Process msedge.exe -ArgumentList '--kiosk','%DASH_URL%','--edge-kiosk-type=fullscreen','--no-first-run','--disable-features=Translate,TranslateUI','--disable-translate','--lang=ko-KR','--accept-lang=ko-KR,ko','--disable-session-crashed-bubble','--no-default-browser-check'"
) else (
  echo [BROWSER] Normal mode...
  start "" powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Sleep 2; Start-Process '%DASH_URL%'"
)

REM Start the dashboard wrapper script runs python app.py
set "WEATHER_PORT=8100"
call npm run start

echo [INFO] Stopped.
pause
endlocal
