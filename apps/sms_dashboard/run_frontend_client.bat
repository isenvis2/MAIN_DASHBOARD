@echo off
setlocal

cd /d %~dp0

echo ============================================
echo SMS Dashboard Frontend - Client PC mode
echo ============================================
echo.

set "SMS_BACKEND_URL=%~1"
if not defined SMS_BACKEND_URL (
  echo Usage: run_frontend_client.bat http://SERVER_IP:3005
  set /p SMS_BACKEND_URL=Enter SMS backend URL: 
)

if not defined SMS_BACKEND_URL (
  echo [ERROR] SMS_BACKEND_URL is required.
  pause
  exit /b 1
)

echo Backend URL: %SMS_BACKEND_URL%

where npm >nul 2>nul
if errorlevel 1 (
  echo [ERROR] npm command not found. Please install Node.js.
  pause
  exit /b 1
)

if not exist node_modules (
  echo [SETUP] npm install...
  call npm install
  if errorlevel 1 (
    echo [ERROR] npm install failed.
    pause
    exit /b 1
  )
)

call npm run dev -- --host 0.0.0.0 --port 3000
pause
