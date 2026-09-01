#pragma once

#include <string>

namespace Wavely {

class WavelyController;

class WavelyView {
public:
    WavelyView(WavelyController* controller);
    ~WavelyView();

    bool open(void* parentWindowHandle);
    void close();
    void resize(int width, int height);

    int getWidth() const { return mWidth; }
    int getHeight() const { return mHeight; }

private:
    WavelyController* mController = nullptr;
    void* mParentWindow = nullptr;
    int mWidth = 1080;
    int mHeight = 700;
};

} // namespace Wavely
