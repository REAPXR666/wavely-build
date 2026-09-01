#!/bin/bash
set -e

echo "========================================================"
echo "      Wavely VST3 Plugin macOS Build Pipeline"
echo "========================================================"

mkdir -p build
cd build

echo "[1/3] Generating Xcode / CMake Build Files..."
cmake .. -G Xcode

echo "[2/3] Compiling Universal VST3 Binary..."
cmake --build . --config Release

echo "[3/3] Deploying to /Library/Audio/Plug-Ins/VST3/..."
cmake --install . --config Release

echo "========================================================"
echo " [SUCCESS] Wavely.vst3 installed to /Library/Audio/Plug-Ins/VST3/"
echo "========================================================"
