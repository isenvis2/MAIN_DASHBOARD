@echo off
setlocal
rem Starts EVENT_DASHBOARD and opens its web page.
rem Usage: run_event_dashboard_open.bat [--kiosk]
set "SCRIPT_DIR=%~dp0"
set "OPEN_MODE=%~1"
echo ============================================
echo   Start and open EVENT_DASHBOARD
echo ============================================
echo URL=http://localhost:3100/
echo MODE=%OPEN_MODE%
echo.
call "%SCRIPT_DIR%run_event_dashboard.bat"
timeout /t 3 >nul
call "%SCRIPT_DIR%open_event_dashboard.bat" %OPEN_MODE%
endlocal
