@echo off
setlocal enabledelayedexpansion

echo ========================================================
echo       Wavely VST3 Plugin Native Build Pipeline
echo ========================================================
echo.

if not exist build (
    mkdir build
)

cd build

echo [1/3] Generating Visual Studio / CMake Build Files...
cmake .. -G "Visual Studio 17 2022" -A x64

if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] CMake configuration failed. Ensure Visual Studio 2022 and CMake are installed.
    pause
    exit /b %ERRORLEVEL%
)

echo.
echo [2/3] Compiling 64-bit VST3 Release Binary...
cmake --build . --config Release

if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Compilation failed.
    pause
    exit /b %ERRORLEVEL%
)

echo.
echo [3/3] Deploying Wavely.vst3 to System VST3 Directory...
cmake --install . --config Release

echo.
echo ========================================================
echo  [SUCCESS] Wavely.vst3 successfully built and installed!
echo  Location: %CommonProgramFiles%\VST3\Wavely.vst3
echo ========================================================
echo.
pause
