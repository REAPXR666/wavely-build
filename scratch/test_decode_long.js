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
  return { cookie, authorization };
}

function getSpliceSample(queryText) {
  return new Promise((resolve, reject) => {
    const credentials = parseSpliceCredentials();
    if (!credentials || !credentials.authorization) return reject(new Error('No credentials'));
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
    const bodyData = JSON.stringify({
      operationName: 'SamplesSearch',
      variables: { query: queryText, limit: 5 },
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
        try { resolve(JSON.parse(data).data.assetsSearch.items); } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(bodyData);
    req.end();
  });
}

app.whenReady().then(async () => {
  try {
    const samples = await getSpliceSample('synth loop');
    if (samples.length === 0) {
      console.log('No samples found.');
      app.quit();
      return;
    }
    const sample = samples[0];
    const file = sample.files.find(f => f.asset_file_type_slug === 'preview_mp3');
    console.log(`Downloading preview for sample: ${sample.name}`);
    console.log(`URL: ${file.url}`);

    session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
      details.requestHeaders['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
      details.requestHeaders['Referer'] = 'https://splice.com/';
      details.requestHeaders['Origin'] = 'https://splice.com';
      callback({ cancel: false, requestHeaders: details.requestHeaders });
    });

    let captureWin = new BrowserWindow({
      show: true,
      webPreferences: { nodeIntegration: false, contextIsolation: false, webSecurity: false }
    });
    captureWin.webContents.openDevTools();

    captureWin.loadURL('about:blank');
    captureWin.webContents.on('did-finish-load', () => {
      const escapedUrl = file.url.replace(/'/g, "\\'");
      captureWin.webContents.executeJavaScript(`
        (async function() {
          try {
            console.log('Fetching...');
            window.__status = 'fetching';
            const resp = await fetch('${escapedUrl}');
            if (!resp.ok) throw new Error('HTTP ' + resp.status);
            const arrayBuffer = await resp.arrayBuffer();
            console.log('Fetched:', arrayBuffer.byteLength);
            
            window.__status = 'decoding';
            const audioCtx = new AudioContext();
            const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
            console.log('Decoded duration:', audioBuffer.duration);
            
            window.__status = 'encoding';
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
            
            // Convert to base64 in chunks
            const bytes = new Uint8Array(buf);
            let b64 = '';
            for(let i=0;i<bytes.length;i+=8192) {
              b64 += String.fromCharCode.apply(null, bytes.subarray(i, i+8192));
            }
            
            audioCtx.close();
            window.__capturedWav = btoa(b64);
            window.__capturedDuration = audioBuffer.duration;
            window.__status = 'done';
            console.log('Finished encoding WAV!');
          } catch(err) {
            console.error('JS error:', err);
            window.__status = 'error';
            window.__error = err.message || String(err);
          }
        })()
      `);
    });

    const poll = setInterval(async () => {
      try {
        const status = await captureWin.webContents.executeJavaScript('window.__status');
        console.log('[Poll] Status:', status);
        if (status === 'done') {
          const wavB64 = await captureWin.webContents.executeJavaScript('window.__capturedWav');
          const scratchDir = path.join(__dirname, '..', 'scratch');
          fs.writeFileSync(path.join(scratchDir, 'sample_decoded_chunked.wav'), Buffer.from(wavB64, 'base64'));
          console.log('Saved chunked WAV successfully!');
          clearInterval(poll);
          app.quit();
        } else if (status === 'error') {
          const err = await captureWin.webContents.executeJavaScript('window.__error');
          console.error('Script error:', err);
          clearInterval(poll);
          app.quit();
        }
      } catch (e) {
        console.error('Error polling:', e);
      }
    }, 1000);

  } catch (e) {
    console.error(e);
    app.quit();
  }
});
