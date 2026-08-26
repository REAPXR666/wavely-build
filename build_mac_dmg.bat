@echo off
title WAVELY - MACOS (.DMG) BUILDER
cd /d "%~dp0"

echo ======================================================================
echo           WAVELY DESKTOP - MACOS (.DMG) BUILD SYSTEM
echo ======================================================================
echo.
echo  Apple requires macOS tools (hdiutil / Gatekeeper) to create .dmg files.
echo  We have set up an automated GitHub Actions cloud builder that compiles
echo  Wavely-Mac.dmg on Apple macOS runners for free!
echo.
echo ----------------------------------------------------------------------
echo  OPTION 1: Trigger GitHub Actions macOS Builder
echo ----------------------------------------------------------------------
echo.

where gh >nul 2>nul
if %ERRORLEVEL% equ 0 (
    echo [INFO] GitHub CLI detected!
    set /p RUN_GH="Would you like to trigger the macOS DMG build on GitHub now? (Y/N): "
    if /i "%RUN_GH%"=="Y" (
        echo.
        echo [1/2] Pushing latest code...
        git add .
        git commit -m "Build macOS DMG release"
        git push
        echo.
        echo [2/2] Triggering macOS build workflow...
        gh workflow run build.yml
        echo.
        echo [SUCCESS] macOS build started! Check progress at:
        echo           gh run watch
        echo.
        pause
        exit /b 0
    )
) else (
    echo [INFO] Push your code to GitHub to automatically trigger the build:
    echo        1. git add .
    echo        2. git commit -m "Release v1.0.6"
    echo        3. git push
    echo.
    echo GitHub Actions will automatically compile:
    echo   - Wavely-Mac.dmg (macOS Universal DMG Installer)
    echo   - Wavely-Mac.zip (macOS Universal ZIP)
    echo   - Wavely-Setup.exe (Windows Installer)
    echo   - Wavely-Portable.zip (Windows Portable)
    echo.
)

echo ----------------------------------------------------------------------
echo  OPTION 2: Local Build (If running on macOS or macOS VM)
echo ----------------------------------------------------------------------
echo.
echo Running local builder...
call npm run build
call npx electron-builder --mac dmg zip -c.mac.identity=null

echo.
pause
