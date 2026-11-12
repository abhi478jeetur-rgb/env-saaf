'use strict';
const assert = require('node:assert');
const { validateEnv, EnvSaafError } = require('./index');

// typed coercion: the classic bugs
const env = validateEnv({
  PORT: { type: 'port', required: true },
  DEBUG: { type: 'boolean', default: false },
  RETRIES: { type: 'number', default: 3 },
  API_URL: { type: 'url', required: true },
  LOG_LEVEL: { type: 'string', choices: ['info', 'warn', 'error'], default: 'info' },
}, { PORT: '3000', DEBUG: 'false', API_URL: 'https://example.com' });

assert.strictEqual(env.PORT, 3000);
assert.strictEqual(env.PORT + 1, 3001); // not "30001"
assert.strictEqual(env.DEBUG, false);  // "false" is NOT truthy anymore
assert.strictEqual(env.RETRIES, 3);
assert.strictEqual(env.LOG_LEVEL, 'info');
assert.ok(Object.isFrozen(env));

// all errors collected together, not one-by-one
assert.throws(
  () => validateEnv({ A: { required: true }, B: { type: 'port', required: true } }, { B: '99999' }),
  (e) => e instanceof EnvSaafError && e.errors.length === 2
);

console.log('env-saaf v0.1.0: all tests passed');
