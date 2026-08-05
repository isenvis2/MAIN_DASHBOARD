@echo off
setlocal

cd /d "%~dp0"

echo.
echo [1/5] Project folder: "%cd%"
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js not found in PATH.
  echo Install Node.js LTS from https://nodejs.org/
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo [ERROR] npm not found in PATH.
  pause
  exit /b 1
)

if not exist "package.json" (
  echo [ERROR] package.json not found. Put this bat in project root.
  pause
  exit /b 1
)

echo [2/5] Node:
node -v
echo [3/5] npm:
npm -v
echo.

if not exist "node_modules\" (
  echo [4/5] Running npm install...
  call npm install
  if errorlevel 1 (
    echo [ERROR] npm install failed.
    pause
    exit /b 1
  )
) else (
  echo [4/5] node_modules exists. Skipping install.
)

echo.
echo [5/5] Starting dev server...
echo Press Ctrl+C to stop.
echo.

call npm run dev
pause
endlocal