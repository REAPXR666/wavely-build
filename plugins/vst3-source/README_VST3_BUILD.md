# 🔌 Wavely VST3 Plugin Native Source & Build Guide

This directory contains the full native C++ source code for the **Wavely VST3 DAW Plugin & Host Sync Bridge**.

---

## 📁 Architecture Overview

* **`source/WavelyProcessor.cpp` / `.h`**: Audio processing engine. Mixes incoming track audio with low-latency sample preview audio, reads host tempo, transport state (Play/Stop), and playhead sample position.
* **`source/WavelyController.cpp` / `.h`**: Parameter management (Volume, Pitch semitones, Auto-Sync mode).
* **`source/WavelyView.cpp` / `.h`**: Embedded hardware-accelerated WebView interface.
* **`source/WavelyBridgeClient.cpp` / `.h`**: Local loopback socket client communicating with the desktop app (`127.0.0.1:6768`).
* **`source/WavelyPluginFactory.cpp`**: Steinberg VST3 DLL exports (`GetPluginFactory`).

---

## 🛠️ How to Compile

### On Windows (Visual Studio 2022 + CMake)
1. Double-click `build_vst3.bat` or run:
   ```cmd
   mkdir build && cd build
   cmake .. -G "Visual Studio 17 2022" -A x64
   cmake --build . --config Release
   cmake --install . --config Release
   ```
2. The output binary is installed automatically to:
   `C:\Program Files\Common Files\VST3\Wavely.vst3\Contents\x86_64-win\Wavely.vst3`

### On macOS (Xcode + CMake)
1. Run `chmod +x build_vst3.sh && ./build_vst3.sh` or:
   ```bash
   mkdir build && cd build
   cmake .. -G Xcode
   cmake --build . --config Release
   cmake --install . --config Release
   ```
2. The output bundle is installed to:
   `/Library/Audio/Plug-Ins/VST3/Wavely.vst3`

---

## 🎹 How to Use in Your DAW

1. Open **FL Studio**, **Ableton Live**, **Logic Pro**, **Cubase**, or **Reaper**.
2. Run your DAW's **Plugin Manager & Scan**.
3. Load `Wavely Connect` onto any mixer track or instrument slot.
4. Auditioned samples will stream directly into your DAW mixer channel in sync with your song's BPM!
