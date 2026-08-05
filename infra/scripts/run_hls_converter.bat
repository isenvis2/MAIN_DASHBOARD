@echo off
chcp 65001 > nul
setlocal EnableExtensions

set "SCRIPT_DIR=%~dp0"
for %%I in ("%SCRIPT_DIR%..\..") do set "ROOT_DIR=%%~fI"
set "API_DIR=%ROOT_DIR%\apps\hls_converter\api"
set "HLS_SCRIPT_DIR=%ROOT_DIR%\apps\hls_converter\scripts"
set "MEDIA_DIR=%ROOT_DIR%\shared\media"

echo ============================================
echo Starting HLS Converter (original-compatible)
echo ROOT_DIR       = %ROOT_DIR%
echo API_DIR        = %API_DIR%
echo HLS_SCRIPT_DIR = %HLS_SCRIPT_DIR%
echo MEDIA_DIR      = %MEDIA_DIR%
echo ============================================

echo [STARTUP_CLEANUP] Dedicated server mode: force stopping all ffmpeg.exe before HLS startup...
taskkill /F /IM ffmpeg.exe /T >nul 2>&1
if errorlevel 1 (
    echo [STARTUP_CLEANUP] No running ffmpeg.exe found or taskkill returned non-zero.
) else (
    echo [STARTUP_CLEANUP] Existing ffmpeg.exe processes stopped.
)

if not exist "%API_DIR%\server.js" (
    echo [ERROR] server.js not found in %API_DIR%
    goto :end
)

if not exist "%HLS_SCRIPT_DIR%\run_converter.bat" (
    echo [ERROR] run_converter.bat not found in %HLS_SCRIPT_DIR%
    goto :end
)

if not exist "%API_DIR%\node_modules" (
    echo [INFO] node_modules not found for HLS API. Running npm install...
    pushd "%API_DIR%"
    call npm install
    if errorlevel 1 (
        echo [ERROR] npm install failed in %API_DIR%
        popd
        goto :end
    )
    popd
) else (
    echo [INFO] HLS API node_modules found. Skipping npm install.
)

echo [INFO] Checking for an existing process on port 8080...
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R /C:":8080 .*LISTENING"') do (
    echo [INFO] Stopping old process on port 8080, PID=%%P
    taskkill /F /PID %%P >nul 2>&1
)

if exist "%MEDIA_DIR%" (
  echo [INFO] Clearing old media...
  rmdir /s /q "%MEDIA_DIR%"
)
mkdir "%MEDIA_DIR%" > nul 2>&1

start "HLS_API" /d "%API_DIR%" cmd /k "set PORT=8080&& set HOST=0.0.0.0&& node server.js"
timeout /t 3 >nul

where curl >nul 2>&1
if not errorlevel 1 (
    curl -s http://localhost:8080/api/health
    echo.
) else (
    echo [INFO] curl not found. Open http://localhost:8080/api/health to confirm API version.
)

start "HLS_CONVERTER" /d "%HLS_SCRIPT_DIR%" cmd /k "run_converter.bat --nomail --http-port 0"

echo [INFO] Open http://localhost:8080/index.html for HLS module test

:end
endlocal
