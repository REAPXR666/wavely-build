const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'splice queries.txt');
let content = '';
try {
  content = fs.readFileSync(filePath, 'utf16le');
  if (!content.includes('cookie') && !content.includes('authorization')) {
    content = fs.readFileSync(filePath, 'utf8');
  }
} catch (e) {
  console.error('Error reading file:', e);
  process.exit(1);
}

const lines = content.split(/\r?\n/);
console.log('Lines around 7130:');
for (let i = Math.max(0, 7110); i < Math.min(lines.length, 7150); i++) {
  console.log(`${i+1}: ${lines[i]}`);
}
