#pragma once

#include <string>
#include <thread>
#include <atomic>
#include <functional>

namespace Wavely {

class WavelyProcessor;

class WavelyBridgeClient {
public:
    WavelyBridgeClient(WavelyProcessor* processor);
    ~WavelyBridgeClient();

    void start(int port = 6768);
    void stop();
    bool isConnected() const;

    void sendHostSync(double bpm, double position, bool isPlaying);

private:
    void networkThreadLoop();

    WavelyProcessor* mProcessor = nullptr;
    int mPort = 6768;
    std::atomic<bool> mRunning{false};
    std::atomic<bool> mConnected{false};
    std::thread mNetworkThread;
};

} // namespace Wavely
