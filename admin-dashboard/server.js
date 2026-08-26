const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const crypto = require('crypto');

const PORT = process.env.PORT || process.argv[2] || 4000;
const DB_FILE = path.join(__dirname, 'devices.json');
const CONFIG_FILE = path.join(__dirname, 'admin-config.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

// --- ADMIN CONFIGURATION & AUTHENTICATION ---
let adminConfig = {
  adminPasswordHash: '',
  salt: '',
  sessionTimeoutHours: 24,
  bindLocalhostOnly: false,
  allowedAdminIps: []
};

// Active authenticated admin sessions: { [token]: { createdAt, expiresAt, ip } }
const activeSessions = new Map();

// Rate limiting for login attempts: { [ip]: { attempts, lockUntil } }
const loginRateLimits = new Map();

function hashPassword(password, salt) {
  return crypto.createHash('sha256').update(password + salt).digest('hex');
}

function loadAdminConfig() {
  if (fs.existsSync(CONFIG_FILE)) {
    try {
      adminConfig = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    } catch (e) {
      console.error('Failed to parse admin-config.json:', e.message);
    }
  }

  // If no password set yet, initialize default master password: 'admin'
  if (!adminConfig.adminPasswordHash || !adminConfig.salt) {
    adminConfig.salt = crypto.randomBytes(16).toString('hex');
    adminConfig.adminPasswordHash = hashPassword('admin', adminConfig.salt);
    saveAdminConfig();
    console.log(`[SECURITY] Initialized default Admin Password: 'admin' (Change this in the dashboard or admin-config.json)`);
  }
}

function saveAdminConfig() {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(adminConfig, null, 2), 'utf8');
  } catch (e) {
    console.error('Failed to save admin-config.json:', e.message);
  }
}

loadAdminConfig();

// In-Memory Database with JSON File Persistence
let db = {
  devices: {}, // { [hwid]: { ... } }
  bannedIps: {} // { [ip]: { reason, timestamp } }
};

function loadDb() {
  if (fs.existsSync(DB_FILE)) {
    try {
      db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
      if (!db.devices) db.devices = {};
      if (!db.bannedIps) db.bannedIps = {};
    } catch (e) {
      console.error('Failed to parse devices database:', e.message);
    }
  }
}

function saveDb() {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
  } catch (e) {
    console.error('Failed to save devices database:', e.message);
  }
}

loadDb();

// Helper to extract clean client IP
function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  let ip = forwarded ? forwarded.split(',')[0].trim() : req.socket.remoteAddress;
  if (ip === '::1' || ip === '::ffff:127.0.0.1') ip = '127.0.0.1';
  return ip;
}

function parseJsonBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        resolve(JSON.parse(body || '{}'));
      } catch (e) {
        resolve({});
      }
    });
  });
}

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-admin-token'
  });
  res.end(JSON.stringify(data));
}

function verifyAdminAuth(req) {
  const authHeader = req.headers['authorization'] || '';
  const customHeader = req.headers['x-admin-token'] || '';
  let token = '';

  if (authHeader.startsWith('Bearer ')) {
    token = authHeader.slice(7).trim();
  } else if (customHeader) {
    token = customHeader.trim();
  }

  if (!token) return false;

  const session = activeSessions.get(token);
  if (!session) return false;

  if (Date.now() > session.expiresAt) {
    activeSessions.delete(token);
    return false;
  }

  return true;
}

function serveStaticFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'text/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml'
  };
  const contentType = mimeTypes[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 Not Found');
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content);
  });
}

