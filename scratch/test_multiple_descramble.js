const { app, BrowserWindow, session } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');

function parseSpliceCredentials() {
  const queriesPath = path.join(__dirname, '..', 'splice queries.txt');
  let content = '';
  try {
    if (!fs.existsSync(queriesPath)) return null;
    content = fs.readFileSync(queriesPath, 'utf16le');
    if (!content.includes('cookie') && !content.includes('authorization')) {
      content = fs.readFileSync(queriesPath, 'utf8');
    }
  } catch (e) {
    return null;
  }
  const lines = content.split(/\r?\n/);
  let cookie = '';
  let authorization = '';
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.toLowerCase() === 'cookie') cookie = lines[i + 1] ? lines[i + 1].trim() : '';
    else if (line.toLowerCase() === 'authorization') authorization = lines[i + 1] ? lines[i + 1].trim() : '';
  }
  if (!cookie || !authorization) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.includes(' - ')) {
        const parts = line.split(' - ');
        const key = parts[0].trim().toLowerCase();
        const value = parts.slice(1).join(' - ').trim();
        if (key === 'cookie') cookie = value;
        if (key === 'authorization') authorization = value;
      }
    }
  }
  return { cookie, authorization };
}

function getSpliceSamples(queryText, limit = 1) {
  return new Promise((resolve, reject) => {
    const credentials = parseSpliceCredentials();
    if (!credentials || !credentials.authorization) return reject(new Error('No credentials'));
    const graphqlQuery = `query SamplesSearch($query: String, $limit: Int) {
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
          ... on ISample {
            duration
          }
        }
      }
    }`;
    const bodyData = JSON.stringify({
      operationName: 'SamplesSearch',
      variables: { query: queryText, limit },
      query: graphqlQuery
    });
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
      res.on('data', (c) => data += c);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.errors) {
            console.error('GraphQL errors:', parsed.errors);
          }
          if (parsed.data && parsed.data.assetsSearch) {
            resolve(parsed.data.assetsSearch.items);
          } else {
            console.error('Response does not contain assetsSearch. Raw response:', data);
            reject(new Error('Invalid response structure'));
          }
        } catch (e) {
          console.error('Failed to parse response. Raw data:', data);
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.write(bodyData);
    req.end();
  });
}

