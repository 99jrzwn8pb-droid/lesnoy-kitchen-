const fs = require('node:fs');
const path = require('node:path');
const root = fs.existsSync(path.join(__dirname, '../site/index.html')) ? path.join(__dirname, '../site') : path.join(__dirname, '..');
module.exports = (filename = '') => path.join(root, filename);
