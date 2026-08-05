@echo off
setlocal EnableExtensions DisableDelayedExpansion

set "SCRIPT_DIR=%~dp0"
cd /d "%SCRIPT_DIR%\..\.."
set "ROOT_DIR=%CD%"
set "REPORT_DIR=%ROOT_DIR%\apps\report_dashboard"
set "CONFIG_FILE=%REPORT_DIR%\config\report_dashboard.json"

if not exist "%REPORT_DIR%\package.json" (
  echo [ERROR] apps\report_dashboard\package.json not found
  goto :end
)

if not exist "%CONFIG_FILE%" (
  echo [ERROR] Report Dashboard config not found: %CONFIG_FILE%
  goto :end
)

for /f "usebackq delims=" %%P in (`powershell -NoProfile -ExecutionPolicy Bypass -Command "$cfg=Get-Content -Raw -LiteralPath '%CONFIG_FILE%' ^| ConvertFrom-Json; [int]$cfg.service.port"`) do set "REPORT_PORT=%%P"
if not defined REPORT_PORT (
  echo [ERROR] service.port could not be read from %CONFIG_FILE%
  goto :end
)

echo ============================================
echo   Starting Report Dashboard
echo ============================================
echo DIR=%REPORT_DIR%
echo CONFIG=%CONFIG_FILE%
echo URL=http://localhost:%REPORT_PORT%/
echo.

start "REPORT_DASHBOARD" /d "%REPORT_DIR%" cmd /k "call scripts\run_service.bat"

:end
endlocal
