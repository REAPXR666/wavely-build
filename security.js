const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * Calculates SHA-256 integrity checksum of key runtime files.
 */
function computeIntegrityChecksums() {
  const checksums = {};
  const filesToCheck = [
    'main.js',
    'preload.js',
    'hwid.js',
    path.join('dist', 'index.html')
  ];

  for (const rel of filesToCheck) {
    const abs = path.join(__dirname, rel);
    if (fs.existsSync(abs)) {
      try {
        const fileBuf = fs.readFileSync(abs);
        checksums[rel] = crypto.createHash('sha256').update(fileBuf).digest('hex').slice(0, 16);
      } catch (e) {
        checksums[rel] = 'ERR_READ';
      }
    } else {
      checksums[rel] = 'NOT_FOUND';
    }
  }

  const combined = Object.values(checksums).join(':');
  const signature = crypto.createHash('sha256').update(combined).digest('hex').toUpperCase();

  return {
    signature,
    details: checksums
  };
}

/**
 * Applies security restrictions to BrowserWindow to block inspect, DevTools, and tampering.
 */
function applyWindowSecurity(window, isDev = false) {
  if (!window || window.isDestroyed()) return;

  if (!isDev) {
    // 1. Block DevTools keyboard shortcuts (F12, Ctrl+Shift+I, Ctrl+Shift+J, Ctrl+U)
    window.webContents.on('before-input-event', (event, input) => {
      if (input.type === 'keyDown') {
        const isF12 = input.key === 'F12';
        const isInspect = (input.control || input.meta) && input.shift && (input.key.toLowerCase() === 'i' || input.key.toLowerCase() === 'j' || input.key.toLowerCase() === 'c');
        const isViewSource = (input.control || input.meta) && input.key.toLowerCase() === 'u';
        const isHardReload = (input.control || input.meta) && input.key.toLowerCase() === 'r';

        if (isF12 || isInspect || isViewSource) {
          event.preventDefault();
        }
      }
    });

    // 2. Prevent opening new windows / unauthorized web navigations
    window.webContents.setWindowOpenHandler(({ url }) => {
      // Allow external links in standard browser
      if (url.startsWith('http:') || url.startsWith('https:')) {
        require('electron').shell.openExternal(url);
      }
      return { action: 'deny' };
    });

    // 3. Block DevTools from opening programmatically
    window.webContents.on('devtools-opened', () => {
      window.webContents.closeDevTools();
    });
  }
}

module.exports = {
  computeIntegrityChecksums,
  applyWindowSecurity
};
