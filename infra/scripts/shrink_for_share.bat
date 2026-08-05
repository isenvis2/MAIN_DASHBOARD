@echo off
setlocal EnableExtensions EnableDelayedExpansion

rem ============================================================
rem shrink_for_share.bat
rem Run this BAT from:   <project>\infra\scripts\
rem Target cleanup dir:  <project>  (..\.. from this BAT)
rem
rem Default mode:
rem   --inplace
rem
rem Usage:
rem   shrink_for_share.bat
rem   shrink_for_share.bat --inplace
rem   shrink_for_share.bat --preview
rem   shrink_for_share.bat --yes
rem ============================================================

set "SCRIPT_DIR=%~dp0"
if "%SCRIPT_DIR:~-1%"=="\" set "SCRIPT_DIR=%SCRIPT_DIR:~0,-1%"

for %%I in ("%SCRIPT_DIR%\..\..") do set "TARGET_DIR=%%~fI"
for %%I in ("%TARGET_DIR%") do set "PROJECT_NAME=%%~nxI"

set "MODE=inplace"
set "PREVIEW=0"
set "AUTO_YES=0"

:parse_args
if "%~1"=="" goto args_done
if /I "%~1"=="--inplace" set "MODE=inplace"
if /I "%~1"=="--preview" set "PREVIEW=1"
if /I "%~1"=="--yes" set "AUTO_YES=1"
shift
goto parse_args
:args_done

echo ============================================================
echo shrink_for_share
echo SCRIPT_DIR = %SCRIPT_DIR%
echo TARGET_DIR = %TARGET_DIR%
echo PROJECT    = %PROJECT_NAME%
echo MODE       = %MODE%
echo PREVIEW    = %PREVIEW%
echo ============================================================

if /I "%TARGET_DIR%"=="C:\" goto unsafe
if /I "%TARGET_DIR%"=="D:\" goto unsafe
if /I "%TARGET_DIR%"=="E:\" goto unsafe
if /I "%TARGET_DIR%"=="C:"  goto unsafe
if /I "%TARGET_DIR%"=="D:"  goto unsafe
if /I "%TARGET_DIR%"=="E:"  goto unsafe

if not exist "%TARGET_DIR%\apps" goto marker_fail
if not exist "%TARGET_DIR%\infra" goto marker_fail
if not exist "%TARGET_DIR%\shared" goto marker_fail
if not exist "%TARGET_DIR%\infra\scripts" goto marker_fail

if "%AUTO_YES%"=="0" if "%PREVIEW%"=="0" (
    echo.
    echo [CAUTION] Cleanup target:
    echo          "%TARGET_DIR%"
    set /P ANSWER=Continue? [Y/N] : 
    if /I not "!ANSWER!"=="Y" (
        echo Cancelled.
        exit /b 1
    )
)

call :clean_dir_recursive "%TARGET_DIR%" "node_modules"
call :clean_dir_recursive "%TARGET_DIR%" "dist"
call :clean_dir_recursive "%TARGET_DIR%" "build"
call :clean_dir_recursive "%TARGET_DIR%" ".vite"
call :clean_dir_recursive "%TARGET_DIR%" ".parcel-cache"
call :clean_dir_recursive "%TARGET_DIR%" "coverage"
call :clean_dir_recursive "%TARGET_DIR%" "htmlcov"
call :clean_dir_recursive "%TARGET_DIR%" ".pytest_cache"
call :clean_dir_recursive "%TARGET_DIR%" ".mypy_cache"
call :clean_dir_recursive "%TARGET_DIR%" ".ruff_cache"
call :clean_dir_recursive "%TARGET_DIR%" "__pycache__"
call :clean_dir_recursive "%TARGET_DIR%" ".venv"
call :clean_dir_recursive "%TARGET_DIR%" "venv"
call :clean_dir_recursive "%TARGET_DIR%" "env"
call :clean_dir_recursive "%TARGET_DIR%" "tmp"
call :clean_dir_recursive "%TARGET_DIR%" "temp"
call :clean_dir_recursive "%TARGET_DIR%" "logs"
call :clean_dir_recursive "%TARGET_DIR%" "log"

