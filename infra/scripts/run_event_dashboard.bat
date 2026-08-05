@echo off
setlocal

set "SCRIPT_DIR=%~dp0"
cd /d "%SCRIPT_DIR%\..\.."
set "ROOT_DIR=%CD%"
set "EVENT_DIR=%ROOT_DIR%\apps\event_dashboard"

if not exist "%EVENT_DIR%\package.json" (
    echo [ERROR] apps\event_dashboard\package.json not found
    goto :end
)

if not exist "%EVENT_DIR%\server.js" (
    echo [ERROR] apps\event_dashboard\server.js not found
    goto :end
)

echo ============================================
echo   Starting Event Dashboard
echo ============================================
echo DIR=%EVENT_DIR%
echo CONFIG=%EVENT_DIR%\config\event_dashboard.json
echo Default URL=http://localhost:3100/
echo.
echo [INFO] npm install will run first. If dependencies are already installed, npm will finish quickly.
echo.

start "EVENT_DASHBOARD" /d "%EVENT_DIR%" cmd /k "npm install && set HOST=0.0.0.0&& npm start"

:end
endlocal
