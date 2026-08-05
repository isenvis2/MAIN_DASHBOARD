@echo off
setlocal EnableExtensions DisableDelayedExpansion

set "SERVER_IP=%~1"
if "%SERVER_IP%"=="" set "SERVER_IP=%COMPUTERNAME%"

set "SCRIPT_DIR=%~dp0"
cd /d "%SCRIPT_DIR%\..\.."
set "ROOT_DIR=%CD%"
set "REPORT_CONFIG=%ROOT_DIR%\apps\report_dashboard\config\report_dashboard.json"
set "REPORT_PORT=3200"
if exist "%REPORT_CONFIG%" (
  for /f "usebackq delims=" %%P in (`powershell -NoProfile -ExecutionPolicy Bypass -Command "$cfg=Get-Content -Raw -LiteralPath '%REPORT_CONFIG%' ^| ConvertFrom-Json; [int]$cfg.service.port"`) do set "REPORT_PORT=%%P"
)

echo ============================================
echo  RIC Dashboard Remote Port Check
echo ============================================
echo Target: %SERVER_IP%
echo.

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ports=@(8080,8090,8100,3000,3005,5173,8000,3100,%REPORT_PORT%); foreach($p in $ports){ $r=Test-NetConnection '%SERVER_IP%' -Port $p -WarningAction SilentlyContinue; if($r.TcpTestSucceeded){ Write-Host ('OK   {0}:{1}' -f '%SERVER_IP%',$p) -ForegroundColor Green } else { Write-Host ('FAIL {0}:{1}' -f '%SERVER_IP%',$p) -ForegroundColor Red } }"

echo.
echo Expected services:
echo   8080 HLS/GIS API
echo   8090 Main Dashboard
echo   8100 Weather Dashboard
echo   3000 SMS Frontend
echo   3005 SMS Backend
echo   5173 News Frontend
echo   8000 News Backend
echo   3100 Event Dashboard
echo   %REPORT_PORT% Report Dashboard
endlocal