call :clean_dir_if_exists "%TARGET_DIR%\apps\weather_dashboard\cache"

rem ------------------------------------------------------------
rem Event Dashboard cleanup for share package
rem - Keep package-lock.json for reproducible npm install.
rem - Remove generated dependency/build/cache/log files only.
rem ------------------------------------------------------------
call :clean_dir_if_exists "%TARGET_DIR%\apps\event_dashboard\node_modules"
call :clean_dir_if_exists "%TARGET_DIR%\apps\event_dashboard\dist"
call :clean_dir_if_exists "%TARGET_DIR%\apps\event_dashboard\build"
call :clean_dir_if_exists "%TARGET_DIR%\apps\event_dashboard\.vite"
call :clean_dir_if_exists "%TARGET_DIR%\apps\event_dashboard\.parcel-cache"
call :clean_dir_if_exists "%TARGET_DIR%\apps\event_dashboard\coverage"
call :clean_dir_if_exists "%TARGET_DIR%\apps\event_dashboard\logs"
call :clean_dir_if_exists "%TARGET_DIR%\apps\event_dashboard\log"
call :clean_dir_if_exists "%TARGET_DIR%\apps\event_dashboard\tmp"
call :clean_dir_if_exists "%TARGET_DIR%\apps\event_dashboard\temp"
call :delete_file_if_exists "%TARGET_DIR%\apps\event_dashboard\npm-debug.log"
call :delete_file_if_exists "%TARGET_DIR%\apps\event_dashboard\yarn-error.log"
call :delete_file_if_exists "%TARGET_DIR%\apps\event_dashboard\pnpm-debug.log"
call :delete_file_if_exists "%TARGET_DIR%\apps\event_dashboard\.env.local"

call :delete_file_recursive "%TARGET_DIR%" "*.pyc"
call :delete_file_recursive "%TARGET_DIR%" "*.pyo"
call :delete_file_recursive "%TARGET_DIR%" "*.log"
call :delete_file_recursive "%TARGET_DIR%" "npm-debug.log*"
call :delete_file_recursive "%TARGET_DIR%" "yarn-error.log*"
call :delete_file_recursive "%TARGET_DIR%" "pnpm-debug.log*"

call :delete_file_if_exists "%TARGET_DIR%\apps\sms_dashboard\server\data\sms_cache.json"
call :delete_file_if_exists "%TARGET_DIR%\apps\weather_dashboard\cache\weather_cache.json"
call :delete_file_if_exists "%TARGET_DIR%\apps\weather_dashboard\cache\weather_cache.meta.json"

echo.
if "%PREVIEW%"=="1" (
    echo [DONE] Preview finished.
) else (
    echo [DONE] Cleanup finished.
)
exit /b 0

:unsafe
echo [ERROR] Refusing to run on a drive root:
echo         "%TARGET_DIR%"
exit /b 2

:marker_fail
echo [ERROR] Project markers not found under:
echo         "%TARGET_DIR%"
echo.
echo Expected folders:
echo   apps
echo   infra
echo   shared
echo   infra\scripts
exit /b 3

:clean_dir_recursive
set "BASE=%~1"
set "NAME=%~2"
for /f "delims=" %%D in ('dir "%BASE%\%NAME%" /s /b /ad 2^>nul') do (
    call :clean_dir_if_exists "%%~fD"
)
exit /b 0

:clean_dir_if_exists
set "TARGET=%~1"
if exist "%TARGET%" (
    if "%PREVIEW%"=="1" (
        echo [DIR ] "%TARGET%"
    ) else (
        echo [DEL ] "%TARGET%"
        rmdir /S /Q "%TARGET%"
    )
)
exit /b 0

:delete_file_recursive
set "BASE=%~1"
set "MASK=%~2"
for /r "%BASE%" %%F in (%MASK%) do (
    if exist "%%~fF" call :delete_file_if_exists "%%~fF"
)
exit /b 0

:delete_file_if_exists
set "FILE=%~1"
if exist "%FILE%" (
    if "%PREVIEW%"=="1" (
        echo [FILE] "%FILE%"
    ) else (
        echo [DEL ] "%FILE%"
        del /F /Q "%FILE%" >nul 2>&1
    )
)
exit /b 0
