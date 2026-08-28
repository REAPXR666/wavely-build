const os = require('os');
const crypto = require('crypto');

let cachedHwidInfo = null;

function getPrimaryMacAddress() {
  try {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      for (const net of interfaces[name]) {
        if (!net.internal && net.mac && net.mac !== '00:00:00:00:00:00') {
          return net.mac.toUpperCase();
        }
      }
    }
  } catch (e) {}
  return 'NO_MAC';
}

function getCpuIdentifier() {
  try {
    const cpus = os.cpus();
    if (cpus && cpus.length > 0) {
      return `${cpus[0].model.trim()}_${cpus.length}`;
    }
  } catch (e) {}
  return process.env.PROCESSOR_IDENTIFIER || 'GENERIC_CPU';
}

function getHwidInfo() {
  if (cachedHwidInfo) return cachedHwidInfo;

  const hostname = os.hostname() || process.env.COMPUTERNAME || 'UNKNOWN_HOST';
  const username = (os.userInfo ? os.userInfo().username : null) || process.env.USERNAME || 'UNKNOWN_USER';
  const cpuId = getCpuIdentifier();
  const mac = getPrimaryMacAddress();
  const platform = os.platform();
  const arch = os.arch();
  const homedir = os.homedir() || '';

  // Hardware raw string composite (Zero execSync, Zero child process lag, 100% instant in-memory calculation)
  const rawFingerprint = `${platform}|${arch}|${hostname}|${username}|${cpuId}|${mac}|${homedir}`;

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
    platform: platform,
    osRelease: os.release(),
    arch: arch,
    totalMemoryGB: Math.round(os.totalmem() / (1024 * 1024 * 1024)),
    cpuModel: (os.cpus() && os.cpus().length > 0) ? os.cpus()[0].model.trim() : 'Unknown CPU',
    macAddress: mac,
    generatedAt: new Date().toISOString()
  };

  return cachedHwidInfo;
}

module.exports = {
  getHwidInfo
};
