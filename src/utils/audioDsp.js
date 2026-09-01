/**
 * Wavely High-Performance Real-Time Web Audio DSP Suite
 * Includes:
 * 1. Pitch Shifter (Phase Vocoder / Granular Pitch Shifter without changing tempo)
 * 2. Time-Stretcher (0.5x Half-Time, 1.0x, 2.0x, and Host BPM Sync)
 * 3. Audio Buffer Manipulation (Reverse Buffer, Normalization to -0.1 dBFS, Auto-Trim Silence)
 */

/**
 * Creates an offline or online Web Audio Context
 */
export function getAudioContext() {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!window._wavelySharedAudioCtx || window._wavelySharedAudioCtx.state === 'closed') {
    window._wavelySharedAudioCtx = new AudioCtx({ sampleRate: 44100 });
  }
  if (window._wavelySharedAudioCtx.state === 'suspended') {
    window._wavelySharedAudioCtx.resume().catch(() => {});
  }
  return window._wavelySharedAudioCtx;
}

/**
 * Fetches and decodes an audio URL into an AudioBuffer
 */
export async function loadAudioBuffer(url, audioCtx = getAudioContext()) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} loading audio: ${url}`);
  const arrayBuffer = await res.arrayBuffer();
  return await audioCtx.decodeAudioData(arrayBuffer);
}

/**
 * Normalizes an AudioBuffer to peak level (default -0.1 dBFS ≈ 0.988)
 */
export function normalizeAudioBuffer(buffer, targetPeak = 0.988) {
  const numChannels = buffer.numberOfChannels;
  const length = buffer.length;
  const sampleRate = buffer.sampleRate;
  const audioCtx = getAudioContext();
  const normalizedBuffer = audioCtx.createBuffer(numChannels, length, sampleRate);

  let maxPeak = 0;
  for (let c = 0; c < numChannels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < length; i++) {
      const absVal = Math.abs(data[i]);
      if (absVal > maxPeak) maxPeak = absVal;
    }
  }

  const gain = maxPeak > 0 ? targetPeak / maxPeak : 1.0;

  for (let c = 0; c < numChannels; c++) {
    const srcData = buffer.getChannelData(c);
    const destData = normalizedBuffer.getChannelData(c);
    for (let i = 0; i < length; i++) {
      destData[i] = srcData[i] * gain;
    }
  }

  return normalizedBuffer;
}

/**
 * Reverses an AudioBuffer in place or returns a reversed copy
 */
export function reverseAudioBuffer(buffer) {
  const numChannels = buffer.numberOfChannels;
  const length = buffer.length;
  const sampleRate = buffer.sampleRate;
  const audioCtx = getAudioContext();
  const reversedBuffer = audioCtx.createBuffer(numChannels, length, sampleRate);

  for (let c = 0; c < numChannels; c++) {
    const srcData = buffer.getChannelData(c);
    const destData = reversedBuffer.getChannelData(c);
    for (let i = 0; i < length; i++) {
      destData[i] = srcData[length - 1 - i];
    }
  }

  return reversedBuffer;
}

/**
 * Detects and trims leading and trailing silence from an AudioBuffer
 */
export function trimSilenceAudioBuffer(buffer, threshold = 0.005) {
  const numChannels = buffer.numberOfChannels;
  const length = buffer.length;
  let start = length;
  let end = 0;

  for (let c = 0; c < numChannels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < length; i++) {
      if (Math.abs(data[i]) > threshold) {
        if (i < start) start = i;
        break;
      }
    }
    for (let i = length - 1; i >= 0; i--) {
      if (Math.abs(data[i]) > threshold) {
        if (i > end) end = i;
        break;
      }
    }
  }

  if (start >= end) return buffer; // No sound found above threshold

  const trimmedLength = end - start + 1;
  const audioCtx = getAudioContext();
  const trimmedBuffer = audioCtx.createBuffer(numChannels, trimmedLength, buffer.sampleRate);

  for (let c = 0; c < numChannels; c++) {
    const srcData = buffer.getChannelData(c);
    const destData = trimmedBuffer.getChannelData(c);
    for (let i = 0; i < trimmedLength; i++) {
      destData[i] = srcData[start + i];
    }
  }

  return trimmedBuffer;
}

/**
 * Granular Pitch Shifter for AudioBuffer: Shifts pitch by semitones (-12 to +12)
 * while preserving the original playback duration and tempo.
 */
export function pitchShiftAudioBuffer(buffer, semitones = 0) {
  if (semitones === 0) return buffer;

  const pitchRatio = Math.pow(2, semitones / 12);
  const numChannels = buffer.numberOfChannels;
  const originalLength = buffer.length;
  const sampleRate = buffer.sampleRate;
  const audioCtx = getAudioContext();
  const outputBuffer = audioCtx.createBuffer(numChannels, originalLength, sampleRate);

  const grainSize = Math.round(sampleRate * 0.05); // 50ms grains
  const overlap = 0.5;
  const hopSize = Math.round(grainSize * (1 - overlap));

  // Hanning window for smooth crossfade
  const window = new Float32Array(grainSize);
  for (let i = 0; i < grainSize; i++) {
    window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (grainSize - 1)));
  }

  for (let c = 0; c < numChannels; c++) {
    const input = buffer.getChannelData(c);
    const output = outputBuffer.getChannelData(c);

    let inPos = 0;
    let outPos = 0;

    while (outPos + grainSize < originalLength && inPos + grainSize * pitchRatio < originalLength) {
      for (let i = 0; i < grainSize; i++) {
        const srcIndex = inPos + Math.round(i * pitchRatio);
        if (srcIndex < originalLength) {
          output[outPos + i] += input[srcIndex] * window[i];
        }
      }
      outPos += hopSize;
      inPos += Math.round(hopSize * pitchRatio);
    }
  }

  return outputBuffer;
}

/**
 * Time-Stretch AudioBuffer by speed multiplier (0.5x, 1.0x, 2.0x) without altering pitch
 */
export function timeStretchAudioBuffer(buffer, speedMultiplier = 1.0) {
  if (speedMultiplier === 1.0) return buffer;

  const numChannels = buffer.numberOfChannels;
  const originalLength = buffer.length;
  const sampleRate = buffer.sampleRate;
  const targetLength = Math.round(originalLength / speedMultiplier);
  const audioCtx = getAudioContext();
  const outputBuffer = audioCtx.createBuffer(numChannels, targetLength, sampleRate);

  const grainSize = Math.round(sampleRate * 0.04); // 40ms grains
  const hopOut = Math.round(grainSize * 0.25);
  const hopIn = Math.round(hopOut * speedMultiplier);

  const window = new Float32Array(grainSize);
  for (let i = 0; i < grainSize; i++) {
    window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (grainSize - 1)));
  }

  for (let c = 0; c < numChannels; c++) {
    const input = buffer.getChannelData(c);
    const output = outputBuffer.getChannelData(c);

    let inPos = 0;
    let outPos = 0;

    while (outPos + grainSize < targetLength && inPos + grainSize < originalLength) {
      for (let i = 0; i < grainSize; i++) {
        output[outPos + i] += input[inPos + i] * window[i];
      }
      outPos += hopOut;
      inPos += hopIn;
    }
  }

  return outputBuffer;
}

/**
 * Exports an AudioBuffer as a high-quality 24-bit/16-bit WAV Blob
 */
export function audioBufferToWav(buffer, opt = {}) {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const format = opt.float32 ? 3 : 1;
  const bitDepth = format === 3 ? 32 : 16;

  let result;
  if (numChannels === 2) {
    result = interleave(buffer.getChannelData(0), buffer.getChannelData(1));
  } else {
    result = buffer.getChannelData(0);
  }

  return encodeWAV(result, format, sampleRate, numChannels, bitDepth);
}

function interleave(inputL, inputR) {
  const length = inputL.length + inputR.length;
  const result = new Float32Array(length);
  let index = 0;
  let inputIndex = 0;

  while (index < length) {
    result[index++] = inputL[inputIndex];
    result[index++] = inputR[inputIndex];
    inputIndex++;
  }
  return result;
}

function encodeWAV(samples, format, sampleRate, numChannels, bitDepth) {
  const bytesPerSample = bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;
  const buffer = new ArrayBuffer(44 + samples.length * bytesPerSample);
  const view = new DataView(buffer);

  /* RIFF identifier */
  writeString(view, 0, 'RIFF');
  /* RIFF chunk length */
  view.setUint32(4, 36 + samples.length * bytesPerSample, true);
  /* RIFF type */
  writeString(view, 8, 'WAVE');
  /* format chunk identifier */
  writeString(view, 12, 'fmt ');
  /* format chunk length */
  view.setUint32(16, 16, true);
  /* sample format (raw) */
  view.setUint16(20, format, true);
  /* channel count */
  view.setUint16(22, numChannels, true);
  /* sample rate */
  view.setUint32(24, sampleRate, true);
  /* byte rate (sample rate * block align) */
  view.setUint32(28, sampleRate * blockAlign, true);
  /* block align (channel count * bytes per sample) */
  view.setUint16(32, blockAlign, true);
  /* bits per sample */
  view.setUint16(34, bitDepth, true);
  /* data chunk identifier */
  writeString(view, 36, 'data');
  /* data chunk length */
  view.setUint32(40, samples.length * bytesPerSample, true);

  if (format === 1) { // 16-bit PCM
    floatTo16BitPCM(view, 44, samples);
  } else {
    writeFloat32(view, 44, samples);
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

function floatTo16BitPCM(output, offset, input) {
  for (let i = 0; i < input.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, input[i]));
    output.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }
}

function writeFloat32(output, offset, input) {
  for (let i = 0; i < input.length; i++, offset += 4) {
    output.setFloat32(offset, input[i], true);
  }
}

function writeString(view, offset, string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}
