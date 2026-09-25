const { mkdirSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

const dist = join(__dirname, '..', 'dist');

const writePackageType = (directory, type) => {
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 'package.json'), `${JSON.stringify({ type })}\n`);
};

writePackageType(join(dist, 'esm'), 'module');
writePackageType(join(dist, 'cjs'), 'commonjs');
writeFileSync(join(dist, 'cjs', 'index.js'), "module.exports = require('../esm/index.js');\n");
