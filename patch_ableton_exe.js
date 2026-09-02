const fs = require('fs');
const { execSync } = require('child_process');

console.log('=====================================================');
console.log('    ABLETON LIVE 12 SIDEBAR STRING RENAMER           ');
console.log('=====================================================');

// 1. Force terminate all Ableton processes
try {
  execSync('powershell -Command "Get-Process -Name \'*Ableton*\' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue"');
  console.log('Waiting 3 seconds for OS file handles to release...');
  execSync('powershell -Command "Start-Sleep -Seconds 3"');
} catch (e) {}

const exePath = 'C:/ProgramData/Ableton/Live 12 Suite/Program/Ableton Live 12 Suite.exe';
const bakPath = exePath + '.bak';

if (!fs.existsSync(exePath)) {
  console.error('Ableton Live executable not found at:', exePath);
  process.exit(1);
}

if (!fs.existsSync(bakPath)) {
  fs.copyFileSync(exePath, bakPath);
  console.log('Created safe backup at:', bakPath);
}

const buf = fs.readFileSync(exePath);

const sU8 = Buffer.from('Splice', 'utf8');
const wU8 = Buffer.from('Wavely', 'utf8');
const sU16 = Buffer.from('Splice', 'utf16le');
const wU16 = Buffer.from('Wavely', 'utf16le');

let count8 = 0;
let count16 = 0;

let pos = 0;
while ((pos = buf.indexOf(sU8, pos)) !== -1) {
  wU8.copy(buf, pos);
  count8++;
  pos += 6;
}

pos = 0;
while ((pos = buf.indexOf(sU16, pos)) !== -1) {
  wU16.copy(buf, pos);
  count16++;
  pos += 12;
}

fs.writeFileSync(exePath, buf);
console.log(`Successfully patched Ableton Live executable!`);
console.log(`Patched ${count8} UTF-8 strings and ${count16} UTF-16 strings from 'Splice' -> 'Wavely'.`);
console.log('=====================================================');
