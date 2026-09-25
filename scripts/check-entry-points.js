require('reflect-metadata');
const assert = require('node:assert/strict');
const { name: packageName } = require('../package.json');

const checkEntryPoints = async () => {
  const required = require(packageName);
  const imported = await import(packageName);

  assert.equal(typeof imported.KafkaModule.register, 'function');
  assert.equal(required.ProducerProxy, imported.ProducerProxy);
  assert.equal(required.ConsumerProxy, imported.ConsumerProxy);
  assert.equal(require(`${packageName}/package.json`).name, packageName);
  assert.throws(
    () => require(`${packageName}/dist/esm/index.js`),
    { code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' },
  );
};

checkEntryPoints().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
