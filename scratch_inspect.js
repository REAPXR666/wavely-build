const fs = require('fs');
const content = fs.readFileSync('e:/SPLICE CLONE/main.js', 'utf8');
const lines = content.split('\n');
for (let i = 549; i < 582; i++) {
  console.log(`${i+1}: ${JSON.stringify(lines[i])}`);
}
