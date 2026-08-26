const fs = require('fs');
const path = require('path');

const wavPath = path.join(__dirname, 'sample_descrambled_decoded.wav');
if (!fs.existsSync(wavPath)) {
  console.error('WAV file not found');
  process.exit(1);
}

const buffer = fs.readFileSync(wavPath);
// WAV header is 44 bytes.
// We are using 16-bit PCM. Each sample is 2 bytes.
// Let's read samples from byte 44 onwards.
const dataView = new DataView(buffer.buffer, buffer.byteOffset + 44);
const numSamples = (buffer.length - 44) / 2;

console.log(`Total samples: ${numSamples}`);

let leadingSilenceSamples = 0;
for (let i = 0; i < numSamples; i++) {
  const sampleVal = dataView.getInt16(i * 2, true);
  if (Math.abs(sampleVal) > 10) { // threshold for non-silence
    leadingSilenceSamples = i;
    break;
  }
}

const sampleRate = 48000; // Let's check sample rate from header
const headerSampleRate = buffer.readUInt32LE(24);
console.log(`Header Sample Rate: ${headerSampleRate} Hz`);

const silenceDurationMs = (leadingSilenceSamples / headerSampleRate) * 1000;
console.log(`Leading silence: ${leadingSilenceSamples} samples (${silenceDurationMs.toFixed(2)} ms)`);
