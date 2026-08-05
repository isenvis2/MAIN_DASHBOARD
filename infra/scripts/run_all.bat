@echo off
setlocal

set "SCRIPT_DIR=%~dp0"
cd /d "%SCRIPT_DIR%\..\.."
set "ROOT_DIR=%CD%"
set "OPEN_MODE=%~1"

echo ============================================
echo   Raon Integrated Control - Run All
echo ============================================
echo ROOT_DIR=%ROOT_DIR%
echo MODE=%OPEN_MODE%
echo.

if not exist "%ROOT_DIR%\shared\data\cameras.json" (
    echo [ERROR] shared\data\cameras.json not found
    goto :end
)

if not exist "%ROOT_DIR%\shared\config\GISDashBoard.json" (
    echo [ERROR] shared\config\GISDashBoard.json not found
    goto :end
)

if not exist "%ROOT_DIR%\shared\config\modules.json" (
    echo [ERROR] shared\config\modules.json not found
    goto :end
)

set "REPORT_CONFIG=%ROOT_DIR%\apps\report_dashboard\config\report_dashboard.json"
if not exist "%REPORT_CONFIG%" (
    echo [ERROR] apps\report_dashboard\config\report_dashboard.json not found
    goto :end
)
for /f "usebackq delims=" %%P in (`powershell -NoProfile -ExecutionPolicy Bypass -Command "$cfg=Get-Content -Raw -LiteralPath '%REPORT_CONFIG%' ^| ConvertFrom-Json; [int]$cfg.service.port"`) do set "REPORT_PORT=%%P"
if not defined REPORT_PORT (
    echo [ERROR] Report Dashboard service.port could not be read
    goto :end
)

echo [1/7] Starting HLS Converter...
call "%ROOT_DIR%\infra\scripts\run_hls_converter.bat"
call "%ROOT_DIR%\infra\scripts\wait_health.bat" HLS_API http://127.0.0.1:8080/api/health 20
echo.

echo [2/7] Starting Weather Dashboard...
call "%ROOT_DIR%\infra\scripts\run_weather_dashboard.bat"
call "%ROOT_DIR%\infra\scripts\wait_health.bat" WEATHER http://127.0.0.1:8100/api/health 15
echo.

echo [3/7] Starting SMS Dashboard...
call "%ROOT_DIR%\infra\scripts\run_sms_dashboard.bat"
call "%ROOT_DIR%\infra\scripts\wait_health.bat" SMS_BACKEND http://127.0.0.1:3005/api/health 15
echo.

echo [4/7] Starting News Dashboard...
call "%ROOT_DIR%\infra\scripts\run_news_dashboard.bat"
call "%ROOT_DIR%\infra\scripts\wait_health.bat" NEWS_BACKEND http://127.0.0.1:8000/api/health 15
echo.

echo [5/7] Starting Event Dashboard...
call "%ROOT_DIR%\infra\scripts\run_event_dashboard.bat"
call "%ROOT_DIR%\infra\scripts\wait_health.bat" EVENT http://127.0.0.1:3100/api/health 15
echo.

echo [6/7] Starting Report Dashboard...
call "%ROOT_DIR%\infra\scripts\run_report_dashboard.bat"
call "%ROOT_DIR%\infra\scripts\wait_health.bat" REPORT http://127.0.0.1:%REPORT_PORT%/api/health 120
echo.

echo [7/7] Starting Main Dashboard...
call "%ROOT_DIR%\infra\scripts\run_main_dashboard.bat" %OPEN_MODE%
echo.

echo ============================================
echo All modules started.
echo ============================================
echo Main:  http://localhost:8090/apps/main_dashboard/web/index.html
echo Event:  http://localhost:3100/
echo Report: http://localhost:%REPORT_PORT%/

:end
endlocal
