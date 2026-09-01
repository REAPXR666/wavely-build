#include "vst3_com.h"
#include "WavelyProcessor.h"
#include <atomic>
#include <cstring>

using namespace Steinberg;
using namespace Steinberg::Vst;

// VST3 Component & Controller Class ID: {4A5B6C7D-8E9F-0123-4567-89ABCDEF0123}
static const FUID kWavelyCID(0x4A5B6C7D, 0x8E9F0123, 0x456789AB, 0xCDEF0123);
static const FUID kWavelyControllerCID(0x4A5B6C7D, 0x8E9F0123, 0x456789AB, 0xCDEF0124);

const FUID FUnknown::iid(0x00000000, 0x00000000, 0xC0000000, 0x00000046);
const FUID IPluginFactory::iid(0x7A4D811C, 0x52114A1F, 0xAED9D2EE, 0x07D60140);
const FUID IPluginFactory2::iid(0x0007B650, 0xF24B4C25, 0xA66E0B01, 0x114F70F4);
const FUID IPluginFactory3::iid(0x45550F63, 0xA3FA4F4A, 0x9BBEF736, 0x7E409FDC);
const FUID IComponent::iid(0xE831FF31, 0xF2D54301, 0x928EBBEE, 0x25697802);
const FUID IAudioProcessor::iid(0x42043E09, 0xB2DA4FA6, 0x815F1EA4, 0xD58D2E11);
const FUID IEditController::iid(0xDCD76820, 0xB5764263, 0x8C88B504, 0xA9290005);

class WavelyVst3Component : public IComponent, public IAudioProcessor {
public:
    WavelyVst3Component() : mRefCount(1) {
        mProcessor.initialize(44100.0, 512);
    }

    // FUnknown
    tresult queryInterface(const FUID& _iid, void** obj) override {
        if (_iid == FUnknown::iid || _iid == IComponent::iid) {
            *obj = static_cast<IComponent*>(this);
            addRef();
            return kResultOk;
        }
        if (_iid == IAudioProcessor::iid) {
            *obj = static_cast<IAudioProcessor*>(this);
            addRef();
            return kResultOk;
        }
        *obj = nullptr;
        return kNoInterface;
    }

    uint32 addRef() override { return ++mRefCount; }
    uint32 release() override {
        uint32 r = --mRefCount;
        if (r == 0) delete this;
        return r;
    }

    // IComponent
    tresult initialize(FUnknown* context) override { return kResultOk; }
    tresult terminate() override { return kResultOk; }
    int32 getBusCount(MediaType type, BusDirection dir) override {
        return (type == kAudio) ? 1 : 0;
    }

    tresult getBusInfo(MediaType type, BusDirection dir, int32 index, BusInfo& bus) override {
        if (type != kAudio || index != 0) return kInvalidArgument;
        bus.mediaType = kAudio;
        bus.direction = dir;
        bus.channelCount = 2; // Stereo
        bus.busType = kMain;
        bus.flags = 1; // Default active
        const char16* name = (dir == kInput) ? u"Stereo In" : u"Stereo Out";
        std::memcpy(bus.name, name, (std::char_traits<char16>::length(name) + 1) * sizeof(char16));
        return kResultOk;
    }

    tresult getRoutingInfo(void* inInfo, void* outInfo) override { return kNotImplemented; }
    tresult activateBus(MediaType type, BusDirection dir, int32 index, TBool state) override { return kResultOk; }
    tresult setActive(TBool state) override { return kResultOk; }
    tresult setState(void* state) override { return kResultOk; }
    tresult getState(void* state) override { return kResultOk; }

    // IAudioProcessor
    tresult setBusArrangements(void* inputs, int32 numIns, void* outputs, int32 numOuts) override { return kResultOk; }
    tresult getBusArrangement(BusDirection dir, int32 index, void* arr) override { return kResultOk; }
    tresult canProcessSampleSize(int32 symbolicSampleSize) override { return (symbolicSampleSize == 0) ? kResultTrue : kResultFalse; }
    uint32 getLatencySamples() override { return 0; }
    tresult setupProcessing(ProcessSetup& setup) override {
        mProcessor.initialize(setup.sampleRate, setup.maxSamplesPerBlock);
        return kResultOk;
    }
    tresult setProcessing(TBool state) override { return kResultOk; }
    tresult process(ProcessData& data) override {
        if (data.numOutputs <= 0 || !data.outputs) return kResultOk;

        float** ins = (data.numInputs > 0 && data.inputs) ? data.inputs[0].channelBuffers32 : nullptr;
        float** outs = data.outputs[0].channelBuffers32;
        int numChannels = data.outputs[0].numChannels;
        int numSamples = data.numSamples;

        Wavely::HostProcessContext ctx;
        ctx.sampleRate = 44100.0;
        ctx.tempo = 120.0;
        ctx.isPlaying = false;

        mProcessor.process(ins, outs, numChannels, numSamples, ctx);
        return kResultOk;
    }
    uint32 getTailSamples() override { return 0; }

private:
    std::atomic<uint32> mRefCount;
    Wavely::WavelyProcessor mProcessor;
};

