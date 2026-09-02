@echo off
title Wavely Ableton Live 12 Injector
echo ===================================================
echo     INJECTING WAVELY INTO ABLETON LIVE 12 SIDEBAR
echo ===================================================
echo.

powershell -ExecutionPolicy Bypass -File "%~dp0inject_ableton.ps1"

echo.
echo ===================================================
echo     INJECTION COMPLETE!
echo ===================================================
pause
