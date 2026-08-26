const os = require('os');
const crypto = require('crypto');
const { execSync } = require('child_process');

let cachedHwidInfo = null;

function getWindowsMachineGuid() {
  try {
    const output = execSync('reg query "HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Cryptography" /v MachineGuid', {
      encoding: 'utf8',
      timeout: 3000,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'ignore']
    });
    const match = output.match(/MachineGuid\s+REG_SZ\s+([a-zA-Z0-9-]+)/i);
    if (match && match[1]) {
      return match[1].trim();
    }
  } catch (e) {}
  return null;
}

function getSystemUuid() {
  try {
    const output = execSync('wmic csproduct get uuid', {
      encoding: 'utf8',
      timeout: 3000,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'ignore']
    });
    const lines = output.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (lines.length > 1 && lines[1] && lines[1].toLowerCase() !== 'uuid') {
      return lines[1];
    }
  } catch (e) {}
  return null;
}

function getCpuIdentifier() {
  const cpus = os.cpus();
  if (cpus && cpus.length > 0) {
    return `${cpus[0].model.trim()}_${cpus.length}`;
  }
  return 'GENERIC_CPU';
}

function getPrimaryMacAddress() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const net of interfaces[name]) {
      if (!net.internal && net.mac && net.mac !== '00:00:00:00:00:00') {
        return net.mac.toUpperCase();
      }
    }
  }
  return 'NO_MAC';
}

function getHwidInfo() {
  if (cachedHwidInfo) return cachedHwidInfo;

  const machineGuid = getWindowsMachineGuid() || 'NO_MACHINE_GUID';
  const sysUuid = getSystemUuid() || 'NO_SYS_UUID';
  const cpuId = getCpuIdentifier();
  const mac = getPrimaryMacAddress();
  const hostname = os.hostname() || 'UNKNOWN_HOST';
  const username = os.userInfo ? os.userInfo().username : 'UNKNOWN_USER';

  // Hardware raw string composite
  const rawFingerprint = `${machineGuid}|${sysUuid}|${cpuId}|${mac}|${hostname}`;

  // Private cryptographic salt
  const salt = 'WAVELY_ENTERPRISE_HWID_SECRET_SALT_2026_V1';
  const fullHash = crypto.createHash('sha256').update(rawFingerprint + salt).digest('hex').toUpperCase();

  // Clean 20-character product HWID: XXXX-XXXX-XXXX-XXXX-XXXX
  const formattedHwid = fullHash.match(/.{1,4}/g).slice(0, 5).join('-');

  cachedHwidInfo = {
    hwid: formattedHwid,
    fullHash: fullHash,
    pcName: hostname,
    username: username,
    platform: os.platform(),
    osRelease: os.release(),
    arch: os.arch(),
    totalMemoryGB: Math.round(os.totalmem() / (1024 * 1024 * 1024)),
    cpuModel: (os.cpus() && os.cpus().length > 0) ? os.cpus()[0].model.trim() : 'Unknown CPU',
    macAddress: mac,
    machineGuidSnippet: machineGuid.slice(0, 8),
    generatedAt: new Date().toISOString()
  };

  return cachedHwidInfo;
}

module.exports = {
  getHwidInfo
};
