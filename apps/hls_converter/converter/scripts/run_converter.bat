@echo off
chcp 65001 > nul
setlocal EnableExtensions
set PYTHONIOENCODING=utf-8

echo ============================================
echo RTSP -^> HLS Converter Starting
echo ============================================

set "SCRIPT_DIR=%~dp0"
for %%I in ("%SCRIPT_DIR%..\..\..") do set "ROOT=%%~fI"
set "APP_DIR=%ROOT%\apps\hls_converter\converter"
set "CONFIG=%ROOT%\shared\data\camera_list.json"

set "PY_CMD="
where py >nul 2>nul && set "PY_CMD=py -3"
if not defined PY_CMD (
  where python >nul 2>nul && set "PY_CMD=python"
)
if not defined PY_CMD (
  echo [ERROR] Python not found in PATH.
  pause
  exit /b 1
)

set "HLS_ARGS=%*"
if "%HLS_ARGS%"=="" set "HLS_ARGS=--nomail --http-port 0 --hls-time 1.0 --hls-list-size 24 --hls-delete-threshold 12"

cd /d "%APP_DIR%"

echo [INFO] ROOT   = %ROOT%
echo [INFO] APP    = %APP_DIR%
echo [INFO] CONFIG = %CONFIG%
echo [INFO] PY_CMD = %PY_CMD%
echo [INFO] ARGS   = %HLS_ARGS%

%PY_CMD% ffmpeg_manager.py --config "%CONFIG%" %HLS_ARGS%

pause
endlocal
