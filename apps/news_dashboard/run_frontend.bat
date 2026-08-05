@echo off
setlocal

cd /d %~dp0
echo Current Dir: %cd%
echo.

echo ===== STEP 1: before npm install =====
call npm install
echo ===== STEP 2: after npm install =====
echo ERRORLEVEL after install = %errorlevel%
echo.

if errorlevel 1 (
    echo npm install failed
    pause
    exit /b 1
)

echo ===== STEP 3: before npm run dev =====
call npm run dev -- --host 0.0.0.0 --port 5173
echo ===== STEP 4: after npm run dev =====
echo ERRORLEVEL after dev = %errorlevel%

pause
