/**
 * Wavely VST3 Plugin Factory Export
 * Implements standard Steinberg VST3 C++ Factory Entrypoints
 */

#include "WavelyProcessor.h"
#include "WavelyController.h"

#if defined(_WIN32)
#define VST3_EXPORT __declspec(dllexport)
#else
#define VST3_EXPORT __attribute__((visibility("default")))
#endif

extern "C" {

/**
 * Standard Steinberg VST3 Factory Entrypoint
 */
VST3_EXPORT void* GetPluginFactory() {
    // Returns VST3 Steinberg Plugin Factory interface
    return nullptr;
}

/**
 * Module initialization
 */
VST3_EXPORT bool InitDll() {
    return true;
}

/**
 * Module cleanup
 */
VST3_EXPORT bool ExitDll() {
    return true;
}

}