class WavelyVst3Factory : public IPluginFactory3 {
public:
    WavelyVst3Factory() : mRefCount(1) {}

    // FUnknown
    tresult queryInterface(const FUID& _iid, void** obj) override {
        if (_iid == FUnknown::iid || _iid == IPluginFactory::iid || _iid == IPluginFactory2::iid || _iid == IPluginFactory3::iid) {
            *obj = static_cast<IPluginFactory3*>(this);
            addRef();
            return kResultOk;
        }
        *obj = nullptr;
        return kNoInterface;
    }

    uint32 addRef() override { return ++mRefCount; }
    uint32 release() override {
        uint32 r = --mRefCount;
        if (r == 0) delete this;
        return r;
    }

    // IPluginFactory
    tresult getFactoryInfo(PFactoryInfo* info) override {
        if (!info) return kInvalidArgument;
        std::strncpy(info->vendor, "Wavely Technologies Inc.", sizeof(info->vendor) - 1);
        std::strncpy(info->url, "https://wavely.lol", sizeof(info->url) - 1);
        std::strncpy(info->email, "support@wavely.lol", sizeof(info->email) - 1);
        info->flags = 1; // Unicode
        return kResultOk;
    }

    int32 countClasses() override {
        return 1;
    }

    tresult getClassInfo(int32 index, PClassInfo* info) override {
        if (index != 0 || !info) return kInvalidArgument;
        info->cid = kWavelyCID;
        info->cardinality = 0x7FFFFFFF;
        std::strncpy(info->category, "Audio Module Class", sizeof(info->category) - 1);
        std::strncpy(info->name, "Wavely Connect", sizeof(info->name) - 1);
        return kResultOk;
    }

    tresult createInstance(FIDString cid, FIDString _iid, void** obj) override {
        if (!cid || !obj) return kInvalidArgument;
        
        WavelyVst3Component* comp = new WavelyVst3Component();
        FUID reqIid;
        std::memcpy(&reqIid, _iid, sizeof(FUID));
        tresult res = comp->queryInterface(reqIid, obj);
        comp->release();
        return res;
    }

    // IPluginFactory2
    tresult getClassInfo2(int32 index, PClassInfo2* info) override {
        if (index != 0 || !info) return kInvalidArgument;
        info->cid = kWavelyCID;
        info->cardinality = 0x7FFFFFFF;
        std::strncpy(info->category, "Audio Module Class", sizeof(info->category) - 1);
        std::strncpy(info->name, "Wavely Connect", sizeof(info->name) - 1);
        info->classFlags = 0;
        std::strncpy(info->subCategories, "Instrument|Sampler|Fx", sizeof(info->subCategories) - 1);
        std::strncpy(info->vendor, "Wavely Technologies Inc.", sizeof(info->vendor) - 1);
        std::strncpy(info->version, "1.0.6", sizeof(info->version) - 1);
        std::strncpy(info->sdkVersion, "VST 3.7.8", sizeof(info->sdkVersion) - 1);
        return kResultOk;
    }

    // IPluginFactory3
    tresult getClassInfoUnicode(int32 index, void* info) override {
        return getClassInfo2(index, static_cast<PClassInfo2*>(info));
    }

    tresult setHostContext(FUnknown* context) override {
        return kResultOk;
    }

private:
    std::atomic<uint32> mRefCount;
};

static WavelyVst3Factory* gFactoryInstance = nullptr;

#if defined(_WIN32)
#define VST3_EXPORT __declspec(dllexport)
#else
#define VST3_EXPORT __attribute__((visibility("default")))
#endif

extern "C" {

VST3_EXPORT void* GetPluginFactory() {
    if (!gFactoryInstance) {
        gFactoryInstance = new WavelyVst3Factory();
    }
    gFactoryInstance->addRef();
    return static_cast<IPluginFactory3*>(gFactoryInstance);
}

VST3_EXPORT bool InitDll() {
    return true;
}

VST3_EXPORT bool ExitDll() {
    if (gFactoryInstance) {
        gFactoryInstance->release();
        gFactoryInstance = nullptr;
    }
    return true;
}

}
