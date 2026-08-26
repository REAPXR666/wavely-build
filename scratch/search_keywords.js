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
const terms = ['decode', 'audiocontext', 'source', 'buffer', 'scramble', 'descramble', 'pitch', 'bend', 'chop', 'rearrange', 'algorithm', 'player'];
terms.forEach(term => {
  let count = 0;
  lines.forEach((line, idx) => {
    if (line.toLowerCase().includes(term) && count < 5) {
      console.log(`[${term}] Line ${idx + 1}: ${line.substring(0, 150)}`);
      count++;
    }
  });
  console.log(`Found ${count} (capped at 5) matches for term: "${term}"\n`);
});
