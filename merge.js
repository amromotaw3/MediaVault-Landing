const fs = require('fs');
const chunks = ['state', 'views', 'library', 'player', 'downloads', 'vault', 'casting', 'main'];
let code = '(async function () {\n  \'use strict\';\n\n';
for(const c of chunks) {
  code += fs.readFileSync('src/renderer/js/' + c + '.js', 'utf-8') + '\n';
}
code += '})();\n';
fs.writeFileSync('renderer.js', code);
console.log('Merged back');
