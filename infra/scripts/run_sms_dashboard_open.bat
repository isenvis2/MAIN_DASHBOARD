@echo off
setlocal
rem Starts SMS_DASHBOARD and opens its web page.
rem Usage: run_sms_dashboard_open.bat [--kiosk]
set "SCRIPT_DIR=%~dp0"
set "OPEN_MODE=%~1"
echo ============================================
echo   Start and open SMS_DASHBOARD
echo ============================================
echo URL=http://localhost:3000/
echo MODE=%OPEN_MODE%
echo.
call "%SCRIPT_DIR%run_sms_dashboard.bat"
timeout /t 3 >nul
call "%SCRIPT_DIR%open_sms_dashboard.bat" %OPEN_MODE%
endlocal
