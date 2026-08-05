@echo off
setlocal

echo ============================================
echo   Raon Integrated Control - Stop All
echo ============================================

echo Stopping Node.js processes...
taskkill /f /im node.exe >nul 2>&1

echo Stopping Python processes...
taskkill /f /im python.exe >nul 2>&1

echo Stopping FFmpeg processes...
taskkill /f /im ffmpeg.exe >nul 2>&1

echo Done.
endlocal
