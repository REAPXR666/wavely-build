@echo off
title Wavely Builder
cls

echo ===================================================
echo             WAVELY PRODUCTION BUILDER             
echo ===================================================
echo.
echo [1/3] Verifying environment...
if not exist node_modules (
    echo.
    echo Node modules folder not found. Installing dependencies...
    call npm install
) else (
    echo Dependencies verified.
)
echo.
echo [2/3] Cleaning previous builds...
echo Closing any active instances of Wavely to unlock files...
taskkill /F /IM Wavely.exe /T 2>nul
taskkill /F /IM electron.exe /T 2>nul
timeout /t 2 /nobreak >nul
if exist dist (
    rd /s /q dist
)
if exist release (
    echo Clearing old releases...
    rd /s /q release
)

echo.
echo [3/3] Bundling Vite assets and packaging Electron application...
call npm run package

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo ---------------------------------------------------
    echo ERROR: Build failed! Please check output details.
    echo ---------------------------------------------------
    pause
    exit /b %ERRORLEVEL%
)

echo.
echo ===================================================
echo             BUILD COMPLETED SUCCESSFULLY!           
echo ===================================================
echo.
echo Your installer is ready at:
echo %~dp0release\Wavely Setup 1.0.7.exe
echo.
pause
