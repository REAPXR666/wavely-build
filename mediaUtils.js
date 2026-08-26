const fs = require('fs');
const path = require('path');

const PRESET_EXTENSIONS = [
  '.vital',
  '.fxp',
  '.fxb',
  '.serumpreset',
  '.splicepreset',
  '.spf',
  '.spf2',
  '.nmsv'
];

function getPresetExtension(value = '') {
  let candidate = String(value).trim();
  try {
    if (/^https?:\/\//i.test(candidate)) {
      candidate = decodeURIComponent(new URL(candidate).pathname);
    }
  } catch (_) {}

  const lower = candidate.toLowerCase().split(/[?#]/)[0];
  return PRESET_EXTENSIONS.find(extension => lower.endsWith(extension)) || '';
}

function presetExtensionForSynth(synth = '') {
  const normalized = String(synth).toLowerCase().replace(/[^a-z0-9]/g, '');
  if (normalized.includes('vital')) return '.vital';
  if (normalized.includes('astra')) return '.splicepreset';
  if (normalized.includes('massive')) return '.nmsv';
  if (normalized.includes('spire')) return '.spf';
  if (normalized.includes('sylenth')) return '.fxb';
  if (normalized.includes('serum')) return '.fxp';
  return '.fxp';
}

function sanitizePresetFileName(name = '') {
  return String(name)
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/[. ]+$/g, '')
    .trim();
}

function resolvePresetFileName(name, synth, downloadUrl = '') {
  let rawName = path.basename(String(name || 'Wavely_Preset').replace(/\\/g, '/'));

  // Repair legacy double extensions such as "Bass.vital.fxp" while keeping
  // the original, meaningful preset format.
  const duplicateExtension = rawName.match(/(\.(?:vital|fxp|fxb|serumpreset|splicepreset|spf2?|nmsv))(?:\.(?:vital|fxp|fxb|serumpreset|splicepreset|spf2?|nmsv))+$/i);
  if (duplicateExtension) {
    rawName = rawName.slice(0, duplicateExtension.index) + duplicateExtension[1];
  }

  const originalExtension = getPresetExtension(rawName);
  const urlExtension = getPresetExtension(downloadUrl);
  const extension = originalExtension || urlExtension || presetExtensionForSynth(synth);
  const safeName = sanitizePresetFileName(rawName) || 'Wavely_Preset';

  if (getPresetExtension(safeName)) return safeName;
  return `${safeName}${extension}`;
}

function selectPresetAssetFile(files = []) {
  const candidates = files.filter(file => file && file.url);
  const isPreview = file => {
    const descriptor = `${file.asset_file_type_slug || ''} ${file.name || ''} ${file.path || ''} ${file.url || ''}`.toLowerCase();
    return descriptor.includes('preview') || /\.(?:mp3|wav|ogg|m4a)(?:$|[?#])/i.test(descriptor);
  };

  return candidates.find(file => getPresetExtension(file.name) || getPresetExtension(file.path) || getPresetExtension(file.url)) ||
    candidates.find(file => !isPreview(file) && /preset|full|original|download/i.test(String(file.asset_file_type_slug || ''))) ||
    candidates.find(file => !isPreview(file)) ||
    null;
}

function readNormalizedMagnitude(buffer, offset, bitsPerSample, audioFormat) {
  if (offset < 0 || offset + (bitsPerSample / 8) > buffer.length) return 0;
  if (bitsPerSample === 8) return Math.abs((buffer.readUInt8(offset) - 128) / 128);
  if (bitsPerSample === 16) return Math.abs(buffer.readInt16LE(offset) / 32768);
  if (bitsPerSample === 24) {
    let value = buffer[offset] | (buffer[offset + 1] << 8) | (buffer[offset + 2] << 16);
    if (value & 0x800000) value |= ~0xFFFFFF;
    return Math.abs(value / 8388608);
  }
  if (bitsPerSample === 32 && audioFormat === 3) {
    const value = buffer.readFloatLE(offset);
    return Number.isFinite(value) ? Math.min(1, Math.abs(value)) : 0;
  }
  if (bitsPerSample === 32) return Math.abs(buffer.readInt32LE(offset) / 2147483648);
  return 0;
}

function detectAudioOnsetFrame({
  buffer,
  dataOffset,
  totalFrames,
  numChannels,
  sampleRate,
  bitsPerSample,
  audioFormat = 1,
  isPercussive = false
}) {
  if (!buffer || !totalFrames || !sampleRate || !numChannels) return 0;

  const bytesPerSample = bitsPerSample / 8;
  const bytesPerFrame = numChannels * bytesPerSample;
  if (![8, 16, 24, 32].includes(bitsPerSample) || !Number.isInteger(bytesPerFrame)) return 0;

  const minimumScan = Math.min(totalFrames, Math.floor(sampleRate * 0.25));
  const proportionalScan = Math.min(Math.floor(sampleRate * 1.5), Math.floor(totalFrames * 0.5));
  const maxScanFrames = Math.max(minimumScan, proportionalScan);
  const windowFrames = Math.max(8, Math.floor(sampleRate * 0.001));
  const envelope = [];

  for (let windowStart = 0; windowStart < maxScanFrames; windowStart += windowFrames) {
    const windowEnd = Math.min(maxScanFrames, windowStart + windowFrames);
    let peak = 0;
    let sumSquares = 0;
    let count = 0;

    for (let frame = windowStart; frame < windowEnd; frame++) {
      for (let channel = 0; channel < numChannels; channel++) {
        const sampleOffset = dataOffset + (frame * bytesPerFrame) + (channel * bytesPerSample);
        const magnitude = readNormalizedMagnitude(buffer, sampleOffset, bitsPerSample, audioFormat);
        peak = Math.max(peak, magnitude);
        sumSquares += magnitude * magnitude;
        count++;
      }
    }

    const rms = count ? Math.sqrt(sumSquares / count) : 0;
    envelope.push(Math.max(peak * 0.65, rms * 1.8));
  }

  if (!envelope.length) return 0;
  const referencePeak = Math.max(...envelope);
  const absoluteFloor = 0.0015;
  if (referencePeak < absoluteFloor) return 0;

  const sortedEnvelope = [...envelope].sort((a, b) => a - b);
  const quietIndex = Math.min(sortedEnvelope.length - 1, Math.floor(sortedEnvelope.length * 0.15));
  const quietFloor = sortedEnvelope[quietIndex] || 0;
  const relativeGate = referencePeak * (isPercussive ? 0.1 : 0.025);
  const onsetGate = Math.min(
    referencePeak * 0.45,
    Math.max(absoluteFloor, relativeGate, quietFloor * 6)
  );

  let onsetWindow = 0;
  let found = false;
  const requiredActiveWindows = isPercussive ? 2 : 3;
  for (let index = 0; index < envelope.length; index++) {
    if (envelope[index] < onsetGate) continue;
    let activeWindows = 0;
    for (let lookahead = index; lookahead < Math.min(envelope.length, index + 4); lookahead++) {
      if (envelope[lookahead] >= onsetGate * 0.7) activeWindows++;
    }
    if (activeWindows >= requiredActiveWindows) {
      onsetWindow = index;
      found = true;
      break;
    }
  }

  if (!found || onsetWindow === 0) return 0;

  // Preserve the natural attack immediately before the detected body, but do
  // not reconnect isolated encoder ticks or weak pre-transients.
  const lowerGate = Math.max(
    absoluteFloor * 0.5,
    quietFloor * 2.5,
    referencePeak * (isPercussive ? 0.015 : 0.004)
  );
  const maxBacktrackWindows = isPercussive ? 12 : 40;
  const earliestWindow = Math.max(0, onsetWindow - maxBacktrackWindows);
  while (onsetWindow > earliestWindow && envelope[onsetWindow - 1] >= lowerGate) {
    onsetWindow--;
  }

  let onsetFrame = onsetWindow * windowFrames;
  const zeroCrossingSearchFrames = Math.floor(sampleRate * 0.002);
  const earliestFrame = Math.max(0, onsetFrame - zeroCrossingSearchFrames);
  for (let frame = onsetFrame; frame >= earliestFrame; frame--) {
    let frameMagnitude = 0;
    for (let channel = 0; channel < numChannels; channel++) {
      const sampleOffset = dataOffset + (frame * bytesPerFrame) + (channel * bytesPerSample);
      frameMagnitude = Math.max(frameMagnitude, readNormalizedMagnitude(buffer, sampleOffset, bitsPerSample, audioFormat));
    }
    if (frameMagnitude <= lowerGate * 0.5) {
      onsetFrame = frame;
      break;
    }
  }

  return Math.max(0, Math.min(totalFrames - 1, onsetFrame));
}

function toLocalMediaUrl(filePath) {
  if (!filePath) return '';
  return `wavely-media://local/${encodeURI(String(filePath).replace(/\\/g, '/'))}`;
}

function buildAcidChunk(tempo, numBeats, meterN = 4, meterD = 4) {
  const acidBuffer = Buffer.alloc(32);
  acidBuffer.write('acid', 0);
  acidBuffer.writeUInt32LE(24, 4);
  acidBuffer.writeUInt32LE(0x01, 8);
  acidBuffer.writeUInt16LE(0x3C, 12);
  acidBuffer.writeUInt16LE(0x00, 14);
  acidBuffer.writeFloatLE(0.0, 16);
  acidBuffer.writeUInt32LE(numBeats, 20);
  acidBuffer.writeUInt16LE(meterN, 24);
  acidBuffer.writeUInt16LE(meterD, 26);
  acidBuffer.writeFloatLE(tempo, 28);
  return acidBuffer;
}

function processAudioForDawSync(filePath, meta = {}) {
  try {
    if (!fs.existsSync(filePath)) return { success: false, error: 'Audio file was not found.' };
    const inputBuffer = fs.readFileSync(filePath);
    if (inputBuffer.length < 44 || inputBuffer.toString('ascii', 0, 4) !== 'RIFF' || inputBuffer.toString('ascii', 8, 12) !== 'WAVE') {
      return { success: false, error: 'Unsupported or invalid WAV file.' };
    }

    let offset = 12;
    let format = null;
    let formatChunk = null;
    let dataOffset = -1;
    let dataSize = 0;
    while (offset < inputBuffer.length - 8) {
      const chunkId = inputBuffer.toString('ascii', offset, offset + 4);
      const chunkSize = inputBuffer.readUInt32LE(offset + 4);
      if (chunkSize < 0 || offset + 8 + chunkSize > inputBuffer.length + 1) break;
      if (chunkId === 'fmt ') {
        format = {
          audioFormat: inputBuffer.readUInt16LE(offset + 8),
          numChannels: inputBuffer.readUInt16LE(offset + 10),
          sampleRate: inputBuffer.readUInt32LE(offset + 12),
          byteRate: inputBuffer.readUInt32LE(offset + 16),
          blockAlign: inputBuffer.readUInt16LE(offset + 20),
          bitsPerSample: inputBuffer.readUInt16LE(offset + 22)
        };
        formatChunk = inputBuffer.subarray(offset, offset + 8 + chunkSize + (chunkSize % 2));
      } else if (chunkId === 'data') {
        dataOffset = offset + 8;
        dataSize = Math.min(chunkSize, inputBuffer.length - dataOffset);
      }
      offset += 8 + chunkSize + (chunkSize % 2);
    }

    if (!format || !formatChunk || dataOffset === -1 || dataSize <= 0) {
      return { success: false, error: 'WAV format or data chunk is missing.' };
    }

    const { audioFormat, numChannels, sampleRate, bitsPerSample } = format;
    const bytesPerSample = bitsPerSample / 8;
    const bytesPerFrame = numChannels * bytesPerSample;
    if (!Number.isInteger(bytesPerFrame) || bytesPerFrame <= 0) {
      return { success: false, error: 'Unsupported WAV sample format.' };
    }

    const totalFrames = Math.floor(dataSize / bytesPerFrame);
    const durationSeconds = totalFrames / sampleRate;
    let bpm = meta.bpm ? parseFloat(meta.bpm) : null;
    if (!bpm || Number.isNaN(bpm) || bpm < 40 || bpm > 300) {
      const baseName = path.basename(filePath);
      const match = baseName.match(/(\d{2,3})(?:\s*bpm|_bpm|\s*BPM|_BPM)/i) || baseName.match(/_(\d{2,3})_/);
      if (match) bpm = parseFloat(match[1]);
    }

    const lowerName = path.basename(filePath).toLowerCase();
    const isExplicitOneShot = lowerName.includes('one shot') || lowerName.includes('oneshot') || lowerName.includes('one_shot') || lowerName.includes('hit') || (meta.productType === 'sample' && durationSeconds < 1.5 && !bpm);
    const isLoop = !isExplicitOneShot && (meta.productType === 'loop' || (bpm && (lowerName.includes('loop') || lowerName.includes('groove') || durationSeconds > 1.8)));
    const onsetDescriptor = `${lowerName} ${(meta.tags || []).join(' ').toLowerCase()} ${meta.assetCategory || ''}`;
    const isPercussive = isExplicitOneShot || /\b(kick|snare|clap|snap|hat|hihat|cymbal|perc|drum|rim|tom|impact|hit|stab)\b/i.test(onsetDescriptor);
    const transientStart = detectAudioOnsetFrame({
      buffer: inputBuffer,
      dataOffset,
      totalFrames,
      numChannels,
      sampleRate,
      bitsPerSample,
      audioFormat,
      isPercussive
    });

    let targetFrames = totalFrames - transientStart;
    let numberOfBeats = 0;
    if (isLoop && bpm && bpm >= 40 && bpm <= 300) {
      const beatSeconds = 60 / bpm;
      const rawBeats = (targetFrames / sampleRate) / beatSeconds;
      const possibleBeats = [1, 2, 4, 8, 16, 24, 32, 48, 64];
      numberOfBeats = possibleBeats.reduce((previous, current) => Math.abs(current - rawBeats) < Math.abs(previous - rawBeats) ? current : previous);
      targetFrames = Math.max(1, Math.round(numberOfBeats * beatSeconds * sampleRate));
    }

    const startByte = dataOffset + (transientStart * bytesPerFrame);
    const audioData = Buffer.alloc(targetFrames * bytesPerFrame);
    const availableBytes = Math.max(0, Math.min(audioData.length, inputBuffer.length - startByte));
    inputBuffer.copy(audioData, 0, startByte, startByte + availableBytes);

    if (bitsPerSample === 16) {
      const fadeInFrames = Math.min(targetFrames, Math.floor(sampleRate * 0.0005));
      for (let frame = 0; frame < fadeInFrames; frame++) {
        const multiplier = fadeInFrames ? frame / fadeInFrames : 1;
        for (let channel = 0; channel < numChannels; channel++) {
          const sampleOffset = (frame * bytesPerFrame) + (channel * bytesPerSample);
          audioData.writeInt16LE(Math.round(audioData.readInt16LE(sampleOffset) * multiplier), sampleOffset);
        }
      }

      if (isLoop) {
        const fadeOutFrames = Math.min(targetFrames, Math.floor(sampleRate * 0.001));
        for (let frame = 0; frame < fadeOutFrames; frame++) {
          const multiplier = fadeOutFrames ? (fadeOutFrames - frame) / fadeOutFrames : 1;
          const targetFrame = targetFrames - fadeOutFrames + frame;
          for (let channel = 0; channel < numChannels; channel++) {
            const sampleOffset = (targetFrame * bytesPerFrame) + (channel * bytesPerSample);
            audioData.writeInt16LE(Math.round(audioData.readInt16LE(sampleOffset) * multiplier), sampleOffset);
          }
        }
      }
    }

    const acidChunk = isLoop && bpm && numberOfBeats > 0 ? buildAcidChunk(bpm, numberOfBeats) : Buffer.alloc(0);
    const dataHeader = Buffer.alloc(8);
    dataHeader.write('data', 0);
    dataHeader.writeUInt32LE(audioData.length, 4);
    const riffHeader = Buffer.alloc(12);
    riffHeader.write('RIFF', 0);
    riffHeader.writeUInt32LE(4 + formatChunk.length + acidChunk.length + dataHeader.length + audioData.length, 4);
    riffHeader.write('WAVE', 8);
    const outputBuffer = Buffer.concat([riffHeader, formatChunk, acidChunk, dataHeader, audioData]);

    let retries = 3;
    while (retries > 0) {
      try {
        fs.writeFileSync(filePath, outputBuffer);
        break;
      } catch (writeError) {
        retries--;
        if (retries === 0) throw writeError;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
      }
    }

    return {
      success: true,
      trimmedFrames: transientStart,
      trimmedMilliseconds: Math.round((transientStart / sampleRate) * 1000),
      durationSeconds: targetFrames / sampleRate,
      isLoop,
      bpm,
      numberOfBeats
    };
  } catch (error) {
    return { success: false, error: error.message || String(error) };
  }
}

module.exports = {
  detectAudioOnsetFrame,
  getPresetExtension,
  presetExtensionForSynth,
  resolvePresetFileName,
  selectPresetAssetFile,
  toLocalMediaUrl,
  processAudioForDawSync
};
