@echo off
setlocal EnableExtensions DisableDelayedExpansion

rem ============================================================
rem _open_dashboard_url.bat
rem Usage:
rem   _open_dashboard_url.bat "http://localhost:5173" "NEWS_DASHBOARD" [--kiosk]
rem
rem Supports:
rem   --kiosk / --kiost / --fullscreen
rem ============================================================

set "DASHBOARD_URL=%~1"
set "WINDOW_TITLE=%~2"
set "OPEN_MODE=%~3"

if not defined DASHBOARD_URL (
    echo [ERROR] URL is required.
    exit /b 1
)
if not defined WINDOW_TITLE set "WINDOW_TITLE=DASHBOARD"

set "PF64=%ProgramFiles%"
call set "PF86=%%ProgramFiles(x86)%%"
set "LOCALAPP=%LocalAppData%"
set "EDGE_PATH="
set "CHROME_PATH="

if exist "%PF86%\Microsoft\Edge\Application\msedge.exe" set "EDGE_PATH=%PF86%\Microsoft\Edge\Application\msedge.exe"
if not defined EDGE_PATH if exist "%PF64%\Microsoft\Edge\Application\msedge.exe" set "EDGE_PATH=%PF64%\Microsoft\Edge\Application\msedge.exe"
if not defined EDGE_PATH if exist "%LOCALAPP%\Microsoft\Edge\Application\msedge.exe" set "EDGE_PATH=%LOCALAPP%\Microsoft\Edge\Application\msedge.exe"

if exist "%PF86%\Google\Chrome\Application\chrome.exe" set "CHROME_PATH=%PF86%\Google\Chrome\Application\chrome.exe"
if not defined CHROME_PATH if exist "%PF64%\Google\Chrome\Application\chrome.exe" set "CHROME_PATH=%PF64%\Google\Chrome\Application\chrome.exe"
if not defined CHROME_PATH if exist "%LOCALAPP%\Google\Chrome\Application\chrome.exe" set "CHROME_PATH=%LOCALAPP%\Google\Chrome\Application\chrome.exe"

echo ============================================
echo Opening dashboard
echo TITLE=%WINDOW_TITLE%
echo URL=%DASHBOARD_URL%
echo MODE=%OPEN_MODE%
echo ============================================

if /I "%OPEN_MODE%"=="--kiosk" goto OPEN_KIOSK
if /I "%OPEN_MODE%"=="--kiost" goto OPEN_KIOSK
if /I "%OPEN_MODE%"=="--fullscreen" goto OPEN_KIOSK
goto OPEN_NORMAL

:OPEN_KIOSK
if defined EDGE_PATH (
    echo [BROWSER] Edge kiosk fullscreen
    start "%WINDOW_TITLE%" "%EDGE_PATH%" --kiosk "%DASHBOARD_URL%" --edge-kiosk-type=fullscreen --no-first-run --disable-session-crashed-bubble --no-default-browser-check
    goto END
)
if defined CHROME_PATH (
    echo [BROWSER] Chrome kiosk
    start "%WINDOW_TITLE%" "%CHROME_PATH%" --kiosk "%DASHBOARD_URL%" --no-first-run --disable-session-crashed-bubble --no-default-browser-check
    goto END
)
echo [WARN] Edge/Chrome not found. Falling back to default browser normal mode.
start "%WINDOW_TITLE%" "%DASHBOARD_URL%"
goto END

:OPEN_NORMAL
if defined CHROME_PATH (
    echo [BROWSER] Chrome normal
    start "%WINDOW_TITLE%" "%CHROME_PATH%" "%DASHBOARD_URL%"
    goto END
)
if defined EDGE_PATH (
    echo [BROWSER] Edge normal
    start "%WINDOW_TITLE%" "%EDGE_PATH%" "%DASHBOARD_URL%"
    goto END
)
echo [BROWSER] Default browser
start "%WINDOW_TITLE%" "%DASHBOARD_URL%"

:END
endlocal
exit /b 0
