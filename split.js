const fs = require('fs');
const code = fs.readFileSync('renderer.js', 'utf-8').replace(/\r/g, '').split('\n');

let out = {};
let currentFile = 'state'; // initial
out[currentFile] = [];

const markers = {
  'Views': 'views',
  'Library': 'library',
  'Video Player': 'player',
  'Audio Equalizer': 'player',
  'Downloads': 'downloads',
  'Vault Logic': 'vault',
  'Casting Logic': 'casting',
  'LOAD DATA': 'main'
};

for(let i=0; i < code.length; i++) {
  let line = code[i];
  
  // Exclude the IIFE wrapper and use strict
  if(line.trim() === '(async function () {' || line.trim() === "'use strict';" || line.trim() === '"use strict";' || line.trim() === '})();') continue;

  // We find marker triggers. But to fix Downloads missing, we use uppercase match or ignore case
  for(const [k, v] of Object.entries(markers)) {
    if(line.includes('// ── ' + k + ' ──') || line.includes('// ══') || line.toUpperCase().includes('//  ' + k.toUpperCase())) {
      // Don't switch if it's an unrelated section
      if(k === 'Downloads' && line.toUpperCase().includes('DOWNLOADS')) currentFile = v;
      else if(line.includes(k)) currentFile = v;
    }
  }

  // To ensure globals work identically without IIFE, we just let them exist in the Top-Level of each script.
  // Then we will load them in <script> tags sequentially.
  out[currentFile] = out[currentFile] || [];
  out[currentFile].push(line);
}

for(const [k, v] of Object.entries(out)) {
  fs.writeFileSync('src/renderer/js/' + k + '.js', v.join('\n'));
}

console.log('Files generated successfully:', Object.keys(out));
