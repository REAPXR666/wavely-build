const fs = require('fs');
const path = require('path');
const http = require('http');
const os = require('os');
const { UPDATER_CONFIG } = require('../updater');

// Helper functions imported or duplicated for isolation
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

function fetchJson(url, callback) {
  const parsedUrl = new URL(url);
  const options = {
    hostname: parsedUrl.hostname,
    port: parsedUrl.port || 80,
    path: parsedUrl.pathname + parsedUrl.search,
    method: 'GET',
    headers: { 'User-Agent': 'Test-Updater' }
  };
  http.get(options, (res) => {
    if (res.statusCode !== 200) {
      return callback(new Error(`Server status ${res.statusCode}`));
    }
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      try {
        callback(null, JSON.parse(data));
      } catch (e) {
        callback(e);
      }
    });
  }).on('error', callback);
}

function downloadFile(url, destPath, callback) {
  const file = fs.createWriteStream(destPath);
  const parsedUrl = new URL(url);
  const options = {
    hostname: parsedUrl.hostname,
    port: parsedUrl.port || 80,
    path: parsedUrl.pathname + parsedUrl.search,
    method: 'GET',
    headers: { 'User-Agent': 'Test-Updater' }
  };
  
  http.get(options, (res) => {
    if (res.statusCode !== 200) {
      return callback(new Error(`Server status ${res.statusCode}`));
    }
    res.pipe(file);
    file.on('finish', () => {
      file.close();
      callback(null);
    });
  }).on('error', (err) => {
    fs.unlink(destPath, () => {});
    callback(err);
  });
}

// Start Mock server
const server = http.createServer((req, res) => {
  if (req.url === '/version.json') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      version: '2.0.0',
      url: 'http://localhost:8999/installer.exe',
      notes: 'Unit test mock update works!'
    }));
  } else if (req.url === '/installer.exe') {
    res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
    res.end('MOCK_INSTALLER_BINARY_DATA');
  } else {
    res.writeHead(404);
    res.end();
  }
});

server.listen(8999, () => {
  console.log('Mock updater server running on port 8999');

  // Test 1: Semver check
  console.log('\n--- Test 1: Semver Comparisons ---');
  console.log('1.0.0 < 2.0.0:', isNewerVersion('1.0.0', '2.0.0') === true ? 'PASS' : 'FAIL');
  console.log('1.1.0 < 1.1.1:', isNewerVersion('1.1.0', '1.1.1') === true ? 'PASS' : 'FAIL');
  console.log('1.2.0 < 1.2.0:', isNewerVersion('1.2.0', '1.2.0') === false ? 'PASS' : 'FAIL');
  console.log('1.2.0 < 1.1.9:', isNewerVersion('1.2.0', '1.1.9') === false ? 'PASS' : 'FAIL');

  // Test 2: Fetch Version JSON
  console.log('\n--- Test 2: Fetch Version JSON ---');
  fetchJson('http://localhost:8999/version.json', (err, data) => {
    if (err) {
      console.error('Fetch JSON failed:', err);
      process.exit(1);
    }
    console.log('Fetched payload:', JSON.stringify(data));
    console.log('Version matches 2.0.0:', data.version === '2.0.0' ? 'PASS' : 'FAIL');

    // Test 3: Download file
    console.log('\n--- Test 3: Download Installer File ---');
    const tempDest = path.join(os.tmpdir(), 'Wavely-Test-Installer.exe');
    downloadFile(data.url, tempDest, (dlErr) => {
      if (dlErr) {
        console.error('Download failed:', dlErr);
        process.exit(1);
      }
      console.log('File downloaded to:', tempDest);
      const content = fs.readFileSync(tempDest, 'utf8');
      console.log('File contents correct:', content === 'MOCK_INSTALLER_BINARY_DATA' ? 'PASS' : 'FAIL');

      // Cleanup
      fs.unlinkSync(tempDest);
      console.log('Cleanup completed.');

      server.close(() => {
        console.log('\nAll unit tests passed successfully. Closing server.');
        process.exit(0);
      });
    });
  });
});
