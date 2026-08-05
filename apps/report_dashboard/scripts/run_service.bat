@echo off
setlocal EnableExtensions DisableDelayedExpansion

cd /d "%~dp0\.."
set "REPORT_DIR=%CD%"
set "CONFIG_FILE=%REPORT_DIR%\config\report_dashboard.json"

if not exist "%CONFIG_FILE%" (
  echo [ERROR] Report Dashboard configuration was not found: %CONFIG_FILE%
  exit /b 1
)

where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js was not found in PATH. Install Node.js 20 LTS or newer.
  exit /b 1
)

for /f "usebackq delims=" %%P in (`powershell -NoProfile -ExecutionPolicy Bypass -Command "$cfg=Get-Content -Raw -LiteralPath '%CONFIG_FILE%' ^| ConvertFrom-Json; [int]$cfg.service.port"`) do set "REPORT_PORT=%%P"
if not defined REPORT_PORT (
  echo [ERROR] service.port could not be read from %CONFIG_FILE%
  exit /b 1
)

echo ================================================================
echo  Report Dashboard Integrated Service
echo ================================================================
echo  Project : %REPORT_DIR%
echo  Config  : %CONFIG_FILE%
echo  Port    : %REPORT_PORT%
echo.

powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $r=Invoke-RestMethod -Uri 'http://127.0.0.1:%REPORT_PORT%/api/health' -TimeoutSec 2; if ($r.ok -eq $true -and $r.service -eq 'report-dashboard') { exit 0 } else { exit 1 }" >nul 2>&1
if not errorlevel 1 (
  echo [INFO] Report Dashboard is already running at http://127.0.0.1:%REPORT_PORT%/
  exit /b 0
)

set "NEED_INSTALL=0"
if not exist "node_modules\" set "NEED_INSTALL=1"
if exist "node_modules\" (
  call npm ls --depth=0 >nul 2>&1
  if errorlevel 1 set "NEED_INSTALL=1"
)

if "%NEED_INSTALL%"=="1" (
  echo [SETUP] Installing required Node.js packages...
  call npm ci --no-audit --no-fund --registry=https://registry.npmjs.org/
  if errorlevel 1 (
    echo [ERROR] Package installation failed.
    exit /b 1
  )
)

echo [BUILD] Creating Report Dashboard production build...
call npm run build
if errorlevel 1 (
  echo [ERROR] Production build failed.
  exit /b 1
)

echo [START] Report Dashboard: http://127.0.0.1:%REPORT_PORT%/
node "dist\server.cjs"
set "EXIT_CODE=%ERRORLEVEL%"
echo [STOP] Report Dashboard stopped. Exit code: %EXIT_CODE%
exit /b %EXIT_CODE%
