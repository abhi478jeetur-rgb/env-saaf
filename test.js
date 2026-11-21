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

// Issue #57: a file rule validates readability and preserves the path string.
{
  const fs = require('node:fs');
  const path = require('node:path');
  const dir = fs.mkdtempSync(path.join(__dirname, 'file-type-test-'));
  const schema = { CONFIG_FILE: { type: 'file', required: true } };
  const file = path.join(dir, 'my config.json');
  function assertInvalid(input) {
    assert.throws(
      () => validateEnv(schema, { CONFIG_FILE: input }),
      err => err instanceof EnvSaafError && err.errors[0].includes('expected a readable file')
        && err.errors[0].includes(input),
    );
  }
  try {
    fs.writeFileSync(file, '{}');
    assert.strictEqual(validateEnv(schema, { CONFIG_FILE: file }).CONFIG_FILE, file);
    assert.strictEqual(validateEnv(schema, { CONFIG_FILE: ` ${file} ` }).CONFIG_FILE, file);
    const relative = path.relative(process.cwd(), file);
    assert.strictEqual(validateEnv(schema, { CONFIG_FILE: relative }).CONFIG_FILE, relative);
    const defaults = { CONFIG_FILE: { type: 'file', default: file } };
    assert.strictEqual(validateEnv(defaults, {}).CONFIG_FILE, file);
    assertInvalid(path.join(dir, 'missing.json'));
    assertInvalid(dir);
    assert.match(generateExample(schema), /^CONFIG_FILE=\.\/config\.json$/m);
    if (process.platform !== 'win32' && process.getuid() !== 0) {
      fs.chmodSync(file, 0o000);
      assertInvalid(file);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// Port zero requests an ephemeral listener. Blank values still fail validation.
{
  const schema = { PORT: { type: 'port', required: true } };
  assert.strictEqual(validateEnv(schema, { PORT: '0' }).PORT, 0);
  assert.strictEqual(validateEnv(schema, { PORT: '65535' }).PORT, 65535);
  for (const raw of ['-1', '65536', '3.5', 'abc', ' \t ', null, false]) {
    assert.throws(() => validateEnv(schema, { PORT: raw }), /expected a port \(0-65535, e\.g\. 3000\)/);
  }
  const untrimmed = { PORT: { ...schema.PORT, trim: false } };
  assert.throws(() => validateEnv(untrimmed, { PORT: ' \t ' }), /expected a port \(0-65535, e\.g\. 3000\)/);
  assert.throws(() => validateEnv(schema, { PORT: '' }), /missing required variable/);
}

// v0.2.0
assert.deepStrictEqual(parseEnvFile('PORT=3000\nNAME="my app"\n'), { PORT: '3000', NAME: 'my app' });
assert.deepStrictEqual(scanCode('process.env.API_URL; const { PORT } = process.env;'), ['API_URL', 'PORT']);
assert.deepStrictEqual(diffEnv(['A', 'B'], ['A', 'C']), { usedNotDocumented: ['B'], documentedNotUsed: ['C'] });

// Issue #69: deterministic combinations of the documented .env syntax.
{
  let seed = 0x62a47f21;
  const pick = (choices) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return choices[Math.floor(seed / 0x100000000 * choices.length)];
  };
  const spaces = ['', ' ', '  ', '\t'];
  const fragments = ['sample', '42', 'x=y', 'with#hash', 'café', 'path\\part'];
  const noise = ['', '# comment', '? = value', "UNCLOSED='", '??='];

  for (let sample = 0; sample < 128; sample++) {
    const newline = pick(['\n', '\r\n']);
    const anchor = 'FUZZ_BASE_' + sample;
    const local = 'demo' + sample;
    const reference = '${' + anchor + '}';
    const expected = { [anchor]: local };
    const lines = [anchor + '=' + local];

    for (let index = 0; index < 8; index++) {
      const key = pick(['FUZZ_KEY_', '_FUZZ_', 'Case_']) + sample + '_' + index;
      const word = pick(fragments) + '-' + pick(fragments);
      const phrase = ' ' + word + ' # literal ';
      const [encoded, value] = pick([
        [word, word],
        ['"' + phrase + '"', phrase],
        ["'" + phrase + "'", phrase],
        ['"' + word + newline + 'next line"', word + '\nnext line'],
        [reference + '/suffix', local + '/suffix'],
        ['"' + reference + ' ' + word + '"', local + ' ' + word],
        ['\\' + reference, reference],
        ["'" + reference + "'", reference],
        ['', ''],
      ]);
      const prefix = pick(['', 'export ', 'export\t']);
      const comment = pick(['', ' # trailing', '\t# trailing']);
      lines.push(pick(spaces) + prefix + key + pick(spaces) + '=' + pick(spaces) + encoded + comment);
      expected[key] = value;
    }

    const valid = lines.join(newline) + newline;
    let parsed;
    assert.doesNotThrow(() => { parsed = parseEnvFile(valid); }, JSON.stringify(valid));
    assert.deepStrictEqual(parsed, expected, JSON.stringify(valid));

    const pickDistinctNoise = (position) => pick(noise).replace('UNCLOSED', 'UNCLOSED_' + position);
    const mixed = [
      pickDistinctNoise('START'), ...lines.slice(0, 5),
      pickDistinctNoise('MIDDLE'), ...lines.slice(5), pickDistinctNoise('END'),
    ].join(newline);
    assert.doesNotThrow(() => parseEnvFile(mixed), JSON.stringify(mixed));
  }
}

// v1.0.0: masking — a real secret is never printed in full
assert.strictEqual(maskValue('sk_live_123456'), 'sk***56');
assert.strictEqual(maskValue('abc'), '****');
assert.deepStrictEqual(maskSecrets({ KEY: 'sk_live_123456' }), { KEY: 'sk***56' });
// an empty value has nothing to hide — it stays empty instead of looking set
assert.strictEqual(maskValue(''), '');
assert.strictEqual(maskValue('x'), '****');
assert.deepStrictEqual(maskSecrets({ KEY: '' }), { KEY: '' });
// v1.0.0: generateExample — placeholders/defaults only, never a real secret
const ex = generateExample({ PORT: { type: 'port', required: true }, API_KEY: { type: 'string', required: true } });
assert.ok(ex.includes('PORT=3000'));
assert.ok(ex.includes('API_KEY=\n'));
assert.ok(!ex.includes('sk_live'));

// Issue #56: secret-looking keys get an empty placeholder in the generated example.
{
  const { generateExample } = require('./index');
  const ex2 = generateExample({
    API_KEY: { type: 'string', required: true },
    DB_PASSWORD: { type: 'string' },
    MONKEY: { type: 'string' },
    PORT: { type: 'port' },
    TOKEN_WITH_DEFAULT: { type: 'string', default: 'abc' },
  });
  assert.ok(ex2.includes('API_KEY=\n'));
  assert.ok(ex2.includes('DB_PASSWORD=\n'));
  // 'KEY' inside another word does not count as a secret-looking key.
  assert.ok(ex2.includes('MONKEY=your_value_here'));
  assert.ok(ex2.includes('PORT=3000'));
  // An explicit default wins over the secret rule.
  assert.ok(ex2.includes('TOKEN_WITH_DEFAULT=abc'));
}

// Issue #84: trim: false keeps leading/trailing whitespace for string-like types.
{
  const { validateEnv } = require('./index');
  assert.strictEqual(validateEnv({ T: { type: 'string', trim: false } }, { T: '  abc  ' }).T, '  abc  ');
  // Default behaviour is unchanged: values are trimmed.
  assert.strictEqual(validateEnv({ T: { type: 'string' } }, { T: '  abc  ' }).T, 'abc');
  // With trim: false a padded URL is kept exactly as provided (the URL parser itself tolerates the spaces).
  assert.strictEqual(validateEnv({ U: { type: 'url', trim: false } }, { U: ' https://example.com ' }).U, ' https://example.com ');
  assert.strictEqual(validateEnv({ U: { type: 'url', trim: false } }, { U: 'https://example.com' }).U, 'https://example.com');
  // A padded email is kept as-is, so it fails the no-whitespace rule instead of being silently fixed.
  assert.throws(() => validateEnv({ E: { type: 'email', trim: false } }, { E: ' a@example.com ' }), /expected a valid email/);
  // Numeric and boolean coercion is unaffected by trim: false.
  assert.strictEqual(validateEnv({ N: { type: 'number', trim: false } }, { N: ' 42 ' }).N, 42);
  assert.strictEqual(validateEnv({ B: { type: 'boolean', trim: false } }, { B: ' true ' }).B, true);
  // Choices and length checks see the kept whitespace.
  assert.throws(() => validateEnv({ M: { type: 'string', trim: false, choices: ['dev'] } }, { M: ' dev ' }), /expected one of/);
  assert.throws(() => validateEnv({ S: { type: 'string', trim: false, maxLength: 3 } }, { S: '  ab  ' }), /at most 3 characters/);
}

// scanDir also scans .mts/.cts files
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

// Issue #14: parseEnvFile — strip inline comments after unquoted values;
// '#' inside quotes is safe; a comment after a quoted value is stripped too
{
  const { parseEnvFile, loadEnv } = require('./index');
  assert.deepStrictEqual(
    parseEnvFile('PORT=3000 # my port\nDEBUG=true # enable logs\nNAME="x # y"\nNOTE=\'a # b\' # trailing\nEMPTY= # nothing\nURL=https://example.com/#frag\n'),
    { PORT: '3000', DEBUG: 'true', NAME: 'x # y', NOTE: 'a # b', EMPTY: '', URL: 'https://example.com/#frag' }
  );
  // end-to-end: a .env file with inline comments validates via loadEnv
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'env-saaf-inline-'));
  const file = path.join(dir, '.env');
  fs.writeFileSync(file, 'PORT=4000 # app port\nDEBUG=true # verbose\n');
  const envInline = loadEnv(
    { PORT: { type: 'port', required: true }, DEBUG: { type: 'boolean', default: false } },
    { path: file, env: {} }
  );
  assert.strictEqual(envInline.PORT, 4000);
  assert.strictEqual(envInline.DEBUG, true);
  fs.rmSync(dir, { recursive: true, force: true });
}

// feat: loadEnv — read a .env file and validate it in one call (fixes #2)
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
  // override: false (default) — the base env wins; true — the file wins
  assert.strictEqual(loadEnv(schema, { path: file, env: { PORT: '5000' } }).PORT, 5000);
  assert.strictEqual(loadEnv(schema, { path: file, env: { PORT: '5000' }, override: true }).PORT, 4000);
  // assign: validated values are written back into the base env as strings
  const target = {};
  loadEnv(schema, { path: file, env: target, assign: true });
  assert.strictEqual(target.PORT, '4000');
  assert.strictEqual(target.DEBUG, 'true');
  // without assign, a process.env-like base env stays untouched
  const untouched = { PORT: '5000' };
  loadEnv(schema, { path: file, env: untouched });
  assert.strictEqual(untouched.PORT, '5000');
  assert.strictEqual(untouched.DEBUG, undefined);
  // missing file + required schema -> saaf error
  assert.throws(() => loadEnv(schema, { path: path.join(dir, 'nope.env'), env: {} }), /file not found/);
  // Issue #158: an explicitly passed single `path` that does not exist throws
  // naming the path even when every variable is optional — a typo'd path is a
  // deliberate instruction, and ignoring it silently would boot with defaults.
  assert.throws(
    () => loadEnv({ PORT: { type: 'port', default: 3000 } }, { path: path.join(dir, 'nope.env'), env: {} }),
    (e) => e.message === `env-saaf: .env file not found: ${path.join(dir, 'nope.env')}`
  );
  // the implicit default `.env` stays optional: nothing required -> defaults
  const env4 = loadEnv({ PORT: { type: 'port', default: 3000 } }, { env: {} });
  assert.strictEqual(env4.PORT, 3000);
  // list forms keep skipping missing entries (no throw, defaults apply)
  assert.strictEqual(
    loadEnv({ PORT: { type: 'port', default: 3000 } }, { paths: [path.join(dir, 'nope.env')], env: {} }).PORT, 3000
  );
  assert.strictEqual(
    loadEnv({ PORT: { type: 'port', default: 3000 } }, { path: [path.join(dir, 'nope.env')], env: {} }).PORT, 3000
  );
  fs.rmSync(dir, { recursive: true, force: true });
}

// Issue #157: loadEnv names the path when a file exists but cannot be read —
// a directory (EISDIR) or a permission-denied file (EACCES) — instead of
// leaking the raw Node error. Missing files keep their behaviour above.
{
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { loadEnv } = require('./index');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'env-saaf-eisdir-'));
  const schema = { PORT: { type: 'port', required: true } };
  // a directory passed as path reports the path, not a raw EISDIR
  assert.throws(
    () => loadEnv(schema, { path: dir, env: {} }),
    (e) => e.code === undefined && e.message.includes(`cannot read .env file at ${dir}`)
  );
  // the same applies to every entry of a paths: [...] list
  assert.throws(
    () => loadEnv(schema, { paths: [path.join(dir, 'nope.env'), dir], env: {} }),
    (e) => e.code === undefined && e.message.includes(`cannot read .env file at ${dir}`)
  );
  // a permission-denied file reports the path instead of a raw EACCES/EPERM
  if (process.platform !== 'win32' && process.getuid() !== 0) {
    const file = path.join(dir, '.env.sealed');
    fs.writeFileSync(file, 'PORT=4000\n');
    fs.chmodSync(file, 0o000);
    assert.throws(
      () => loadEnv(schema, { path: file, env: {} }),
      (e) => e.code === undefined && e.message.includes(`cannot read .env file at ${file}`)
    );
  }
  fs.rmSync(dir, { recursive: true, force: true });
}

// Issue #83: reject a misplaced path or other non-schema argument up front.
{
  const { loadEnv } = require('./index');
  const message = "loadEnv expects a schema object as the first argument — did you mean loadEnv(schema, { path: '.env' })?";
  assert.throws(() => loadEnv('.env', { PORT: { type: 'port' } }), { name: 'TypeError', message });
  for (const schema of [null, undefined, [], 42, false, 1n, Symbol('schema'), () => {}, new Date(), new Map(), new (class Schema {})()]) {
    assert.throws(() => loadEnv(schema), { name: 'TypeError', message });
  }
  // Argument validation must happen before reading options or files.
  assert.throws(() => loadEnv('.env', { get path() { throw new Error('options read too soon'); } }), { name: 'TypeError', message });
  assert.deepStrictEqual(loadEnv({}, { paths: [], env: {} }), {});
  const schema = Object.assign(Object.create(null), { PORT: { type: 'port' } });
  assert.strictEqual(loadEnv(schema, { paths: [], env: { PORT: '3000' } }).PORT, 3000);
}

// feat: strict mode — flag variables that are set but not in the schema (fixes #4)
{
  const schema = { PORT: { type: 'port', required: true } };
  // non-strict (default): extra keys are ignored
  assert.strictEqual(validateEnv(schema, { PORT: '3000', DATABSE_URL: 'x' }).PORT, 3000);
  // strict: an unknown key becomes an error
  assert.throws(
    () => validateEnv(schema, { PORT: '3000', DATABSE_URL: 'x' }, { strict: true }),
    /DATABSE_URL: set but not in schema/
  );
  // an empty value is ignored in strict mode too (treated as missing)
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

// Issue #3: a 'url' value must come back exactly as given —
// no normalization (no added trailing slash), but an invalid URL must error
{
  const out = validateEnv({ API_URL: { type: 'url', required: true } }, { API_URL: 'https://api.example.com' });
  assert.strictEqual(out.API_URL, 'https://api.example.com');
  const out2 = validateEnv({ API_URL: { type: 'url', required: true } }, { API_URL: 'https://api.example.com/v1?x=1' });
  assert.strictEqual(out2.API_URL, 'https://api.example.com/v1?x=1');
  assert.throws(() => validateEnv({ U: { type: 'url' } }, { U: 'not a url' }), /valid URL/);
}

// Issue #50: `protocols` allowlists the schemes a `url` value may use.
{
  // An allowed scheme passes, and the value comes back exactly as given.
  assert.strictEqual(
    validateEnv({ U: { type: 'url', protocols: ['https'] } }, { U: 'https://example.com' }).U,
    'https://example.com');
  // Several allowed schemes; matching is case-insensitive, with or without ':'.
  assert.strictEqual(
    validateEnv({ U: { type: 'url', protocols: ['http', 'https:'] } }, { U: 'HTTPS://example.com/x' }).U,
    'HTTPS://example.com/x');
  // A scheme outside the list is rejected, naming the allowed schemes.
  assert.throws(
    () => validateEnv({ U: { type: 'url', protocols: ['https'] } }, { U: 'ftp://example.com/x' }),
    /expected a URL with one of these protocols \(https\), got "ftp:\/\/example\.com\/x"/);
  // Without the option, any valid URL still passes.
  assert.strictEqual(
    validateEnv({ U: { type: 'url' } }, { U: 'ftp://example.com/x' }).U, 'ftp://example.com/x');
  // A bad `protocols` option is rejected up front, naming the key — even
  // when the variable is absent.
  assert.throws(
    () => validateEnv({ U: { type: 'url', protocols: 'https' } }, {}),
    /U: "protocols" must be a non-empty array of schemes/);
  assert.throws(
    () => validateEnv({ U: { type: 'url', protocols: [] } }, {}),
    /U: "protocols" must be a non-empty array of schemes/);
  assert.throws(
    () => validateEnv({ U: { type: 'url', protocols: ['ht tp'] } }, {}),
    /U: "protocols" must be a non-empty array of schemes/);
  // A default goes through the same check as a provided value.
  assert.throws(
    () => validateEnv({ U: { type: 'url', protocols: ['https'], default: 'ftp://example.com' } }, {}),
    /one of these protocols/);
}

// Issue #5: CLI 'check --file <name>' — compare against the given file instead of .env.example
{
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { execFileSync } = require('node:child_process');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'env-saaf-cli-'));
  fs.writeFileSync(path.join(dir, 'app.js'), 'const x = process.env.MY_FLAG;');
  fs.writeFileSync(path.join(dir, '.env.sample'), 'MY_FLAG=1\n');
  const cli = path.join(__dirname, 'cli.js');
  // --file .env.sample: everything is documented, exit 0 (must not throw)
  execFileSync('node', [cli, 'check', dir, '--file', '.env.sample'], { stdio: 'pipe' });
  // without --file: no .env.example present, exit 2
  let code = 0;
  try { execFileSync('node', [cli, 'check', dir], { stdio: 'pipe' }); } catch (e) { code = e.status; }
  assert.strictEqual(code, 2);
  fs.rmSync(dir, { recursive: true, force: true });
}

