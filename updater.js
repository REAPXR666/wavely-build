const { dialog, app } = require('electron');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const os = require('os');
const { spawn } = require('child_process');

// --- AUTO UPDATER CONFIGURATION ---
const UPDATER_CONFIG = {
  enabled: true,
  // URL to check the version JSON file.
  versionUrl: 'https://raw.githubusercontent.com/REAPXR666/Wavely/refs/heads/main/version.json',
  
  // GitHub Personal Access Token (PAT).
  // Leave empty/null for public repositories.
  githubToken: null, 
  
  // Current app version (hardcoded).
  currentVersion: '1.0.6'
};

/**
 * Semver helper to check if latest version is newer than current version.
 * Supports strings like "v1.1.0" or "1.1" or "2.0.3-alpha".
 */
function isNewerVersion(current, latest) {
  const cParts = current.replace(/^v/, '').split('-')[0].split('.').map(Number);
  const lParts = latest.replace(/^v/, '').split('-')[0].split('.').map(Number);
  
  for (let i = 0; i < Math.max(cParts.length, lParts.length); i++) {
    const c = cParts[i] || 0;
    const l = lParts[i] || 0;
    if (l > c) return true;
    if (c > l) return false;
  }
  return false;
}

/**
 * Fetch a JSON payload from a remote URL, with redirect-handling and token authentication.
 */
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
    
    // Only attach GitHub token if requesting from GitHub domains
    if (token && (parsedUrl.hostname.endsWith('github.com') || parsedUrl.hostname.endsWith('githubusercontent.com'))) {
      options.headers['Authorization'] = `token ${token}`;
    }
    
    const client = parsedUrl.protocol === 'https:' ? https : http;
    
    const req = client.get(options, (res) => {
      // Handle redirects
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
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          callback(null, json);
        } catch (e) {
          callback(new Error('Failed to parse version JSON response'));
        }
      });
    });

    req.on('error', (err) => {
      callback(err);
    });
  }
  
  get(url);
}

/**
 * Download a file with redirect-handling and authentication headers, stripping token on third-party hostnames (like S3 redirects).
 */
function downloadFile(url, destPath, token, callback) {
  const file = fs.createWriteStream(destPath);

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
        'User-Agent': 'Wavely-App'
      }
    };
    
    // Only attach GitHub token if target is github.com or githubusercontent.com
    if (token && (parsedUrl.hostname.endsWith('github.com') || parsedUrl.hostname.endsWith('githubusercontent.com'))) {
      options.headers['Authorization'] = `token ${token}`;
    }
    
    const client = parsedUrl.protocol === 'https:' ? https : http;
    
    const req = client.get(options, (res) => {
      // Handle redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        let redirectUrl = res.headers.location;
        if (!redirectUrl.startsWith('http://') && !redirectUrl.startsWith('https://')) {
          redirectUrl = new URL(redirectUrl, targetUrl).href;
        }
        return get(redirectUrl);
      }
      
      if (res.statusCode !== 200) {
        return callback(new Error(`Failed to download installer: status code ${res.statusCode}`));
      }
      
      res.pipe(file);
      
      file.on('finish', () => {
        file.close();
        callback(null);
      });
    });

    req.on('error', (err) => {
      fs.unlink(destPath, () => {}); // Clean up temp file
      callback(err);
    });
  }
  
  get(url);
}

/**
 * Triggers updater sequence.
 */
function checkForUpdates(mainWindow) {
  if (!UPDATER_CONFIG.enabled) return;

  console.log('[Updater] Checking for updates...');
  fetchJson(UPDATER_CONFIG.versionUrl, UPDATER_CONFIG.githubToken, (err, updateData) => {
    if (err) {
      console.error('[Updater] Version check failed:', err.message);
      return;
    }

    if (!updateData || !updateData.version || !updateData.url) {
      console.warn('[Updater] Invalid version.json content.');
      return;
    }

    const hasUpdate = isNewerVersion(UPDATER_CONFIG.currentVersion, updateData.version);
    console.log(`[Updater] Current: ${UPDATER_CONFIG.currentVersion}, Latest: ${updateData.version}. Update available: ${hasUpdate}`);

    if (hasUpdate) {
      // Prompt user
      const dialogOpts = {
        type: 'info',
        buttons: ['Update Now', 'Later'],
        defaultId: 0,
        cancelId: 1,
        title: 'Wavely Update Available',
        message: `A new version (v${updateData.version}) of Wavely is available.`,
        detail: updateData.notes 
          ? `Release Notes:\n${updateData.notes}\n\nDo you want to download and install it now?`
          : 'Do you want to download and install it now?'
      };

      // Display popup dialog
      dialog.showMessageBox(mainWindow, dialogOpts).then((returnValue) => {
        if (returnValue.response === 0) {
          // User clicked Update Now
          console.log('[Updater] User confirmed update. Starting download...');
          
          const tempDir = os.tmpdir();
          // Keep naming consistent or dynamic
          const installerName = updateData.installerName || 'Wavely-Setup.exe';
          const destPath = path.join(tempDir, installerName);

          // Prompt user that download is in progress
          dialog.showMessageBox(mainWindow, {
            type: 'info',
            title: 'Downloading Update',
            message: 'Downloading Wavely update in the background...',
            detail: 'The application will notify you and launch the installer once the download completes.',
            buttons: ['OK']
          });

          downloadFile(updateData.url, destPath, UPDATER_CONFIG.githubToken, (downloadErr) => {
            if (downloadErr) {
              console.error('[Updater] Installer download failed:', downloadErr.message);
              dialog.showErrorBox(
                'Update Failed',
                `Failed to download the update installer:\n${downloadErr.message}`
              );
              return;
            }

            console.log('[Updater] Download complete. Executing installer:', destPath);
            
            // Confirm install execution
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'Ready to Install',
              message: 'The update download is complete.',
              detail: 'The app will now close, and the update installer will launch automatically.',
              buttons: ['Launch Installer']
            }).then(() => {
              if (process.platform === 'win32') {
                // Spawn installer detached so it lives beyond the app close
                const child = spawn(destPath, [], {
                  detached: true,
                  stdio: 'ignore'
                });
                child.unref();
                app.quit();
              } else {
                console.warn('[Updater] Auto-install only supported on Windows. Manual execution required.');
                dialog.showMessageBox(mainWindow, {
                  type: 'warning',
                  title: 'Manual Installation Required',
                  message: `Installer saved to ${destPath}`,
                  detail: 'Please run the installer manually to complete the update.',
                  buttons: ['OK']
                });
              }
            });
          });
        }
      });
    }
  });
}

module.exports = {
  checkForUpdates,
  UPDATER_CONFIG
};
