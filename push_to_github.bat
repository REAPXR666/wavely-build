@echo off
title WAVELY - PUSH TO GITHUB
cd /d "%~dp0"

echo ======================================================================
echo           WAVELY DESKTOP - PUSH TO GITHUB CLOUD BUILD
echo ======================================================================
echo.

git remote get-url origin >nul 2>nul
if %ERRORLEVEL% neq 0 (
    git remote add origin https://github.com/REAPXR666/wavely-build.git
)

echo [1/3] Adding latest files...
git add .

echo [2/3] Creating commit...
git commit -m "Build macOS DMG and Windows release"

echo.
echo [3/3] Pushing to GitHub (Branch: main)...
git branch -M main
git push -u origin main

if %ERRORLEVEL% equ 0 (
    echo.
    echo ======================================================================
    echo  SUCCESS! Pushed to GitHub.
    echo  GitHub Actions is now compiling:
    echo    - Wavely-Mac.dmg (macOS Universal Installer)
    echo    - Wavely-Mac.zip (macOS Universal ZIP)
    echo    - Wavely-Setup.exe (Windows Installer)
    echo    - Wavely-Portable.zip (Windows Portable)
    echo.
    echo  Check build progress at:
    echo  https://github.com/REAPXR666/wavely-build/actions
    echo ======================================================================
) else (
    echo.
    echo [NOTE] If prompted for GitHub login, enter your username and GitHub Personal Access Token.
)

echo.
pause