// Issue #160: a template parse error must print the `env-saaf: ` prefix
// exactly once — parseEnvFile's duplicate-key error already carries it,
// and readEnvFile used to add it again (in text and --json output).
{
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { spawnSync } = require('node:child_process');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'env-saaf-dbl-prefix-'));
  const cli = path.join(__dirname, 'cli.js');
  const run = (args) => spawnSync('node', [cli, ...args], { encoding: 'utf8' });
  try {
    fs.writeFileSync(path.join(dir, 'app.js'), 'const x = process.env.PORT;');
    fs.writeFileSync(path.join(dir, '.env.example'), 'PORT=3000\nPORT=3001\n');
    const human = run(['check', dir]);
    assert.strictEqual(human.status, 2);
    assert.strictEqual(human.stderr.trim(), 'env-saaf: .env.example: duplicate key PORT at line 2 (first defined at line 1)');
    assert.ok(!human.stderr.includes('env-saaf: .env.example: env-saaf:'));
    const json = run(['check', dir, '--json']);
    assert.strictEqual(json.status, 2);
    assert.strictEqual(JSON.parse(json.stdout).error, '.env.example: duplicate key PORT at line 2 (first defined at line 1)');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// Issue #113: 'check' exits 1 whenever it reports a finding — including EXTRA /
// MISSING keys in .env, which used to print a line and still exit 0 — and
// --json 'ok' matches the exit code in every case. A clean project still exits 0.
// Decision: UNUSED (documented but never referenced in code) is a finding too.
{
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { spawnSync } = require('node:child_process');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'env-saaf-check-'));
  const cli = path.join(__dirname, 'cli.js');
  const run = (args) => spawnSync('node', [cli, ...args], { encoding: 'utf8' });
  const write = (name, text) => fs.writeFileSync(path.join(dir, name), text);

  write('app.js', 'const flag = process.env.KNOWN;');
  write('.env.example', 'KNOWN=1\n');

  // Clean project: exit 0, ok true.
  write('.env', 'KNOWN=1\n');
  const clean = run(['check', dir]);
  assert.strictEqual(clean.status, 0);
  assert.strictEqual(JSON.parse(run(['check', dir, '--json']).stdout.trim()).ok, true);

  // The only finding is EXTRA in .env: exit 1, and --json agrees.
  write('.env', 'KNOWN=1\nTYPO_KEY=2\n');
  const extra = run(['check', dir]);
  assert.strictEqual(extra.status, 1);
  assert.ok(extra.stdout.includes('EXTRA in .env: TYPO_KEY'));
  const extraJson = JSON.parse(run(['check', dir, '--json']).stdout.trim());
  assert.strictEqual(extraJson.ok, false);
  assert.deepStrictEqual(extraJson.envExtra, ['TYPO_KEY']);
  assert.strictEqual(run(['check', dir, '--json']).status, 1);

  // The only finding is MISSING in .env: exit 1.
  write('.env', '');
  const missing = run(['check', dir]);
  assert.strictEqual(missing.status, 1);
  assert.ok(missing.stdout.includes('MISSING in .env: KNOWN'));

  // UNUSED (documented, never used in code): exit 1 as well.
  write('.env.example', 'KNOWN=1\nUNUSED_KEY=2\n');
  write('.env', 'KNOWN=1\nUNUSED_KEY=2\n');
  const unused = run(['check', dir]);
  assert.strictEqual(unused.status, 1);
  assert.ok(unused.stdout.includes('UNUSED: UNUSED_KEY'));

  fs.rmSync(dir, { recursive: true, force: true });
}

// Issue #102: CLI 'example --write' — save the draft to a file instead of printing it
{
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { spawnSync } = require('node:child_process');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'env-saaf-cli-'));
  fs.writeFileSync(path.join(dir, 'app.js'), 'const x = process.env.MY_FLAG;');
  const cli = path.join(__dirname, 'cli.js');
  const run = (args) => spawnSync('node', [cli, ...args], { encoding: 'utf8' });
  // without --write: draft still goes to stdout and no file is created
  const plain = run(['example', dir]);
  assert.strictEqual(plain.status, 0);
  assert.ok(plain.stdout.includes('MY_FLAG='));
  assert.ok(!fs.existsSync(path.join(dir, '.env.example')));
  // --write: draft lands in .env.example, with a confirmation on stdout
  const wrote = run(['example', dir, '--write']);
  assert.strictEqual(wrote.status, 0);
  assert.ok(wrote.stdout.includes('wrote .env.example'));
  const saved = fs.readFileSync(path.join(dir, '.env.example'), 'utf8');
  assert.ok(saved.includes('MY_FLAG='));
  // --write again without --force: refuses, exit 1, file untouched
  const again = run(['example', dir, '--write']);
  assert.strictEqual(again.status, 1);
  assert.ok(again.stderr.includes('--force'));
  assert.strictEqual(fs.readFileSync(path.join(dir, '.env.example'), 'utf8'), saved);
  // --write --force: overwrites with a fresh scan
  fs.writeFileSync(path.join(dir, 'app.js'), 'const x = process.env.MY_FLAG; const y = process.env.OTHER;');
  const forced = run(['example', dir, '--write', '--force']);
  assert.strictEqual(forced.status, 0);
  assert.ok(fs.readFileSync(path.join(dir, '.env.example'), 'utf8').includes('OTHER='));
  // --write=<file>: writes to the named file instead
  const named = run(['example', dir, '--write=.env.local.example']);
  assert.strictEqual(named.status, 0);
  assert.ok(fs.readFileSync(path.join(dir, '.env.local.example'), 'utf8').includes('MY_FLAG='));
  fs.rmSync(dir, { recursive: true, force: true });
}

// Issue #116: 'example --write' on a directory with no variables refuses
// instead of writing a header-only file. Plain 'example' (stdout) is unchanged.
{
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { spawnSync } = require('node:child_process');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'env-saaf-cli-'));
  fs.writeFileSync(path.join(dir, 'app.js'), 'console.log("nothing to see here");');
  const cli = path.join(__dirname, 'cli.js');
  const run = (args) => spawnSync('node', [cli, ...args], { encoding: 'utf8' });
  // --write: warns on stderr, exits 1, and writes no file
  const refused = run(['example', dir, '--write']);
  assert.strictEqual(refused.status, 1);
  assert.ok(refused.stderr.includes('no process.env usage found'), refused.stderr);
  assert.ok(!fs.existsSync(path.join(dir, '.env.example')));
  // plain example on the same directory is unchanged: exit 0, header only
  const plain = run(['example', dir]);
  assert.strictEqual(plain.status, 0);
  assert.ok(plain.stdout.includes('# Generated by env-saaf'));
  assert.ok(!fs.existsSync(path.join(dir, '.env.example')));
  fs.rmSync(dir, { recursive: true, force: true });
}

// Issue #15: scanCode — let aur var destructuring of process.env (previously only const)
{
  assert.deepStrictEqual(
    scanCode('let { A } = process.env; var { B } = process.env; const { C } = process.env;'),
    ['A', 'B', 'C']
  );
  assert.deepStrictEqual(
    scanCode('let { API_URL: api = "http://localhost" } = process.env; var { PORT = 3000 } = process.env;'),
    ['API_URL', 'PORT']
  );
}

// Issue #18: boolean type — also accept 'on'/'off' (and 'y'/'n')
{
  const b = (v) => validateEnv({ F: { type: 'boolean' } }, { F: v }).F;
  assert.strictEqual(b('on'), true);
  assert.strictEqual(b('ON'), true);
  assert.strictEqual(b('On'), true);
  assert.strictEqual(b('off'), false);
  assert.strictEqual(b('OFF'), false);
  assert.strictEqual(b('Off'), false);
  assert.strictEqual(b('y'), true);
  assert.strictEqual(b('n'), false);
  assert.strictEqual(b('yes'), true);
  assert.strictEqual(b('no'), false);
  assert.strictEqual(b('1'), true);
  assert.strictEqual(b('0'), false);
  assert.throws(() => validateEnv({ F: { type: 'boolean' } }, { F: 'enabled' }), /expected a boolean/);
  // end-to-end: a .env file with FEATURE_X=on / DEBUG=off
  const { parseEnvFile } = require('./index');
  const parsed = validateEnv(
    { FEATURE_X: { type: 'boolean' }, DEBUG: { type: 'boolean' } },
    parseEnvFile('FEATURE_X=on\nDEBUG=off\n')
  );
  assert.strictEqual(parsed.FEATURE_X, true);
  assert.strictEqual(parsed.DEBUG, false);
}

// Issue #19: CLI '--help' / '-h' — print usage, exit 0 (asking for help is not an error)
{
  const { execFileSync } = require('node:child_process');
  const path = require('node:path');
  const cli = path.join(__dirname, 'cli.js');
  // --help aur -h: exit 0, usage text stdout par
  const outHelp = execFileSync('node', [cli, '--help'], { encoding: 'utf8' });
  assert.ok(outHelp.includes('Usage: env-saaf'));
  const outH = execFileSync('node', [cli, '-h'], { encoding: 'utf8' });
  assert.ok(outH.includes('Usage: env-saaf'));
  // an unknown command still exits 2
  let code = 0;
  try { execFileSync('node', [cli, 'frobnicate'], { stdio: 'pipe' }); } catch (e) { code = e.status; }
  assert.strictEqual(code, 2);
  // no-args ab bhi usage + exit 0
  const outNone = execFileSync('node', [cli], { encoding: 'utf8' });
  assert.ok(outNone.includes('Usage: env-saaf'));
}

// Issue #97: --help / -h recognised after a subcommand, not treated as a directory
{
  const { spawnSync } = require('node:child_process');
  const path = require('node:path');
  const cli = path.join(__dirname, 'cli.js');
  for (const args of [
    ['scan', '--help'],
    ['check', '--help'],
    ['example', '--help'],
    ['scan', '-h'],
    ['scan', '--help', 'some-dir'],
  ]) {
    const run = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
    assert.strictEqual(run.status, 0, args.join(' ') + ' should exit 0: ' + run.stderr);
    assert.ok(run.stdout.includes('Usage: env-saaf'), args.join(' ') + ' should print usage');
    assert.ok(!/ENOENT|not found/.test(run.stderr + run.stdout), args.join(' ') + ' must not treat --help as a path');
  }
}

