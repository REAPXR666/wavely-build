@echo off
setlocal enabledelayedexpansion

echo ========================================================
echo       Wavely VST3 Plugin Native Build Pipeline
echo ========================================================
echo.

:: 1. Auto-detect Visual Studio / BuildTools environment
set "VCVARS_PATH="

if exist "C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Auxiliary\Build\vcvars64.bat" (
    set "VCVARS_PATH=C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Auxiliary\Build\vcvars64.bat"
) else if exist "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat" (
    set "VCVARS_PATH=C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat"
) else if exist "C:\Program Files\Microsoft Visual Studio\2022\Professional\VC\Auxiliary\Build\vcvars64.bat" (
    set "VCVARS_PATH=C:\Program Files\Microsoft Visual Studio\2022\Professional\VC\Auxiliary\Build\vcvars64.bat"
) else if exist "C:\Program Files\Microsoft Visual Studio\2022\Enterprise\VC\Auxiliary\Build\vcvars64.bat" (
    set "VCVARS_PATH=C:\Program Files\Microsoft Visual Studio\2022\Enterprise\VC\Auxiliary\Build\vcvars64.bat"
) else if exist "C:\Program Files (x86)\Microsoft Visual Studio\2019\BuildTools\VC\Auxiliary\Build\vcvars64.bat" (
    set "VCVARS_PATH=C:\Program Files (x86)\Microsoft Visual Studio\2019\BuildTools\VC\Auxiliary\Build\vcvars64.bat"
)

if defined VCVARS_PATH (
    echo [Environment] Initializing Visual Studio 64-bit toolchain...
    echo Calling: "!VCVARS_PATH!"
    call "!VCVARS_PATH!" >nul 2>&1
)

:: 2. Auto-detect CMake binary
where cmake >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    if exist "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\cmake.exe" (
        set "PATH=C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin;!PATH!"
    ) else if exist "C:\Program Files\Microsoft Visual Studio\2022\Community\Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\cmake.exe" (
        set "PATH=C:\Program Files\Microsoft Visual Studio\2022\Community\Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin;!PATH!"
    )
)

where cmake >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] CMake not found. Please install CMake or Visual Studio C++ CMake component.
    pause
    exit /b 1
)

echo.
echo [1/3] Configuring CMake project...
if not exist build (
    mkdir build
)
cd build

cmake .. -G "Visual Studio 17 2022" -A x64

if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] CMake configuration failed.
    cd ..
    pause
    exit /b %ERRORLEVEL%
)

echo.
echo [2/3] Compiling Wavely.vst3 64-bit Release binary...
cmake --build . --config Release

if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Compilation failed.
    cd ..
    pause
    exit /b %ERRORLEVEL%
)

echo.
echo [3/3] Deploying to Local Bundle and System VST3 Directory...
if exist "Release\Wavely.vst3" (
    if not exist "..\..\Wavely.vst3\Contents\x86_64-win" (
        mkdir "..\..\Wavely.vst3\Contents\x86_64-win"
    )
    copy /Y "Release\Wavely.vst3" "..\..\Wavely.vst3\Contents\x86_64-win\Wavely.vst3"
    
    if defined CommonProgramFiles (
        if not exist "%CommonProgramFiles%\VST3\Wavely.vst3\Contents\x86_64-win" (
            mkdir "%CommonProgramFiles%\VST3\Wavely.vst3\Contents\x86_64-win"
        )
        copy /Y "Release\Wavely.vst3" "%CommonProgramFiles%\VST3\Wavely.vst3\Contents\x86_64-win\Wavely.vst3"
        echo [Installed] Copied to %CommonProgramFiles%\VST3\Wavely.vst3\Contents\x86_64-win\Wavely.vst3
    )
)

cd ..

echo.
echo ========================================================
echo  [SUCCESS] Wavely.vst3 compiled and installed!
echo  Open your DAW (FL Studio, Ableton, Reaper) to scan.
echo ========================================================
echo.
pause
