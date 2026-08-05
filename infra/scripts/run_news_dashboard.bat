@echo off
setlocal EnableExtensions DisableDelayedExpansion

set "SCRIPT_DIR=%~dp0"
cd /d "%SCRIPT_DIR%\..\.."
set "ROOT_DIR=%CD%"
set "NEWS_DIR=%ROOT_DIR%\apps\news_dashboard"
set "NEWS_BACKEND_DIR=%NEWS_DIR%\backend"
set "NEWS_URL=http://localhost:5173/"
set "NEWS_HEALTH_URL=http://127.0.0.1:8000/api/health"

echo ============================================
echo Starting News Dashboard
echo ROOT_DIR=%ROOT_DIR%
echo NEWS_DIR=%NEWS_DIR%
echo BACKEND_DIR=%NEWS_BACKEND_DIR%
echo FRONTEND_URL=%NEWS_URL%
echo BACKEND_HEALTH=%NEWS_HEALTH_URL%
echo ============================================

where python >nul 2>nul
if errorlevel 1 (
    echo [ERROR] python command not found. Please install Python and add it to PATH.
    goto :end
)

where npm >nul 2>nul
if errorlevel 1 (
    echo [ERROR] npm command not found. Please install Node.js and add npm to PATH.
    goto :end
)

if not exist "%NEWS_BACKEND_DIR%\server.py" (
    echo [ERROR] backend\server.py not found in %NEWS_BACKEND_DIR%
    goto :end
)

if not exist "%NEWS_BACKEND_DIR%\requirements.txt" (
    echo [ERROR] backend\requirements.txt not found in %NEWS_BACKEND_DIR%
    goto :end
)

if not exist "%NEWS_DIR%\package.json" (
    echo [ERROR] package.json not found in %NEWS_DIR%
    goto :end
)

echo.
echo [SETUP] Installing News backend Python dependencies...
pushd "%NEWS_BACKEND_DIR%"
call python -m pip install -r requirements.txt
if errorlevel 1 (
    popd
    echo [ERROR] Python dependency install failed in %NEWS_BACKEND_DIR%
    goto :end
)
popd

echo.
echo [SETUP] Installing News frontend npm dependencies if needed...
pushd "%NEWS_DIR%"
if not exist "node_modules" (
    call npm install
    if errorlevel 1 (
        popd
        echo [ERROR] npm install failed in %NEWS_DIR%
        goto :end
    )
) else (
    echo [INFO] News Dashboard node_modules found. Skipping npm install.
)
popd

echo.
echo [START] News backend...
start "NEWS_BACKEND" /d "%NEWS_BACKEND_DIR%" cmd /k "python server.py"

echo [WAIT] Waiting for News backend health check...
set /a WAIT_COUNT=0
:WAIT_BACKEND
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $r=Invoke-WebRequest -UseBasicParsing '%NEWS_HEALTH_URL%' -TimeoutSec 1; if ($r.StatusCode -ge 200 -and $r.StatusCode -lt 500) { exit 0 } else { exit 1 } } catch { exit 1 }" >nul 2>nul
if %errorlevel%==0 goto BACKEND_READY

timeout /t 1 /nobreak >nul
set /a WAIT_COUNT+=1
if %WAIT_COUNT% GEQ 30 goto BACKEND_TIMEOUT
goto WAIT_BACKEND

:BACKEND_READY
echo [OK] News backend is ready.
goto START_FRONTEND

:BACKEND_TIMEOUT
echo [WARN] News backend did not respond within 30 seconds.
echo [WARN] The backend window may show the actual error. Continuing to start frontend.

:START_FRONTEND
echo.
echo [START] News frontend...
start "NEWS_FRONTEND" /d "%NEWS_DIR%" cmd /k "npm run dev -- --host 0.0.0.0 --port 5173"

echo [WAIT] Waiting for News frontend page...
set /a WAIT_COUNT=0
:WAIT_FRONTEND
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $r=Invoke-WebRequest -UseBasicParsing '%NEWS_URL%' -TimeoutSec 1; if ($r.StatusCode -ge 200 -and $r.StatusCode -lt 500) { exit 0 } else { exit 1 } } catch { exit 1 }" >nul 2>nul
if %errorlevel%==0 goto FRONTEND_READY

timeout /t 1 /nobreak >nul
set /a WAIT_COUNT+=1
if %WAIT_COUNT% GEQ 45 goto FRONTEND_TIMEOUT
goto WAIT_FRONTEND

:FRONTEND_READY
echo [OK] News frontend is ready: %NEWS_URL%
goto :end

:FRONTEND_TIMEOUT
echo [WARN] News frontend did not respond within 45 seconds.
echo [WARN] Please check the NEWS_FRONTEND terminal output.

goto :end

:end
endlocal
