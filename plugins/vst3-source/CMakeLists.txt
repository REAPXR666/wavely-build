cmake_minimum_required(VERSION 3.15)
project(WavelyPlugin VERSION 1.0.6 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Options
option(WAVELY_BUILD_VST3 "Build VST3 Plugin Target" ON)
option(WAVELY_USE_WEBVIEW "Embed Native WebView in Editor" ON)

# Source Files
set(PLUGIN_SOURCES
    source/WavelyPluginFactory.cpp
    source/WavelyProcessor.h
    source/WavelyProcessor.cpp
    source/WavelyController.h
    source/WavelyController.cpp
    source/WavelyView.h
    source/WavelyView.cpp
    source/WavelyBridgeClient.h
    source/WavelyBridgeClient.cpp
)

# Shared / Module Library for VST3
add_library(Wavely MODULE ${PLUGIN_SOURCES})

# VST3 Output naming and bundle structure
set_target_properties(Wavely PROPERTIES
    PREFIX ""
    SUFFIX ".vst3"
    OUTPUT_NAME "Wavely"
)

if(WIN32)
    target_compile_definitions(Wavely PRIVATE
        WIN32_LEAN_AND_MEAN
        NOMINMAX
        _CRT_SECURE_NO_WARNINGS
        WAVELY_WIN=1
    )
    target_link_libraries(Wavely PRIVATE
        ws2_32
        ole32
        shell32
        user32
        advapi32
    )
elseif(APPLE)
    target_compile_definitions(Wavely PRIVATE
        WAVELY_MAC=1
    )
    target_link_libraries(Wavely PRIVATE
        "-framework Cocoa"
        "-framework WebKit"
        "-framework CoreAudio"
    )
endif()

target_include_directories(Wavely PRIVATE
    include
    source
)

# Custom installation target into standard system VST3 folders
if(WIN32)
    set(SYSTEM_VST3_DIR "$ENV{CommonProgramFiles}/VST3/Wavely.vst3/Contents/x86_64-win")
    install(TARGETS Wavely DESTINATION "${SYSTEM_VST3_DIR}")
elseif(APPLE)
    set(SYSTEM_VST3_DIR "/Library/Audio/Plug-Ins/VST3/Wavely.vst3/Contents/MacOS")
    install(TARGETS Wavely DESTINATION "${SYSTEM_VST3_DIR}")
endif()
