@echo off
setlocal

set SCRIPT_DIR=%~dp0
cd /d "%SCRIPT_DIR%\..\.."
set ROOT_DIR=%CD%
set WEATHER_DIR=%ROOT_DIR%\apps\weather_dashboard

echo ============================================
echo Starting Weather Dashboard
echo ROOT_DIR=%ROOT_DIR%
echo WEATHER_DIR=%WEATHER_DIR%
echo ============================================

if not exist "%WEATHER_DIR%\app.py" (
    echo [ERROR] app.py not found in %WEATHER_DIR%
    goto :end
)

where python >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Python not found. Install Python 3.10+ and ensure python is on PATH.
    pause
    goto :end
)

if not exist "%WEATHER_DIR%\requirements.txt" (
    echo [ERROR] requirements.txt not found in %WEATHER_DIR%
    pause
    goto :end
)

echo [SETUP] Installing Weather Dashboard Python packages...
python -m pip install -r "%WEATHER_DIR%\requirements.txt"
if errorlevel 1 (
    echo [ERROR] Weather Dashboard dependency installation failed.
    pause
    goto :end
)

echo [CHECK] Verifying Weather Dashboard Python imports...
python -c "from dotenv import load_dotenv; import flask, requests; print('Weather dependencies OK')"
if errorlevel 1 (
    echo [ERROR] Weather Dashboard dependency import check failed.
    pause
    goto :end
)

start "WEATHER_DASHBOARD" /d "%WEATHER_DIR%" cmd /k "set WEATHER_PORT=8100 && python app.py"

:end
endlocal
