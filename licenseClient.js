const http = require('http');
const https = require('https');
const path = require('path');
const fs = require('fs');
const { app, safeStorage } = require('electron');
const { getHwidInfo } = require('./hwid');
const { computeIntegrityChecksums } = require('./security');

let serverBaseUrl = 'https://wavely.lol'; // Official production server (https://wavely.lol)
let heartbeatIntervalTimer = null;
let mainWindowRef = null;

const legacySessionFilePath = path.join(__dirname, 'session.json');

function getSessionFilePath() {
  return path.join(app.getPath('userData'), 'session.json');
}

function encodeSessionToken(token) {
  if (!token) return {};
  try {
    if (safeStorage.isEncryptionAvailable()) {
      return { encryptedToken: safeStorage.encryptString(token).toString('base64') };
    }
  } catch (err) {
    console.warn('[Auth] OS-backed token encryption is unavailable:', err.message);
  }
  return { token };
}

function decodeSessionToken(data) {
  if (data?.encryptedToken) {
    try {
      return safeStorage.decryptString(Buffer.from(data.encryptedToken, 'base64'));
    } catch (err) {
      console.warn('[Auth] Saved session could not be decrypted:', err.message);
      return null;
    }
  }
  return data?.token || null;
}

let authState = {
  isLoggedIn: false,
  token: null,
  user: null,
  subscription: {
    isSubscribed: false,
    plan: 'none',
    expiresAt: null
  },
  isBanned: false,
  banReason: '',
  status: 'pending', // 'active' | 'banned' | 'tampered' | 'unsubscribed' | 'offline'
  hwidInfo: null,
  lastChecked: null
};

// Check if user specified custom remote licensing server in licensing.json
const configPath = path.join(__dirname, 'licensing.json');
if (fs.existsSync(configPath)) {
  try {
    const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    if (cfg.serverBaseUrl) serverBaseUrl = cfg.serverBaseUrl;
    else if (cfg.serverEndpoint) serverBaseUrl = cfg.serverEndpoint.replace(/\/api\/.*$/, '');
  } catch (e) {}
}

// Restore the saved session only after Electron is ready. Windows secure
// storage cannot reliably decrypt data while the app module is still loading.
function loadSavedSession() {
  const sessionFilePath = getSessionFilePath();
  const sourcePath = fs.existsSync(sessionFilePath)
    ? sessionFilePath
    : (fs.existsSync(legacySessionFilePath) ? legacySessionFilePath : null);

  if (sourcePath) {
    try {
      const data = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
      const token = decodeSessionToken(data);
      if (token) {
        authState.token = token;
        authState.user = data.user || null;
        authState.subscription = data.subscription || { isSubscribed: false, plan: 'none' };
        authState.isLoggedIn = true;
        console.log(`[Auth] Restored saved session for ${authState.user?.username || 'Wavely user'}.`);

        // Transparently migrate development-era sessions out of the app bundle.
        if (sourcePath === legacySessionFilePath) {
          saveSession(token, authState.user, authState.subscription);
        }
      }
    } catch (err) {
      console.warn('[Auth] Saved session could not be loaded:', err.message);
    }
  }
}

function initializeAuthSession() {
  loadSavedSession();
  return getAuthState();
}

function saveSession(token, user, subscription) {
  authState.token = token;
  authState.user = user;
  authState.subscription = subscription || { isSubscribed: false, plan: 'none' };
  authState.isLoggedIn = !!token;

  try {
    const sessionFilePath = getSessionFilePath();
    const sessionDir = path.dirname(sessionFilePath);
    const tempPath = `${sessionFilePath}.tmp`;
    fs.mkdirSync(sessionDir, { recursive: true });
    fs.writeFileSync(tempPath, JSON.stringify({
      ...encodeSessionToken(token),
      user,
      subscription: authState.subscription,
      savedAt: new Date().toISOString()
    }, null, 2), 'utf8');
    fs.renameSync(tempPath, sessionFilePath);
  } catch (err) {
    console.error('[Auth] Failed to persist session:', err.message);
  }
}

function clearSession() {
  authState.isLoggedIn = false;
  authState.token = null;
  authState.user = null;
  authState.subscription = { isSubscribed: false, plan: 'none', expiresAt: null };

  try {
    const sessionFilePath = getSessionFilePath();
    if (fs.existsSync(sessionFilePath)) fs.unlinkSync(sessionFilePath);
  } catch (err) {
    console.warn('[Auth] Failed to clear saved session:', err.message);
  }
}

function setMainWindow(window) {
  mainWindowRef = window;
}

function postJson(urlStr, data, timeoutMs = 6000) {
  return new Promise((resolve) => {
    try {
      const url = new URL(urlStr);
      const client = url.protocol === 'https:' ? https : http;
      const body = JSON.stringify(data || {});

      const req = client.request({
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname + (url.search || ''),
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          'User-Agent': 'WavelyClient/1.0.6',
          ...(authState.token ? { 'Authorization': `Bearer ${authState.token}` } : {})
        },
        timeout: timeoutMs
      }, (res) => {
        let raw = '';
        res.on('data', chunk => raw += chunk);
        res.on('end', () => {
          try {
            resolve(JSON.parse(raw));
          } catch (err) {
            resolve({ success: false, error: 'Invalid server response' });
          }
        });
      });

      req.on('timeout', () => {
        req.destroy();
        resolve({ success: false, error: 'Server timeout', offline: true });
      });

      req.on('error', (err) => {
        resolve({ success: false, error: err.message, offline: true });
      });

      req.write(body);
      req.end();
    } catch (e) {
      resolve({ success: false, error: e.message, offline: true });
    }
  });
}

