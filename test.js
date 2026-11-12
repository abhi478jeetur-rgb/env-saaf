'use strict';
const assert = require('node:assert');
const { validateEnv, EnvSaafError, parseEnvFile, scanCode, diffEnv } = require('./index');

// v0.1.0 core
const env = validateEnv({
  PORT: { type: 'port', required: true },
  DEBUG: { type: 'boolean', default: false },
  API_URL: { type: 'url', required: true },
}, { PORT: '3000', DEBUG: 'false', API_URL: 'https://example.com' });
assert.strictEqual(env.PORT + 1, 3001);
assert.strictEqual(env.DEBUG, false);
assert.throws(() => validateEnv({ A: { required: true } }, {}), EnvSaafError);

// v0.2.0: parseEnvFile
assert.deepStrictEqual(
  parseEnvFile('# comment\nPORT=3000\nexport NAME="my app"\nEMPTY=\n'),
  { PORT: '3000', NAME: 'my app', EMPTY: '' }
);

// v0.2.0: scanCode — dot, bracket and destructuring styles
assert.deepStrictEqual(
  scanCode(`const a = process.env.API_URL; const b = process.env['DB_HOST']; const { PORT, HOST: h } = process.env;`),
  ['API_URL', 'DB_HOST', 'HOST', 'PORT']
);

// v0.2.0: diffEnv
assert.deepStrictEqual(
  diffEnv(['API_URL', 'SECRET_KEY'], ['API_URL', 'OLD_KEY']),
  { usedNotDocumented: ['SECRET_KEY'], documentedNotUsed: ['OLD_KEY'] }
);

console.log('env-saaf v0.2.0: all tests passed');
