// splice-capture.js — Preload script for hidden Splice audio capture window.
// Injected BEFORE splice.com page JS runs. Hooks the Web Audio API to intercept
// the descrambled audio that Splice's own player produces.
//
// Splice's player flow:
//   1. Fetches scrambled MP3 from S3
//   2. Decodes with AudioContext.decodeAudioData() → scrambled PCM
//   3. Rearranges PCM segments internally (proprietary algorithm)
//   4. Creates AudioBufferSourceNode, assigns the clean buffer, calls start()
//
// We hook step 4 to capture the final clean AudioBuffer.

(function() {
  'use strict';

  // Storage for captured audio
  window.__capturedAudio = null;
  window.__captureStatus = 'waiting'; // waiting | capturing | done | error

  // Track all decoded buffers — we want the largest one (the actual sample)
  const decodedBuffers = [];

  // Hook 1: Capture buffers assigned to AudioBufferSourceNode
  const origBufferDesc = Object.getOwnPropertyDescriptor(AudioBufferSourceNode.prototype, 'buffer');
  if (origBufferDesc && origBufferDesc.set) {
    Object.defineProperty(AudioBufferSourceNode.prototype, 'buffer', {
      get: origBufferDesc.get,
      set: function(buf) {
        if (buf && buf.length > 0) {
          decodedBuffers.push(buf);
          tryCapture(buf);
        }
        return origBufferDesc.set.call(this, buf);
      },
      configurable: true,
      enumerable: true
    });
  }

  // Hook 2: Also hook decodeAudioData as a fallback capture point
  const origDecode = AudioContext.prototype.decodeAudioData;
  AudioContext.prototype.decodeAudioData = function(arrayBuffer, successCb, errorCb) {
    const wrappedSuccess = function(audioBuffer) {
      if (audioBuffer && audioBuffer.length > 0) {
        decodedBuffers.push(audioBuffer);
        tryCapture(audioBuffer);
      }
      if (successCb) successCb(audioBuffer);
    };
    
    // Handle both callback and promise styles
    const result = origDecode.call(this, arrayBuffer, wrappedSuccess, errorCb);
    if (result && typeof result.then === 'function') {
      return result.then(function(audioBuffer) {
        if (audioBuffer && audioBuffer.length > 0) {
          decodedBuffers.push(audioBuffer);
          tryCapture(audioBuffer);
        }
        return audioBuffer;
      });
    }
    return result;
  };

  // Also patch webkitAudioContext if it exists
  if (typeof webkitAudioContext !== 'undefined') {
    const origDecodeWebkit = webkitAudioContext.prototype.decodeAudioData;
    webkitAudioContext.prototype.decodeAudioData = AudioContext.prototype.decodeAudioData;
  }

  // Hook 3: Intercept AudioBufferSourceNode.start() to know when playback begins
  const origStart = AudioBufferSourceNode.prototype.start;
  AudioBufferSourceNode.prototype.start = function() {
    if (this.buffer && this.buffer.length > 0) {
      decodedBuffers.push(this.buffer);
      tryCapture(this.buffer);
    }
    return origStart.apply(this, arguments);
  };

  function tryCapture(buf) {
    if (window.__captureStatus === 'done') return;
    
    // Pick the largest buffer we've seen — that's the actual sample audio.
    // Splice may decode UI sounds or tiny blips; the real sample will be the longest.
    let bestBuf = buf;
    for (const b of decodedBuffers) {
      if (b.length > bestBuf.length) {
        bestBuf = b;
      }
    }
    
    // Only finalize if the buffer is at least 0.05 seconds (not a UI click sound)
    if (bestBuf.duration < 0.05) return;
    
    window.__captureStatus = 'capturing';
    
    try {
      const wavData = encodeWAV(bestBuf);
      // Store as a regular array (serializable over IPC)
      window.__capturedAudio = {
        wavBase64: arrayBufferToBase64(wavData),
        sampleRate: bestBuf.sampleRate,
        duration: bestBuf.duration,
        channels: bestBuf.numberOfChannels,
        length: bestBuf.length
      };
      window.__captureStatus = 'done';
    } catch (err) {
      console.error('[splice-capture] WAV encode error:', err);
      window.__captureStatus = 'error';
    }
  }

  function encodeWAV(audioBuffer) {
    const numChannels = audioBuffer.numberOfChannels;
    const sampleRate = audioBuffer.sampleRate;
    const bitDepth = 16;
    const bytesPerSample = bitDepth / 8;
    const blockAlign = numChannels * bytesPerSample;
    const byteRate = sampleRate * blockAlign;
    const dataSize = audioBuffer.length * blockAlign;
    const headerSize = 44;
    const totalSize = headerSize + dataSize;

    const buffer = new ArrayBuffer(totalSize);
    const view = new DataView(buffer);

    // Write WAV header
    writeStr(view, 0, 'RIFF');
    view.setUint32(4, totalSize - 8, true);
    writeStr(view, 8, 'WAVE');
    writeStr(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitDepth, true);
    writeStr(view, 36, 'data');
    view.setUint32(40, dataSize, true);

    // Interleave channel data
    const channels = [];
    for (let ch = 0; ch < numChannels; ch++) {
      channels.push(audioBuffer.getChannelData(ch));
    }

    let offset = headerSize;
    for (let i = 0; i < audioBuffer.length; i++) {
      for (let ch = 0; ch < numChannels; ch++) {
        const sample = Math.max(-1, Math.min(1, channels[ch][i]));
        const val = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
        view.setInt16(offset, val | 0, true);
        offset += 2;
      }
    }

    return buffer;
  }

  function writeStr(view, offset, str) {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  }

  function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    const chunkSize = 8192;
    let result = '';
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.subarray(i, i + chunkSize);
      result += String.fromCharCode.apply(null, chunk);
    }
    return btoa(result);
  }
})();
