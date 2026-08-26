const { app, BrowserWindow, session } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');

const userDataPath = app.getPath('userData');
const spliceCacheDir = path.join(userDataPath, 'splice-cache');

function ensureDir(dirPath) {
  try {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
    return true;
  } catch (e) {
    return false;
  }
}

ensureDir(spliceCacheDir);

function parseSpliceCredentials() {
  const pathsToTry = [
    path.join(path.dirname(process.execPath), 'splice queries.txt'),
    path.join(userDataPath, 'splice queries.txt'),
    path.join(__dirname, '..', 'splice queries.txt') // Project root
  ];

  let queriesPath = null;
  for (const p of pathsToTry) {
    if (fs.existsSync(p)) {
      queriesPath = p;
      break;
    }
  }

  if (!queriesPath) {
    console.log('splice queries.txt does not exist');
    return null;
  }

  console.log(`Loading credentials from: ${queriesPath}`);
  let content = fs.readFileSync(queriesPath, 'utf8');
  if (!content.includes('cookie') && !content.includes('authorization')) {
    content = fs.readFileSync(queriesPath, 'utf16le');
  }

  const lines = content.split(/\r?\n/);
  let cookie = '';
  let authorization = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.toLowerCase() === 'cookie') {
      cookie = lines[i + 1] ? lines[i + 1].trim() : '';
    } else if (line.toLowerCase() === 'authorization') {
      authorization = lines[i + 1] ? lines[i + 1].trim() : '';
    }
  }
  return { cookie, authorization };
}

