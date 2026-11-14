'use strict';
const assert = require('node:assert');
const { validateEnv, EnvSaafError, parseEnvFile, scanCode, diffEnv, maskSecrets, maskValue, generateExample } = require('./index');

// v0.1.0 core
const env = validateEnv({
  PORT: { type: 'port', required: true },
  DEBUG: { type: 'boolean', default: false },
  API_URL: { type: 'url', required: true },
}, { PORT: '3000', DEBUG: 'false', API_URL: 'https://example.com' });
assert.strictEqual(env.PORT + 1, 3001);
assert.strictEqual(env.DEBUG, false);
assert.throws(() => validateEnv({ A: { required: true } }, {}), EnvSaafError);

// v0.2.0
assert.deepStrictEqual(parseEnvFile('PORT=3000\nNAME="my app"\n'), { PORT: '3000', NAME: 'my app' });
assert.deepStrictEqual(scanCode('process.env.API_URL; const { PORT } = process.env;'), ['API_URL', 'PORT']);
assert.deepStrictEqual(diffEnv(['A', 'B'], ['A', 'C']), { usedNotDocumented: ['B'], documentedNotUsed: ['C'] });

// v1.0.0: masking — real secret kabhi pura print nahi hota
assert.strictEqual(maskValue('sk_live_123456'), 'sk***56');
assert.strictEqual(maskValue('abc'), '****');
assert.deepStrictEqual(maskSecrets({ KEY: 'sk_live_123456' }), { KEY: 'sk***56' });

// v1.0.0: generateExample — sirf placeholder/default, asli secret kabhi nahi
const ex = generateExample({ PORT: { type: 'port', required: true }, API_KEY: { type: 'string', required: true } });
assert.ok(ex.includes('PORT=3000'));
assert.ok(ex.includes('API_KEY=your_value_here'));
assert.ok(!ex.includes('sk_live'));

// Unreleased fix: scanDir ab .mts/.cts files bhi scan karta hai
{
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { scanDir } = require('./index');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'env-saaf-scan-'));
  fs.writeFileSync(path.join(dir, 'a.mts'), 'export const x = process.env.FROM_MTS;');
  fs.writeFileSync(path.join(dir, 'b.cts'), 'export const y = process.env.FROM_CTS;');
  fs.writeFileSync(path.join(dir, 'c.ts'), 'export const z = process.env.FROM_TS;');
  assert.deepStrictEqual(scanDir(dir), ['FROM_CTS', 'FROM_MTS', 'FROM_TS']);
  fs.rmSync(dir, { recursive: true, force: true });
}

// feat: loadEnv — .env file padho + validate karo, ek call me (fixes #2)
{
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { loadEnv } = require('./index');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'env-saaf-loadenv-'));
  const file = path.join(dir, '.env');
  fs.writeFileSync(file, 'PORT=4000\nDEBUG=true\nAPI_URL=https://api.example.com/v1\n');
  const schema = {
    PORT: { type: 'port', required: true },
    DEBUG: { type: 'boolean', default: false },
    API_URL: { type: 'url', required: true },
  };
  // basic: file se typed values
  const env1 = loadEnv(schema, { path: file, env: {} });
  assert.strictEqual(env1.PORT, 4000);
  assert.strictEqual(env1.DEBUG, true);
  assert.strictEqual(env1.API_URL, 'https://api.example.com/v1');
  assert.ok(Object.isFrozen(env1));
  // override: false (default) — base env jeet-ta hai; true — file jeet-ti hai
  assert.strictEqual(loadEnv(schema, { path: file, env: { PORT: '5000' } }).PORT, 5000);
  assert.strictEqual(loadEnv(schema, { path: file, env: { PORT: '5000' }, override: true }).PORT, 4000);
  // assign: validated values base env me strings banke likhe jate hain
  const target = {};
  loadEnv(schema, { path: file, env: target, assign: true });
  assert.strictEqual(target.PORT, '4000');
  assert.strictEqual(target.DEBUG, 'true');
  // assign ke bina process.env jaisa base env untouched rehta hai
  const untouched = { PORT: '5000' };
  loadEnv(schema, { path: file, env: untouched });
  assert.strictEqual(untouched.PORT, '5000');
  assert.strictEqual(untouched.DEBUG, undefined);
  // missing file + required schema -> saaf error
  assert.throws(() => loadEnv(schema, { path: path.join(dir, 'nope.env'), env: {} }), /file not found/);
  // missing file + sab optional -> defaults, no throw
  const env4 = loadEnv({ PORT: { type: 'port', default: 3000 } }, { path: path.join(dir, 'nope.env'), env: {} });
  assert.strictEqual(env4.PORT, 3000);
  fs.rmSync(dir, { recursive: true, force: true });
}

// feat: strict mode — schema se bahar ke set variables flag karo (fixes #4)
{
  const schema = { PORT: { type: 'port', required: true } };
  // non-strict (default): extra keys ignore hote hain
  assert.strictEqual(validateEnv(schema, { PORT: '3000', DATABSE_URL: 'x' }).PORT, 3000);
  // strict: unknown key error me aata hai
  assert.throws(
    () => validateEnv(schema, { PORT: '3000', DATABSE_URL: 'x' }, { strict: true }),
    /DATABSE_URL: set but not in schema/
  );
  // khaali value strict me bhi ignore (missing jaisi)
  assert.strictEqual(validateEnv(schema, { PORT: '3000', EMPTY_VAR: '' }, { strict: true }).PORT, 3000);
  // ek hi pass me saari problems: unknown + missing
  assert.throws(
    () => validateEnv(schema, { DATABSE_URL: 'x' }, { strict: true }),
    (e) => e instanceof EnvSaafError
      && e.errors.length === 2
      && e.errors.some(m => m.includes('DATABSE_URL'))
      && e.errors.some(m => m.includes('PORT: missing'))
  );
}

// Issue #3: 'url' type value bilkul waisa hi laute jaisa diya gaya tha —
// normalize karke trailing slash NAHI judna chahiye, par galat URL par error aana chahiye
{
  const out = validateEnv({ API_URL: { type: 'url', required: true } }, { API_URL: 'https://api.example.com' });
  assert.strictEqual(out.API_URL, 'https://api.example.com');
  const out2 = validateEnv({ API_URL: { type: 'url', required: true } }, { API_URL: 'https://api.example.com/v1?x=1' });
  assert.strictEqual(out2.API_URL, 'https://api.example.com/v1?x=1');
  assert.throws(() => validateEnv({ U: { type: 'url' } }, { U: 'not a url' }), /valid URL/);
}

console.log('env-saaf v1.0.0: all tests passed');
