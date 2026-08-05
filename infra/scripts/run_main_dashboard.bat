@echo off
setlocal EnableExtensions DisableDelayedExpansion

set "SCRIPT_DIR=%~dp0"
cd /d "%SCRIPT_DIR%\..\.."
set "ROOT_DIR=%CD%"
set "MAIN_WEB_DIR=%ROOT_DIR%\apps\main_dashboard\web"
set "MAIN_PORT=8090"
set "OPEN_MODE=%~1"
set "DASHBOARD_URL=http://localhost:%MAIN_PORT%/apps/main_dashboard/web/index.html"

set "PF64=%ProgramFiles%"
call set "PF86=%%ProgramFiles(x86)%%"
set "LOCALAPP=%LocalAppData%"
set "EDGE_PATH="

if exist "%PF86%\Microsoft\Edge\Application\msedge.exe" set "EDGE_PATH=%PF86%\Microsoft\Edge\Application\msedge.exe"
if not defined EDGE_PATH if exist "%PF64%\Microsoft\Edge\Application\msedge.exe" set "EDGE_PATH=%PF64%\Microsoft\Edge\Application\msedge.exe"
if not defined EDGE_PATH if exist "%LOCALAPP%\Microsoft\Edge\Application\msedge.exe" set "EDGE_PATH=%LOCALAPP%\Microsoft\Edge\Application\msedge.exe"

echo ============================================
echo Starting Main Dashboard
echo ROOT_DIR=%ROOT_DIR%
echo MAIN_WEB_DIR=%MAIN_WEB_DIR%
echo PORT=%MAIN_PORT%
echo MODE=%OPEN_MODE%
echo ============================================

if not exist "%MAIN_WEB_DIR%\index.html" (
    echo [ERROR] index.html not found in %MAIN_WEB_DIR%
    goto :end
)

echo [INFO] Checking for an existing process on port %MAIN_PORT%...
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R /C:":%MAIN_PORT% .*LISTENING"') do (
    echo [INFO] Stopping old process on port %MAIN_PORT%, PID=%%P
    taskkill /F /PID %%P >nul 2>&1
)

REM Serve from project root so /shared/config and /apps/... paths are reachable
REM Bind to 0.0.0.0 so other PCs can access http://SERVER_IP:8090/apps/main_dashboard/web/index.html
start "MAIN_DASHBOARD" /d "%ROOT_DIR%" cmd /k "python -m http.server %MAIN_PORT% --bind 0.0.0.0"
timeout /t 2 >nul

if /I "%OPEN_MODE%"=="--kiosk" goto OPEN_KIOSK
if /I "%OPEN_MODE%"=="--kiost" goto OPEN_KIOSK
if /I "%OPEN_MODE%"=="--fullscreen" goto OPEN_KIOSK
goto OPEN_NORMAL

:OPEN_KIOSK
if not defined EDGE_PATH goto EDGE_FALLBACK
echo [BROWSER] Edge kiosk fullscreen
echo [EDGE] %EDGE_PATH%
call start "" "%EDGE_PATH%" --kiosk "%DASHBOARD_URL%" --edge-kiosk-type=fullscreen --no-first-run --disable-session-crashed-bubble --no-default-browser-check
goto :end

:EDGE_FALLBACK
echo [WARN] Edge not found. Falling back to default browser.
start "" "%DASHBOARD_URL%"
goto :end

:OPEN_NORMAL
echo [BROWSER] Normal mode
start "" "%DASHBOARD_URL%"

:end
endlocal
