#pragma once

#include <string>
#include <map>

namespace Wavely {

enum ParameterID {
    kParamVolume = 0,
    kParamPitch = 1,
    kParamSync = 2,
    kParamCount
};

class WavelyController {
public:
    WavelyController();
    ~WavelyController();

    void setParamNormalized(ParameterID id, double value);
    double getParamNormalized(ParameterID id) const;

private:
    double mParameters[kParamCount];
};

} // namespace Wavely
