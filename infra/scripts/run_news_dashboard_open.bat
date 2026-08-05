@echo off
setlocal
rem Starts NEWS_DASHBOARD and opens its web page.
rem Usage: run_news_dashboard_open.bat [--kiosk]
set "SCRIPT_DIR=%~dp0"
set "OPEN_MODE=%~1"
echo ============================================
echo   Start and open NEWS_DASHBOARD
echo ============================================
echo URL=http://localhost:5173/
echo MODE=%OPEN_MODE%
echo.
call "%SCRIPT_DIR%run_news_dashboard.bat"
timeout /t 3 >nul
call "%SCRIPT_DIR%open_news_dashboard.bat" %OPEN_MODE%
endlocal
