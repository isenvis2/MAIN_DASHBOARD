@echo off
setlocal EnableExtensions
set "NAME=%~1"
set "URL=%~2"
set "MAX_SEC=%~3"
if "%MAX_SEC%"=="" set "MAX_SEC=30"
set /a COUNT=0
set "START_TS=%TIME%"
echo [WAIT] %NAME% health: %URL% max=%MAX_SEC%s
:LOOP
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $r=Invoke-WebRequest -UseBasicParsing '%URL%' -TimeoutSec 1; if ($r.StatusCode -ge 200 -and $r.StatusCode -lt 500) { exit 0 } else { exit 1 } } catch { exit 1 }" >nul 2>nul
if %errorlevel%==0 goto OK
timeout /t 1 /nobreak >nul
set /a COUNT+=1
if %COUNT% GEQ %MAX_SEC% goto TIMEOUT
goto LOOP
:OK
echo [OK] %NAME% ready elapsed=%COUNT%s
endlocal & exit /b 0
:TIMEOUT
echo [WARN] %NAME% health timeout after %MAX_SEC%s. Continuing.
endlocal & exit /b 1
