#include "WavelyProcessor.h"
#include <cmath>
#include <cstring>
#include <algorithm>

namespace Wavely {

static const size_t RING_BUFFER_SIZE = 192000; // ~4 seconds buffer at 48kHz

WavelyProcessor::WavelyProcessor() {
    mRingBufferL.resize(RING_BUFFER_SIZE, 0.0f);
    mRingBufferR.resize(RING_BUFFER_SIZE, 0.0f);
}

WavelyProcessor::~WavelyProcessor() {}

void WavelyProcessor::initialize(double sampleRate, int maxBlockSize) {
    mSampleRate = sampleRate;
    mMaxBlockSize = maxBlockSize;
    mReadIndex = 0;
    mWriteIndex = 0;
    mBufferedSamples = 0;
    std::fill(mRingBufferL.begin(), mRingBufferL.end(), 0.0f);
    std::fill(mRingBufferR.begin(), mRingBufferR.end(), 0.0f);
}

void WavelyProcessor::setOutputGain(float gain) {
    mOutputGain.store(std::max(0.0f, std::min(2.0f, gain)));
}

HostProcessContext WavelyProcessor::getCurrentContext() const {
    std::lock_guard<std::mutex> lock(mContextMutex);
    return mCurrentContext;
}

void WavelyProcessor::writeAudioBuffer(const float* bufferL, const float* bufferR, int numSamples) {
    if (!bufferL || numSamples <= 0) return;

    size_t currentWrite = mWriteIndex.load();
    for (int i = 0; i < numSamples; i++) {
        mRingBufferL[(currentWrite + i) % RING_BUFFER_SIZE] = bufferL[i];
        mRingBufferR[(currentWrite + i) % RING_BUFFER_SIZE] = bufferR ? bufferR[i] : bufferL[i];
    }

    mWriteIndex.store((currentWrite + numSamples) % RING_BUFFER_SIZE);
    mBufferedSamples.fetch_add(numSamples);
}

void WavelyProcessor::process(float** inputs, float** outputs, int numChannels, int numSamples, const HostProcessContext& context) {
    {
        std::lock_guard<std::mutex> lock(mContextMutex);
        mCurrentContext = context;
    }

    if (!outputs || numChannels <= 0 || numSamples <= 0) return;

    const float gain = mOutputGain.load();
    size_t available = mBufferedSamples.load();
    size_t currentRead = mReadIndex.load();

    int samplesToRead = std::min(numSamples, static_cast<int>(available));

    for (int i = 0; i < samplesToRead; i++) {
        size_t idx = (currentRead + i) % RING_BUFFER_SIZE;
        float sampleL = mRingBufferL[idx] * gain;
        float sampleR = mRingBufferR[idx] * gain;

        // Mix with existing track audio if input exists, otherwise output clean preview
        float inL = (inputs && inputs[0]) ? inputs[0][i] : 0.0f;
        float inR = (inputs && numChannels > 1 && inputs[1]) ? inputs[1][i] : inL;

        outputs[0][i] = inL + sampleL;
        if (numChannels > 1 && outputs[1]) {
            outputs[1][i] = inR + sampleR;
        }
    }

    // Zero-fill remaining buffer if underrun
    for (int i = samplesToRead; i < numSamples; i++) {
        float inL = (inputs && inputs[0]) ? inputs[0][i] : 0.0f;
        float inR = (inputs && numChannels > 1 && inputs[1]) ? inputs[1][i] : inL;
        outputs[0][i] = inL;
        if (numChannels > 1 && outputs[1]) {
            outputs[1][i] = inR;
        }
    }

    if (samplesToRead > 0) {
        mReadIndex.store((currentRead + samplesToRead) % RING_BUFFER_SIZE);
        mBufferedSamples.fetch_sub(samplesToRead);
    }
}

} // namespace Wavely
