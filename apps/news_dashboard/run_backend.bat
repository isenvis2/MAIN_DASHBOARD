@echo off
setlocal

cd /d %~dp0backend
echo Current Dir: %cd%
echo.

echo ===== STEP 1: before pip install =====
call python -m pip install -r requirements.txt
echo ===== STEP 2: after pip install =====
echo ERRORLEVEL after install = %errorlevel%
echo.

if errorlevel 1 (
    echo pip install failed
    pause
    exit /b 1
)

echo ===== STEP 3: before python server.py =====
call python server.py
echo ===== STEP 4: after python server.py =====
echo ERRORLEVEL after server = %errorlevel%

pause
