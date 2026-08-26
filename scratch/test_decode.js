const { app, BrowserWindow, session } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');

// Helper to parse credentials from splice queries.txt
function parseSpliceCredentials() {
  const queriesPath = path.join(__dirname, '..', 'splice queries.txt');
  let content = '';
  try {
    if (!fs.existsSync(queriesPath)) {
      console.log('splice queries.txt does not exist');
      return null;
    }
    content = fs.readFileSync(queriesPath, 'utf16le');
    if (!content.includes('cookie') && !content.includes('authorization')) {
      content = fs.readFileSync(queriesPath, 'utf8');
    }
  } catch (e) {
    console.error('Failed to read splice queries.txt:', e);
    return null;
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

// Function to query a sample from Splice
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

    const bodyData = JSON.stringify(payload);

    const reqOptions = {
      hostname: 'surfaces-graphql.splice.com',
      port: 443,
      path: '/graphql',
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'authorization': credentials.authorization,
        'cookie': credentials.cookie,
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36'
      }
    };

    const req = https.request(reqOptions, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.data && json.data.assetsSearch && json.data.assetsSearch.items) {
            const items = json.data.assetsSearch.items;
            resolve(items);
          } else {
            reject(new Error('Invalid response structure: ' + data.substring(0, 500)));
          }
        } catch (e) {
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
  console.log('App ready. Fetching a sample from Splice...');
  
  try {
    const samples = await getSpliceSample('kick');
    if (samples.length === 0) {
      console.log('No samples found.');
      app.quit();
      return;
    }

    const sample = samples[0];
    const file = sample.files.find(f => f.asset_file_type_slug === 'preview_mp3');
    if (!file) {
      console.log('No preview file found for sample.');
      app.quit();
      return;
    }

    console.log(`Found sample: ${sample.name} (${sample.uuid})`);
    console.log(`Preview URL: ${file.url}`);

    // Set up interceptor for capture window
    session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
      const url = details.url.toLowerCase();
      if (url.includes('spliceproduction.s3') || url.includes('splice.com')) {
        details.requestHeaders['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36';
        details.requestHeaders['Referer'] = 'https://splice.com/';
        details.requestHeaders['Origin'] = 'https://splice.com';
      }
      callback({ cancel: false, requestHeaders: details.requestHeaders });
    });

    // Run the capture code
    let captureWin = new BrowserWindow({
      show: true, // Show it for debugging
      width: 800,
      height: 600,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: false,
        webSecurity: false
      }
    });

    // Open devtools so we can see console errors
    captureWin.webContents.openDevTools();

    captureWin.loadURL('about:blank');

    captureWin.webContents.on('did-finish-load', () => {
      console.log('Blank page loaded. Injecting script...');
      const escapedUrl = file.url.replace(/'/g, "\\'");
      captureWin.webContents.executeJavaScript(`
        (async function() {
          try {
            console.log('Starting fetch...');
            window.__status = 'fetching';
            const resp = await fetch('${escapedUrl}');
            console.log('Fetch response status:', resp.status);
            if (!resp.ok) throw new Error('HTTP ' + resp.status);
            const arrayBuffer = await resp.arrayBuffer();
            console.log('Fetched buffer size:', arrayBuffer.byteLength);
            
            window.__status = 'decoding';
            const audioCtx = new AudioContext();
            console.log('Decoding...');
            const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
            console.log('Decoded buffer duration:', audioBuffer.duration);
            
            window.__status = 'encoding';
            // Encode as 16-bit PCM WAV
            const numCh = audioBuffer.numberOfChannels;
            const sr = audioBuffer.sampleRate;
            const len = audioBuffer.length;
            const dataSize = len * numCh * 2;
            const buf = new ArrayBuffer(44 + dataSize);
            const v = new DataView(buf);
            
            function ws(o, s) { for(let i=0;i<s.length;i++) v.setUint8(o+i, s.charCodeAt(i)); }
            ws(0,'RIFF'); v.setUint32(4, 36+dataSize, true); ws(8,'WAVE');
            ws(12,'fmt '); v.setUint32(16,16,true); v.setUint16(20,1,true);
            v.setUint16(22,numCh,true); v.setUint32(24,sr,true);
            v.setUint32(28,sr*numCh*2,true); v.setUint16(32,numCh*2,true);
            v.setUint16(34,16,true); ws(36,'data'); v.setUint32(40,dataSize,true);
            
            const channels = [];
            for(let c=0;c<numCh;c++) channels.push(audioBuffer.getChannelData(c));
            let off = 44;
            for(let i=0;i<len;i++) {
              for(let c=0;c<numCh;c++) {
                const s = Math.max(-1, Math.min(1, channels[c][i]));
                v.setInt16(off, (s<0 ? s*0x8000 : s*0x7FFF)|0, true);
                off += 2;
              }
            }
            
            const bytes = new Uint8Array(buf);
            let b64 = '';
            for(let i=0;i<bytes.length;i+=8192) {
              b64 += String.fromCharCode.apply(null, bytes.subarray(i, i+8192));
            }
            
            audioCtx.close();
            window.__capturedWav = btoa(b64);
            window.__capturedDuration = audioBuffer.duration;
            window.__status = 'done';
            console.log('Encoding done!');
          } catch(err) {
            console.error('Script error:', err);
            window.__status = 'error';
            window.__captureError = err.message || String(err);
          }
        })()
      `).catch(err => {
        console.error('JS Execution failed:', err);
      });
    });

    const pollInterval = setInterval(async () => {
      try {
        const status = await captureWin.webContents.executeJavaScript('window.__status');
        console.log('[Poll] Status:', status);
        if (status === 'done') {
          const dur = await captureWin.webContents.executeJavaScript('window.__capturedDuration');
          console.log(`[Poll] Done! Duration: ${dur}s`);
          clearInterval(pollInterval);
          setTimeout(() => app.quit(), 2000);
        } else if (status === 'error') {
          const errMsg = await captureWin.webContents.executeJavaScript('window.__captureError');
          console.error('[Poll] Error:', errMsg);
          clearInterval(pollInterval);
          setTimeout(() => app.quit(), 2000);
        }
      } catch (err) {
        console.error('[Poll] Error running check:', err.message);
      }
    }, 1000);

    setTimeout(() => {
      console.log('Timeout reached. Exiting.');
      clearInterval(pollInterval);
      app.quit();
    }, 20000);

  } catch (e) {
    console.error('Error fetching sample list:', e);
    app.quit();
  }
});
