const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'splice queries.txt');
if (!fs.existsSync(filePath)) {
  console.log('File does not exist at:', filePath);
  process.exit(1);
}

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

console.log('File loaded. Length:', content.length);

// Search for lines containing .wv.json
const lines = content.split(/\r?\n/);
let foundCount = 0;
lines.forEach((line, idx) => {
  if (line.toLowerCase().includes('.wv.json')) {
    console.log(`Line ${idx + 1}: ${line}`);
    foundCount++;
  }
});
console.log(`Found ${foundCount} matches for .wv.json`);
