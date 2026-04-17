
const fs = require('fs');
const content = fs.readFileSync('renderer.js', 'utf8');
let openCount = 0;
let closeCount = 0;
for (let i = 0; i < content.length; i++) {
  if (content[i] === '{') openCount++;
  if (content[i] === '}') closeCount++;
}
console.log(`Open: ${openCount}, Close: ${closeCount}`);
if (openCount > closeCount) console.log(`Missing ${openCount - closeCount} closing braces.`);
else if (closeCount > openCount) console.log(`Extra ${closeCount - openCount} closing braces.`);
else console.log("Braces are balanced.");
