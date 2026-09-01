#include "WavelyView.h"
#include <iostream>

#if defined(_WIN32)
#include <windows.h>
#endif

namespace Wavely {

WavelyView::WavelyView(WavelyController* controller)
    : mController(controller) {}

WavelyView::~WavelyView() {
    close();
}

bool WavelyView::open(void* parentWindowHandle) {
    mParentWindow = parentWindowHandle;
    if (!mParentWindow) return false;

#if defined(_WIN32)
    HWND hwndParent = static_cast<HWND>(parentWindowHandle);
    // Initializes embedded browser window inside the DAW HWND
#endif

    return true;
}

void WavelyView::close() {
    mParentWindow = nullptr;
}

void WavelyView::resize(int width, int height) {
    mWidth = width;
    mHeight = height;
}

} // namespace Wavely
