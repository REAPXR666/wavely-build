/**
 * Wavely MIDI Clip (.mid) Generator & Procedural Pattern Engine
 * Creates standard Type 0 SMF MIDI files for sample chops, dynamic grooves,
 * and custom randomized chop sequences at any user-defined BPM.
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
  // 1. Set Tempo Meta Event (00 FF 51 03 tt tt tt)
  const mpqn = Math.round(60000000 / Math.max(20, Math.min(320, bpm)));
  const tempoBytes = [
    (mpqn >> 16) & 0xff,
    (mpqn >> 8) & 0xff,
    mpqn & 0xff
  ];

  const rawEvents = [
    { absTick: 0, bytes: [0xff, 0x51, 0x03, ...tempoBytes] }
  ];

  // Convert notes into NoteOn and NoteOff events
  notes.forEach((n) => {
    const midiNote = Math.max(0, Math.min(127, n.note || 60));
    const velocity = Math.max(1, Math.min(127, n.velocity || 100));
    const startTick = Math.max(0, Math.round(n.startTick || 0));
    const duration = Math.max(1, Math.round(n.durationTicks || (ppq / 2)));

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
  const header = [
    0x4d, 0x54, 0x68, 0x64, // "MThd"
    0x00, 0x00, 0x00, 0x06, // length 6
    0x00, 0x00,             // format 0 (single track)
    0x00, 0x01,             // 1 track
    (ppq >> 8) & 0xff, ppq & 0xff // Division (PPQ)
  ];

  // 3. Construct MTrk (Track) Chunk
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
 * Generates MIDI file from any arbitrary sequence of slice indices at custom BPM
 */
export function createCustomPatternMidi(sequence = [], sliceCount = 8, bpm = 120, division = 16) {
  const ppq = 480;
  const notes = [];
  const baseNote = 60; // C3
  const stepTicks = Math.round((ppq * 4) / division); // e.g. 1/16 note = 120 ticks

  sequence.forEach((step, idx) => {
    if (step !== null && step !== undefined && step >= 0) {
      const sliceIdx = step % sliceCount;
      const isAccent = (idx % 4 === 0);
      notes.push({
        note: baseNote + sliceIdx,
        startTick: idx * stepTicks,
        durationTicks: Math.max(10, stepTicks - 12),
        velocity: isAccent ? 118 : Math.floor(90 + Math.random() * 20)
      });
    }
  });

  return generateMidiFile(notes, bpm, ppq);
}

/**
 * Procedurally generates creative, musically coherent random chop patterns
 */
export function generateRandomPattern(sliceCount = 8, style = 'groove', steps = 16) {
  const pattern = [];

  if (style === 'breakbeat') {
    // Syncopated breakbeat rhythm (e.g. 0, 0, 2, 4, 1, 3, 5, 0...)
    for (let i = 0; i < steps; i++) {
      if (i % 4 === 0) {
        pattern.push(0); // Kick / Root slice on downbeat
      } else if (i % 4 === 2) {
        pattern.push(Math.min(sliceCount - 1, Math.floor(sliceCount / 2))); // Snare / Mid slice
      } else if (Math.random() > 0.4) {
        pattern.push(Math.floor(Math.random() * sliceCount));
      } else {
        pattern.push(null); // Rest / Ghost
      }
    }
  } else if (style === 'stutter') {
    // Glitchy stutter repeats (e.g. 0, 0, 0, 1, 2, 2, 3, 4...)
    let currentSlice = 0;
    for (let i = 0; i < steps; i++) {
      if (i % 2 === 0 || Math.random() > 0.6) {
        currentSlice = Math.floor(Math.random() * sliceCount);
      }
      pattern.push(currentSlice);
    }
  } else if (style === 'trap_roll') {
    // Rapid rolls and bounces
    for (let i = 0; i < steps; i++) {
      if (i >= 12 && Math.random() > 0.3) {
        pattern.push(sliceCount - 1); // roll on last 4 steps
      } else {
        pattern.push((i * 2 + Math.floor(Math.random() * 2)) % sliceCount);
      }
    }
  } else if (style === 'reverse_roll') {
    for (let i = 0; i < steps; i++) {
      pattern.push((sliceCount - 1 - (i % sliceCount)));
    }
  } else {
    // General creative groove: weighted toward low & high pads
    for (let i = 0; i < steps; i++) {
      if (i === 0) {
        pattern.push(0);
      } else if (Math.random() > 0.25) {
        pattern.push(Math.floor(Math.random() * sliceCount));
      } else {
        pattern.push(null); // Rest
      }
    }
  }

  return pattern;
}
