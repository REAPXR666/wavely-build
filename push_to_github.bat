@echo off
title WAVELY - PUSH TO GITHUB
cd /d "%~dp0"

echo ======================================================================
echo           WAVELY DESKTOP - PUSH TO GITHUB & CLOUD BUILD
echo ======================================================================
echo.

git remote get-url origin >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo [INFO] No GitHub repository linked yet.
    echo Please create a new repository on https://github.com/new
    echo.
    set /p REPO_URL="Enter your GitHub repository URL (e.g. https://github.com/username/wavely.git): "
    if not "%REPO_URL%"=="" (
        git remote add origin %REPO_URL%
        git branch -M main
    ) else (
        echo [ERROR] No URL provided. Aborting.
        pause
        exit /b 1
    )
)

echo.
echo [1/3] Adding latest files...
git add .

echo [2/3] Creating commit...
set /p COMMIT_MSG="Enter commit description (default: 'Update build'): "
if "%COMMIT_MSG%"=="" set COMMIT_MSG=Update build
git commit -m "%COMMIT_MSG%"

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
    echo  Check build progress under the "Actions" tab on your GitHub repository!
    echo ======================================================================
) else (
    echo.
    echo [NOTE] If GitHub asked for authentication, sign in with your GitHub Personal Access Token.
)

echo.
pause
