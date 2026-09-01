const { app, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const os = require('os');
const { spawn } = require('child_process');

// --- AUTO UPDATER CONFIGURATION ---
const UPDATER_CONFIG = {
  enabled: true,
  versionUrl: 'https://raw.githubusercontent.com/REAPXR666/Wavely/refs/heads/main/version.json',
  githubToken: null, 
  currentVersion: (app && typeof app.getVersion === 'function') ? app.getVersion() : '1.0.7'
};

let downloadedInstallerPath = null;

function isNewerVersion(current, latest) {
  if (!latest) return false;
  const cParts = (current || '1.0.0').replace(/^v/, '').split('-')[0].split('.').map(Number);
  const lParts = latest.replace(/^v/, '').split('-')[0].split('.').map(Number);
  
  for (let i = 0; i < Math.max(cParts.length, lParts.length); i++) {
    const c = cParts[i] || 0;
    const l = lParts[i] || 0;
    if (l > c) return true;
    if (c > l) return false;
  }
  return false;
}

function fetchJson(url, token, callback) {
  function get(targetUrl) {
    let parsedUrl;
    try {
      parsedUrl = new URL(targetUrl);
    } catch (e) {
      return callback(new Error(`Invalid URL: ${targetUrl}`));
    }

    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method: 'GET',
      headers: {
        'User-Agent': 'Wavely-App',
        'Accept': 'application/json'
      }
    };
    
    if (token && (parsedUrl.hostname.endsWith('github.com') || parsedUrl.hostname.endsWith('githubusercontent.com'))) {
      options.headers['Authorization'] = `token ${token}`;
    }
    
    const client = parsedUrl.protocol === 'https:' ? https : http;
    
    const req = client.get(options, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        let redirectUrl = res.headers.location;
        if (!redirectUrl.startsWith('http://') && !redirectUrl.startsWith('https://')) {
          redirectUrl = new URL(redirectUrl, targetUrl).href;
        }
        return get(redirectUrl);
      }
      
      if (res.statusCode !== 200) {
        return callback(new Error(`Server returned status code ${res.statusCode}`));
      }
      
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          callback(null, json);
        } catch (e) {
          callback(new Error('Failed to parse version JSON response'));
        }
      });
    });

    req.on('error', (err) => { callback(err); });
  }
  
  get(url);
}

function downloadFileWithProgress(url, destPath, token, onProgress, onComplete) {
  const file = fs.createWriteStream(destPath);

  function get(targetUrl) {
    let parsedUrl;
    try {
      parsedUrl = new URL(targetUrl);
    } catch (e) {
      return onComplete(new Error(`Invalid URL: ${targetUrl}`));
    }

    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method: 'GET',
      headers: { 'User-Agent': 'Wavely-App' }
    };
    
    if (token && (parsedUrl.hostname.endsWith('github.com') || parsedUrl.hostname.endsWith('githubusercontent.com'))) {
      options.headers['Authorization'] = `token ${token}`;
    }
    
    const client = parsedUrl.protocol === 'https:' ? https : http;
    
    const req = client.get(options, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        let redirectUrl = res.headers.location;
        if (!redirectUrl.startsWith('http://') && !redirectUrl.startsWith('https://')) {
          redirectUrl = new URL(redirectUrl, targetUrl).href;
        }
        return get(redirectUrl);
      }
      
      if (res.statusCode !== 200) {
        return onComplete(new Error(`Failed to download installer: status code ${res.statusCode}`));
      }
      
      const totalBytes = parseInt(res.headers['content-length'] || '0', 10);
      let receivedBytes = 0;

      res.on('data', (chunk) => {
        receivedBytes += chunk.length;
        if (totalBytes > 0 && onProgress) {
          const percent = Math.min(99, Math.round((receivedBytes / totalBytes) * 100));
          onProgress(percent);
        }
      });

      res.pipe(file);
      
      file.on('finish', () => {
        file.close();
        if (onProgress) onProgress(100);
        onComplete(null, destPath);
      });
    });

    req.on('error', (err) => {
      fs.unlink(destPath, () => {});
      onComplete(err);
    });
  }
  
  get(url);
}

function checkForUpdates(mainWindow) {
  if (!UPDATER_CONFIG.enabled || !mainWindow) return;

  console.log('[Updater] Checking for updates silently...');
  fetchJson(UPDATER_CONFIG.versionUrl, UPDATER_CONFIG.githubToken, (err, updateData) => {
    if (err) {
      console.warn('[Updater] Version check notice:', err.message);
      return;
    }

    if (!updateData || !updateData.version || !updateData.url) return;

    const hasUpdate = isNewerVersion(UPDATER_CONFIG.currentVersion, updateData.version);
    console.log(`[Updater] Current: ${UPDATER_CONFIG.currentVersion}, Latest: ${updateData.version}. Update available: ${hasUpdate}`);

    if (hasUpdate) {
      // Send custom event to React frontend to trigger the confetti celebration popup!
      mainWindow.webContents.send('app-update-available', updateData);
    }
  });
}

function registerUpdateIpc(mainWindow) {
  ipcMain.handle('start-update-download', async (event, updateData) => {
    if (!updateData || !updateData.url) {
      return { success: false, error: 'Invalid update download URL' };
    }

    const tempDir = os.tmpdir();
    const installerName = updateData.installerName || `Wavely-Setup-v${updateData.version || 'latest'}.exe`;
    const destPath = path.join(tempDir, installerName);

    return new Promise((resolve) => {
      downloadFileWithProgress(
        updateData.url, 
        destPath, 
        UPDATER_CONFIG.githubToken,
        (percent) => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('app-update-progress', { percent });
          }
        },
        (err, savedPath) => {
          if (err) {
            resolve({ success: false, error: err.message });
          } else {
            downloadedInstallerPath = savedPath;
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('app-update-ready', { path: savedPath, version: updateData.version });
            }
            resolve({ success: true, path: savedPath });
          }
        }
      );
    });
  });

  ipcMain.handle('install-downloaded-update', async () => {
    if (downloadedInstallerPath && fs.existsSync(downloadedInstallerPath)) {
      if (process.platform === 'win32') {
        const child = spawn(downloadedInstallerPath, [], {
          detached: true,
          stdio: 'ignore'
        });
        child.unref();
        setTimeout(() => app.quit(), 300);
        return { success: true };
      }
    }
    return { success: false, error: 'Installer binary not found' };
  });
}

module.exports = {
  checkForUpdates,
  registerUpdateIpc,
  UPDATER_CONFIG
};
