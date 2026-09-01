#pragma once

#include <cstdint>
#include <cstring>

namespace Steinberg {

typedef int32_t tresult;
typedef int32_t TBool;
typedef uint32_t uint32;
typedef int32_t int32;
typedef int64_t int64;
typedef char char8;
typedef char16_t char16;
typedef const char* FIDString;

static const tresult kResultOk = 0;
static const tresult kResultTrue = 0;
static const tresult kResultFalse = 1;
static const tresult kInvalidArgument = -1;
static const tresult kNotImplemented = -2;
static const tresult kInternalError = -3;
static const tresult kNotInitialized = -4;
static const tresult kNoInterface = -5;

struct FUID {
    uint32_t data[4];

    FUID() { data[0] = data[1] = data[2] = data[3] = 0; }
    FUID(uint32_t d1, uint32_t d2, uint32_t d3, uint32_t d4) {
        data[0] = d1; data[1] = d2; data[2] = d3; data[3] = d4;
    }
    bool operator==(const FUID& o) const {
        return data[0] == o.data[0] && data[1] == o.data[1] && data[2] == o.data[2] && data[3] == o.data[3];
    }
};

class FUnknown {
public:
    virtual tresult queryInterface(const FUID& _iid, void** obj) = 0;
    virtual uint32 addRef() = 0;
    virtual uint32 release() = 0;
    static const FUID iid;
};

struct PFactoryInfo {
    char8 vendor[64];
    char8 url[256];
    char8 email[128];
    int32 flags;
};

struct PClassInfo {
    FUID cid;
    int32 cardinality;
    char8 category[32];
    char8 name[64];
};

struct PClassInfo2 {
    FUID cid;
    int32 cardinality;
    char8 category[32];
    char8 name[64];
    uint32 classFlags;
    char8 subCategories[128];
    char8 vendor[64];
    char8 version[64];
    char8 sdkVersion[64];
};

class IPluginFactory : public FUnknown {
public:
    virtual tresult getFactoryInfo(PFactoryInfo* info) = 0;
    virtual int32 countClasses() = 0;
    virtual tresult getClassInfo(int32 index, PClassInfo* info) = 0;
    virtual tresult createInstance(FIDString cid, FIDString _iid, void** obj) = 0;
    static const FUID iid;
};

class IPluginFactory2 : public IPluginFactory {
public:
    virtual tresult getClassInfo2(int32 index, PClassInfo2* info) = 0;
    static const FUID iid;
};

class IPluginFactory3 : public IPluginFactory2 {
public:
    virtual tresult getClassInfoUnicode(int32 index, void* info) = 0;
    virtual tresult setHostContext(FUnknown* context) = 0;
    static const FUID iid;
};

namespace Vst {

typedef uint32 MediaType;
typedef int32 BusDirection;
typedef int32 BusType;
typedef int32 IoMode;
typedef uint32 ParamID;
typedef double ParamValue;
typedef double SampleRate;

enum MediaTypes { kAudio = 0, kEvent, kNumMediaTypes };
enum BusDirections { kInput = 0, kOutput };
enum BusTypes { kMain = 0, kAux };
enum IoModes { kSimple = 0, kAdvanced, kOfflineProcessing };

struct ProcessSetup {
    int32 processMode;
    int32 symbolicSampleSize;
    int32 maxSamplesPerBlock;
    SampleRate sampleRate;
};

struct AudioBusBuffers {
    int32 numChannels;
    uint64_t silenceFlags;
    union {
        float** channelBuffers32;
        double** channelBuffers64;
    };
};

struct ProcessData {
    int32 processMode;
    int32 symbolicSampleSize;
    int32 numSamples;
    int32 numInputs;
    int32 numOutputs;
    AudioBusBuffers* inputs;
    AudioBusBuffers* outputs;
    void* inputParameterChanges;
    void* outputParameterChanges;
    void* inputEvents;
    void* outputEvents;
    void* processContext;
};

struct BusInfo {
    MediaType mediaType;
    BusDirection direction;
    int32 channelCount;
    char16 name[128];
    BusType busType;
    uint32 flags;
};

class IComponent : public FUnknown {
public:
    virtual tresult initialize(FUnknown* context) = 0;
    virtual tresult terminate() = 0;
    virtual int32 getBusCount(MediaType type, BusDirection dir) = 0;
    virtual tresult getBusInfo(MediaType type, BusDirection dir, int32 index, BusInfo& bus) = 0;
    virtual tresult getRoutingInfo(void* inInfo, void* outInfo) = 0;
    virtual tresult activateBus(MediaType type, BusDirection dir, int32 index, TBool state) = 0;
    virtual tresult setActive(TBool state) = 0;
    virtual tresult setState(void* state) = 0;
    virtual tresult getState(void* state) = 0;
    static const FUID iid;
};

class IAudioProcessor : public FUnknown {
public:
    virtual tresult setBusArrangements(void* inputs, int32 numIns, void* outputs, int32 numOuts) = 0;
    virtual tresult getBusArrangement(BusDirection dir, int32 index, void* arr) = 0;
    virtual tresult canProcessSampleSize(int32 symbolicSampleSize) = 0;
    virtual uint32 getLatencySamples() = 0;
    virtual tresult setupProcessing(ProcessSetup& setup) = 0;
    virtual tresult setProcessing(TBool state) = 0;
    virtual tresult process(ProcessData& data) = 0;
    virtual uint32 getTailSamples() = 0;
    static const FUID iid;
};

class IEditController : public FUnknown {
public:
    virtual tresult initialize(FUnknown* context) = 0;
    virtual tresult terminate() = 0;
    virtual tresult setComponentState(void* state) = 0;
    virtual tresult setState(void* state) = 0;
    virtual tresult getState(void* state) = 0;
    virtual int32 getParameterCount() = 0;
    virtual tresult getParameterInfo(int32 paramIndex, void* info) = 0;
    virtual tresult getParamStringByValue(ParamID id, ParamValue valueNormalized, char16* string) = 0;
    virtual tresult getParamValueByString(ParamID id, const char16* string, ParamValue& valueNormalized) = 0;
    virtual ParamValue normalizedParamToPlain(ParamID id, ParamValue valueNormalized) = 0;
    virtual ParamValue plainParamToNormalized(ParamID id, ParamValue plainValue) = 0;
    virtual ParamValue getParamNormalized(ParamID id) = 0;
    virtual tresult setParamNormalized(ParamID id, ParamValue value) = 0;
    virtual tresult setComponentHandler(void* handler) = 0;
    virtual void* createView(FIDString name) = 0;
    static const FUID iid;
};

} // namespace Vst
} // namespace Steinberg
