@echo off
setlocal EnableExtensions DisableDelayedExpansion

set "DASHBOARD_URL=http://localhost:5173"
set "OPEN_MODE=%~1"

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

echo EDGE_PATH=%EDGE_PATH%
echo CHROME_PATH=%CHROME_PATH%
echo Opening dashboard: %DASHBOARD_URL%

if /I "%OPEN_MODE%"=="--kiosk" goto OPEN_KIOSK
if /I "%OPEN_MODE%"=="--kiost" goto OPEN_KIOSK
if /I "%OPEN_MODE%"=="--fullscreen" goto OPEN_KIOSK
goto OPEN_NORMAL

:OPEN_KIOSK
if not defined EDGE_PATH goto OPEN_KIOSK_FALLBACK
echo Kiosk browser: Edge
echo Edge path: %EDGE_PATH%
start "" "%EDGE_PATH%" --kiosk "%DASHBOARD_URL%" --edge-kiosk-type=fullscreen --no-first-run
goto END

:OPEN_KIOSK_FALLBACK
echo Edge not found. Falling back to default browser in normal mode.
start "" "%DASHBOARD_URL%"
goto END

:OPEN_NORMAL
if defined CHROME_PATH goto OPEN_CHROME
if defined EDGE_PATH goto OPEN_EDGE
goto OPEN_DEFAULT

:OPEN_CHROME
echo Normal browser: Chrome
echo Chrome path: %CHROME_PATH%
start "" "%CHROME_PATH%" "%DASHBOARD_URL%"
goto END

:OPEN_EDGE
echo Chrome not found. Falling back to Edge.
echo Edge path: %EDGE_PATH%
start "" "%EDGE_PATH%" "%DASHBOARD_URL%"
goto END

:OPEN_DEFAULT
echo Chrome and Edge not found. Falling back to default browser.
start "" "%DASHBOARD_URL%"

:END
endlocal
exit /b 0
