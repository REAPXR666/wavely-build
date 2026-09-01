/**
 * Wavely MIDI Clip (.mid) Generator
 * Creates standard Type 0 SMF MIDI files for sample chops and rhythmic sequences.
 */

// Variable Length Quantity (VLQ) encoder for MIDI delta times
function writeVarInt(value) {
  let buffer = value & 0x7f;
  const bytes = [];
  while ((value >>= 7)) {
    buffer <<= 8;
    buffer |= (value & 0x7f) | 0x80;
  }
  while (true) {
    bytes.push(buffer & 0xff);
    if (buffer & 0x80) {
      buffer >>= 8;
    } else {
      break;
    }
  }
  return bytes;
}

/**
 * Generates a standard .mid file Blob for sliced sample chops.
 * @param {Array} notes - Array of { note: 60, startTick: 0, durationTicks: 480, velocity: 100 }
 * @param {number} bpm - Tempo in BPM (e.g. 120, 140, 172)
 * @param {number} ppq - Pulses (ticks) per quarter note (default 480)
 * @returns {Blob} Standard MIDI file Blob
 */
export function generateMidiFile(notes = [], bpm = 120, ppq = 480) {
  const events = [];

  // 1. Set Tempo Meta Event (00 FF 51 03 tt tt tt)
  // Microseconds per quarter note = 60,000,000 / BPM
  const mpqn = Math.round(60000000 / Math.max(20, Math.min(300, bpm)));
  const tempoBytes = [
    (mpqn >> 16) & 0xff,
    (mpqn >> 8) & 0xff,
    mpqn & 0xff
  ];

  // Raw MIDI events list with absolute tick times
  const rawEvents = [
    { absTick: 0, bytes: [0xff, 0x51, 0x03, ...tempoBytes] } // Tempo
  ];

  // Convert notes into NoteOn and NoteOff events
  notes.forEach((n) => {
    const midiNote = Math.max(0, Math.min(127, n.note || 60));
    const velocity = Math.max(1, Math.min(127, n.velocity || 100));
    const startTick = Math.max(0, Math.round(n.startTick || 0));
    const duration = Math.max(1, Math.round(n.durationTicks || ppq));

    // Note On (Channel 0: 0x90)
    rawEvents.push({
      absTick: startTick,
      bytes: [0x90, midiNote, velocity]
    });

    // Note Off (Channel 0: 0x80)
    rawEvents.push({
      absTick: startTick + duration,
      bytes: [0x80, midiNote, 0x00]
    });
  });

  // Sort events by absolute tick
  rawEvents.sort((a, b) => a.absTick - b.absTick);

  // Convert absolute ticks into delta-times
  let lastTick = 0;
  const trackData = [];

  rawEvents.forEach((ev) => {
    const delta = ev.absTick - lastTick;
    lastTick = ev.absTick;
    const deltaBytes = writeVarInt(delta);
    trackData.push(...deltaBytes, ...ev.bytes);
  });

  // End of Track Meta Event (00 FF 2F 00)
  trackData.push(0x00, 0xff, 0x2f, 0x00);

  // 2. Construct MThd (Header) Chunk
  // MThd (4 bytes), Length = 6 (4 bytes), Format 0 (2 bytes), Tracks = 1 (2 bytes), Division (2 bytes)
  const header = [
    0x4d, 0x54, 0x68, 0x64, // "MThd"
    0x00, 0x00, 0x00, 0x06, // length 6
    0x00, 0x00,             // format 0 (single track)
    0x00, 0x01,             // 1 track
    (ppq >> 8) & 0xff, ppq & 0xff // Division (PPQ)
  ];

  // 3. Construct MTrk (Track) Chunk
  // MTrk (4 bytes), Length (4 bytes), track data
  const trackLen = trackData.length;
  const trackHeader = [
    0x4d, 0x54, 0x72, 0x6b, // "MTrk"
    (trackLen >> 24) & 0xff,
    (trackLen >> 16) & 0xff,
    (trackLen >> 8) & 0xff,
    trackLen & 0xff
  ];

  const fullMidi = new Uint8Array([...header, ...trackHeader, ...trackData]);
  return new Blob([fullMidi], { type: 'audio/midi' });
}

/**
 * Generates chromatic MIDI notes for slices (C3, C#3, D3, D#3...) in sequential bars.
 */
export function createChopMidiPattern(sliceCount = 8, bpm = 120, patternType = 'linear') {
  const ppq = 480;
  const notes = [];
  const baseNote = 60; // C3 (Standard DAW sampler root key)

  if (patternType === 'linear') {
    // 1 slice per 1/8th note or 1/4 note
    const stepTicks = ppq / 2; // 1/8 note
    for (let i = 0; i < sliceCount; i++) {
      notes.push({
        note: baseNote + i,
        startTick: i * stepTicks,
        durationTicks: stepTicks - 10,
        velocity: 100
      });
    }
  } else if (patternType === 'stutter') {
    // Rhythmic stutter sequence: 1-1-2-3-4-4-3-2...
    const sequence = [0, 0, 1, 2, 3, 3, 2, 1, 4, 4, 5, 6, 7, 7, 6, 5];
    const stepTicks = ppq / 4; // 1/16 note
    sequence.slice(0, Math.min(sequence.length, sliceCount * 2)).forEach((sliceIdx, step) => {
      notes.push({
        note: baseNote + (sliceIdx % sliceCount),
        startTick: step * stepTicks,
        durationTicks: stepTicks - 5,
        velocity: (step % 4 === 0) ? 115 : 95
      });
    });
  } else if (patternType === 'reverse') {
    const stepTicks = ppq / 2;
    for (let i = 0; i < sliceCount; i++) {
      notes.push({
        note: baseNote + (sliceCount - 1 - i),
        startTick: i * stepTicks,
        durationTicks: stepTicks - 10,
        velocity: 100
      });
    }
  }

  return generateMidiFile(notes, bpm, ppq);
}
