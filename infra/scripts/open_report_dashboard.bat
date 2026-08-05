@echo off
setlocal EnableExtensions DisableDelayedExpansion

set "SCRIPT_DIR=%~dp0"
cd /d "%SCRIPT_DIR%\..\.."
set "ROOT_DIR=%CD%"
set "CONFIG_FILE=%ROOT_DIR%\apps\report_dashboard\config\report_dashboard.json"

if not exist "%CONFIG_FILE%" (
  echo [ERROR] Report Dashboard config not found: %CONFIG_FILE%
  endlocal
  exit /b 1
)

for /f "usebackq delims=" %%P in (`powershell -NoProfile -ExecutionPolicy Bypass -Command "$cfg=Get-Content -Raw -LiteralPath '%CONFIG_FILE%' ^| ConvertFrom-Json; [int]$cfg.service.port"`) do set "REPORT_PORT=%%P"
if not defined REPORT_PORT (
  echo [ERROR] service.port could not be read from %CONFIG_FILE%
  endlocal
  exit /b 1
)

call "%SCRIPT_DIR%_open_dashboard_url.bat" "http://localhost:%REPORT_PORT%/" "REPORT_DASHBOARD" %~1
endlocal
