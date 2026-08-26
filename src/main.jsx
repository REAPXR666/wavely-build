import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './App.css';

// --- BROWSER FALLBACK MOCK FOR WINDOW.ELECTRON ---
if (typeof window.electron === 'undefined') {
  console.warn('Electron context not detected. Initializing standard browser mock-fallback environment.');
  
  // High-performance direct local audio synthesizer (WAV PCM 16-bit generator)
  // Generates playable data URLs with custom frequencies to fully bypass browser CORS limits!
  function generateSynthBeepDataUrl(frequency = 440, duration = 0.5, type = 'sine') {
    const sampleRate = 8000; // 8kHz for fast synthesis and tiny base64 payload size
    const numChannels = 1;
    const bitDepth = 16;
    
    const numSamples = sampleRate * duration;
    const dataSize = numSamples * numChannels * (bitDepth / 8);
    const chunkSize = 36 + dataSize;
    const byteRate = sampleRate * numChannels * (bitDepth / 8);
    const blockAlign = numChannels * (bitDepth / 8);
    
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);
    
    // Write WAV header
    const writeString = (v, offset, str) => {
      for (let i = 0; i < str.length; i++) {
        v.setUint8(offset + i, str.charCodeAt(i));
      }
    };
    
    writeString(view, 0, 'RIFF');
    view.setUint32(4, chunkSize, true);
    writeString(view, 8, 'WAVE');
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM format
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitDepth, true);
    writeString(view, 36, 'data');
    view.setUint32(40, dataSize, true);
    
    // Synthesize simple audio waveform
    let offset = 44;
    for (let i = 0; i < numSamples; i++) {
      const t = i / sampleRate;
      let decay = Math.exp(-3.5 * t); // decaying envelope
      let val = 0;
      
      if (type === 'kick') {
        // Kick synthesis: fast frequency sweep down
        const f = 150 * Math.exp(-35 * t) + 40;
        val = Math.sin(2 * Math.PI * f * t) * 32767 * Math.exp(-6 * t);
      } else if (type === 'snare') {
        // Snare synthesis: noise + 180Hz body
        const noise = Math.random() * 2 - 1;
        const body = Math.sin(2 * Math.PI * 180 * t) * 0.4;
        val = (noise * 0.6 * Math.exp(-12 * t) + body * Math.exp(-6 * t)) * 32767;
      } else if (type === 'hihat') {
        // Hi-hat synthesis: high-frequency white noise
        const noise = Math.random() * 2 - 1;
        val = noise * 32767 * Math.exp(-40 * t);
      } else {
        // Synth: sine wave
        val = Math.sin(2 * Math.PI * frequency * t) * 32767 * decay;
      }
      
      view.setInt16(offset, Math.max(-32768, Math.min(32767, val)), true);
      offset += 2;
    }
    
    // Base64 encode
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return 'data:audio/wav;base64,' + btoa(binary);
  }

  // Simulated local storage for settings and download tracking in standard browser
  let mockDb = {
    settings: {
      downloadDir: 'C:\\Users\\louis\\Music\\SpliceLibrary',
      presetDir: 'C:\\Users\\louis\\Presets',
      theme: 'dark'
    },
    downloadedSamples: [],
    downloadedPresets: [],
    indexedPacks: []
  };

  const getMockSamples = (query) => {
    const q = (query || 'kick').toLowerCase();
    const mockPacks = ['Neon DnB', 'Cyberpunk Trap', 'Vintage Soul', 'Deep House', 'Lo-Fi Chill', 'Techno Grid'];
    const mockKeys = ['C min', 'G min', 'F maj', 'A# min', 'D min', 'E min', '--'];
    const results = [];
    const instruments = ['kick', 'snare', 'synth', 'lead', 'melody', 'bass', 'sub', 'hihat', 'vocal', 'pad', 'perc', 'loop', 'fx'];
    const matchingInstrument = instruments.find(ins => q.includes(ins)) || 'loop';
    
    for (let i = 1; i <= 12; i++) {
      const pack = mockPacks[i % mockPacks.length];
      const key = mockKeys[i % mockKeys.length];
      const bpm = 80 + (i * 7) % 100;
      
      // Determine synth type for direct browser audio synthesis
      let type = 'sine';
      let freq = 440;
      let duration = '0:01';
      let durationSec = 0.5;

      if (matchingInstrument === 'kick') {
        type = 'kick';
        durationSec = 0.3;
      } else if (matchingInstrument === 'snare') {
        type = 'snare';
        durationSec = 0.25;
      } else if (matchingInstrument === 'hihat') {
        type = 'hihat';
        durationSec = 0.1;
      } else {
        // Melodic notes/loops
        type = 'sine';
        const frequencies = [261.63, 293.66, 329.63, 349.23, 392.00, 440.00, 493.88]; // C4 to B4 major scale
        freq = frequencies[i % frequencies.length];
        if (q.includes('loop') || matchingInstrument === 'loop') {
          duration = '0:04';
          durationSec = 4.0;
        } else {
          durationSec = 0.8;
        }
      }

      // Generate a dynamic, playable data URL beep locally! (100% CORS-free and instant!)
      const previewUrl = generateSynthBeepDataUrl(freq, durationSec, type);
      const name = `${q.toUpperCase()}_${matchingInstrument.toUpperCase()}_${bpm}_${key.replace(' ', '')}_oneshot_${i}.wav`;
      const coverArtUrl = `https://images.unsplash.com/photo-${1618005182384 + (i % 6) * 100}?w=150&auto=format&fit=crop&q=80`;
      results.push({
        id: `browser-mock-sample-${q}-${i}`,
        name: name,
        pack: pack,
        duration: duration,
        key: key,
        bpm: bpm,
        tags: [matchingInstrument, q, 'wav', 'oneshot'],
        source: 'Splice',
        packUuid: `mock-pack-uuid-${(i % 3) + 1}`,
        coverArtUrl: coverArtUrl,
        previewUrl: previewUrl,
        isDownloaded: mockDb.downloadedSamples.includes(`browser-mock-sample-${q}-${i}`)
      });
    }
    return results;
  };

  const getMockPresets = (query) => {
    const q = (query || 'bass').toLowerCase();
    const synths = ['Serum', 'Vital', 'PhasePlant', 'Massive', 'Sylenth1'];
    const categories = ['Bass', 'Lead', 'Pad', 'Pluck', 'Arp', 'FX', 'Sub'];
    const results = [];
    
    for (let i = 1; i <= 8; i++) {
      const synth = synths[i % synths.length];
      const category = categories[i % categories.length];
      
      // Melodic tone for preset demo
      const freq = category.toLowerCase().includes('bass') ? 110 : 330;
      const previewUrl = generateSynthBeepDataUrl(freq, 1.2, 'sine');

      results.push({
        id: `browser-mock-preset-${i}`,
        name: `${synth.toUpperCase()}_${q.toUpperCase()}_${category.toUpperCase()}_${i}`,
        synth: synth,
        category: category,
        creator: `SoundDesignPro_${i}`,
        tags: [synth.toLowerCase(), category.toLowerCase(), q],
        previewUrl: previewUrl,
        downloadUrl: '#',
        isDownloaded: mockDb.downloadedPresets.includes(`browser-mock-preset-${i}`)
      });
    }
    return results;
  };

  const getMockPacks = (query) => {
    const packs = [
      ['Broken Signal', ['UK Garage', 'Vocal', '2-Step'], 184, '~426 MB'],
      ['Soft Focus Drums', ['Indie', 'Drums', 'Texture'], 126, '~310 MB'],
      ['Night Bus', ['Drum & Bass', 'Bass', 'Breaks'], 208, '~512 MB'],
      ['Rubber Rooms', ['Techno', 'Percussion', 'Analog'], 142, '~388 MB'],
      ['Afterimage', ['Ambient', 'Cinematic', 'Field'], 96, '~274 MB'],
      ['Chrome Choir', ['Pop', 'Vocal', 'Synth'], 118, '~346 MB']
    ];
    const needle = (query || '').toLowerCase();
    return packs
      .filter(([name, tags]) => !needle || name.toLowerCase().includes(needle) || tags.some(tag => tag.toLowerCase().includes(needle)))
      .map(([name, tags, itemCount, estimatedStorage], index) => ({
        id: `browser-mock-pack-${index + 1}`,
        uuid: `browser-mock-pack-${index + 1}`,
        name,
        tags,
        itemCount,
        estimatedStorage,
        source: 'Wavely',
        coverArtUrl: '',
        demoUrl: ''
      }));
  };

  window.electron = {
    // Browser-only preview session. The packaged Electron app continues to use
    // the real authenticated bridge from preload.js.
    getAuthState: async () => new URLSearchParams(window.location.search).has('auth')
      ? { isLoggedIn: false, user: null, subscription: { isSubscribed: false, plan: 'none' } }
      : { isLoggedIn: true, user: { username: 'Studio Guest', email: 'preview@wavely.local' }, subscription: { isSubscribed: true, plan: 'monthly_499' } },
    verifySubscription: async () => ({ isSubscribed: true, plan: 'monthly_499' }),
    getLicensingState: async () => ({ status: 'active', isBanned: false }),
    logout: async () => true,
    selectFolder: async () => 'C:\\Users\\louis\\Music\\CustomLibrary',
    startDrag: (filePath) => console.log('Native Drag-and-drop initiated for file:', filePath),
    searchSounds: async (query) => getMockSamples(query || 'featured loops'),
    searchPresets: async (query) => getMockPresets(query || 'synth'),
    searchPacks: async (query) => ({ success: true, packs: getMockPacks(query) }),
    getDownloadedPacks: async () => ({ success: true, packs: [] }),
    onPackDownloadProgress: () => () => {},
    getSettings: async () => mockDb.settings,
    saveSettings: async (settings) => {
      mockDb.settings = { ...mockDb.settings, ...settings };
      return mockDb.settings;
    },
    downloadSample: async (sound) => {
      if (!mockDb.downloadedSamples.includes(sound.id)) {
        mockDb.downloadedSamples.push(sound.id);
      }
      return { success: true, filePath: 'C:\\fake-path\\sample.wav' };
    },
    downloadPreset: async (preset) => {
      if (!mockDb.downloadedPresets.includes(preset.id)) {
        mockDb.downloadedPresets.push(preset.id);
      }
      return { success: true, filePath: 'C:\\fake-path\\preset.vital' };
    },
    downloadAndIndexPack: async (pack) => {
      if (!mockDb.indexedPacks.includes(pack.id)) {
        mockDb.indexedPacks.push(pack.id);
      }
      return { success: true };
    },
    getIndexedPacks: async () => ({
      downloadedCount: mockDb.downloadedSamples.length,
      presetsCount: mockDb.downloadedPresets.length,
      indexedPacks: mockDb.indexedPacks
    }),
    scanLibrary: async () => ({ count: 4, totalIndexed: 14 }),
    openFolder: async () => true,
    captureSpliceAudio: async (url, uuid) => {
      console.log('[Mock] captureSpliceAudio called for:', uuid);
      return { success: false, error: 'Capture not available in browser mode' };
    }
  };
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