function getSpliceSample(queryText) {
  return new Promise((resolve, reject) => {
    const credentials = parseSpliceCredentials();
    if (!credentials || !credentials.authorization) {
      return reject(new Error('No valid credentials'));
    }

    const graphqlQuery = `query SamplesSearch($query: String, $limit: Int = 5) {
      assetsSearch(
        filter: {legacy: true, published: true, asset_type_slug: sample, query: $query}
        pagination: {page: 1, limit: $limit}
      ) {
        items {
          ... on IAsset {
            uuid
            name
            files {
              asset_file_type_slug
              url
            }
          }
        }
      }
    }`;

    const payload = {
      operationName: 'SamplesSearch',
      variables: { query: queryText, limit: 5 },
      query: graphqlQuery
    };

    const req = https.request({
      hostname: 'surfaces-graphql.splice.com',
      port: 443,
      path: '/graphql',
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'authorization': credentials.authorization,
        'cookie': credentials.cookie,
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(json.data.assetsSearch.items);
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.write(JSON.stringify(payload));
    req.end();
  });
}

function captureSpliceAudio(scrambledUrl, sampleUuid) {
  return new Promise((resolve, reject) => {
    const cachedPath = path.join(spliceCacheDir, `${sampleUuid}.wav`);
    if (fs.existsSync(cachedPath)) {
      console.log(`[SpliceCapture] Disk cache hit: ${cachedPath}`);
      return resolve(cachedPath);
    }

    console.log(`[SpliceCapture] Fetching and decoding ${sampleUuid}`);
    let captureWin = new BrowserWindow({
      show: false,
      width: 400,
      height: 300,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: false,
        webSecurity: false
      }
    });

    const credentials = parseSpliceCredentials();
    const cookiePromises = [];
    if (credentials && credentials.cookie) {
      const parts = credentials.cookie.split(';');
      parts.forEach(part => {
        const eqIdx = part.indexOf('=');
        if (eqIdx === -1) return;
        const name = part.substring(0, eqIdx).trim();
        const value = part.substring(eqIdx + 1).trim();
        if (name && value) {
          cookiePromises.push(
            captureWin.webContents.session.cookies.set({
              url: 'https://splice.com',
              name: name,
              value: value,
              domain: '.splice.com',
              path: '/'
            }).catch(err => console.error('Failed to set cookie in capture session:', err))
          );
        }
      });
    }

    Promise.all(cookiePromises).then(async () => {
      try {
        const cookies = await captureWin.webContents.session.cookies.get({ url: 'https://splice.com' });
        console.log(`[SpliceCapture] Active cookies in capture session: ${cookies.length}`);
      } catch (err) {
        console.error('[SpliceCapture] Failed to query cookies:', err);
      }
      captureWin.loadURL('https://splice.com/robots.txt');
    });

    captureWin.webContents.on('did-finish-load', () => {
      const escapedUrl = scrambledUrl.replace(/'/g, "\\'");
      captureWin.webContents.executeJavaScript(`
        (async function() {
          try {
            window.__status = 'fetching';
            const resp = await fetch('${escapedUrl}', { credentials: 'include' });
            if (!resp.ok) throw new Error('HTTP ' + resp.status);
            const arrayBuffer = await resp.arrayBuffer();
            const fileBytes = new Uint8Array(arrayBuffer);
            const dvHeaders = new DataView(arrayBuffer);
            
            const low = dvHeaders.getUint32(2, true);
            const high = dvHeaders.getUint32(6, true);
            const e = low + (high * 0x100000000);
            
            const keyBytes = fileBytes.subarray(10, 28);
            const payloadBytes = fileBytes.subarray(28);
            const payloadLength = payloadBytes.length;
            
            const block1End = Math.min(e, payloadLength);
            for (let i = 0; i < block1End; i++) {
              payloadBytes[i] ^= keyBytes[i % 18];
            }
            
            const block3Start = 2 * e;
            const block3End = Math.min(3 * e, payloadLength);
            if (block3Start < payloadLength) {
              for (let i = block3Start; i < block3End; i++) {
                const keyIndex = (i - block3Start) % 18;
                payloadBytes[i] ^= keyBytes[keyIndex];
              }
            }
            
            const cleanMp3Buffer = payloadBytes.slice().buffer;
            
            window.__status = 'decoding';
            const audioCtx = new AudioContext();
            const audioBuffer = await audioCtx.decodeAudioData(cleanMp3Buffer);
            
            window.__status = 'encoding';
            const numCh = audioBuffer.numberOfChannels;
            const sr = audioBuffer.sampleRate;
            const len = audioBuffer.length;
            
            const channels = [];
            for (let c = 0; c < numCh; c++) {
              channels.push(audioBuffer.getChannelData(c));
            }
            
            let startIdx = 0;
            const threshold = 0.0003; 
            const maxTrimSamples = Math.floor(sr * 0.05);
            for (let i = 0; i < Math.min(len, maxTrimSamples); i++) {
              let above = false;
              for (let c = 0; c < numCh; c++) {
                if (Math.abs(channels[c][i]) > threshold) {
                  above = true;
                  break;
                }
              }
              if (above) {
                startIdx = i;
                break;
              }
            }
            
            const trimmedLen = len - startIdx;
            const dataSize = trimmedLen * numCh * 2;
            const buf = new ArrayBuffer(44 + dataSize);
            const v = new DataView(buf);
            
            function ws(o, s) { for(let i=0;i<s.length;i++) v.setUint8(o+i, s.charCodeAt(i)); }
            ws(0,'RIFF'); v.setUint32(4, 36+dataSize, true); ws(8,'WAVE');
            ws(12,'fmt '); v.setUint32(16,16,true); v.setUint16(20,1,true);
            v.setUint16(22,numCh,true); v.setUint32(24,sr,true);
            v.setUint32(28,sr*numCh*2,true); v.setUint16(32,numCh*2,true);
            v.setUint16(34,16,true); ws(36,'data'); v.setUint32(40,dataSize,true);
            
            let off = 44;
            for (let i = startIdx; i < len; i++) {
              for (let c = 0; c < numCh; c++) {
                const s = Math.max(-1, Math.min(1, channels[c][i]));
                v.setInt16(off, (s < 0 ? s * 0x8000 : s * 0x7FFF) | 0, true);
                off += 2;
              }
            }
            
            const bytes = new Uint8Array(buf);
            let b64 = '';
            for (let i = 0; i < bytes.length; i += 8192) {
              b64 += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
            }
            
            audioCtx.close();
            window.__capturedWav = btoa(b64);
            window.__capturedDuration = audioBuffer.duration;
            window.__status = 'done';
          } catch(err) {
            window.__status = 'error';
            window.__captureError = err.message || String(err);
          }
        })()
      `).catch(err => {
        console.error('JS injection failed:', err);
      });
    });

    let resolved = false;
    const maxWait = 30000;

    const pollInterval = setInterval(async () => {
      if (resolved || captureWin.isDestroyed()) {
        clearInterval(pollInterval);
        return;
      }
      try {
        const status = await captureWin.webContents.executeJavaScript('window.__status');
        console.log(`Polling status: ${status}`);
        if (status === 'done') {
          const wavB64 = await captureWin.webContents.executeJavaScript('window.__capturedWav');
          const dur = await captureWin.webContents.executeJavaScript('window.__capturedDuration');
          if (wavB64) {
            resolved = true;
            clearInterval(pollInterval);
            const wavBuffer = Buffer.from(wavB64, 'base64');
            fs.writeFileSync(cachedPath, wavBuffer);
            console.log(`[SpliceCapture] Successfully saved: ${cachedPath} (${(wavBuffer.length/1024).toFixed(0)}KB, ${dur.toFixed(1)}s)`);
            if (!captureWin.isDestroyed()) captureWin.close();
            resolve(cachedPath);
          }
        } else if (status === 'error') {
          const errMsg = await captureWin.webContents.executeJavaScript('window.__captureError');
          resolved = true;
          clearInterval(pollInterval);
          if (!captureWin.isDestroyed()) captureWin.close();
          reject(new Error(errMsg || 'Capture decode error'));
        }
      } catch (err) {
        console.error('Poll error:', err);
      }
    }, 500);

    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        clearInterval(pollInterval);
        if (captureWin && !captureWin.isDestroyed()) captureWin.close();
        reject(new Error('Splice audio capture timed out'));
      }
    }, maxWait);
  });
}

app.whenReady().then(async () => {
  console.log('Test process started. Fetching sample list...');
  try {
    const samples = await getSpliceSample('synth lead');
    if (samples.length === 0) {
      console.log('No samples found.');
      app.quit();
      return;
    }
    const sample = samples[0];
    const file = sample.files.find(f => f.asset_file_type_slug === 'preview_mp3');
    if (!file) {
      console.log('No preview file found.');
      app.quit();
      return;
    }

    console.log(`Running capture for sample UUID: ${sample.uuid} (${sample.name})`);
    const finalWavPath = await captureSpliceAudio(file.url, sample.uuid);
    console.log(`TEST SUCCESS: Decoded file written to ${finalWavPath}`);
    app.quit();
  } catch (err) {
    console.error('TEST FAILED with error:', err);
    app.quit();
  }
});
