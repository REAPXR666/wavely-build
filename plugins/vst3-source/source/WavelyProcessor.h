#pragma once

#include <vector>
#include <string>
#include <atomic>
#include <mutex>

namespace Wavely {

struct HostProcessContext {
    double sampleRate = 44100.0;
    double projectTimeSamples = 0.0;
    double tempo = 120.0;
    double timeSigNumerator = 4.0;
    double timeSigDenominator = 4.0;
    bool isPlaying = false;
    bool isRecording = false;
    bool isLooping = false;
};

class WavelyProcessor {
public:
    WavelyProcessor();
    ~WavelyProcessor();

    void initialize(double sampleRate, int maxBlockSize);
    void process(float** inputs, float** outputs, int numChannels, int numSamples, const HostProcessContext& context);
    void setOutputGain(float gain);
    void writeAudioBuffer(const float* bufferL, const float* bufferR, int numSamples);

    HostProcessContext getCurrentContext() const;

private:
    double mSampleRate = 44100.0;
    int mMaxBlockSize = 512;
    std::atomic<float> mOutputGain{1.0f};

    // Circular Ring Buffer for audio streaming from Desktop App Bridge
    std::vector<float> mRingBufferL;
    std::vector<float> mRingBufferR;
    std::atomic<size_t> mReadIndex{0};
    std::atomic<size_t> mWriteIndex{0};
    std::atomic<size_t> mBufferedSamples{0};
    mutable std::mutex mContextMutex;
    HostProcessContext mCurrentContext;
};

} // namespace Wavely
