@echo off
setlocal
set "SCRIPT_DIR=%~dp0"
cd /d "%SCRIPT_DIR%\..\..\apps\news_dashboard"
call run_frontend_client.bat %*
endlocal