// Issue #62: --no-color is accepted globally and the CLI keeps its output plain.
{
  const { spawnSync } = require('node:child_process');
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const cli = path.join(__dirname, 'cli.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'env-saaf-plain-'));

  try {
    fs.writeFileSync(path.join(dir, 'app.js'), 'const value = process.env.PLAIN_OUTPUT;');
    const commands = [
      { args: ['--no-color', 'scan', dir] },
      { args: ['scan', '--no-color', dir] },
      { args: ['scan', dir, '--no-color'] },
      { args: ['scan', dir], env: { ...process.env, NO_COLOR: '1' } },
    ];
    for (const { args, env } of commands) {
      const run = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', env });
      assert.strictEqual(run.status, 0, args.join(' '));
      assert.strictEqual(run.stdout.trim(), 'PLAIN_OUTPUT');
      assert.strictEqual(run.stderr, '');
    }

    const json = spawnSync(process.execPath, [cli, 'scan', '--no-color', dir, '--json'], { encoding: 'utf8' });
    assert.strictEqual(json.status, 0);
    assert.deepStrictEqual(JSON.parse(json.stdout), { ok: true, vars: ['PLAIN_OUTPUT'] });

    const help = spawnSync(process.execPath, [cli, '--no-color', '--help'], { encoding: 'utf8' });
    assert.strictEqual(help.status, 0);
    assert.ok(help.stdout.includes('--no-color'));
    assert.strictEqual(help.stderr, '');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// Issue #98: global --version / -v flag — print the installed version and exit 0.
{
  const { spawnSync } = require('node:child_process');
  const path = require('node:path');
  const cli = path.join(__dirname, 'cli.js');
  const expected = `env-saaf ${require('./package.json').version}\n`;

  const commands = [
    ['--version'],
    ['-v'],
    ['check', '--version'],
    ['scan', '-v'],
    ['--no-color', '--version'],
  ];
  for (const args of commands) {
    const run = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
    assert.strictEqual(run.status, 0, args.join(' '));
    assert.strictEqual(run.stdout, expected, args.join(' '));
    assert.strictEqual(run.stderr, '', args.join(' '));
  }

  const help = spawnSync(process.execPath, [cli, '--help'], { encoding: 'utf8' });
  assert.ok(help.stdout.includes('--version'));
}

// Issue #24: CLI --json output for check and scan
{
  const { execFileSync } = require('node:child_process');
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const cli = path.join(__dirname, 'cli.js');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'env-saaf-json-'));
  fs.writeFileSync(path.join(dir, 'app.js'), 'const x = process.env.MISSING_KEY;\nconst y = process.env.OK_KEY;');
  fs.writeFileSync(path.join(dir, '.env.example'), 'OK_KEY=1\nEXTRA_KEY=2\n');

  // check --json: missing used-not-documented, extra documented-not-used, ok false, exit 1
  let code = 0;
  let out = '';
  try {
    out = execFileSync('node', [cli, 'check', dir, '--json'], { encoding: 'utf8' });
  } catch (e) {
    code = e.status;
    out = e.stdout;
  }
  assert.strictEqual(code, 1);
  const parsed = JSON.parse(out);
  assert.strictEqual(parsed.ok, false);
  assert.deepStrictEqual(parsed.missing, ['MISSING_KEY']);
  assert.deepStrictEqual(parsed.extra, ['EXTRA_KEY']);
  assert.deepStrictEqual(parsed.invalid, []);
  // Issue #187: the same keys are also exposed as `unused`, the name scan --json uses
  assert.deepStrictEqual(parsed.unused, ['EXTRA_KEY']);

  // scan --json: lists vars, ok true, exit 0
  const scanOut = execFileSync('node', [cli, 'scan', dir, '--json'], { encoding: 'utf8' });
  const scanParsed = JSON.parse(scanOut);
  assert.strictEqual(scanParsed.ok, true);
  assert.deepStrictEqual(scanParsed.vars.sort(), ['MISSING_KEY', 'OK_KEY']);

  // human output still default (no --json)
  const humanOut = execFileSync('node', [cli, 'scan', dir], { encoding: 'utf8', stdio: 'pipe' });
  assert.ok(humanOut.includes('MISSING_KEY'));
  assert.ok(!humanOut.includes('{'));

  fs.rmSync(dir, { recursive: true, force: true });
}

// Issue #187: check --json exposes documented-but-unused keys as `unused`, the
// same name scan --json uses for them — `extra` keeps the same list so existing
// consumers of the old shape are untouched.
{
  const { spawnSync } = require('node:child_process');
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const cli = path.join(__dirname, 'cli.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'env-saaf-check-unused-'));

  try {
    fs.writeFileSync(path.join(dir, 'app.js'), 'const used = process.env.USED_KEY;');
    fs.writeFileSync(path.join(dir, '.env.example'), 'USED_KEY=1\nOLD_KEY=2\nANOTHER_OLD=3\n');

    const json = spawnSync(process.execPath, [cli, 'check', dir, '--json'], { encoding: 'utf8' });
    assert.strictEqual(json.status, 1);
    const parsed = JSON.parse(json.stdout);
    assert.strictEqual(parsed.ok, false);
    assert.deepStrictEqual(parsed.extra, ['OLD_KEY', 'ANOTHER_OLD']);
    assert.deepStrictEqual(parsed.unused, ['OLD_KEY', 'ANOTHER_OLD']);
    assert.deepStrictEqual(parsed.missing, []);

    // Text mode is unchanged: UNUSED stays a finding with exit 1.
    const human = spawnSync(process.execPath, [cli, 'check', dir], { encoding: 'utf8' });
    assert.strictEqual(human.status, 1);
    assert.ok(human.stdout.includes('UNUSED: OLD_KEY'), human.stdout);
    assert.ok(human.stdout.includes('UNUSED: ANOTHER_OLD'), human.stdout);

    // scan --json is untouched: `unused` still sits next to `vars`, ok true, exit 0.
    const scanJson = spawnSync(process.execPath, [cli, 'scan', dir, '--json'], { encoding: 'utf8' });
    assert.strictEqual(scanJson.status, 0);
    assert.deepStrictEqual(JSON.parse(scanJson.stdout), {
      ok: true,
      vars: ['USED_KEY'],
      unused: ['OLD_KEY', 'ANOTHER_OLD'],
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// Issue #100: CLI check also compares the real .env with the template keys.
{
  const { spawnSync } = require('node:child_process');
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const cli = path.join(__dirname, 'cli.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'env-saaf-envkeys-'));

  try {
    fs.writeFileSync(path.join(dir, 'app.js'), 'const db = process.env.DATABASE_URL;');
    fs.writeFileSync(path.join(dir, '.env.example'), 'DATABASE_URL=\n');
    fs.writeFileSync(path.join(dir, '.env'), 'DATABSE_URL=postgres://localhost/app\n');

    const human = spawnSync(process.execPath, [cli, 'check', dir], { encoding: 'utf8' });
    assert.ok(human.stdout.includes('EXTRA in .env: DATABSE_URL (not in .env.example)'), human.stdout);
    assert.ok(human.stdout.includes('MISSING in .env: DATABASE_URL (in .env.example, not set locally)'), human.stdout);

    const json = spawnSync(process.execPath, [cli, 'check', dir, '--json'], { encoding: 'utf8' });
    assert.deepStrictEqual(JSON.parse(json.stdout), {
      ok: false,
      missing: [],
      extra: [],
      unused: [],
      invalid: [],
      envExtra: ['DATABSE_URL'],
      envMissing: ['DATABASE_URL'],
    });

    // A matching .env is clean; the existing all-clean message still applies.
    fs.writeFileSync(path.join(dir, '.env'), 'DATABASE_URL=postgres://localhost/app\n');
    const clean = spawnSync(process.execPath, [cli, 'check', dir], { encoding: 'utf8' });
    assert.strictEqual(clean.status, 0);
    assert.ok(clean.stdout.includes('all clean'));
    assert.ok(!clean.stdout.includes('in .env:'));

    // Without .env the comparison is skipped and the old shape is unchanged except for empty fields.
    fs.rmSync(path.join(dir, '.env'));
    const noEnv = spawnSync(process.execPath, [cli, 'check', dir, '--json'], { encoding: 'utf8' });
    assert.deepStrictEqual(JSON.parse(noEnv.stdout), {
      ok: true,
      missing: [],
      extra: [],
      unused: [],
      invalid: [],
      envExtra: [],
      envMissing: [],
    });

    // --file selects the template used for the comparison too.
    fs.writeFileSync(path.join(dir, '.env.sample'), 'SAMPLE_KEY=\n');
    fs.writeFileSync(path.join(dir, '.env'), 'SAMPLE_KEY=set\nTYPO_KEY=oops\n');
    const custom = spawnSync(process.execPath, [cli, 'check', dir, '--file', '.env.sample', '--json'], { encoding: 'utf8' });
    assert.deepStrictEqual(JSON.parse(custom.stdout).envExtra, ['TYPO_KEY']);
    assert.deepStrictEqual(JSON.parse(custom.stdout).envMissing, []);
    assert.deepStrictEqual(JSON.parse(custom.stdout).missing, ['DATABASE_URL']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// Issue #70: CLI scan finds literal env reads in TypeScript modules.
{
  const { execFileSync } = require('node:child_process');
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'env-saaf-ts-cli-'));

  try {
    fs.writeFileSync(path.join(dir, 'service.ts'), [
      "enum Mode { Hosted = 'hosted' }",
      "export const hosts = { [Mode.Hosted]: process.env['SERVICE_HOST'] } as const;",
    ].join('\n'));
    fs.mkdirSync(path.join(dir, 'nested'));
    fs.writeFileSync(path.join(dir, 'nested', 'server.mts'), [
      'export namespace Server {',
      '  const { API_PORT: port } = process.env;',
      '  export const config = { port, endpoint: process.env.SERVICE_HOST } as const;',
      '}',
    ].join('\n'));
    fs.writeFileSync(path.join(dir, 'worker.cts'), [
      "const { QUEUE_NAME = 'default' } = process.env;",
      'export const config = { queue: QUEUE_NAME, tracing: process.env["TRACE_MODE"] } as const;',
    ].join('\n'));
    const output = execFileSync(process.execPath, [path.join(__dirname, 'cli.js'), 'scan', dir, '--json'], {
      encoding: 'utf8',
    });
    assert.deepStrictEqual(JSON.parse(output), {
      ok: true,
      vars: ['API_PORT', 'QUEUE_NAME', 'SERVICE_HOST', 'TRACE_MODE'],
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// Issue #30: parseEnvFile — multiline quoted values keep their newlines
// (PEM keys, JSON blobs); the key after the closing quote still parses.
assert.deepStrictEqual(
  parseEnvFile('KEY="-----BEGIN-----\nabc123\n-----END-----"\nNEXT=ok\n'),
  { KEY: '-----BEGIN-----\nabc123\n-----END-----', NEXT: 'ok' });
assert.deepStrictEqual(
  parseEnvFile("KEY='line1\nline2' # trailing\nNEXT=ok\n"),
  { KEY: 'line1\nline2', NEXT: 'ok' });

// Issue #22: parseEnvFile — ${VAR} interpolation in double-quoted and
// unquoted values; the file's own values win over process.env; nested
// references expand; single-quoted and \${...} escapes stay literal;
// unknown names expand to an empty string.
assert.deepStrictEqual(
  parseEnvFile('HOST=example.com\nURL=https://${HOST}/api\n'),
  { HOST: 'example.com', URL: 'https://example.com/api' });
assert.deepStrictEqual(
  parseEnvFile('A=hello\nB=${A} world\nC=${B}!\n'),
  { A: 'hello', B: 'hello world', C: 'hello world!' });
assert.deepStrictEqual(
  parseEnvFile("A=hello\nB='${A}'\n"),
  { A: 'hello', B: '${A}' });
assert.deepStrictEqual(
  parseEnvFile('A=hello\nB=\\${A}\n'),
  { A: 'hello', B: '${A}' });
assert.deepStrictEqual(
  parseEnvFile('B=x${MISSING_VAR}y\n'),
  { B: 'xy' });

// Issue #136: unset and empty values have different defaults.
{
  const missing = 'ENV_SAAF_TEST_MISSING_DEFAULT';
  const external = 'ENV_SAAF_TEST_PROCESS_DEFAULT';
  const priorMissing = process.env[missing];
  const priorExternal = process.env[external];
  try {
    delete process.env[missing];
    process.env[external] = 'process-value';
    const values = parseEnvFile([
      'SET=value',
      'EMPTY=',
      'ALIAS=${ENV_SAAF_TEST_MISSING_DEFAULT}',
      'UNSET_COLON=${ENV_SAAF_TEST_MISSING_DEFAULT:-fallback}',
      'UNSET_DASH=${ENV_SAAF_TEST_MISSING_DEFAULT-fallback}',
      'SET_COLON="${SET:-ignored}"',
      'SET_DASH=${SET-ignored}',
      'EMPTY_COLON=${EMPTY:-fallback}',
      'EMPTY_DASH=${EMPTY-ignored}',
      'EXPANDED_EMPTY=${ALIAS:-fallback}',
      'EMPTY_DEFAULT=x${ENV_SAAF_TEST_MISSING_DEFAULT:-}y',
      'PROCESS=${ENV_SAAF_TEST_PROCESS_DEFAULT:-fallback}',
      'NESTED=${ENV_SAAF_TEST_MISSING_DEFAULT:-${SET}}',
      'UNUSED_NESTED=${SET:-${ENV_SAAF_TEST_MISSING_DEFAULT:-ignored}}',
      'ESCAPED=\\${SET:-ignored}',
      'NESTED_ESCAPED=${ENV_SAAF_TEST_MISSING_DEFAULT:-\\${SET}}',
      "SINGLE='${SET:-ignored}'",
      'UNTERMINATED=${SET} ${SET:-fallback',
    ].join('\n'));
    assert.deepStrictEqual(values, {
      SET: 'value',
      EMPTY: '',
      ALIAS: '',
      UNSET_COLON: 'fallback',
      UNSET_DASH: 'fallback',
      SET_COLON: 'value',
      SET_DASH: 'value',
      EMPTY_COLON: 'fallback',
      EMPTY_DASH: '',
      EXPANDED_EMPTY: 'fallback',
      EMPTY_DEFAULT: 'xy',
      PROCESS: 'process-value',
      NESTED: 'value',
      UNUSED_NESTED: 'value',
      ESCAPED: '${SET:-ignored}',
      NESTED_ESCAPED: '${SET}',
      SINGLE: '${SET:-ignored}',
      UNTERMINATED: 'value ${SET:-fallback',
    });
  } finally {
    if (priorMissing === undefined) delete process.env[missing];
    else process.env[missing] = priorMissing;
    if (priorExternal === undefined) delete process.env[external];
    else process.env[external] = priorExternal;
  }
}

// Issue #185: a self-reference with a default (`${A:-...}` / `${A-...}`) uses
// the default, because the key's own value is not set while its own line is
// being resolved — exactly as for a genuinely absent name. A self-reference
// without a default stays literal, and a genuine cycle (A=${B}, B=${A}) still
// resolves to literals without looping forever.
assert.deepStrictEqual(
  parseEnvFile('A=${A:-fallback}\n'),
  { A: 'fallback' });
assert.deepStrictEqual(
  parseEnvFile('A=${A-fallback}\n'),
  { A: 'fallback' });
assert.deepStrictEqual(
  parseEnvFile('A=${A}\n'),
  { A: '${A}' });
assert.deepStrictEqual(
  parseEnvFile('A=${B}\nB=${A}\n'),
  { A: '${A}', B: '${B}' });
// the self-reference is unset at nesting depth too: it sits inside another
// key's default, reached while A's own line is being resolved
assert.deepStrictEqual(
  parseEnvFile('A=${ENV_SAAF_TEST_MISSING_NESTED:-${A:-q}}\n'),
  { A: 'q' });

// Issue #25: loadEnv — multiple files; later files override earlier ones,
// via `paths: [...]` or `path` as an array.
{
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { loadEnv } = require('./index');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'env-saaf-multi-'));
  const f1 = path.join(dir, '.env');
  const f2 = path.join(dir, '.env.local');
  fs.writeFileSync(f1, 'PORT=3000\nHOST=base\n');
  fs.writeFileSync(f2, 'HOST=local\n');
  const merged = loadEnv(
    { PORT: { type: 'port', required: true }, HOST: { type: 'string', required: true } },
    { paths: [f1, f2], env: {} });
  assert.strictEqual(merged.PORT, 3000);
  assert.strictEqual(merged.HOST, 'local');
  const viaArray = loadEnv({ HOST: { type: 'string' } }, { path: [f1, f2], env: {} });
  assert.strictEqual(viaArray.HOST, 'local');
  fs.rmSync(dir, { recursive: true, force: true });
}

// Issue #34: per-key 'transform' — custom parsing after coercion
{
  const { validateEnv, loadEnv } = require('./index');
  // the issue's own examples: split a comma list, normalise case
  const t1 = validateEnv({
    ALLOWED_ORIGINS: { type: 'string', transform: v => v.split(',').map(s => s.trim()) },
    SHOUTY_NAME: { type: 'string', transform: v => v.toUpperCase() },
  }, { ALLOWED_ORIGINS: 'a.com, b.com ,c.com', SHOUTY_NAME: 'hello' });
  assert.deepStrictEqual(t1.ALLOWED_ORIGINS, ['a.com', 'b.com', 'c.com']);
  assert.strictEqual(t1.SHOUTY_NAME, 'HELLO');
  // transform runs AFTER coercion and the choices check: a port arrives as a number
  const t2 = validateEnv({ PORT_PLUS: { type: 'port', transform: n => n + 1 } }, { PORT_PLUS: '3000' });
  assert.strictEqual(t2.PORT_PLUS, 3001);
  // a choices failure skips the transform entirely
  let transformCalled = false;
  assert.throws(
    () => validateEnv(
      { MODE: { type: 'string', choices: ['a', 'b'], transform: v => { transformCalled = true; return v; } } },
      { MODE: 'c' }
    ),
    /expected one of/
  );
  assert.strictEqual(transformCalled, false);
  // a throwing transform is collected as a normal validation error, naming the key —
  // and it does not hide the other keys' errors
  assert.throws(
    () => validateEnv({
      BAD: { type: 'string', transform: () => { throw new Error('nope'); } },
      MISSING: { type: 'string', required: true },
    }, { BAD: 'x' }),
    (e) => e instanceof EnvSaafError
      && e.errors.length === 2
      && e.errors.some(m => m.includes('BAD: transform failed: nope'))
      && e.errors.some(m => m.includes('MISSING: missing'))
  );
  // transform does NOT run on defaults — a default passes through untouched
  let defaultTransformed = false;
  const t3 = validateEnv(
    { GREETING: { type: 'string', default: 'hi', transform: v => { defaultTransformed = true; return v + '!'; } } },
    {}
  );
  assert.strictEqual(t3.GREETING, 'hi');
  assert.strictEqual(defaultTransformed, false);
  // a non-function transform is a schema error naming the key
  assert.throws(
    () => validateEnv({ A: { type: 'string', transform: 'split' } }, { A: 'x' }),
    /A: "transform" must be a function/
  );
  // end-to-end: loadEnv applies transforms too (it validates through validateEnv)
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'env-saaf-transform-'));
  fs.writeFileSync(path.join(dir, '.env'), 'ALLOWED_ORIGINS=a.com, b.com\n');
  const loaded = loadEnv(
    { ALLOWED_ORIGINS: { type: 'string', required: true, transform: v => v.split(',').map(s => s.trim()) } },
    { path: path.join(dir, '.env'), env: {} }
  );
  assert.deepStrictEqual(loaded.ALLOWED_ORIGINS, ['a.com', 'b.com']);
  fs.rmSync(dir, { recursive: true, force: true });
}

// Issue #23: 'email' type and 'pattern' option for strings
{
  const { validateEnv } = require('./index');
  // email: pragmatic validation — one '@', non-empty local/domain, a dot in the domain
  assert.strictEqual(validateEnv({ E: { type: 'email' } }, { E: 'a@b.co' }).E, 'a@b.co');
  assert.strictEqual(validateEnv({ E: { type: 'email' } }, { E: 'first.last+tag@sub.example.org' }).E, 'first.last+tag@sub.example.org');
  for (const bad of ['not-an-email', 'a@b', '@b.co', 'a@.co', 'a@b.', 'a@@b.co', 'a b@c.co', 'a@c']) {
    assert.throws(() => validateEnv({ E: { type: 'email' } }, { E: bad }), /expected a valid email address/);
  }
  // pattern: a slug and a prefixed key; the mismatch error names the pattern
  const p = validateEnv({
    SLUG: { type: 'string', pattern: /^[a-z0-9-]+$/ },
    API_KEY: { type: 'string', pattern: /^sk_[A-Za-z0-9]+$/ },
  }, { SLUG: 'my-post-2', API_KEY: 'sk_abc123' });
  assert.strictEqual(p.SLUG, 'my-post-2');
  assert.strictEqual(p.API_KEY, 'sk_abc123');
  assert.throws(
    () => validateEnv({ S: { type: 'string', pattern: /^[a-z0-9-]+$/ } }, { S: 'Bad Slug!' }),
    (e) => e instanceof EnvSaafError && e.errors.some(m => m.includes('S: expected to match /^[a-z0-9-]+$/'))
  );
  // pattern also works with the email type, and runs after the choices check
  assert.strictEqual(
    validateEnv({ E: { type: 'email', pattern: /@example\.com$/ } }, { E: 'a@example.com' }).E, 'a@example.com');
  assert.throws(
    () => validateEnv({ E: { type: 'email', pattern: /@example\.com$/ } }, { E: 'a@other.com' }),
    /expected to match/
  );
  // a non-RegExp pattern is a schema error naming the key
  assert.throws(
    () => validateEnv({ S: { type: 'string', pattern: '[a-z]+' } }, { S: 'abc' }),
    /S: "pattern" must be a RegExp/
  );
}

// Issue #33: scanCode finds process.env[`KEY`] template-literal access,
// but not interpolated names — those cannot be known statically.
assert.deepStrictEqual(
  scanCode('const v = process.env[`DYNAMIC_NAME`]; const w = process.env[`PREFIX_${SUFFIX}`];'),
  ['DYNAMIC_NAME']);
assert.deepStrictEqual(
  scanCode('process.env.API_URL; process.env[\'BRACKET\']; process.env[`TICK`];'),
  ['API_URL', 'BRACKET', 'TICK']);


// Issues #45 + #47: 'int' type (whole numbers only) and min/max for numbers.
{
  const ints = validateEnv({ N: { type: 'int', required: true } }, { N: '42' });
  assert.strictEqual(ints.N, 42);
  assert.strictEqual(validateEnv({ N: { type: 'int' } }, { N: '-3' }).N, -3);
  assert.strictEqual(validateEnv({ N: { type: 'int' } }, { N: '1e3' }).N, 1000); // 1e3 is a whole value
  assert.strictEqual(validateEnv({ N: { type: 'int' } }, { N: '1.5e2' }).N, 150); // 1.5e2 is whole too
  assert.throws(() => validateEnv({ N: { type: 'int' } }, { N: '3.5' }), /expected an integer/);
  assert.throws(() => validateEnv({ N: { type: 'int' } }, { N: 'abc' }), /expected an integer/);
  // min/max: both, min alone, max alone; the error names the allowed range.
  assert.strictEqual(validateEnv({ N: { type: 'number', min: 1, max: 10 } }, { N: '5' }).N, 5);
  assert.throws(() => validateEnv({ N: { type: 'number', min: 1 } }, { N: '0' }), /at least 1/);
  assert.throws(() => validateEnv({ N: { type: 'number', max: 10 } }, { N: '11' }), /at most 10/);
  assert.throws(() => validateEnv({ N: { type: 'number', min: 1, max: 10 } }, { N: '99' }), /1\u201310/);
  // min/max also apply to int and port.
  assert.strictEqual(validateEnv({ N: { type: 'int', min: 0 } }, { N: '7' }).N, 7);
  assert.throws(() => validateEnv({ N: { type: 'int', min: 0 } }, { N: '-1' }), /at least 0/);
  assert.throws(() => validateEnv({ P: { type: 'port', max: 1024 } }, { P: '8080' }), /at most 1024/);
  // min/max leave non-numeric values alone.
  assert.strictEqual(validateEnv({ S: { type: 'string', min: 1 } }, { S: 'x' }).S, 'x');
}

// Issues #32 + #48: 'json' type (parse JSON values) and minLength/maxLength for strings.
{
  // json: objects, arrays and primitives are parsed and returned as-is.
  assert.deepStrictEqual(
    validateEnv({ F: { type: 'json', required: true } }, { F: '{"beta":true,"maxItems":3}' }).F,
    { beta: true, maxItems: 3 });
  assert.deepStrictEqual(
    validateEnv({ F: { type: 'json' } }, { F: '[1, "two", null]' }).F, [1, 'two', null]);
  assert.strictEqual(validateEnv({ F: { type: 'json' } }, { F: '42' }).F, 42);
  assert.strictEqual(validateEnv({ F: { type: 'json' } }, { F: '"hello"' }).F, 'hello');
  assert.strictEqual(validateEnv({ F: { type: 'json' } }, { F: 'true' }).F, true);
  assert.strictEqual(validateEnv({ F: { type: 'json' } }, { F: 'null' }).F, null);
  // Invalid JSON is a normal collected error naming the key.
  assert.throws(() => validateEnv({ F: { type: 'json' } }, { F: '{not json' }), /expected valid JSON/);
  assert.throws(() => validateEnv({ F: { type: 'json', required: true } }, { F: '' }), /missing required variable/);
  // A default may be given as an already-parsed object.
  assert.deepStrictEqual(
    validateEnv({ F: { type: 'json', default: { beta: false } } }, {}).F, { beta: false });
  // An already-parsed value passed directly in the env object passes through.
  assert.deepStrictEqual(
    validateEnv({ F: { type: 'json' } }, { F: { beta: true } }).F, { beta: true });
  // json works with required/default like every other type.
  assert.throws(() => validateEnv({ F: { type: 'json', required: true } }, {}), EnvSaafError);

  // minLength/maxLength: both, min alone, max alone; the error names the allowed length.
  assert.strictEqual(validateEnv({ S: { type: 'string', minLength: 2, maxLength: 5 } }, { S: 'abc' }).S, 'abc');
  assert.throws(() => validateEnv({ S: { type: 'string', minLength: 3 } }, { S: 'ab' }), /at least 3 characters/);
  assert.throws(() => validateEnv({ S: { type: 'string', maxLength: 2 } }, { S: 'abc' }), /at most 2 characters/);
  assert.throws(() => validateEnv({ S: { type: 'string', minLength: 2, maxLength: 4 } }, { S: 'abcdef' }), /2\u20134 characters/);
  // Length is checked after coercion, so surrounding whitespace is trimmed first.
  assert.strictEqual(validateEnv({ S: { type: 'string', minLength: 3, maxLength: 3 } }, { S: '  abc  ' }).S, 'abc');
  // Combines with pattern: length is checked first, then the pattern.
  assert.throws(() => validateEnv({ S: { type: 'string', minLength: 5, pattern: /^[a-z]+$/ } }, { S: 'ab1' }), /at least 5 characters/);
  assert.throws(() => validateEnv({ S: { type: 'string', minLength: 2, pattern: /^[a-z]+$/ } }, { S: 'ab1' }), /expected to match/);
  // Applies to email and url values too; non-string values skip the check.
  assert.throws(() => validateEnv({ E: { type: 'email', maxLength: 5 } }, { E: 'a@b.co' }), /at most 5 characters/);
  assert.strictEqual(validateEnv({ N: { type: 'number', minLength: 5 } }, { N: '42' }).N, 42);
  // Bad option values are a clear rule error, not a crash.
  assert.throws(() => validateEnv({ S: { type: 'string', minLength: -1 } }, { S: 'abc' }), /non-negative integers/);
  assert.throws(() => validateEnv({ S: { type: 'string', maxLength: 2.5 } }, { S: 'abc' }), /non-negative integers/);
}

// Issues #37 + #42: 'uuid' type (canonical UUIDs) and 'hex' type
// (hex strings, with an optional exact `length` for fixed-size values).
{
  // uuid: lowercase, uppercase and mixed-case hex all pass, returned unchanged.
  assert.strictEqual(
    validateEnv({ ID: { type: 'uuid' } }, { ID: '550e8400-e29b-41d4-a716-446655440000' }).ID,
    '550e8400-e29b-41d4-a716-446655440000');
  assert.strictEqual(
    validateEnv({ ID: { type: 'uuid' } }, { ID: '550E8400-E29B-41D4-A716-446655440000' }).ID,
    '550E8400-E29B-41D4-A716-446655440000');
  assert.strictEqual(
    validateEnv({ ID: { type: 'uuid' } }, { ID: '550e8400-E29B-41d4-A716-446655440000' }).ID,
    '550e8400-E29B-41d4-A716-446655440000');
  // Malformed UUIDs are rejected with an error naming the key.
  for (const bad of [
    '550e8400e29b41d4a716446655440000', // no dashes
    '550e8400-e29b-41d4-a716', // too short
    '550e8400-e29b-41d4-a716-44665544000g', // non-hex character
    '550e8400-e29b-41d4-a716-446655440000-extra', // too long
    'not-a-uuid',
  ]) {
    assert.throws(() => validateEnv({ ID: { type: 'uuid' } }, { ID: bad }), /expected a valid UUID/);
  }
  assert.throws(() => validateEnv({ ID: { type: 'uuid', required: true } }, {}), EnvSaafError);

  // hex: mixed-case hex passes, returned unchanged.
  assert.strictEqual(validateEnv({ H: { type: 'hex' } }, { H: 'deadBEEF42' }).H, 'deadBEEF42');
  assert.strictEqual(validateEnv({ H: { type: 'hex' } }, { H: '00ff' }).H, '00ff');
  for (const bad of ['deadbeefzz', '0x1234', '12 34', 'café']) {
    assert.throws(() => validateEnv({ H: { type: 'hex' } }, { H: bad }), /expected a hexadecimal string/);
  }
  // length: an exact-length value passes, anything else fails naming the length.
  assert.strictEqual(validateEnv({ H: { type: 'hex', length: 6 } }, { H: 'a1b2c3' }).H, 'a1b2c3');
  assert.throws(() => validateEnv({ H: { type: 'hex', length: 6 } }, { H: 'a1b2' }), /6 characters long/);
  assert.throws(() => validateEnv({ H: { type: 'hex', length: 6 } }, { H: 'a1b2c3d4' }), /6 characters long/);
  // A bad length option is a clear rule error, not a crash.
  assert.throws(() => validateEnv({ H: { type: 'hex', length: -1 } }, { H: 'a1' }), /"length" must be a non-negative integer/);
  assert.throws(() => validateEnv({ H: { type: 'hex', length: 2.5 } }, { H: 'a1' }), /"length" must be a non-negative integer/);
  // minLength/maxLength also work on hex values — they are strings.
  assert.throws(() => validateEnv({ H: { type: 'hex', maxLength: 2 } }, { H: 'a1b2' }), /at most 2 characters/);
}

// Issues #38 + #39 + #43: 'ipv4', 'semver' and 'base64' types. All three
// return the value unchanged; a bad value is rejected naming the key.
{
  // ipv4: four octets, each 0-255; a leading zero is rejected (except '0' itself).
  assert.strictEqual(validateEnv({ IP: { type: 'ipv4' } }, { IP: '192.168.0.1' }).IP, '192.168.0.1');
  assert.strictEqual(validateEnv({ IP: { type: 'ipv4' } }, { IP: '0.0.0.0' }).IP, '0.0.0.0');
  assert.strictEqual(validateEnv({ IP: { type: 'ipv4' } }, { IP: '255.255.255.255' }).IP, '255.255.255.255');
  for (const bad of ['256.1.1.1', '1.2.3', '1.2.3.4.5', 'example.com', '01.2.3.4', '192.168.0', '192.168.0.1/24']) {
    assert.throws(() => validateEnv({ IP: { type: 'ipv4' } }, { IP: bad }), /expected a valid IPv4 address/);
  }
  assert.throws(() => validateEnv({ IP: { type: 'ipv4', required: true } }, {}), EnvSaafError);

  // semver: MAJOR.MINOR.PATCH, no leading 'v'; pre-release and build suffixes pass.
  assert.strictEqual(validateEnv({ V: { type: 'semver' } }, { V: '1.2.3' }).V, '1.2.3');
  assert.strictEqual(validateEnv({ V: { type: 'semver' } }, { V: '1.2.3-beta.1' }).V, '1.2.3-beta.1');
  assert.strictEqual(validateEnv({ V: { type: 'semver' } }, { V: '0.0.1+build.5' }).V, '0.0.1+build.5');
  for (const bad of ['1.2', 'v1.2.3', '1.02.3', '1.2.3.4', 'latest', '1.2.x']) {
    assert.throws(() => validateEnv({ V: { type: 'semver' } }, { V: bad }), /expected a valid semantic version/);
  }

  // base64: standard base64 only (A-Za-z0-9+/ with '=' padding, length a multiple of 4).
  assert.strictEqual(validateEnv({ B: { type: 'base64' } }, { B: 'aGVsbG8=' }).B, 'aGVsbG8=');
  assert.strictEqual(validateEnv({ B: { type: 'base64' } }, { B: 'aGVsbG8gd29ybGQ=' }).B, 'aGVsbG8gd29ybGQ=');
  assert.strictEqual(validateEnv({ B: { type: 'base64' } }, { B: 'AA==' }).B, 'AA==');
  for (const bad of ['not base64!', 'aGVsbG8', 'aGVsbG8===', 'aGVs-bG8=', 'aGVs_bG8=', '====']) {
    assert.throws(() => validateEnv({ B: { type: 'base64' } }, { B: bad }), /expected a valid base64 string/);
  }
  // minLength/maxLength work on the new string types too.
  assert.throws(() => validateEnv({ IP: { type: 'ipv4', minLength: 20 } }, { IP: '1.2.3.4' }), /at least 20 characters/);
}

// Issue #40: 'date' type — ISO 8601 dates and datetimes become Date objects.
// Impossible dates are rejected instead of rolling over to the next month.
{
  // date-only: parsed as a Date at UTC midnight.
  const d = validateEnv({ D: { type: 'date' } }, { D: '2026-01-31' }).D;
  assert.ok(d instanceof Date);
  assert.strictEqual(d.toISOString(), '2026-01-31T00:00:00.000Z');
  // leap day is real in a leap year, impossible otherwise.
  assert.strictEqual(validateEnv({ D: { type: 'date' } }, { D: '2024-02-29' }).D.toISOString().slice(0, 10), '2024-02-29');
  assert.throws(() => validateEnv({ D: { type: 'date' } }, { D: '2026-02-29' }), /expected a valid ISO 8601 date/);
  // full datetimes: UTC, an offset, and fractional seconds all parse.
  assert.strictEqual(validateEnv({ D: { type: 'date' } }, { D: '2026-01-31T10:00:00Z' }).D.toISOString(), '2026-01-31T10:00:00.000Z');
  assert.strictEqual(validateEnv({ D: { type: 'date' } }, { D: '2026-01-31T10:00:00+05:30' }).D.toISOString(), '2026-01-31T04:30:00.000Z');
  assert.strictEqual(validateEnv({ D: { type: 'date' } }, { D: '2026-01-31T10:00:00.123Z' }).D.toISOString(), '2026-01-31T10:00:00.123Z');
  assert.strictEqual(validateEnv({ D: { type: 'date' } }, { D: '2026-01-31T10:00' }).D instanceof Date, true);
  // impossible and malformed values are rejected, naming the key.
  for (const bad of ['2026-02-31', '2026-13-01', '2026-00-10', '2026-01-32', '2026-01-31T25:00:00Z',
    '2026-01-31T10:60:00Z', '31-01-2026', '2026/01/31', 'not-a-date', '2026-1-31']) {
    assert.throws(() => validateEnv({ D: { type: 'date' } }, { D: bad }), /expected a valid ISO 8601 date/);
  }
  assert.throws(() => validateEnv({ D: { type: 'date', required: true } }, {}), EnvSaafError);
  // A Date given as a default passes through; an invalid one fails like a bad value.
  const def = new Date('2026-06-01T00:00:00.000Z');
  assert.strictEqual(validateEnv({ D: { type: 'date', default: def } }, {}).D, def);
  assert.throws(() => validateEnv({ D: { type: 'date', default: new Date('not a date') } }, {}), /expected a valid ISO 8601 date/);
  // generateExample suggests a real date, not a placeholder.
  assert.ok(generateExample({ LAUNCH: { type: 'date', required: true } }).includes('LAUNCH=2026-01-31'));
}

// Issue #41: 'duration' type — human durations ('15m', '2h', '1d') become milliseconds.
{
  const schema = { TIMEOUT: { type: 'duration' } };
  assert.strictEqual(validateEnv(schema, { TIMEOUT: '500ms' }).TIMEOUT, 500);
  assert.strictEqual(validateEnv(schema, { TIMEOUT: '30s' }).TIMEOUT, 30000);
  assert.strictEqual(validateEnv(schema, { TIMEOUT: '15m' }).TIMEOUT, 900000);
  assert.strictEqual(validateEnv(schema, { TIMEOUT: '2h' }).TIMEOUT, 7200000);
  assert.strictEqual(validateEnv(schema, { TIMEOUT: '1d' }).TIMEOUT, 86400000);
  // A bare number is already milliseconds; decimals and case do not matter.
  assert.strictEqual(validateEnv(schema, { TIMEOUT: '250' }).TIMEOUT, 250);
  assert.strictEqual(validateEnv(schema, { TIMEOUT: '1.5h' }).TIMEOUT, 5400000);
  assert.strictEqual(validateEnv(schema, { TIMEOUT: '15M' }).TIMEOUT, 900000);
  assert.strictEqual(validateEnv(schema, { TIMEOUT: ' 30s ' }).TIMEOUT, 30000);
  // A number passed directly (e.g. as a default) is taken as milliseconds.
  assert.strictEqual(validateEnv({ TIMEOUT: { type: 'duration', default: 5000 } }, {}).TIMEOUT, 5000);
  // min/max work on the millisecond result like on any other number.
  assert.strictEqual(validateEnv({ TIMEOUT: { type: 'duration', min: 1000 } }, { TIMEOUT: '30s' }).TIMEOUT, 30000);
  assert.throws(() => validateEnv({ TIMEOUT: { type: 'duration', min: 1000 } }, { TIMEOUT: '500ms' }), /expected a number at least 1000/);
  // Unknown units, negatives and malformed values are rejected, naming the key.
  for (const bad of ['15x', '15min', '15sec', '-5m', '-1', 'm', '1.2.3h', '1e3s']) {
    assert.throws(() => validateEnv(schema, { TIMEOUT: bad }), /expected a duration/);
  }
  assert.throws(() => validateEnv({ TIMEOUT: { type: 'duration', required: true } }, {}), EnvSaafError);
  // generateExample suggests a real duration, not a placeholder.
  assert.ok(generateExample({ TIMEOUT: { type: 'duration', required: true } }).includes('TIMEOUT=15m'));
  // Issue #176: 'w' is a week of 7 days, case-insensitive, fractional values allowed.
  assert.strictEqual(validateEnv(schema, { TIMEOUT: '1w' }).TIMEOUT, 604800000);
  assert.strictEqual(validateEnv(schema, { TIMEOUT: '2w' }).TIMEOUT, 1209600000);
  assert.strictEqual(validateEnv(schema, { TIMEOUT: '1W' }).TIMEOUT, 604800000);
  assert.strictEqual(validateEnv(schema, { TIMEOUT: '1.5w' }).TIMEOUT, 907200000);
  assert.strictEqual(validateEnv(schema, { TIMEOUT: ' 1 w ' }).TIMEOUT, 604800000);
  assert.strictEqual(validateEnv({ TIMEOUT: { type: 'duration', max: 604800000 } }, { TIMEOUT: '1w' }).TIMEOUT, 604800000);
  assert.throws(() => validateEnv({ TIMEOUT: { type: 'duration', max: 604800000 } }, { TIMEOUT: '2w' }), /expected a number at most 604800000/);
  // Existing units keep their values, and wrong week spellings are still rejected.
  assert.strictEqual(validateEnv(schema, { TIMEOUT: '7d' }).TIMEOUT, validateEnv(schema, { TIMEOUT: '1w' }).TIMEOUT);
  assert.strictEqual(validateEnv(schema, { TIMEOUT: '1d' }).TIMEOUT, 86400000);
  assert.strictEqual(validateEnv(schema, { TIMEOUT: '2H' }).TIMEOUT, 7200000);
  assert.strictEqual(validateEnv(schema, { TIMEOUT: '500ms' }).TIMEOUT, 500);
  for (const bad of ['1wk', '1week', '1ww', 'w', '-1w', '1.w', '1e2w']) {
    assert.throws(() => validateEnv(schema, { TIMEOUT: bad }), /expected a duration/);
  }
}

// Issue #44: 'host' type — a hostname or IP address, with no scheme, path or port.
{
  const schema = { HOST: { type: 'host' } };
  assert.strictEqual(validateEnv(schema, { HOST: 'db.internal' }).HOST, 'db.internal');
  assert.strictEqual(validateEnv(schema, { HOST: 'localhost' }).HOST, 'localhost');
  assert.strictEqual(validateEnv(schema, { HOST: '10.0.0.5' }).HOST, '10.0.0.5');
  assert.strictEqual(validateEnv(schema, { HOST: '::1' }).HOST, '::1');
  assert.strictEqual(validateEnv(schema, { HOST: '2001:db8::1' }).HOST, '2001:db8::1');
  assert.strictEqual(validateEnv(schema, { HOST: 'DB.EXAMPLE.COM' }).HOST, 'DB.EXAMPLE.COM');
  // A scheme, a path or a port is rejected, naming the key.
  for (const bad of ['https://db.internal', 'http://localhost:3000', 'db.internal:8080', 'localhost:3000',
    'db/x', 'db.internal/', 'http://[::1]:8080', '-bad-.example.com', 'bad..host', '.example.com', 'example.com.']) {
    assert.throws(() => validateEnv(schema, { HOST: bad }), /expected a hostname or IP address/);
  }
  assert.throws(() => validateEnv({ HOST: { type: 'host', required: true } }, {}), EnvSaafError);
  // String options work on it like on any other string type.
  assert.throws(() => validateEnv({ HOST: { type: 'host', maxLength: 5 } }, { HOST: 'db.internal' }), /at most 5 characters/);
  // generateExample suggests a real host, not a placeholder.
  assert.ok(generateExample({ HOST: { type: 'host', required: true } }).includes('HOST=localhost'));
}

// Issue #82: parseEnvFile takes .env TEXT, not a file path. Passing a path
// silently returned {}; now it throws a clear error pointing at loadEnv.
{
  const helpful = /parseEnvFile expects \.env text, not a file path.*did you mean loadEnv\(schema, \{ path:/;
  assert.throws(() => parseEnvFile('.env'), helpful);
  assert.throws(() => parseEnvFile('config/.env.local'), helpful);
  assert.throws(() => parseEnvFile('/etc/app.env'), helpful);
  // Normal .env text still parses as before — including a single line with
  // no trailing newline and an empty file.
  assert.deepStrictEqual(parseEnvFile('A=1'), { A: '1' });
  assert.deepStrictEqual(parseEnvFile('FOO=bar'), { FOO: 'bar' });
  assert.deepStrictEqual(parseEnvFile(''), {});
  // A lone comment line is not a path, even when it mentions one.
  assert.deepStrictEqual(parseEnvFile('# see config/notes'), {});
}

// Issue #145: bare lines report their position, even after multiline values.
{
  assert.throws(() => parseEnvFile('FOO\n'), /line 1: expected KEY=VALUE/);
  assert.throws(
    () => parseEnvFile('PORT=3000\r\nCERT="one\r\ntwo"\r\nFOO # example=123\r\nBAR=\r\n'),
    /line 4: expected KEY=VALUE/
  );
  assert.deepStrictEqual(parseEnvFile('\r\n# comment\r\n \t\r\n'), {});
  assert.deepStrictEqual(parseEnvFile('BAR=\n'), { BAR: '' });
}

// CLI callers retain readable errors and the machine-readable JSON contract.
{
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { spawnSync } = require('node:child_process');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'env-saaf-bare-line-'));
  const run = (...args) => spawnSync(process.execPath, [path.join(__dirname, 'cli.js'), ...args], {
    encoding: 'utf8',
  });
  try {
    fs.writeFileSync(path.join(dir, '.env.example'), '# config\nFOO\n');
    const scan = run('scan', dir, '--json');
    assert.strictEqual(scan.status, 2);
    assert.strictEqual(scan.stderr, '');
    const error = JSON.parse(scan.stdout);
    assert.strictEqual(error.ok, false);
    assert.match(error.error, /\.env\.example: line 2: expected KEY=VALUE/);

    fs.writeFileSync(path.join(dir, '.env.example'), 'FOO=\n');
    fs.writeFileSync(path.join(dir, '.env'), 'fake secret value accidentally written on its own line\n');
    const check = run('check', dir);
    assert.strictEqual(check.status, 2);
    assert.strictEqual(check.stdout, '');
    assert.match(check.stderr, /\.env: line 1: expected KEY=VALUE/);
    assert.doesNotMatch(check.stderr, /fake secret value/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// Issue #88: loadEnv with assign: true must JSON-stringify object/array values.
{
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { loadEnv } = require('./index');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'env-saaf-assign-json-'));
  const file = path.join(dir, '.env');
  fs.writeFileSync(file, 'CFG={"a":1}\nLIST=[1,2,3]\nN=42\nFLAG=true\nNAME=hi\nNOTHING=null\n');
  const schema = {
    CFG: { type: 'json', required: true },
    LIST: { type: 'json', required: true },
    N: { type: 'number', required: true },
    FLAG: { type: 'boolean', required: true },
    NAME: { type: 'string', required: true },
    NOTHING: { type: 'json', required: true },
  };
  const target = {};
  const validated = loadEnv(schema, { path: file, env: target, assign: true });
  // The validated result is unchanged (parsed objects), only the assigned-back copy is text.
  assert.deepStrictEqual(validated.CFG, { a: 1 });
  assert.deepStrictEqual(validated.LIST, [1, 2, 3]);
  // Objects/arrays from the json type round-trip through JSON.parse.
  assert.strictEqual(target.CFG, '{"a":1}');
  assert.deepStrictEqual(JSON.parse(target.CFG), { a: 1 });
  assert.strictEqual(target.LIST, '[1,2,3]');
  assert.deepStrictEqual(JSON.parse(target.LIST), [1, 2, 3]);
  // Primitives keep their existing String(value) behaviour.
  assert.strictEqual(target.N, '42');
  assert.strictEqual(target.FLAG, 'true');
  assert.strictEqual(target.NAME, 'hi');
  // null stays "null".
  assert.strictEqual(target.NOTHING, 'null');

  // A transform returning an object is also JSON-stringified on assign.
  const t2 = {};
  loadEnv(
    { OBJ: { type: 'string', required: true, transform: (v) => ({ raw: v }) } },
    { path: (() => { const f = path.join(dir, '.env2'); fs.writeFileSync(f, 'OBJ=x\n'); return f; })(), env: t2, assign: true }
  );
  assert.strictEqual(t2.OBJ, '{"raw":"x"}');
  assert.deepStrictEqual(JSON.parse(t2.OBJ), { raw: 'x' });
  fs.rmSync(dir, { recursive: true, force: true });
}

// Issue #117: parseEnvFile — a backslash-escaped quote inside a quoted value
// is part of the value, not the end of it. Single and double quotes behave the
// same way; a plain backslash (C:\path) is not an escape and stays literal.
{
  assert.deepStrictEqual(parseEnvFile(String.raw`B='it\'s'`), { B: "it's" });
  assert.deepStrictEqual(parseEnvFile(String.raw`D="it\"s"`), { D: 'it"s' });
  assert.deepStrictEqual(
    parseEnvFile(String.raw`E='C:\path\to'`),
    { E: String.raw`C:\path\to` }
  );
  // The escaped quote on the first line must not close a multiline value.
  assert.deepStrictEqual(
    parseEnvFile("G='line1\\'s\nline2'\n"),
    { G: "line1's\nline2" }
  );
}

// Issue #114: a default goes through the same coercion and validation as a
// provided value; a bad default fails with the key named, a supplied value wins.
{
  const bad = (schema, key) => assert.throws(
    () => validateEnv(schema, {}),
    (e) => e instanceof EnvSaafError && e.errors.some((m) => m.startsWith(key + ':'))
  );
  bad({ P: { type: 'port', default: 99999 } }, 'P');
  bad({ M: { choices: ['a', 'b'], default: 'c' } }, 'M');
  bad({ N: { type: 'number', default: 'notanumber' } }, 'N');
  bad({ R: { type: 'int', min: 1, max: 5, default: 9 } }, 'R');
  // An empty value counts as missing, so the default is checked then too.
  assert.throws(() => validateEnv({ P: { type: 'port', default: 99999 } }, { P: '' }), /P:/);
  // Valid defaults still work, and are coerced like real values.
  assert.deepStrictEqual({ ...validateEnv({
    P: { type: 'port', default: 3000 },
    L: { choices: ['info', 'warn'], default: 'info' },
    B: { type: 'boolean', default: 'yes' },
    J: { type: 'json', default: { a: 1 } },
  }, {}) }, { P: 3000, L: 'info', B: true, J: { a: 1 } });
  // A supplied value overrides the default (and a bad default is never checked then).
  assert.strictEqual(validateEnv({ P: { type: 'port', default: 99999 } }, { P: '8080' }).P, 8080);
  // transform still runs only on provided values.
  assert.strictEqual(validateEnv({ T: { default: 'a', transform: (v) => v + '!' } }, {}).T, 'a');
}

// Issue #115: scanCode reads code, not the text inside comments or literals.
{
  // A mention in a comment or a literal is not a read.
  assert.deepStrictEqual(scanCode('// set process.env.FOO first'), []);
  assert.deepStrictEqual(scanCode('/* use process.env.BAR */'), []);
  assert.deepStrictEqual(scanCode('const s = "see process.env.BAZ in docs"'), []);
  assert.deepStrictEqual(scanCode("const t = 'process.env.QUX'"), []);
  assert.deepStrictEqual(scanCode('const u = `see process.env.QUUX in docs`'), []);
  assert.deepStrictEqual(scanCode('const r = /process.env.REGEX/;'), []);   // a regex literal, not a read
  // A block comment spanning lines is masked across lines.
  assert.deepStrictEqual(scanCode('const a = 1; /* process.env.L\nprocess.env.M */ const b = 2;'), []);
  // A read inside a template's ${...} is a read; the literal text around it is not.
  assert.deepStrictEqual(scanCode('const v = `k=${process.env.REAL} and process.env.FAKE`'), ['REAL']);
  // The reads that must keep working: dot, bracket with a string or template, destructuring.
  assert.deepStrictEqual(scanCode("process.env.A; process.env['B']; process.env[`C`]"), ['A', 'B', 'C']);
  assert.deepStrictEqual(scanCode('const { D, E: alias = 1, F = "x" } = process.env;'), ['D', 'E', 'F']);
  // A real read and a decoy on the same line: only the read counts.
  assert.deepStrictEqual(scanCode('const g = process.env.G; // process.env.H is not read'), ['G']);
  // Destructuring that only appears in a comment is not a read.
  assert.deepStrictEqual(scanCode('// const { I } = process.env'), []);
  // An escaped quote doesn't end the literal early and expose what follows it.
  assert.deepStrictEqual(scanCode("const j = 'it\\'s process.env.J'; process.env.K"), ['K']);
  // The library's own doc comment mentions process.env.KEY: scanning index.js is not a read of KEY.
  const own = require('node:fs').readFileSync(require('node:path').join(__dirname, 'index.js'), 'utf8');
  assert.ok(!scanCode(own).includes('KEY'));
}

// Issue #90: CLI check --schema validates values against a schema, not just presence.
{
  const { spawnSync } = require('node:child_process');
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const cli = path.join(__dirname, 'cli.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'env-saaf-schema-'));

  try {
    fs.writeFileSync(path.join(dir, 'app.js'), 'const p = process.env.PORT;\nconst d = process.env.DEBUG;');
    fs.writeFileSync(path.join(dir, '.env.example'), 'PORT=\nDEBUG=\n');
    fs.writeFileSync(path.join(dir, '.env'), 'PORT=not-a-port\nDEBUG=yes\n');
    fs.writeFileSync(path.join(dir, 'env.schema.js'),
      "'use strict';\nmodule.exports = { PORT: { type: 'port', required: true }, DEBUG: { type: 'boolean' } };\n");

    // A wrong-typed value in the real .env fails the check, naming the key, exit 1.
    const bad = spawnSync(process.execPath, [cli, 'check', dir, '--schema', 'env.schema.js'], { encoding: 'utf8' });
    assert.strictEqual(bad.status, 1);
    assert.ok(bad.stdout.includes('INVALID: PORT: expected a port (0-65535, e.g. 3000), got "not-a-port"'), bad.stdout);
    assert.ok(!bad.stdout.includes('DEBUG'), bad.stdout);

    // --json reports the failure in the existing `invalid` field.
    const json = spawnSync(process.execPath, [cli, 'check', dir, '--schema', 'env.schema.js', '--json'], { encoding: 'utf8' });
    assert.strictEqual(json.status, 1);
    assert.deepStrictEqual(JSON.parse(json.stdout), {
      ok: false,
      missing: [],
      extra: [],
      unused: [],
      invalid: ['PORT: expected a port (0-65535, e.g. 3000), got "not-a-port"'],
      envExtra: [],
      envMissing: [],
    });

    // Valid values pass, and presence-only (no --schema) never flags values.
    fs.writeFileSync(path.join(dir, '.env'), 'PORT=3000\nDEBUG=yes\n');
    const good = spawnSync(process.execPath, [cli, 'check', dir, '--schema', 'env.schema.js'], { encoding: 'utf8' });
    assert.strictEqual(good.status, 0);
    assert.ok(good.stdout.includes('all clean'));
    fs.writeFileSync(path.join(dir, '.env'), 'PORT=not-a-port\nDEBUG=yes\n');
    const presenceOnly = spawnSync(process.execPath, [cli, 'check', dir], { encoding: 'utf8' });
    assert.strictEqual(presenceOnly.status, 0);
    assert.ok(presenceOnly.stdout.includes('all clean'));
    assert.ok(!presenceOnly.stdout.includes('INVALID'));

    // The template's placeholders are not real values: with no .env the schema
    // step is skipped instead of flagging .env.example.
    fs.rmSync(path.join(dir, '.env'));
    fs.writeFileSync(path.join(dir, '.env.example'), 'PORT=not-a-port\nDEBUG=\n');
    const skipped = spawnSync(process.execPath, [cli, 'check', dir, '--schema', 'env.schema.js'], { encoding: 'utf8' });
    assert.strictEqual(skipped.status, 0);
    assert.ok(!skipped.stdout.includes('INVALID'));

    // An explicit --file names the file to validate.
    fs.writeFileSync(path.join(dir, '.env.example'), 'PORT=\nDEBUG=\n');
    fs.writeFileSync(path.join(dir, 'custom.env'), 'PORT=not-a-port\nDEBUG=yes\n');
    const custom = spawnSync(process.execPath, [cli, 'check', dir, '--schema', 'env.schema.js', '--file', 'custom.env'], { encoding: 'utf8' });
    assert.strictEqual(custom.status, 1);
    assert.ok(custom.stdout.includes('INVALID: PORT: expected a port (0-65535, e.g. 3000), got "not-a-port"'), custom.stdout);

    // A schema file that cannot be loaded is a usage error (exit 2), not a finding.
    const missing = spawnSync(process.execPath, [cli, 'check', dir, '--schema', 'nope.js'], { encoding: 'utf8' });
    assert.strictEqual(missing.status, 2);
    assert.ok(missing.stderr.includes('cannot load schema nope.js'), missing.stderr);
    fs.writeFileSync(path.join(dir, 'bad.schema.js'), "'use strict';\nmodule.exports = 'nope';\n");
    const notObject = spawnSync(process.execPath, [cli, 'check', dir, '--schema', 'bad.schema.js'], { encoding: 'utf8' });
    assert.strictEqual(notObject.status, 2);
    assert.ok(notObject.stderr.includes('must export a schema object'), notObject.stderr);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// Issue #89: a missing template file must point at the command that drafts one,
// and --json must carry that hint instead of plain text on stderr.
{
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { spawnSync } = require('node:child_process');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'env-saaf-hint-'));
  fs.writeFileSync(path.join(dir, 'app.js'), 'const known = process.env.KNOWN;');
  const cli = path.join(__dirname, 'cli.js');
  const run = (args) => spawnSync('node', [cli, ...args], { encoding: 'utf8' });

  const plain = run(['check', dir]);
  assert.strictEqual(plain.status, 2);
  assert.match(plain.stderr, /not found in/);
  assert.match(plain.stderr, /env-saaf example/);
  assert.strictEqual(plain.stdout, '');

  const json = run(['check', dir, '--json']);
  assert.strictEqual(json.status, 2);
  const payload = JSON.parse(json.stdout.trim());
  assert.strictEqual(payload.ok, false);
  assert.match(payload.error, /not found in/);
  assert.match(payload.hint, /env-saaf example/);
  assert.strictEqual(json.stderr, '');

  fs.rmSync(dir, { recursive: true, force: true });
}
// Issue #63: CLI scan also lists keys declared in the template that no code reads, as a
// warning only: stdout stays the plain list, the exit code stays 0.
{
  const { spawnSync } = require('node:child_process');
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const cli = path.join(__dirname, 'cli.js');
  const run = (args) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'env-saaf-scan-unused-'));
  try {
    fs.writeFileSync(path.join(dir, 'app.js'), 'const a = process.env.USED_KEY;\n');
    fs.writeFileSync(path.join(dir, '.env.example'), 'USED_KEY=1\nOLD_KEY=2\n');
    fs.writeFileSync(path.join(dir, '.env.sample'), 'USED_KEY=1\nSAMPLE_ONLY=3\n');

    // Text mode: used vars on stdout (unchanged), the unused key as a warning on stderr
    const plain = run(['scan', dir]);
    assert.strictEqual(plain.status, 0);
    assert.strictEqual(plain.stdout.trim(), 'USED_KEY');
    assert.match(plain.stderr, /UNUSED: OLD_KEY \(in \.env\.example, never used in code\)/);
    assert.ok(!plain.stderr.includes('USED_KEY (in'));

    // --json: an `unused` field next to `vars`, still ok: true and exit 0
    const json = run(['scan', dir, '--json']);
    assert.strictEqual(json.status, 0);
    assert.deepStrictEqual(JSON.parse(json.stdout), { ok: true, vars: ['USED_KEY'], unused: ['OLD_KEY'] });
    assert.strictEqual(json.stderr, '');

    // --file picks another template
    const sample = run(['scan', dir, '--file', '.env.sample', '--json']);
    assert.deepStrictEqual(JSON.parse(sample.stdout).unused, ['SAMPLE_ONLY']);

    // A template where every key is read produces no warning at all
    fs.writeFileSync(path.join(dir, '.env.example'), 'USED_KEY=1\n');
    const clean = run(['scan', dir]);
    assert.strictEqual(clean.status, 0);
    assert.strictEqual(clean.stderr, '');
    assert.deepStrictEqual(JSON.parse(run(['scan', dir, '--json']).stdout), { ok: true, vars: ['USED_KEY'], unused: [] });

    // No template file: nothing to compare, output exactly as before
    fs.rmSync(path.join(dir, '.env.example'));
    const none = run(['scan', dir, '--json']);
    assert.deepStrictEqual(JSON.parse(none.stdout), { ok: true, vars: ['USED_KEY'] });
    assert.strictEqual(none.stderr, '');
    assert.strictEqual(run(['scan', dir]).stderr, '');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// Issue #134: invalid schema rules must be rejected up front, even when no
// value is present to coerce (an absent optional key must not hide a typo).
{
  const unknown = validateEnv.bind(null, { TYPO: { type: 'emial' } }, {});
  assert.throws(unknown, EnvSaafError);
  assert.throws(unknown, /TYPO/);
  assert.throws(unknown, /emial/);

  // The invalid option is reported before any environment value is read.
  assert.throws(() => validateEnv({ K: { type: 'string', pattern: 'not-a-regexp' } }, {}), /"pattern" must be a RegExp/);
  assert.throws(() => validateEnv({ K: { type: 'string', transform: 'nope' } }, {}), /"transform" must be a function/);
  assert.throws(() => validateEnv({ K: { type: 'number', min: 'x' } }, {}), /"min"/);
  assert.throws(() => validateEnv({ K: { type: 'number', max: 'x' } }, {}), /"max"/);
  assert.throws(() => validateEnv({ K: { type: 'hex', length: 'x' } }, {}), /"length"/);

  // Valid rules still validate and coerce exactly as before.
  assert.strictEqual(validateEnv({ OK: { type: 'int', required: true } }, { OK: '42' }).OK, 42);
}

// Issue #133: a directory argument that is a file or does not exist must be
// reported clearly with exit 2, never a raw Node stack trace.
{
  const { spawnSync } = require('node:child_process');
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const cli = path.join(__dirname, 'cli.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'env-saaf-baddir-'));
  const file = path.join(dir, 'index.js');
  fs.writeFileSync(file, 'process.env.X;');

  try {
    for (const command of ['scan', 'check', 'example']) {
      // missing directory
      const missing = spawnSync(process.execPath, [cli, command, path.join(dir, 'nope')], { encoding: 'utf8' });
      assert.strictEqual(missing.status, 2, `${command} missing`);
      assert.ok(missing.stderr.includes('does not exist'), `${command} missing: ${missing.stderr}`);
      assert.ok(!/at .*readdirSync|ENOENT: no such file or directory, scandir/.test(missing.stderr), 'no stack trace');

      // a file where a directory is expected
      const asFile = spawnSync(process.execPath, [cli, command, file], { encoding: 'utf8' });
      assert.strictEqual(asFile.status, 2, `${command} file`);
      assert.ok(asFile.stderr.includes('is not a directory'), `${command} file: ${asFile.stderr}`);
      assert.ok(!/at .*readdirSync|ENOTDIR/.test(asFile.stderr), 'no stack trace');
    }

    // --json keeps stdout parseable with an error field and the same exit code.
    const json = spawnSync(process.execPath, [cli, 'scan', file, '--json'], { encoding: 'utf8' });
    assert.strictEqual(json.status, 2);
    assert.strictEqual(JSON.parse(json.stdout).ok, false);
    assert.ok(JSON.parse(json.stdout).error.includes('is not a directory'));

    // A real directory is still scanned normally.
    const ok = spawnSync(process.execPath, [cli, 'scan', dir], { encoding: 'utf8' });
    assert.strictEqual(ok.status, 0);
    assert.strictEqual(ok.stdout.trim(), 'X');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// Issue #144: duplicates fail through the public entry points without values.
{
  const fs = require('node:fs');
  const path = require('node:path');
  const { loadEnv } = require('./index');
  const duplicate = '# comment\r\nPORT=synthetic_first\r\nexport PORT=synthetic_second\r\n';
  const check = (error) => {
    assert.strictEqual(error.message, 'env-saaf: duplicate key PORT at line 3 (first defined at line 2)');
    return true;
  };
  assert.throws(() => parseEnvFile(duplicate), check);
  assert.throws(() => parseEnvFile('A="first\nsecond"\nA=third'), /duplicate key A at line 3 .*line 1/);
  assert.deepStrictEqual(parseEnvFile('A="first\nA=inside"\nB=ok'), { A: 'first\nA=inside', B: 'ok' });
  for (const key of ['constructor', 'toString', 'hasOwnProperty']) {
    assert.strictEqual(parseEnvFile(key + '=ok')[key], 'ok');
    assert.throws(() => parseEnvFile(key + '=one\n' + key + '=two'), /duplicate key/);
  }
  const dir = fs.mkdtempSync(path.join(__dirname, 'duplicate-test-'));
  const file = path.join(dir, '.env');
  try {
    fs.writeFileSync(file, duplicate);
    assert.throws(() => loadEnv({}, { path: file, env: {} }), check);
    fs.writeFileSync(file, 'PORT=3000\nNAME=example\n');
    assert.strictEqual(loadEnv({ PORT: { type: 'port' } }, { path: file, env: {} }).PORT, 3000);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// Issue #146: empty scans explain success on stderr without polluting stdout.
{
  const fs = require('node:fs');
  const path = require('node:path');
  const { spawnSync } = require('node:child_process');
  const dir = fs.mkdtempSync(path.join(__dirname, 'scan-empty-test-'));
  const run = (...args) => spawnSync(process.execPath, [path.join(__dirname, 'cli.js'), 'scan', dir, ...args], { encoding: 'utf8' });
  try {
    for (const source of [null, 'console.log("hello");\n']) {
      if (source) fs.writeFileSync(path.join(dir, 'app.js'), source);
      const plain = run();
      assert.strictEqual(plain.status, 0);
      assert.strictEqual(plain.stdout, '');
      assert.strictEqual(plain.stderr, 'No process.env usage found.\n');
      const json = run('--json');
      assert.strictEqual(json.status, 0);
      assert.strictEqual(json.stderr, '');
      assert.strictEqual(json.stdout, '{"ok":true,"vars":[]}\n');
    }
    fs.writeFileSync(path.join(dir, 'app.js'), 'process.env.SYNTHETIC_KEY;\n');
    const plain = run();
    assert.strictEqual(plain.status, 0);
    assert.strictEqual(plain.stdout, 'SYNTHETIC_KEY\n');
    assert.strictEqual(plain.stderr, '');
    const json = run('--json');
    assert.strictEqual(json.status, 0);
    assert.strictEqual(json.stderr, '');
    assert.strictEqual(json.stdout, '{"ok":true,"vars":["SYNTHETIC_KEY"]}\n');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// Issue #55: non-throwing mode — return { env, errors } instead of throwing,
// so a health check or a CLI can log every config problem and keep booting.
{
  const schema = {
    PORT: { type: 'port', required: true },
    NAME: { type: 'string' },
    DEBUG: { type: 'boolean', default: false },
  };

  // Default behaviour is unchanged: invalid values still throw.
  assert.throws(() => validateEnv(schema, { PORT: 'not-a-port' }), EnvSaafError);
  assert.throws(() => validateEnv(schema, { PORT: 'not-a-port' }, { throwOnError: true }), EnvSaafError);

  // Invalid values are collected; the values that did validate are returned.
  const partial = validateEnv(schema, { PORT: 'abc', NAME: 'ok', DEBUG: 'yes' }, { throwOnError: false });
  assert.deepStrictEqual(partial.env, { NAME: 'ok', DEBUG: true });
  assert.deepStrictEqual(partial.errors, ['PORT: expected a port (0-65535, e.g. 3000), got "abc"']);

  // A clean environment returns the env the throwing API would and no errors.
  const clean = validateEnv(schema, { PORT: '3000', DEBUG: 'false' }, { throwOnError: false });
  assert.deepStrictEqual(clean.env, { PORT: 3000, DEBUG: false });
  assert.deepStrictEqual(clean.errors, []);

  // The returned list is the EnvSaafError contents, one-to-one.
  const bad = { PORT: 'x', DEBUG: 'maybe' };
  let thrown;
  try { validateEnv(schema, bad); } catch (e) { thrown = e; }
  assert.ok(thrown instanceof EnvSaafError);
  const collected = validateEnv(schema, bad, { throwOnError: false });
  assert.deepStrictEqual(collected.errors, thrown.errors);
  assert.strictEqual(collected.errors.length, 2);

  // strict-mode findings are collected the same way.
  const strict = validateEnv(schema, { PORT: '3000', TYPO: 'x' }, { strict: true, throwOnError: false });
  assert.deepStrictEqual(strict.env, { PORT: 3000, DEBUG: false });
  assert.deepStrictEqual(strict.errors, ['TYPO: set but not in schema (strict mode)']);

  // The returned env is frozen exactly like the throwing API's result.
  assert.ok(Object.isFrozen(strict.env));
  assert.deepStrictEqual(validateEnv({}, {}, { throwOnError: false }), { env: {}, errors: [] });

  // A malformed schema is a bug in the code, not a config problem: it throws
  // even in non-throwing mode, where no result could be trusted.
  assert.throws(() => validateEnv({ TYPO: { type: 'emial' } }, {}, { throwOnError: false }), /emial/);

  // loadEnv keeps throwing: with assign: true it writes into the real env, so
  // a partial result must not be accepted there.
  const fs = require('node:fs');
  const path = require('node:path');
  const { loadEnv } = require('./index');
  const dir = fs.mkdtempSync(path.join(__dirname, 'non-throwing-test-'));
  try {
    const file = path.join(dir, '.env');
    fs.writeFileSync(file, 'PORT=not-a-port\n');
    assert.throws(() => loadEnv({ PORT: { type: 'port' } }, { path: file, env: {}, throwOnError: false }), EnvSaafError);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// Issue #169: exercise the CLI's Windows path handling with an in-memory filesystem.
{
  const fs = require('node:fs');
  const path = require('node:path').win32;
  const { runInNewContext } = require('node:vm');
  const cli = fs.readFileSync(require.resolve('./cli'), 'utf8');
  const dir = 'C:\\project';
  for (const [name, schemaPath, example] of [
    ['D:custom.js', 'D:\\schemas\\custom.js', 'npx env-saaf check . --schema D:/schemas/custom.js'],
    ["schema files/it's custom.js", "C:\\project\\schema files\\it's custom.js",
      `npx env-saaf check . --schema "./schema files/it's custom.js"`],
    ['budget! draft.js', 'C:\\project\\budget! draft.js'],
  ]) {
    const writes = new Map();
    const requireFromCli = id => {
      if (id === 'node:fs') return {
        existsSync: file => file === dir,
        statSync: () => ({ isDirectory: () => true }),
        // Issue #171: init now scans the directory before writing; this stub
        // project has no files, so the scan finds nothing.
        readdirSync: () => [],
        writeFileSync: (file, contents) => writes.set(file, contents),
      };
      if (id === 'node:path') return {
        ...path,
        // Supply D:'s current directory without relying on the host environment.
        resolve: (root, file) => path.resolve(file === 'D:custom.js' ? 'D:\\schemas' : root, file),
      };
      if (id === schemaPath) return {};
      // Issue #171: init scans the directory before writing; this stub
      // project ('C:\\project') does not exist on disk, so hand the CLI a
      // scan that finds nothing instead of the real scanDir.
      if (id === './index') return { ...require('./index'), scanDir: () => [] };
      return require(id);
    };
    requireFromCli.resolve = id => id;
    requireFromCli.cache = {};
    runInNewContext(cli, {
      require: requireFromCli,
      process: { argv: ['node', 'cli.js', 'init', dir, '--schema', name], platform: 'win32' },
    });
    const generated = writes.get(schemaPath);
    assert.ok(generated, schemaPath);
    if (!example) {
      assert.match(generated, /--schema set to this path \(JSON\): "\.\/budget! draft\.js"\n/);
      assert.doesNotMatch(generated, /npx env-saaf check/);
      continue;
    }
    const label = example.includes('"') ? ' (cmd.exe)' : '';
    assert.ok(generated.includes(`// Validate the real .env against it${label}: ${example}\n`), generated);
    const argument = example.split(' --schema ')[1].replace(/^"|"$/g, '');
    assert.strictEqual(path.resolve(dir, argument), schemaPath);
  }
}

// Issue #60: CLI 'init' — scaffold a starter schema + .env.example.
{
  const { spawnSync } = require('node:child_process');
  const fs = require('node:fs');
  const path = require('node:path');
  const cli = path.join(__dirname, 'cli.js');
  const run = (args) => spawnSync('node', [cli, ...args], { encoding: 'utf8' });

  const dir = fs.mkdtempSync(path.join(__dirname, 'init-test-'));
  try {
    // Both files land in an empty directory, with a confirmation on stdout.
    const first = run(['init', dir]);
    assert.strictEqual(first.status, 0, first.stderr);
    assert.ok(first.stdout.includes('env.schema.js') && first.stdout.includes('.env.example'));
    const schemaFile = path.join(dir, 'env.schema.js');
    const exampleFile = path.join(dir, '.env.example');
    assert.ok(fs.existsSync(schemaFile));
    assert.ok(fs.existsSync(exampleFile));
    // The scaffold is a valid schema object, and the .env.example on disk is
    // exactly what generateExample produces from it — the two cannot drift.
    const starter = require(schemaFile);
    const types = Object.values(starter).map(rule => rule.type);
    for (const t of ['string', 'int', 'boolean', 'port', 'url', 'email']) {
      assert.ok(types.includes(t), `starter schema should demonstrate ${t}`);
    }
    assert.strictEqual(fs.readFileSync(exampleFile, 'utf8'), generateExample(starter));
    assert.deepStrictEqual(
      Object.keys(starter),
      fs.readFileSync(exampleFile, 'utf8').split('\n')
        .filter(l => l && !l.startsWith('#')).map(l => l.split('=')[0]),
    );

    // Refuses to overwrite either file without --force, naming what exists,
    // and the files keep their content.
    const before = fs.readFileSync(schemaFile, 'utf8');
    assert.match(before, /npx env-saaf check \. --schema \.\/env\.schema\.js$/m);
    const again = run(['init', dir]);
    assert.strictEqual(again.status, 1);
    assert.match(again.stderr, /already exist/);
    assert.match(again.stderr, /--force/);
    assert.strictEqual(fs.readFileSync(schemaFile, 'utf8'), before);

    // --force overwrites both files: a hand-edited schema is replaced by the
    // scaffold again.
    fs.writeFileSync(schemaFile, 'module.exports = { HAND_EDITED: true };\n');
    const forced = run(['init', dir, '--force']);
    assert.strictEqual(forced.status, 0, forced.stderr);
    assert.strictEqual(fs.readFileSync(schemaFile, 'utf8'), before);
    assert.strictEqual(fs.readFileSync(exampleFile, 'utf8'), generateExample(starter));

    // --schema names the schema file; the .env.example is still generated.
    const dir2 = fs.mkdtempSync(path.join(dir, 'named-'));
    try {
      const assertSchemaExample = (schema, argument) => {
        const named = run(['init', dir2, '--force', '--schema', schema]);
        assert.strictEqual(named.status, 0, named.stderr);
        const generated = fs.readFileSync(path.resolve(dir2, schema), 'utf8');
        assert.ok(generated.includes(`npx env-saaf check . --schema ${argument}\n`), generated);
      };
      assertSchemaExample('custom.js', './custom.js');
      assert.ok(fs.existsSync(path.join(dir2, '.env.example')));

      assertSchemaExample('../parent.js', './../parent.js');
      fs.mkdirSync(path.join(dir2, 'schema files'));
      const absolute = path.join(dir2, 'schema files', 'absolute.js');
      const absoluteArg = absolute.split(path.sep).join('/');
      if (process.platform === 'win32') {
        assertSchemaExample('schema files/custom.js', '"./schema files/custom.js"');
        if (/^[\w./: '()-]+$/.test(absoluteArg)) {
          assertSchemaExample(absolute, `"${absoluteArg}"`);
        }
      } else {
        assertSchemaExample('schema files/custom.js', "'./schema files/custom.js'");
        assertSchemaExample(absolute, `'${absoluteArg.replace(/'/g, `'"'"'`)}'`);
      }

      if (process.platform !== 'win32') {
        assertSchemaExample("it's $config.js", "'./it'\"'\"'s $config.js'");
        assertSchemaExample('line\nbreak.js', "$'./line\\nbreak.js'");
        assertSchemaExample('line\u2028separator.js', "$'./line\\342\\200\\250separator.js'");
      }
    } finally {
      fs.rmSync(dir2, { recursive: true, force: true });
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// Issue #175: 'number' and 'int' reject non-finite values (Infinity, -Infinity, exponent overflow).
{
  const nonFinite = ['Infinity', '-Infinity', '+Infinity', '1e999', '-1e999', ' Infinity ', ' 1e999 '];
  for (const raw of nonFinite) {
    assert.throws(
      () => validateEnv({ N: { type: 'number' } }, { N: raw }),
      err => err instanceof EnvSaafError && err.errors.length === 1
        && err.errors[0] === `N: expected a number (e.g. 3.14), got "${raw}"`,
    );
    assert.throws(
      () => validateEnv({ N: { type: 'int' } }, { N: raw }),
      err => err instanceof EnvSaafError && err.errors.length === 1
        && err.errors[0] === `N: expected an integer (e.g. 42), got "${raw}"`,
    );
  }
  // Non-finite values cannot slip past a lower bound like min: 0 either.
  assert.throws(
    () => validateEnv({ N: { type: 'number', min: 0 } }, { N: 'Infinity' }),
    err => err instanceof EnvSaafError && err.errors[0] === 'N: expected a number (e.g. 3.14), got "Infinity"',
  );
  // Non-finite defaults are rejected just like env inputs.
  for (const def of [Infinity, -Infinity, '1e999']) {
    assert.throws(
      () => validateEnv({ N: { type: 'number', default: def } }, {}),
      err => err instanceof EnvSaafError && err.errors[0] === `N: expected a number (e.g. 3.14), got "${def}"`,
    );
    assert.throws(
      () => validateEnv({ N: { type: 'int', default: def } }, {}),
      err => err instanceof EnvSaafError && err.errors[0] === `N: expected an integer (e.g. 42), got "${def}"`,
    );
  }
  // Non-throwing mode collects the error and omits the key.
  const collected = validateEnv({ N: { type: 'number' } }, { N: '1e999' }, { throwOnError: false });
  assert.deepStrictEqual(collected.env, {});
  assert.deepStrictEqual(collected.errors, ['N: expected a number (e.g. 3.14), got "1e999"']);
  // Ordinary finite inputs still pass for both 'number' and 'int'.
  for (const [raw, expected] of [['0', 0], ['42', 42], ['-7', -7], ['3.14', 3.14], ['-0.5', -0.5], ['1e3', 1000], ['1.5e-2', 0.015]]) {
    assert.strictEqual(validateEnv({ N: { type: 'number' } }, { N: raw }).N, expected);
  }
  for (const [raw, expected] of [['0', 0], ['42', 42], ['-7', -7], ['1e3', 1000], ['1.5e2', 150]]) {
    assert.strictEqual(validateEnv({ N: { type: 'int' } }, { N: raw }).N, expected);
  }
}

// Issue #58: every built-in type's validation error includes a format example,
// and aggregated errors remain one concise bullet per key.
{
  const cases = [
    ['email', 'not-an-email', 'e.g. user@example.com'],
    ['number', 'not-a-number', 'e.g. 3.14'],
    ['int', '3.5', 'e.g. 42'],
    ['json', '{bad', 'e.g. {"key":"value"}'],
    ['boolean', 'maybe', 'e.g. true/false, yes/no, on/off, 1/0, y/n'],
    ['url', 'not-a-url', 'e.g. https://example.com'],
    ['uuid', 'not-a-uuid', 'e.g. 550e8400-e29b-41d4-a716-446655440000'],
    ['hex', 'not-hex!', 'e.g. deadbeef'],
    ['ipv4', '999.1.1.1', 'e.g. 192.168.0.1'],
    ['semver', 'v1.2.3', 'e.g. 1.2.3'],
    ['base64', 'not base64!', 'e.g. aGVsbG8='],
    ['port', 'abc', '0-65535, e.g. 3000'],
    ['date', '2026-02-31', 'e.g. 2026-01-31'],
    ['file', './definitely-missing-env-saaf-file.json', 'e.g. ./config.json'],
    ['duration', '15min', 'e.g. 500ms, 30s, 15m, 2h, 1d, 1w'],
    ['host', 'https://db.internal', 'e.g. db.internal, localhost, 10.0.0.5'],
  ];
  for (const [type, bad, expectedHint] of cases) {
    assert.throws(
      () => validateEnv({ VAL: { type } }, { VAL: bad }),
      err => err instanceof EnvSaafError
        && err.errors.length === 1
        && err.errors[0].includes(`(${expectedHint})`)
        && err.errors[0].includes(`got "${bad}"`),
      `${type} error should include (${expectedHint})`,
    );
  }

  // Aggregated EnvSaafError stays readable: one single-line bullet per failing key.
  const schema = {};
  const badEnv = {};
  for (const [type, bad] of cases) {
    const key = `BAD_${type.toUpperCase()}`;
    schema[key] = { type, required: true };
    badEnv[key] = bad;
  }
  let aggregated;
  try { validateEnv(schema, badEnv); } catch (e) { aggregated = e; }
  assert.ok(aggregated instanceof EnvSaafError);
  assert.strictEqual(aggregated.errors.length, cases.length);
  const lines = aggregated.message.split('\n');
  assert.strictEqual(lines[0], 'Invalid environment variables:');
  assert.strictEqual(lines.length, cases.length + 1);
  for (let i = 0; i < cases.length; i++) {
    const [type, , expectedHint] = cases[i];
    const key = `BAD_${type.toUpperCase()}`;
    assert.ok(lines[i + 1].startsWith(`  - ${key}: `), lines[i + 1]);
    assert.ok(lines[i + 1].includes(`(${expectedHint})`), lines[i + 1]);
  }
}

// Issue #170 + #178: CLI round-trip — a fresh `init` followed by `check`
// passes with a single note instead of one UNUSED line per scaffolded key,
// and UNUSED fails the check again as soon as code reads a variable.
{
  const { spawnSync } = require('node:child_process');
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const cli = path.join(__dirname, 'cli.js');
  const run = (args) => spawnSync('node', [cli, ...args], { encoding: 'utf8' });

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'env-saaf-roundtrip-'));
  try {
    // init in an empty directory, then check: exit 0, one plain note, no
    // UNUSED lines — the scaffold is ahead of the code, not drift.
    const inited = run(['init', dir]);
    assert.strictEqual(inited.status, 0, inited.stderr);
    const checked = run(['check', dir]);
    assert.strictEqual(checked.status, 0, checked.stdout + checked.stderr);
    assert.ok(checked.stdout.includes('no process.env usage found in code yet'), checked.stdout);
    assert.ok(checked.stdout.includes('8 keys in .env.example are not used by any code yet'), checked.stdout);
    assert.ok(!checked.stdout.includes('UNUSED:'), checked.stdout);
    const checkedJson = JSON.parse(run(['check', dir, '--json']).stdout.trim());
    assert.strictEqual(checkedJson.ok, true);
    assert.deepStrictEqual(checkedJson.extra, []);
    assert.ok(checkedJson.note.includes('no process.env usage found in code yet'), checkedJson.note);
    // --schema with no real .env: the schema step is skipped, the note still rules.
    assert.strictEqual(run(['check', dir, '--schema', './env.schema.js']).status, 0);

    // A real finding still fails even with no code usage: an EXTRA key in .env
    // is not hidden behind the scaffold note.
    fs.writeFileSync(path.join(dir, '.env'), 'TYPO_KEY=1\n');
    const extra = run(['check', dir]);
    assert.strictEqual(extra.status, 1);
    assert.ok(extra.stdout.includes('EXTRA in .env: TYPO_KEY'), extra.stdout);
    fs.rmSync(path.join(dir, '.env'));

    // Once code reads one variable, UNUSED is a finding again (#113): the
    // other seven scaffolded keys fail the check, in text and --json.
    fs.writeFileSync(path.join(dir, 'app.js'), 'const port = process.env.PORT;\n');
    const drifted = run(['check', dir]);
    assert.strictEqual(drifted.status, 1);
    assert.ok(drifted.stdout.includes('UNUSED: APP_NAME'), drifted.stdout);
    assert.ok(!drifted.stdout.includes('no process.env usage found'), drifted.stdout);
    const driftedJson = JSON.parse(run(['check', dir, '--json']).stdout.trim());
    assert.strictEqual(driftedJson.ok, false);
    assert.strictEqual(driftedJson.extra.length, 7);
    assert.strictEqual(driftedJson.note, undefined);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// Issue #184: CLI 'init' in an ES module project writes env.schema.cjs
// instead of crashing on require() of a .js starter Node treats as ESM.
{
  const { spawnSync } = require('node:child_process');
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const cli = path.join(__dirname, 'cli.js');
  const run = (args) => spawnSync('node', [cli, ...args], { encoding: 'utf8' });

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'env-saaf-esm-'));
  try {
    // A "type": "module" project: init exits 0, writes env.schema.cjs (not
    // env.schema.js) + .env.example, and the whole round-trip works —
    // check passes with the scaffold note, and check --schema validates a
    // real .env against the .cjs schema.
    fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"esmproj","type":"module"}\n');
    const inited = run(['init', dir]);
    assert.strictEqual(inited.status, 0, inited.stderr);
    assert.ok(inited.stdout.includes('env.schema.cjs'), inited.stdout);
    assert.ok(fs.existsSync(path.join(dir, 'env.schema.cjs')));
    assert.ok(!fs.existsSync(path.join(dir, 'env.schema.js')));
    assert.ok(fs.existsSync(path.join(dir, '.env.example')));
    const starter = require(path.join(dir, 'env.schema.cjs'));
    assert.strictEqual(starter.PORT.type, 'port');
    assert.strictEqual(fs.readFileSync(path.join(dir, '.env.example'), 'utf8'), generateExample(starter));
    assert.strictEqual(run(['check', dir]).status, 0);
    fs.writeFileSync(path.join(dir, '.env'),
      'APP_NAME=myapp\nRETRIES=3\nDEBUG=false\nPORT=3000\nAPI_URL=https://example.com\nSUPPORT_EMAIL=a@b.com\nSHUTDOWN_TIMEOUT=15m\nDB_HOST=localhost\n');
    assert.strictEqual(run(['check', dir, '--schema', './env.schema.cjs']).status, 0);
    fs.rmSync(path.join(dir, '.env'));

    // An explicit --schema .js name in the same project is refused cleanly
    // (exit 2, no stack trace) and writes neither file.
    const refused = run(['init', dir, '--force', '--schema', 'custom.js']);
    assert.strictEqual(refused.status, 2, refused.stdout + refused.stderr);
    assert.ok(refused.stderr.includes('.cjs'), refused.stderr);
    assert.ok(!refused.stderr.includes('ReferenceError'), refused.stderr);
    assert.ok(!fs.existsSync(path.join(dir, 'custom.js')));

    // check --schema on a .js schema in an ES module project names the fix.
    fs.writeFileSync(path.join(dir, 'bad.js'), "module.exports = { PORT: { type: 'port' } };\n");
    fs.writeFileSync(path.join(dir, '.env'), 'PORT=3000\n');
    const badCheck = run(['check', dir, '--schema', './bad.js']);
    assert.strictEqual(badCheck.status, 2);
    assert.ok(badCheck.stderr.includes('.cjs'), badCheck.stderr);
    assert.ok(!badCheck.stderr.includes('ReferenceError'), badCheck.stderr);
    fs.rmSync(path.join(dir, '.env'));
    fs.rmSync(path.join(dir, 'bad.js'));

    // A CommonJS project is unchanged: the starter is still env.schema.js.
    const cjsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'env-saaf-cjs-'));
    try {
      fs.writeFileSync(path.join(cjsDir, 'package.json'), '{"name":"cjsproj","type":"commonjs"}\n');
      const cjsInit = run(['init', cjsDir]);
      assert.strictEqual(cjsInit.status, 0, cjsInit.stderr);
      assert.ok(fs.existsSync(path.join(cjsDir, 'env.schema.js')));
      assert.ok(!fs.existsSync(path.join(cjsDir, 'env.schema.cjs')));
    } finally {
      fs.rmSync(cjsDir, { recursive: true, force: true });
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// Issue #171: `init` scans the directory first (the same scan `check` and
// `example` use) and folds keys the code already reads into the starter schema
// as `{ type: 'string' }` entries, so the generated .env.example covers them
// and the first `check` reports no MISSING lines to merge by hand. A directory
// with no code yet scaffolds exactly as before, and keys the scaffold already
// declares are not duplicated.
{
  const { spawnSync } = require('node:child_process');
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const cli = path.join(__dirname, 'cli.js');
  const run = (args) => spawnSync('node', [cli, ...args], { encoding: 'utf8' });

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'env-saaf-init-scan-'));
  try {
    // Code already reads FOO and PORT: FOO must be folded into the scaffold,
    // while PORT (already scaffolded) must not be duplicated.
    fs.writeFileSync(path.join(dir, 'app.js'), 'const port = process.env.PORT;\nconst tag = process.env.FOO;\n');
    const inited = run(['init', dir]);
    assert.strictEqual(inited.status, 0, inited.stderr);
    // The discovered keys are listed in init's output.
    assert.ok(inited.stdout.includes('folded in 1 key found by scanning the code: FOO'), inited.stdout);
    const schemaFile = path.join(dir, 'env.schema.js');
    const schemaText = fs.readFileSync(schemaFile, 'utf8');
    assert.match(schemaText, /FOO: \{ type: 'string' \},/);
    assert.match(schemaText, /Found by scanning this project's code/);
    assert.strictEqual(schemaText.match(/^  PORT:/gm).length, 1, schemaText);
    const starter = require(schemaFile);
    assert.deepStrictEqual(starter.FOO, { type: 'string' });
    const exampleText = fs.readFileSync(path.join(dir, '.env.example'), 'utf8');
    assert.match(exampleText, /^FOO=your_value_here$/m);
    assert.strictEqual(exampleText.match(/^PORT=/gm).length, 1, exampleText);
    assert.strictEqual(exampleText, generateExample(starter));

    // The original complaint is gone: the first `check` after init no longer
    // reports the scanned key as MISSING in .env.example (text or --json).
    const checked = run(['check', dir]);
    assert.ok(!checked.stdout.includes('MISSING in .env.example: FOO'), checked.stdout);
    const checkedJson = JSON.parse(run(['check', dir, '--json']).stdout.trim());
    assert.deepStrictEqual(checkedJson.missing, []);

    // Once the code reads every documented key (the folded one included), the
    // whole round trip is clean: check --schema validates a real .env against
    // the folded scaffold with no hand merging.
    fs.writeFileSync(path.join(dir, 'app.js'),
      'const a = process.env.APP_NAME, r = process.env.RETRIES, d = process.env.DEBUG;\n'
      + 'const p = process.env.PORT, u = process.env.API_URL, e = process.env.SUPPORT_EMAIL;\n'
      + 'const t = process.env.SHUTDOWN_TIMEOUT, h = process.env.DB_HOST, f = process.env.FOO;\n');
    fs.writeFileSync(path.join(dir, '.env'),
      'APP_NAME=myapp\nRETRIES=3\nDEBUG=false\nPORT=3000\nAPI_URL=https://example.com\nSUPPORT_EMAIL=a@b.com\nSHUTDOWN_TIMEOUT=15m\nDB_HOST=localhost\nFOO=bar\n');
    const roundTrip = run(['check', dir, '--schema', './env.schema.js']);
    assert.strictEqual(roundTrip.status, 0, roundTrip.stdout + roundTrip.stderr);
    assert.ok(roundTrip.stdout.includes('all clean'), roundTrip.stdout);
    fs.rmSync(path.join(dir, '.env'));

    // A fresh directory (no code yet) behaves exactly as before: the same 8
    // starter keys, no scan comment, and no "folded in" line on stdout.
    const fresh = fs.mkdtempSync(path.join(os.tmpdir(), 'env-saaf-init-fresh-'));
    try {
      const freshInit = run(['init', fresh]);
      assert.strictEqual(freshInit.status, 0, freshInit.stderr);
      assert.ok(freshInit.stdout.includes('(8 variables)'), freshInit.stdout);
      assert.ok(!freshInit.stdout.includes('folded in'), freshInit.stdout);
      const freshSchema = fs.readFileSync(path.join(fresh, 'env.schema.js'), 'utf8');
      assert.doesNotMatch(freshSchema, /Found by scanning/);
      const freshStarter = require(path.join(fresh, 'env.schema.js'));
      assert.deepStrictEqual(
        Object.keys(freshStarter),
        ['APP_NAME', 'RETRIES', 'DEBUG', 'PORT', 'API_URL', 'SUPPORT_EMAIL', 'SHUTDOWN_TIMEOUT', 'DB_HOST'],
      );
    } finally {
      fs.rmSync(fresh, { recursive: true, force: true });
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// Issue #54: `sensitive: true` masks a key's value in all validation errors
// and CLI output, even when its name does not look like a secret.
{
  const { spawnSync } = require('node:child_process');
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { loadEnv } = require('./index');

  // 1. Invalid non-boolean `sensitive` option is rejected up front even when absent.
  for (const bad of ['true', 1, 0, null, {}]) {
    assert.throws(
      () => validateEnv({ SESSION_ID: { type: 'string', sensitive: bad } }, {}),
      err => err instanceof EnvSaafError
        && err.errors.includes('SESSION_ID: "sensitive" must be a boolean'),
    );
  }

  // 2. Coercion errors across types never leak the raw value when sensitive: true.
  const coercionCases = [
    ['email', 'not-an-email-secret99'],
    ['number', 'not-a-number-secret99'],
    ['int', 'not-an-int-secret99'],
    ['json', '{bad-json-secret99'],
    ['boolean', 'not-a-bool-secret99'],
    ['url', 'not-a-url-secret99'],
    ['file', path.join(os.tmpdir(), 'env-saaf-missing-secret-file-99999')],
    ['uuid', 'not-a-uuid-secret99'],
    ['hex', 'not-hex-secret99'],
    ['ipv4', '999.999.999.999'],
    ['semver', 'v-secret-1.2.3'],
    ['base64', 'not*base64*secret99'],
    ['date', 'not-a-date-secret99'],
    ['duration', 'not-a-duration-secret99'],
    ['host', 'https://secret-host.internal/path'],
    ['port', '99999'],
  ];
  for (const [type, raw] of coercionCases) {
    assert.throws(
      () => validateEnv({ SESSION_ID: { type, sensitive: true } }, { SESSION_ID: raw }),
      err => err instanceof EnvSaafError
        && !err.message.includes(raw)
        && err.errors[0].includes(`got "${maskValue(raw)}"`),
      `expected masked error for type "${type}"`,
    );
  }
  // URL protocols mismatch also masks sensitive values.
  const badProtoUrl = 'http://secret-token-host.internal/callback';
  assert.throws(
    () => validateEnv({ SESSION_ID: { type: 'url', protocols: ['https'], sensitive: true } }, { SESSION_ID: badProtoUrl }),
    err => err instanceof EnvSaafError
      && !err.message.includes(badProtoUrl)
      && err.errors[0].includes(`got "${maskValue(badProtoUrl)}"`),
  );

  // 3. Post-coercion rule checks (min/max, minLength/maxLength, length, choices, pattern, transform).
  assert.throws(
    () => validateEnv({ LICENSE_KEY: { type: 'int', min: 100000, sensitive: true } }, { LICENSE_KEY: '12345' }),
    err => err instanceof EnvSaafError && !err.message.includes('12345') && err.errors[0].includes('got "12***45"'),
  );
  assert.throws(
    () => validateEnv({ SESSION_ID: { type: 'string', minLength: 30, sensitive: true } }, { SESSION_ID: 'sess_secret_99' }),
    err => err instanceof EnvSaafError && !err.message.includes('sess_secret_99') && err.errors[0].includes('got "se***99"'),
  );
  assert.throws(
    () => validateEnv({ LICENSE_KEY: { type: 'hex', length: 32, sensitive: true } }, { LICENSE_KEY: 'deadbeef1234' }),
    err => err instanceof EnvSaafError && !err.message.includes('deadbeef1234') && err.errors[0].includes('got "de***34"'),
  );
  assert.throws(
    () => validateEnv({ SESSION_ID: { type: 'string', choices: ['alpha', 'beta'], sensitive: true } }, { SESSION_ID: 'secret_gamma_99' }),
    err => err instanceof EnvSaafError && !err.message.includes('secret_gamma_99') && err.errors[0].includes('got "se***99"'),
  );
  assert.throws(
    () => validateEnv({ SESSION_ID: { type: 'string', pattern: /^sid_/, sensitive: true } }, { SESSION_ID: 'raw_secret_token_99' }),
    err => err instanceof EnvSaafError && !err.message.includes('raw_secret_token_99') && err.errors[0].includes('got "ra***99"'),
  );
  // Throwing transform that echoes the value still does not leak the raw value.
  assert.throws(
    () => validateEnv(
      { SESSION_ID: { type: 'string', sensitive: true, transform: v => { throw new Error(`bad token ${v}`); } } },
      { SESSION_ID: 'raw_secret_token_99' },
    ),
    err => err instanceof EnvSaafError && !err.message.includes('raw_secret_token_99') && err.errors[0].includes('ra***99'),
  );

  // 4. Short sensitive values mask to '****' without leaking.
  assert.throws(
    () => validateEnv({ SESSION_ID: { type: 'int', sensitive: true } }, { SESSION_ID: 'bad!' }),
    err => err instanceof EnvSaafError && !err.message.includes('bad!') && err.errors[0].includes('got "****"'),
  );

  // 5. Valid sensitive values return the real unmasked value.
  const okRes = validateEnv(
    { SESSION_ID: { type: 'string', pattern: /^sid_/, sensitive: true } },
    { SESSION_ID: 'sid_real_value_123' },
  );
  assert.strictEqual(okRes.SESSION_ID, 'sid_real_value_123');

  // 6. Non-throwing mode masks sensitive values in errors too.
  const nonThrow = validateEnv(
    { SESSION_ID: { type: 'uuid', sensitive: true } },
    { SESSION_ID: 'sess_raw_secret_42' },
    { throwOnError: false },
  );
  assert.deepStrictEqual(nonThrow.env, {});
  assert.strictEqual(nonThrow.errors.length, 1);
  assert.ok(!nonThrow.errors[0].includes('sess_raw_secret_42'));
  assert.ok(nonThrow.errors[0].includes('got "se***42"'));

  // 7. Non-sensitive control: sensitive omitted or false behaves identically to before.
  assert.throws(
    () => validateEnv({ SESSION_ID: { type: 'int' } }, { SESSION_ID: 'not-an-int-plain99' }),
    err => err instanceof EnvSaafError && err.errors[0] === 'SESSION_ID: expected an integer (e.g. 42), got "not-an-int-plain99"',
  );
  assert.throws(
    () => validateEnv({ SESSION_ID: { type: 'int', sensitive: false } }, { SESSION_ID: 'not-an-int-plain99' }),
    err => err instanceof EnvSaafError && err.errors[0] === 'SESSION_ID: expected an integer (e.g. 42), got "not-an-int-plain99"',
  );

  // 8. maskSecrets masks innocuously-named keys as well.
  assert.deepStrictEqual(
    maskSecrets({ SESSION_ID: 'sess_raw_secret_42', LICENSE_KEY: 'lic_99887766' }),
    { SESSION_ID: 'se***42', LICENSE_KEY: 'li***66' },
  );

  // 9. generateExample leaves sensitive keys empty (unless default is set),
  // while non-sensitive innocuously-named keys keep their placeholder.
  const exSens = generateExample({
    SESSION_ID: { type: 'string', required: true, sensitive: true },
    PLAIN_ID: { type: 'string', required: true },
    SENS_DEFAULT: { type: 'string', sensitive: true, default: 'dev-placeholder' },
  });
  assert.match(exSens, /^SESSION_ID=$/m);
  assert.match(exSens, /^PLAIN_ID=your_value_here$/m);
  assert.match(exSens, /^SENS_DEFAULT=dev-placeholder$/m);

  // 10. loadEnv and CLI `check --schema` (text and --json) mask sensitive values.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'env-saaf-sensitive-'));
  try {
    const envFile = path.join(dir, '.env');
    const exampleFile = path.join(dir, '.env.example');
    const schemaFile = path.join(dir, 'env.schema.js');
    const secretVal = 'lic_super_secret_987654';
    fs.writeFileSync(envFile, `SESSION_ID=${secretVal}\n`);
    fs.writeFileSync(exampleFile, 'SESSION_ID=\n');
    fs.writeFileSync(path.join(dir, 'app.js'), 'const s = process.env.SESSION_ID;\n');
    fs.writeFileSync(schemaFile, "module.exports = { SESSION_ID: { type: 'uuid', required: true, sensitive: true } };\n");

    assert.throws(
      () => loadEnv({ SESSION_ID: { type: 'uuid', required: true, sensitive: true } }, { path: envFile, env: {} }),
      err => err instanceof EnvSaafError && !err.message.includes(secretVal) && err.errors[0].includes('got "li***54"'),
    );

    const cli = path.join(__dirname, 'cli.js');
    const textRun = spawnSync('node', [cli, 'check', dir, '--schema', './env.schema.js'], { encoding: 'utf8' });
    assert.strictEqual(textRun.status, 1);
    assert.ok(!textRun.stdout.includes(secretVal) && !textRun.stderr.includes(secretVal), textRun.stdout + textRun.stderr);
    assert.ok(textRun.stdout.includes('INVALID: SESSION_ID:') && textRun.stdout.includes('got "li***54"'), textRun.stdout);

    const jsonRun = spawnSync('node', [cli, 'check', dir, '--schema', './env.schema.js', '--json'], { encoding: 'utf8' });
    assert.strictEqual(jsonRun.status, 1);
    assert.ok(!jsonRun.stdout.includes(secretVal) && !jsonRun.stderr.includes(secretVal), jsonRun.stdout + jsonRun.stderr);
    const parsed = JSON.parse(jsonRun.stdout.trim());
    assert.strictEqual(parsed.ok, false);
    assert.ok(parsed.invalid[0].includes('got "li***54"'), parsed.invalid[0]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// Issue #52: per-key `validate(value, env)` function for custom rules.
{
  // 1. Non-function `validate` is rejected up front in validateSchema,
  // even when the key is absent/optional and even with throwOnError: false.
  for (const bad of ['fn', 123, true, null, {}]) {
    assert.throws(
      () => validateEnv({ CUSTOM: { type: 'string', validate: bad } }, {}),
      err => err instanceof EnvSaafError
        && err.errors.includes('CUSTOM: "validate" must be a function'),
    );
    assert.throws(
      () => validateEnv({ CUSTOM: { type: 'string', validate: bad } }, {}, { throwOnError: false }),
      err => err instanceof EnvSaafError
        && err.errors.includes('CUSTOM: "validate" must be a function'),
    );
  }

  // 2. Passing return values: true, undefined, null, and empty string.
  const passRes = validateEnv(
    {
      A: { type: 'string', validate: () => true },
      B: { type: 'string', validate: () => undefined },
      C: { type: 'string', validate: () => null },
      D: { type: 'string', validate: () => '' },
    },
    { A: 'a', B: 'b', C: 'c', D: 'd' },
  );
  assert.deepStrictEqual(passRes, { A: 'a', B: 'b', C: 'c', D: 'd' });

  // 3. Failing return values: string message and boolean false.
  assert.throws(
    () => validateEnv(
      { APP_PORT: { type: 'port', validate: v => v >= 1024 || 'must be an unprivileged port (>= 1024)' } },
      { APP_PORT: '80' },
    ),
    err => err instanceof EnvSaafError
      && err.errors.length === 1
      && err.errors[0] === 'APP_PORT: must be an unprivileged port (>= 1024)',
  );
  assert.throws(
    () => validateEnv(
      { APP_PORT: { type: 'port', validate: v => v >= 1024 } },
      { APP_PORT: '80' },
    ),
    err => err instanceof EnvSaafError
      && err.errors.length === 1
      && err.errors[0] === 'APP_PORT: failed custom validation, got "80"',
  );

  // 4. Receives coerced value and full env object (cross-key checks).
  let seenVal, seenEnv;
  const inputEnv = { PRIMARY_HOST: 'db1.internal', REPLICA_HOST: 'db2.internal', CONFIG: '{"retries":3}' };
  const crossOk = validateEnv(
    {
      PRIMARY_HOST: { type: 'host', required: true },
      REPLICA_HOST: {
        type: 'host',
        required: true,
        validate: (v, e) => v !== e.PRIMARY_HOST || 'must differ from PRIMARY_HOST',
      },
      CONFIG: {
        type: 'json',
        validate: (v, e) => { seenVal = v; seenEnv = e; return v.retries > 0 || 'retries must be positive'; },
      },
    },
    inputEnv,
  );
  assert.strictEqual(crossOk.REPLICA_HOST, 'db2.internal');
  assert.deepStrictEqual(seenVal, { retries: 3 });
  assert.strictEqual(seenEnv, inputEnv);

  assert.throws(
    () => validateEnv(
      {
        PRIMARY_HOST: { type: 'host', required: true },
        REPLICA_HOST: {
          type: 'host',
          required: true,
          validate: (v, e) => v !== e.PRIMARY_HOST || 'must differ from PRIMARY_HOST',
        },
      },
      { PRIMARY_HOST: 'db1.internal', REPLICA_HOST: 'db1.internal' },
    ),
    err => err instanceof EnvSaafError
      && err.errors.length === 1
      && err.errors[0] === 'REPLICA_HOST: must differ from PRIMARY_HOST',
  );

  // 5. Throwing validator is reported as a validation failure, not a crash.
  assert.throws(
    () => validateEnv(
      {
        DIR: { type: 'string', validate: () => { throw new Error('directory does not exist'); } },
        NON_ERR: { type: 'string', validate: () => { throw 'raw string throw'; } },
      },
      { DIR: '/nope', NON_ERR: 'x' },
    ),
    err => err instanceof EnvSaafError
      && err.errors.length === 2
      && err.errors[0] === 'DIR: validation failed: directory does not exist'
      && err.errors[1] === 'NON_ERR: validation failed: raw string throw',
  );

  // 6. Aggregated errors: built-in failures and custom validate failures collect together.
  assert.throws(
    () => validateEnv(
      {
        REQ: { type: 'string', required: true },
        BAD_PORT: { type: 'port' },
        CUSTOM_STR: { type: 'string', validate: () => 'custom reason' },
        CUSTOM_FALSE: { type: 'int', validate: () => false },
        CUSTOM_THROW: { type: 'string', validate: () => { throw new Error('boom'); } },
      },
      { BAD_PORT: 'nope', CUSTOM_STR: 'a', CUSTOM_FALSE: '7', CUSTOM_THROW: 'b' },
    ),
    err => err instanceof EnvSaafError
      && err.errors.length === 5
      && err.errors[0] === 'REQ: missing required variable'
      && err.errors[1].startsWith('BAD_PORT: expected a port')
      && err.errors[2] === 'CUSTOM_STR: custom reason'
      && err.errors[3] === 'CUSTOM_FALSE: failed custom validation, got "7"'
      && err.errors[4] === 'CUSTOM_THROW: validation failed: boom',
  );

  // 7. Execution order:
  // - skipped for missing optional keys and when coercion/built-in checks fail
  // - runs before transform; transform is skipped when validate fails
  // - runs on defaults (while transform is still skipped on defaults)
  let calledOnMissing = false;
  let calledAfterBadCoercion = false;
  let calledAfterBadBuiltin = false;
  validateEnv(
    { OPT: { type: 'string', validate: () => { calledOnMissing = true; return true; } } },
    {},
  );
  assert.strictEqual(calledOnMissing, false);

  assert.throws(
    () => validateEnv(
      {
        N: { type: 'int', validate: () => { calledAfterBadCoercion = true; return true; } },
        M: { type: 'int', min: 10, validate: () => { calledAfterBadBuiltin = true; return true; } },
      },
      { N: 'abc', M: '5' },
    ),
    err => err instanceof EnvSaafError && err.errors.length === 2,
  );
  assert.strictEqual(calledAfterBadCoercion, false);
  assert.strictEqual(calledAfterBadBuiltin, false);

  const order = [];
  const transformedRes = validateEnv(
    {
      LIST: {
        type: 'string',
        validate: v => { order.push(['validate', v]); return v.includes(',') || 'needs comma'; },
        transform: v => { order.push(['transform', v]); return v.split(','); },
      },
    },
    { LIST: 'a,b' },
  );
  assert.deepStrictEqual(transformedRes.LIST, ['a', 'b']);
  assert.deepStrictEqual(order, [['validate', 'a,b'], ['transform', 'a,b']]);

  let transformCalledAfterFail = false;
  assert.throws(
    () => validateEnv(
      {
        LIST: {
          type: 'string',
          validate: () => 'bad list',
          transform: v => { transformCalledAfterFail = true; return v.split(','); },
        },
      },
      { LIST: 'a' },
    ),
    err => err instanceof EnvSaafError && err.errors[0] === 'LIST: bad list',
  );
  assert.strictEqual(transformCalledAfterFail, false);

  let defaultTransformCalled = false;
  const defaultOk = validateEnv(
    {
      PORT: {
        type: 'port',
        default: 8080,
        validate: v => v >= 1024 || 'too low',
        transform: v => { defaultTransformCalled = true; return v; },
      },
    },
    {},
  );
  assert.strictEqual(defaultOk.PORT, 8080);
  assert.strictEqual(defaultTransformCalled, false);

  assert.throws(
    () => validateEnv(
      { PORT: { type: 'port', default: 80, validate: v => v >= 1024 || 'default too low' } },
      {},
    ),
    err => err instanceof EnvSaafError && err.errors[0] === 'PORT: default too low',
  );

  // 8. `sensitive: true` masks values across false, string, and thrown validate errors.
  const secret = 'sess_secret_token_99';
  assert.throws(
    () => validateEnv(
      { SESSION_ID: { type: 'string', sensitive: true, validate: () => false } },
      { SESSION_ID: secret },
    ),
    err => err instanceof EnvSaafError
      && !err.message.includes(secret)
      && err.errors[0] === `SESSION_ID: failed custom validation, got "${maskValue(secret)}"`,
  );
  assert.throws(
    () => validateEnv(
      { SESSION_ID: { type: 'string', sensitive: true, validate: v => `rejected ${v}` } },
      { SESSION_ID: secret },
    ),
    err => err instanceof EnvSaafError
      && !err.message.includes(secret)
      && err.errors[0] === `SESSION_ID: rejected ${maskValue(secret)}`,
  );
  assert.throws(
    () => validateEnv(
      { SESSION_ID: { type: 'string', sensitive: true, validate: v => { throw new Error(`bad ${v}`); } } },
      { SESSION_ID: secret },
    ),
    err => err instanceof EnvSaafError
      && !err.message.includes(secret)
      && err.errors[0] === `SESSION_ID: validation failed: bad ${maskValue(secret)}`,
  );

  // 9. Non-throwing mode collects validate errors and omits failing keys from env.
  const collected = validateEnv(
    {
      GOOD: { type: 'int', validate: v => v > 0 },
      BAD: { type: 'int', validate: v => v > 10 || 'must exceed 10' },
    },
    { GOOD: '5', BAD: '3' },
    { throwOnError: false },
  );
  assert.deepStrictEqual(collected.env, { GOOD: 5 });
  assert.deepStrictEqual(collected.errors, ['BAD: must exceed 10']);
}

console.log('env-saaf v1.5.0: all tests passed');
