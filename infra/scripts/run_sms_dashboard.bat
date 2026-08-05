@echo off
setlocal

set SCRIPT_DIR=%~dp0
cd /d "%SCRIPT_DIR%\..\.."
set ROOT_DIR=%CD%
set SMS_DIR=%ROOT_DIR%\apps\sms_dashboard
set SMS_BACKEND_DIR=%SMS_DIR%\server
set SMS_FRONTEND_DIR=%SMS_DIR%

echo ============================================
echo Starting SMS Dashboard
echo ROOT_DIR=%ROOT_DIR%
echo SMS_DIR=%SMS_DIR%
echo ============================================

if not exist "%SMS_FRONTEND_DIR%\package.json" (
    echo [ERROR] package.json not found in %SMS_FRONTEND_DIR%
    goto :end
)

if not exist "%SMS_BACKEND_DIR%\server.js" (
    echo [ERROR] server.js not found in %SMS_BACKEND_DIR%
    goto :end
)

if not exist "%SMS_FRONTEND_DIR%\node_modules" (
    echo [SETUP] Running npm install for SMS dashboard...
    pushd "%SMS_FRONTEND_DIR%"
    call npm install
    if errorlevel 1 (
        popd
        echo [ERROR] npm install failed in %SMS_FRONTEND_DIR%
        goto :end
    )
    popd
)

start "SMS_BACKEND" /d "%SMS_BACKEND_DIR%" cmd /k "set HOST=0.0.0.0&& node server.js"
timeout /t 2 >nul
start "SMS_FRONTEND" /d "%SMS_FRONTEND_DIR%" cmd /k "npm run dev -- --host 0.0.0.0 --port 3000"

:end
endlocal
