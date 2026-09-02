@echo off
title Rename Ableton Sidebar Splice to Wavely
echo ===================================================
echo     RENAMING SIDEBAR 'SPLICE' TO 'WAVELY' IN LIVE 12
echo ===================================================
echo.

powershell -ExecutionPolicy Bypass -File "%~dp0patch_ableton_sidebar_name.ps1"

echo.
pause
