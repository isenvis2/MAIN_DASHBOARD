@echo off
setlocal EnableExtensions

cd /d "%~dp0"
set "DASHBOARD_MODE=%~1"
set "DASHBOARD_URL=http://localhost:5173"

echo Current Dir: %cd%
echo.

echo ===== STEP 1: start backend =====
start "NewsDashboard Backend" cmd /k "%~dp0run_backend.bat"

echo ===== STEP 2: wait backend =====
timeout /t 3 /nobreak >nul
echo.

echo ===== STEP 3: start frontend =====
start "NewsDashboard Frontend" cmd /k "%~dp0run_frontend.bat"

echo ===== STEP 4: wait frontend server =====
set /a WAIT_COUNT=0

:WAIT_LOOP
powershell -Command "try { $r=Invoke-WebRequest -UseBasicParsing '%DASHBOARD_URL%' -TimeoutSec 1; exit 0 } catch { exit 1 }" >nul 2>&1
if %errorlevel%==0 goto FRONTEND_READY

timeout /t 1 /nobreak >nul
set /a WAIT_COUNT+=1
if %WAIT_COUNT% GEQ 30 goto FRONTEND_TIMEOUT
goto WAIT_LOOP

:FRONTEND_READY
echo Frontend ready: %DASHBOARD_URL%
echo.
echo ===== STEP 5: open dashboard =====
if /I "%DASHBOARD_MODE%"=="--kiosk" (
    call "%~dp0open_dashboard.bat" --kiosk
) else if /I "%DASHBOARD_MODE%"=="--kiost" (
    call "%~dp0open_dashboard.bat" --kiosk
) else (
    call "%~dp0open_dashboard.bat"
)

echo.
echo Backend health : http://127.0.0.1:8000/api/health
echo Frontend page  : %DASHBOARD_URL%
echo.
pause
endlocal
exit /b 0

:FRONTEND_TIMEOUT
echo Frontend server did not respond within 30 seconds.
echo Expected URL : %DASHBOARD_URL%
echo Please check the frontend terminal output.
echo.
pause
endlocal
exit /b 1
