@echo off
setlocal
set "SCRIPT_DIR=%~dp0"
call "%SCRIPT_DIR%_open_dashboard_url.bat" "http://localhost:5173/" "NEWS_DASHBOARD" %~1
endlocal
