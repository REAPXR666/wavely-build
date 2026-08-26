const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

app.whenReady().then(() => {
  const scratchDir = path.join(__dirname, '..', 'scratch');
  const mp3Path = path.join(scratchDir, 'sample_descrambled_test.mp3');
  if (!fs.existsSync(mp3Path)) {
    console.error('File not found:', mp3Path);
    app.quit();
    return;
  }

  const mp3Buffer = fs.readFileSync(mp3Path);
  const mp3Base64 = mp3Buffer.toString('base64');

  let captureWin = new BrowserWindow({
    show: false,
    webPreferences: { nodeIntegration: false, contextIsolation: false, webSecurity: false }
  });

  captureWin.loadURL('about:blank');
  captureWin.webContents.on('did-finish-load', () => {
    captureWin.webContents.executeJavaScript(`
      (async function() {
        try {
          const b64 = '${mp3Base64}';
          const binary = atob(b64);
          const len = binary.length;
          const bytes = new Uint8Array(len);
          for (let i = 0; i < len; i++) {
            bytes[i] = binary.charCodeAt(i);
          }
          const arrayBuffer = bytes.buffer;

          console.log('Decoding descrambled MP3...');
          const audioCtx = new AudioContext();
          const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
          console.log('Decoded successfully! Duration:', audioBuffer.duration);

          // Encode as WAV
          const numCh = audioBuffer.numberOfChannels;
          const sr = audioBuffer.sampleRate;
          const audioLen = audioBuffer.length;
          const dataSize = audioLen * numCh * 2;
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
          for(let i=0;i<audioLen;i++) {
            for(let c=0;c<numCh;c++) {
              const s = Math.max(-1, Math.min(1, channels[c][i]));
              v.setInt16(off, (s<0 ? s*0x8000 : s*0x7FFF)|0, true);
              off += 2;
            }
          }

          // Chunked base64
          const outBytes = new Uint8Array(buf);
          const chunkSize = 8192;
          let outB64 = '';
          for (let i = 0; i < outBytes.length; i += chunkSize) {
            const chunk = outBytes.subarray(i, i + chunkSize);
            outB64 += String.fromCharCode.apply(null, chunk);
          }

          window.__wavB64 = btoa(outB64);
          window.__capturedDuration = audioBuffer.duration;
          window.__status = 'done';
        } catch (err) {
          window.__status = 'error';
          window.__error = err.message || String(err);
        }
      })()
    `);
  });

  const poll = setInterval(async () => {
    try {
      const status = await captureWin.webContents.executeJavaScript('window.__status');
      if (status === 'done') {
        const wavB64 = await captureWin.webContents.executeJavaScript('window.__wavB64');
        const dur = await captureWin.webContents.executeJavaScript('window.__capturedDuration');
        const outputPath = path.join(scratchDir, 'sample_descrambled_decoded.wav');
        fs.writeFileSync(outputPath, Buffer.from(wavB64, 'base64'));
        console.log(`Successfully decoded descrambled MP3! Duration: ${dur}s, Saved WAV to ${outputPath}`);
        clearInterval(poll);
        app.quit();
      } else if (status === 'error') {
        const err = await captureWin.webContents.executeJavaScript('window.__error');
        console.error('Decode error:', err);
        clearInterval(poll);
        app.quit();
      }
    } catch (e) {
      console.error(e);
    }
  }, 500);
});
