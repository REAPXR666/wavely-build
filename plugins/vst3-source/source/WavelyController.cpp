#include "WavelyController.h"
#include <algorithm>

namespace Wavely {

WavelyController::WavelyController() {
    mParameters[kParamVolume] = 0.8;
    mParameters[kParamPitch] = 0.5; // Center (0 semitones)
    mParameters[kParamSync] = 1.0;  // 1 = Active sync
}

WavelyController::~WavelyController() {}

void WavelyController::setParamNormalized(ParameterID id, double value) {
    if (id >= 0 && id < kParamCount) {
        mParameters[id] = std::max(0.0, std::min(1.0, value));
    }
}

double WavelyController::getParamNormalized(ParameterID id) const {
    if (id >= 0 && id < kParamCount) {
        return mParameters[id];
    }
    return 0.0;
}

} // namespace Wavely
