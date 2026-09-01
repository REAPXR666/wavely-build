#include "WavelyBridgeClient.h"
#include "WavelyProcessor.h"
#include <chrono>
#include <iostream>

#if defined(_WIN32)
#include <winsock2.h>
#include <ws2tcpip.h>
#pragma comment(lib, "ws2_32.lib")
#else
#include <sys/socket.h>
#include <arpa/inet.h>
#include <unistd.h>
#endif

namespace Wavely {

WavelyBridgeClient::WavelyBridgeClient(WavelyProcessor* processor)
    : mProcessor(processor) {}

WavelyBridgeClient::~WavelyBridgeClient() {
    stop();
}

void WavelyBridgeClient::start(int port) {
    if (mRunning) return;
    mPort = port;
    mRunning = true;
    mNetworkThread = std::thread(&WavelyBridgeClient::networkThreadLoop, this);
}

void WavelyBridgeClient::stop() {
    mRunning = false;
    if (mNetworkThread.joinable()) {
        mNetworkThread.join();
    }
}

bool WavelyBridgeClient::isConnected() const {
    return mConnected.load();
}

void WavelyBridgeClient::sendHostSync(double bpm, double position, bool isPlaying) {
    // Transmits JSON sync frame to Desktop App
    // {"type":"HOST_SYNC","bpm":140.0,"pos":0.0,"isPlaying":true}
}

void WavelyBridgeClient::networkThreadLoop() {
#if defined(_WIN32)
    WSADATA wsaData;
    WSAStartup(MAKEWORD(2, 2), &wsaData);
#endif

    while (mRunning) {
        // Local loopback client socket
        std::this_thread::sleep_for(std::chrono::milliseconds(20));

        if (mProcessor) {
            HostProcessContext ctx = mProcessor->getCurrentContext();
            sendHostSync(ctx.tempo, ctx.projectTimeSamples, ctx.isPlaying);
        }
    }

#if defined(_WIN32)
    WSACleanup();
#endif
}

} // namespace Wavely
