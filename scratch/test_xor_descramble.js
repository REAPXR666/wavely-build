const fs = require('fs');
const path = require('path');

const scrambledPath = path.join(__dirname, 'sample_scrambled.mp3');
if (!fs.existsSync(scrambledPath)) {
  console.error('No scrambled sample found at:', scrambledPath);
  process.exit(1);
}

const fileBuffer = fs.readFileSync(scrambledPath);
console.log('Scrambled file size:', fileBuffer.length, 'bytes');

// Bytes 0-1: Unused
// Bytes 2-9 (8 bytes): 64-bit little-endian integer for block size e
// Let's read it as two 32-bit integers, or using readBigUInt64LE if available.
let e;
if (typeof fileBuffer.readBigUInt64LE === 'function') {
  e = Number(fileBuffer.readBigUInt64LE(2));
} else {
  const low = fileBuffer.readUInt32LE(2);
  const high = fileBuffer.readUInt32LE(6);
  e = low + (high * 0x100000000);
}

// Bytes 10-27 (18 bytes): 18-character ASCII XOR key s
const keyBuffer = fileBuffer.subarray(10, 28);
const keyStr = keyBuffer.toString('ascii');

console.log(`Block size e: ${e}`);
console.log(`XOR key: "${keyStr}" (length: ${keyBuffer.length})`);

// Bytes 28 to end: scrambled audio payload
const scrambledPayload = fileBuffer.subarray(28);
const payloadLength = scrambledPayload.length;
console.log('Scrambled payload length:', payloadLength);

const descrambledPayload = Buffer.alloc(payloadLength);
scrambledPayload.copy(descrambledPayload);

// Segmented XOR cipher:
// Block 1: [0, e - 1] -> XORed with key
// Block 2: [e, 2e - 1] -> Clean (skipped)
// Block 3: [2e, 3e - 1] -> XORed with key (key index restarts at 0)
// Remaining: [3e, end] -> Clean (skipped)

// Block 1
const block1End = Math.min(e, payloadLength);
for (let i = 0; i < block1End; i++) {
  descrambledPayload[i] ^= keyBuffer[i % 18];
}

// Block 3
const block3Start = 2 * e;
const block3End = Math.min(3 * e, payloadLength);
if (block3Start < payloadLength) {
  for (let i = block3Start; i < block3End; i++) {
    const keyIndex = (i - block3Start) % 18;
    descrambledPayload[i] ^= keyBuffer[keyIndex];
  }
}

const outputPath = path.join(__dirname, 'sample_descrambled_test.mp3');
fs.writeFileSync(outputPath, descrambledPayload);
console.log('Saved descrambled MP3 to:', outputPath);
console.log('Descrambled size:', descrambledPayload.length, 'bytes');
