@echo off
setlocal
rem Starts WEATHER_DASHBOARD and opens its web page.
rem Usage: run_weather_dashboard_open.bat [--kiosk]
set "SCRIPT_DIR=%~dp0"
set "OPEN_MODE=%~1"
echo ============================================
echo   Start and open WEATHER_DASHBOARD
echo ============================================
echo URL=http://localhost:8100/
echo MODE=%OPEN_MODE%
echo.
call "%SCRIPT_DIR%run_weather_dashboard.bat"
timeout /t 3 >nul
call "%SCRIPT_DIR%open_weather_dashboard.bat" %OPEN_MODE%
endlocal