app.whenReady().then(async () => {
  try {
    const testQueries = ['kick', 'drum loop 120 bpm', 'synth loop 128 bpm'];
    const selectedSamples = [];
    
    for (const q of testQueries) {
      console.log(`Searching for "${q}"...`);
      const items = await getSpliceSamples(q, 1);
      if (items && items.length > 0) {
        const item = items[0];
        const file = item.files.find(f => f.asset_file_type_slug === 'preview_mp3');
        if (file) {
          selectedSamples.push({ 
            name: item.name, 
            uuid: item.uuid, 
            url: file.url,
            originalDuration: item.duration ? item.duration / 1000 : 0
          });
        }
      }
    }

    console.log(`Found ${selectedSamples.length} samples to test.`);

    session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
      details.requestHeaders['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
      details.requestHeaders['Referer'] = 'https://splice.com/';
      details.requestHeaders['Origin'] = 'https://splice.com';
      callback({ cancel: false, requestHeaders: details.requestHeaders });
    });

    let captureWin = new BrowserWindow({
      show: false,
      webPreferences: { nodeIntegration: false, contextIsolation: false, webSecurity: false }
    });

    // Pre-inject cookies
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
            }).catch(err => console.error('Cookie set error:', err))
          );
        }
      });
    }

    await Promise.all(cookiePromises);
    
    // Log the active cookies and login status
    const cookies = await captureWin.webContents.session.cookies.get({ url: 'https://splice.com' });
    console.log('\n==================================================');
    console.log('CAPTURE WINDOW COOKIE STATE CHECK:');
    cookies.forEach(c => {
      console.log(`  - Cookie Name: ${c.name} | Value: ${c.value.substring(0, 20)}... | Domain: ${c.domain}`);
    });
    const tokenCookie = cookies.find(c => c.name === '_splice_token_prod');
    if (tokenCookie) {
      console.log('Login Status: LOGGED IN (_splice_token_prod present)');
      // Decode JWT expiration
      try {
        const tokenParts = tokenCookie.value.split('.');
        const payload = JSON.parse(Buffer.from(tokenParts[1], 'base64').toString('utf8'));
        const expiryDate = new Date(payload.exp * 1000);
        console.log(`Token Expiration Time: ${expiryDate.toISOString()}`);
        console.log(`Token Expired: ${expiryDate < new Date()}`);
      } catch (err) {
        console.log('Could not parse token expiration.');
      }
    } else {
      console.log('Login Status: NOT LOGGED IN (_splice_token_prod missing)');
    }
    console.log('==================================================\n');

    captureWin.loadURL('about:blank');
    
    async function testSample(sample) {
      console.log(`\nTesting sample: ${sample.name}`);
      console.log(`Expected Duration from API: ${sample.originalDuration.toFixed(2)}s`);
      
      const escapedUrl = sample.url.replace(/'/g, "\\'");
      const script = `
        (async function() {
          try {
            window.__status = 'fetching';
            const resp = await fetch('${escapedUrl}');
            if (!resp.ok) throw new Error('HTTP ' + resp.status);
            const arrayBuffer = await resp.arrayBuffer();
            
            // Apply XOR descrambling using DataView for safe 64-bit LE block size reading
            const fileBytes = new Uint8Array(arrayBuffer);
            const dvHeaders = new DataView(arrayBuffer);
            
            // Read e (bytes 2-9) safely as unsigned integers
            const low = dvHeaders.getUint32(2, true);
            const high = dvHeaders.getUint32(6, true);
            const e = low + (high * 0x100000000);
            
            // Read XOR key s (bytes 10-27)
            const keyBytes = fileBytes.subarray(10, 28);
            
            // Scrambled payload starts at byte 28
            const payloadBytes = fileBytes.subarray(28);
            const payloadLength = payloadBytes.length;
            
            // Descramble payload in place
            // Block 1
            const block1End = Math.min(e, payloadLength);
            for (let i = 0; i < block1End; i++) {
              payloadBytes[i] ^= keyBytes[i % 18];
            }
            
            // Block 3
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
            // Encode as 16-bit PCM WAV while trimming leading encoder delay silence
            const numCh = audioBuffer.numberOfChannels;
            const sr = audioBuffer.sampleRate;
            const len = audioBuffer.length;
            
            const channels = [];
            for (let c = 0; c < numCh; c++) {
              channels.push(audioBuffer.getChannelData(c));
            }
            
            // Scan for the first sample exceeding a tiny threshold (~-70dB) within the first 50ms (typical LAME encoder delay is ~26ms)
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
            const leadingSilenceMs = (startIdx / sr) * 1000;
            
            audioCtx.close();
            
            window.__status = 'done';
            window.__duration = audioBuffer.duration;
            window.__trimmedDuration = trimmedLen / sr;
            window.__leadingSilenceMs = leadingSilenceMs;
          } catch(err) {
            window.__status = 'error';
            window.__error = err.message || String(err);
          }
        })()
      `;
      
      await captureWin.webContents.executeJavaScript(script);
      
      return new Promise((resolve, reject) => {
        const poll = setInterval(async () => {
          try {
            const status = await captureWin.webContents.executeJavaScript('window.__status');
            if (status === 'done') {
              const dur = await captureWin.webContents.executeJavaScript('window.__duration');
              const tdur = await captureWin.webContents.executeJavaScript('window.__trimmedDuration');
              const silence = await captureWin.webContents.executeJavaScript('window.__leadingSilenceMs');
              clearInterval(poll);
              resolve({ duration: dur, trimmedDuration: tdur, leadingSilenceMs: silence });
            } else if (status === 'error') {
              const err = await captureWin.webContents.executeJavaScript('window.__error');
              clearInterval(poll);
              reject(new Error(err));
            }
          } catch (e) {
            clearInterval(poll);
            reject(e);
          }
        }, 100);
      });
    }

    captureWin.webContents.on('did-finish-load', async () => {
      for (const sample of selectedSamples) {
        try {
          const res = await testSample(sample);
          console.log(`-> Decoded Raw Duration: ${res.duration.toFixed(3)}s`);
          console.log(`-> Trimmed WAV Duration: ${res.trimmedDuration.toFixed(3)}s`);
          console.log(`-> Leading Silence Removed: ${res.leadingSilenceMs.toFixed(2)} ms`);
          console.log(`-> Time difference with Splice Database: ${(res.trimmedDuration - sample.originalDuration).toFixed(3)}s`);
        } catch (err) {
          console.error(`Result: Failed: ${err.message}`);
        }
      }
      app.quit();
    });

  } catch (e) {
    console.error(e);
    app.quit();
  }
});