const server = http.createServer(async (req, res) => {
  // CORS Preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-admin-token'
    });
    return res.end();
  }

  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;
  const clientIp = getClientIp(req);

  // ==========================================
  // 1. PUBLIC CLIENT LICENSING HEARTBEAT (Open to app clients)
  // ==========================================
  if (pathname === '/api/license/heartbeat' && req.method === 'POST') {
    const data = await parseJsonBody(req);
    if (!data || !data.hwid) {
      return sendJson(res, 400, { success: false, error: 'Missing hardware identifier (HWID)' });
    }

    const hwid = data.hwid;
    const now = new Date().toISOString();

    // Check if IP is banned
    if (db.bannedIps[clientIp]) {
      return sendJson(res, 200, {
        success: true,
        status: 'banned',
        banReason: db.bannedIps[clientIp].reason || 'Your IP address has been banned by the administrator.',
        ip: clientIp
      });
    }

    let device = db.devices[hwid];
    if (!device) {
      device = {
        hwid: hwid,
        fullHash: data.fullHash || '',
        pcName: data.pcName || 'UNKNOWN_PC',
        username: data.username || 'UNKNOWN_USER',
        platform: data.platform || 'win32',
        osRelease: data.osRelease || '',
        arch: data.arch || 'x64',
        totalMemoryGB: data.totalMemoryGB || 0,
        cpuModel: data.cpuModel || '',
        appVersion: data.appVersion || '1.0.0',
        ip: clientIp,
        status: 'active',
        banReason: '',
        firstSeen: now,
        lastSeen: now,
        totalHeartbeats: 1,
        tamperFlag: false,
        integritySignature: data.integritySignature || ''
      };
      db.devices[hwid] = device;
      console.log(`[NEW DEVICE REGISTERED] ${device.pcName} (${device.username}) | HWID: ${device.hwid} | IP: ${clientIp}`);
    } else {
      device.pcName = data.pcName || device.pcName;
      device.username = data.username || device.username;
      device.ip = clientIp;
      device.appVersion = data.appVersion || device.appVersion;
      device.lastSeen = now;
      device.totalHeartbeats = (device.totalHeartbeats || 0) + 1;
      device.integritySignature = data.integritySignature || device.integritySignature;
      console.log(`[HEARTBEAT] ${device.pcName} (${device.username}) | HWID: ${device.hwid} | Status: ${device.status}`);
    }

    saveDb();

    if (device.status === 'banned') {
      return sendJson(res, 200, {
        success: true,
        status: 'banned',
        banReason: device.banReason || 'Your device has been banned by the administrator.',
        hwid: device.hwid
      });
    }

    if (device.status === 'tampered' || device.tamperFlag) {
      return sendJson(res, 200, {
        success: true,
        status: 'tampered',
        banReason: 'Unauthorized binary modifications detected (Crack/Tamper Security Flag).'
      });
    }

    return sendJson(res, 200, {
      success: true,
      status: 'active',
      hwid: device.hwid,
      serverTime: now
    });
  }

  // ==========================================
  // 2. ADMIN AUTHENTICATION ENDPOINTS
  // ==========================================

  // Admin Login
  if (pathname === '/api/admin/login' && req.method === 'POST') {
    // Rate limit check
    const rateLimit = loginRateLimits.get(clientIp);
    if (rateLimit && rateLimit.lockUntil > Date.now()) {
      const waitSecs = Math.ceil((rateLimit.lockUntil - Date.now()) / 1000);
      return sendJson(res, 429, { success: false, error: `Too many failed attempts. Try again in ${waitSecs}s.` });
    }

    const { password } = await parseJsonBody(req);
    const expectedHash = hashPassword(password || '', adminConfig.salt);

    if (expectedHash === adminConfig.adminPasswordHash) {
      // Successful login -> Clear rate limit
      loginRateLimits.delete(clientIp);

      // Generate cryptographically secure session token
      const sessionToken = crypto.randomBytes(32).toString('hex');
      const timeoutMs = (adminConfig.sessionTimeoutHours || 24) * 60 * 60 * 1000;
      activeSessions.set(sessionToken, {
        createdAt: Date.now(),
        expiresAt: Date.now() + timeoutMs,
        ip: clientIp
      });

      console.log(`[ADMIN LOGIN SUCCESS] IP: ${clientIp}`);
      return sendJson(res, 200, {
        success: true,
        token: sessionToken,
        expiresIn: timeoutMs,
        message: 'Admin authentication successful'
      });
    } else {
      // Failed attempt tracking
      const record = rateLimit || { attempts: 0, lockUntil: 0 };
      record.attempts += 1;
      if (record.attempts >= 5) {
        record.lockUntil = Date.now() + 15 * 60 * 1000; // 15 minute lock
        console.warn(`[ADMIN LOGIN BLOCKED] IP ${clientIp} exceeded max attempts. Locked for 15m.`);
      }
      loginRateLimits.set(clientIp, record);

      return sendJson(res, 401, { success: false, error: 'Incorrect master password' });
    }
  }

  // Admin Verify Session Token
  if (pathname === '/api/admin/verify-session' && req.method === 'GET') {
    const isAuthed = verifyAdminAuth(req);
    return sendJson(res, 200, { success: isAuthed });
  }

  // Admin Change Master Password
  if (pathname === '/api/admin/change-password' && req.method === 'POST') {
    if (!verifyAdminAuth(req)) {
      return sendJson(res, 401, { success: false, error: 'Unauthorized: Admin authentication required.' });
    }

    const { currentPassword, newPassword } = await parseJsonBody(req);
    const currentHash = hashPassword(currentPassword || '', adminConfig.salt);

    if (currentHash !== adminConfig.adminPasswordHash) {
      return sendJson(res, 400, { success: false, error: 'Current password does not match.' });
    }

    if (!newPassword || newPassword.length < 4) {
      return sendJson(res, 400, { success: false, error: 'New password must be at least 4 characters.' });
    }

    adminConfig.salt = crypto.randomBytes(16).toString('hex');
    adminConfig.adminPasswordHash = hashPassword(newPassword, adminConfig.salt);
    saveAdminConfig();

    console.log(`[ADMIN PASSWORD CHANGED] Master password updated successfully by IP: ${clientIp}`);
    return sendJson(res, 200, { success: true, message: 'Master password updated successfully.' });
  }

  // Admin Logout
  if (pathname === '/api/admin/logout' && req.method === 'POST') {
    const authHeader = req.headers['authorization'] || '';
    const customHeader = req.headers['x-admin-token'] || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : customHeader.trim();
    if (token) activeSessions.delete(token);
    return sendJson(res, 200, { success: true });
  }

  // ==========================================
  // 3. PROTECTED ADMIN MANAGEMENT APIS
  // (All require valid admin token)
  // ==========================================

  if (pathname.startsWith('/api/admin/')) {
    if (!verifyAdminAuth(req)) {
      return sendJson(res, 401, { success: false, error: 'Unauthorized: Admin authentication required.' });
    }

    // Get all devices
    if (pathname === '/api/admin/devices' && req.method === 'GET') {
      const devicesList = Object.values(db.devices);
      const now = Date.now();

      const onlineCount = devicesList.filter(d => {
        if (!d.lastSeen) return false;
        const diff = now - new Date(d.lastSeen).getTime();
        return diff < 30 * 60 * 1000 && d.status === 'active';
      }).length;

      const bannedCount = devicesList.filter(d => d.status === 'banned').length;
      const tamperedCount = devicesList.filter(d => d.status === 'tampered' || d.tamperFlag).length;

      return sendJson(res, 200, {
        success: true,
        stats: {
          totalDevices: devicesList.length,
          onlineDevices: onlineCount,
          bannedDevices: bannedCount,
          tamperAlerts: tamperedCount,
          bannedIpsCount: Object.keys(db.bannedIps).length
        },
        devices: devicesList.sort((a, b) => new Date(b.lastSeen) - new Date(a.lastSeen)),
        bannedIps: db.bannedIps
      });
    }

    // Ban Device
    if (pathname === '/api/admin/ban' && req.method === 'POST') {
      const { hwid, reason } = await parseJsonBody(req);
      if (!hwid) return sendJson(res, 400, { success: false, error: 'Missing HWID' });

      if (db.devices[hwid]) {
        db.devices[hwid].status = 'banned';
        db.devices[hwid].banReason = reason || 'Access revoked by administrator.';
        saveDb();
        console.log(`[BAN] Device ${hwid} (${db.devices[hwid].pcName}) banned. Reason: ${reason}`);
        return sendJson(res, 200, { success: true, message: `Device ${hwid} banned successfully.`, device: db.devices[hwid] });
      }

      db.devices[hwid] = {
        hwid: hwid,
        pcName: 'Pre-emptive Ban',
        username: 'N/A',
        status: 'banned',
        banReason: reason || 'Access revoked by administrator.',
        firstSeen: new Date().toISOString(),
        lastSeen: new Date().toISOString()
      };
      saveDb();
      return sendJson(res, 200, { success: true, message: `Pre-emptive ban created for HWID ${hwid}.` });
    }

    // Unban Device
    if (pathname === '/api/admin/unban' && req.method === 'POST') {
      const { hwid } = await parseJsonBody(req);
      if (!hwid) return sendJson(res, 400, { success: false, error: 'Missing HWID' });

      if (db.devices[hwid]) {
        db.devices[hwid].status = 'active';
        db.devices[hwid].banReason = '';
        saveDb();
        console.log(`[UNBAN] Device ${hwid} unbanned.`);
        return sendJson(res, 200, { success: true, message: `Device ${hwid} unbanned successfully.` });
      }

      return sendJson(res, 404, { success: false, error: 'Device not found' });
    }

    // Ban IP
    if (pathname === '/api/admin/ban-ip' && req.method === 'POST') {
      const { ip, reason } = await parseJsonBody(req);
      if (!ip) return sendJson(res, 400, { success: false, error: 'Missing IP address' });

      db.bannedIps[ip] = {
        reason: reason || 'IP address banned by administrator.',
        bannedAt: new Date().toISOString()
      };

      Object.values(db.devices).forEach(d => {
        if (d.ip === ip) {
          d.status = 'banned';
          d.banReason = reason || 'IP address banned by administrator.';
        }
      });

      saveDb();
      console.log(`[BAN IP] IP ${ip} banned.`);
      return sendJson(res, 200, { success: true, message: `IP ${ip} banned successfully.` });
    }

    // Unban IP
    if (pathname === '/api/admin/unban-ip' && req.method === 'POST') {
      const { ip } = await parseJsonBody(req);
      if (!ip) return sendJson(res, 400, { success: false, error: 'Missing IP address' });

      delete db.bannedIps[ip];
      saveDb();
      console.log(`[UNBAN IP] IP ${ip} unbanned.`);
      return sendJson(res, 200, { success: true, message: `IP ${ip} unbanned.` });
    }

    // Reset database
    if (pathname === '/api/admin/reset' && req.method === 'POST') {
      db.devices = {};
      db.bannedIps = {};
      saveDb();
      return sendJson(res, 200, { success: true, message: 'Database reset successfully.' });
    }
  }

  // ==========================================
  // 4. SERVE STATIC FILES (Admin UI)
  // ==========================================
  let safePath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const filePath = path.join(PUBLIC_DIR, safePath);

  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    serveStaticFile(res, filePath);
  } else {
    const fallbackPath = path.join(PUBLIC_DIR, 'index.html');
    if (fs.existsSync(fallbackPath)) {
      serveStaticFile(res, fallbackPath);
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 Not Found');
    }
  }
});

server.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(`🛡️  Wavely Admin & License Control Server is LIVE!`);
  console.log(`📍 Web Dashboard:  http://localhost:${PORT}`);
  console.log(`🔌 Client API:     http://localhost:${PORT}/api/license/heartbeat`);
  console.log(`🔐 Master Auth:    Password Protected (Default: 'admin')`);
  console.log(`=======================================================`);
});
