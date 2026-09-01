const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electron', {
  // Folder selector system dialog
  selectFolder: () => ipcRenderer.invoke('select-folder'),

  // DAW Drag and Drop native trigger
  startDrag: (filePath) => ipcRenderer.send('start-drag', filePath),
  prepareLocalAudio: (filePath) => ipcRenderer.invoke('prepare-local-audio', filePath),

  // Search & Scrape operations
  searchSounds: (query, filters) => ipcRenderer.invoke('search-sounds', query, filters),
  searchPresets: (query, filters) => ipcRenderer.invoke('search-presets', query, filters),

  // Settings operations
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),

  // Single sample download (zero-download streams become local)
  downloadSample: (sampleData) => ipcRenderer.invoke('download-sample', sampleData),

  // VST preset download
  downloadPreset: (presetData) => ipcRenderer.invoke('download-preset', presetData),

  // Pack downloader & indexer (Music Radar, 99sounds, Goldbaby, EDMProd, Givemesounds ZIP files)
  downloadAndIndexPack: (packData) => ipcRenderer.invoke('download-pack', packData),
  getIndexedPacks: () => ipcRenderer.invoke('get-indexed-packs'),

  // Manual library folder scanning
  scanLibrary: () => ipcRenderer.invoke('scan-library'),

  // Open an external folder or browser URL
  openFolder: (dirPath) => ipcRenderer.invoke('open-folder', dirPath),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),

  // Splice Audio Capture (hidden browser decode)
  captureSpliceAudio: (scrambledUrl, sampleUuid) => ipcRenderer.invoke('capture-splice-audio', scrambledUrl, sampleUuid),

  // Segment.io Telemetry Tracking
  trackPlay: (soundData) => ipcRenderer.invoke('track-play', soundData),
  trackPage: (pageName) => ipcRenderer.invoke('track-page', pageName),

  // Whole Pack Downloader
  downloadEntirePack: (packData) => ipcRenderer.invoke('download-entire-pack', packData),
  getActiveDownloads: () => ipcRenderer.invoke('get-active-downloads'),
  onPackDownloadProgress: (callback) => {
    const handler = (event, data) => callback(data);
    ipcRenderer.on('pack-download-progress', handler);
    return () => ipcRenderer.removeListener('pack-download-progress', handler);
  },
  removePackDownloadProgressListener: () => ipcRenderer.removeAllListeners('pack-download-progress'),
  cancelPackDownload: (packUuid) => ipcRenderer.invoke('cancel-pack-download', packUuid),

  // Song Starter / Stem Pack Auto-Bundler
  buildSongStarterStems: (seedSound) => ipcRenderer.invoke('build-song-starter-stems', seedSound),
  downloadSongStarter: (starterData) => ipcRenderer.invoke('download-song-starter', starterData),

  // Live Sample Pack Search & Download Management
  searchPacks: (query, page, limit, sortOption) => ipcRenderer.invoke('search-packs', query, page, limit, sortOption),
  getPackDemoAudio: (demoData) => ipcRenderer.invoke('get-pack-demo-audio', demoData),
  getDownloadedPacks: () => ipcRenderer.invoke('get-downloaded-packs'),
  openPackFolder: (folderPath) => ipcRenderer.invoke('open-pack-folder', folderPath),
  removeDownloadedPack: (uuid) => ipcRenderer.invoke('remove-downloaded-pack', uuid),

  // Save Certificate PDF with native Save As dialog
  saveCertificatePdf: (data) => ipcRenderer.invoke('save-certificate-pdf', data),

  // VST3 DAW Plugin & Local Bridge
  getVstStatus: () => ipcRenderer.invoke('get-vst-status'),
  installVstPlugin: (customPath) => ipcRenderer.invoke('install-vst-plugin', customPath),
  openVstFolder: () => ipcRenderer.invoke('open-vst-folder'),

  // Mini DAW Dock Mode
  setMiniDockMode: (enabled) => ipcRenderer.invoke('set-mini-dock-mode', enabled),
  onMiniDockStateChanged: (callback) => {
    const handler = (event, data) => callback(data);
    ipcRenderer.on('mini-dock-state-changed', handler);
    return () => ipcRenderer.removeListener('mini-dock-state-changed', handler);
  },

  // Local AI Demucs Stem Separation
  separateAudioStems: (data) => ipcRenderer.invoke('separate-audio-stems', data),
  openStemsFolder: (dirPath) => ipcRenderer.invoke('open-stems-folder', dirPath),
  onDemucsProgress: (callback) => {
    const handler = (event, data) => callback(data);
    ipcRenderer.on('demucs-progress', handler);
    return () => ipcRenderer.removeListener('demucs-progress', handler);
  },

  // Security, HWID & Licensing Telemetry
  getLicensingState: () => ipcRenderer.invoke('get-licensing-state'),
  getAuthState: () => ipcRenderer.invoke('get-auth-state'),
  login: (username, password) => ipcRenderer.invoke('auth-login', username, password),
  register: (username, email, password, captchaToken, captchaAnswer) => ipcRenderer.invoke('auth-register', username, email, password, captchaToken, captchaAnswer),
  logout: () => ipcRenderer.invoke('auth-logout'),
  getCaptcha: () => ipcRenderer.invoke('get-captcha'),
  verifySubscription: () => ipcRenderer.invoke('verify-subscription'),
  onSubscriptionStatus: (callback) => {
    const handler = (event, data) => callback(data);
    ipcRenderer.on('subscription-status', handler);
    return () => ipcRenderer.removeListener('subscription-status', handler);
  },
  onAuthStateChanged: (callback) => {
    const handler = (event, data) => callback(data);
    ipcRenderer.on('auth-state-changed', handler);
    return () => ipcRenderer.removeListener('auth-state-changed', handler);
  },
  onDeviceBanned: (callback) => {
    const handler = (event, data) => callback(data);
    ipcRenderer.on('device-banned', handler);
    return () => ipcRenderer.removeListener('device-banned', handler);
  }
});