function getJson(urlStr, timeoutMs = 6000) {
  return new Promise((resolve) => {
    try {
      const url = new URL(urlStr);
      const client = url.protocol === 'https:' ? https : http;

      const req = client.request({
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname + (url.search || ''),
        method: 'GET',
        headers: {
          'User-Agent': 'WavelyClient/1.0.6'
        },
        timeout: timeoutMs
      }, (res) => {
        let raw = '';
        res.on('data', chunk => raw += chunk);
        res.on('end', () => {
          try {
            resolve(JSON.parse(raw));
          } catch (err) {
            resolve({ success: false, error: 'Invalid server response' });
          }
        });
      });

      req.on('timeout', () => {
        req.destroy();
        resolve({ success: false, error: 'Server timeout', offline: true });
      });

      req.on('error', (err) => {
        resolve({ success: false, error: err.message, offline: true });
      });

      req.end();
    } catch (e) {
      resolve({ success: false, error: e.message, offline: true });
    }
  });
}

/**
 * Fetch dynamic anti-bot captcha from server
 */
async function fetchCaptcha() {
  return await getJson(`${serverBaseUrl}/api/captcha`);
}

/**
 * User Login
 */
async function loginUser(username, password) {
  const res = await postJson(`${serverBaseUrl}/api/auth/login`, { username, password });
  if (res && res.success && res.token) {
    saveSession(res.token, res.user, res.subscription);
    await verifyDevice();
    return { success: true, user: res.user, subscription: res.subscription };
  }
  return { success: false, error: res?.error || 'Login failed. Please check credentials.' };
}

/**
 * User Registration
 */
async function registerUser(username, email, password, captchaToken, captchaAnswer) {
  const res = await postJson(`${serverBaseUrl}/api/auth/register`, {
    username, email, password,
    captcha_token: captchaToken,
    captcha_answer: captchaAnswer
  });
  if (res && res.success && res.token) {
    saveSession(res.token, res.user, res.subscription);
    await verifyDevice();
    return { success: true, user: res.user, subscription: res.subscription };
  }
  return { success: false, error: res?.error || 'Registration failed.' };
}

/**
 * User Logout
 */
function logoutUser() {
  clearSession();
  if (mainWindowRef && !mainWindowRef.isDestroyed()) {
    mainWindowRef.webContents.send('auth-state-changed', { isLoggedIn: false });
  }
}

/**
 * Perform device & subscription verification on launch.
 */
async function verifyDevice(appVersion = '1.0.6') {
  const hwidInfo = getHwidInfo();
  const integrity = computeIntegrityChecksums();
  authState.hwidInfo = hwidInfo;

  if (!authState.token) {
    authState.status = 'unauthenticated';
    return { allowed: false, requiresLogin: true };
  }

  const payload = {
    token: authState.token,
    hwid: hwidInfo.hwid,
    pcName: hwidInfo.pcName,
    username: hwidInfo.username,
    platform: hwidInfo.platform,
    osRelease: hwidInfo.osRelease,
    arch: hwidInfo.arch,
    totalMemoryGB: hwidInfo.totalMemoryGB,
    cpuModel: hwidInfo.cpuModel,
    appVersion: appVersion,
    integritySignature: integrity.signature,
    integrityDetails: integrity.details
  };

  try {
    const res = await postJson(`${serverBaseUrl}/api/license/verify`, payload);
    authState.lastChecked = new Date().toISOString();

    if (res && res.banned) {
      authState.isBanned = true;
      authState.banReason = res.banReason || 'Access suspended by administrator.';
      authState.status = 'banned';
      notifyWindowBanned();
      return { allowed: false, banned: true, reason: authState.banReason };
    }

    if (res && res.success) {
      authState.isBanned = false;
      authState.subscription = {
        isSubscribed: !!res.isSubscribed,
        plan: res.plan || 'none',
        expiresAt: res.expiresAt || null
      };
      authState.status = res.isSubscribed ? 'active' : 'unsubscribed';
      saveSession(authState.token, authState.user, authState.subscription);

      if (mainWindowRef && !mainWindowRef.isDestroyed()) {
        mainWindowRef.webContents.send('subscription-status', authState.subscription);
      }

      return {
        allowed: true,
        isSubscribed: authState.subscription.isSubscribed,
        plan: authState.subscription.plan
      };
    }

    // Unauthorized or invalid token
    if (res && res.error && res.error.includes('Unauthorized')) {
      clearSession();
      return { allowed: false, requiresLogin: true };
    }

    return { allowed: false, isSubscribed: false };
  } catch (err) {
    return { allowed: true, status: 'offline', isSubscribed: authState.subscription.isSubscribed };
  }
}

function notifyWindowBanned() {
  if (mainWindowRef && !mainWindowRef.isDestroyed()) {
    mainWindowRef.webContents.send('device-banned', {
      hwid: authState.hwidInfo?.hwid || 'UNKNOWN-HWID',
      pcName: authState.hwidInfo?.pcName || 'UNKNOWN',
      banReason: authState.banReason,
      timestamp: new Date().toISOString()
    });
  }
}

/**
 * 5-Minute Heartbeat
 */
function startHeartbeat(intervalMs = 5 * 60 * 1000) {
  if (heartbeatIntervalTimer) clearInterval(heartbeatIntervalTimer);

  heartbeatIntervalTimer = setInterval(() => {
    if (authState.isLoggedIn) {
      verifyDevice().catch(console.error);
    }
  }, intervalMs);
}

function getAuthState() {
  return authState;
}

function getLicensingState() {
  return authState;
}

module.exports = {
  setMainWindow,
  initializeAuthSession,
  fetchCaptcha,
  loginUser,
  registerUser,
  logoutUser,
  verifyDevice,
  startHeartbeat,
  getAuthState,
  getLicensingState,
  getHwidInfo
};
