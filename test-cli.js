'use strict';
// Issue #237: CLI integration tests. These run `cli.js` as a real subprocess
// (spawnSync) in throwaway projects under the OS temp dir, because the
// behaviours users depend on — exit codes, stdout vs stderr, --json shape,
// "type": "module" handling, missing-directory errors — are process-level
// and cannot be pinned by calling into the internals from test.js.
//
// Conventions match test.js: plain node:assert, no framework. Every project
// is created fresh and removed afterwards, and the child process gets a
// scrubbed environment so the developer's real env vars and cwd cannot leak
// into the results.
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CLI = path.join(__dirname, 'cli.js');

/** A minimal environment for the child: enough for Node to start, nothing else. */
function cleanEnv() {
  const env = { PATH: process.env.PATH || '' };
  if (process.platform === 'win32') {
    if (process.env.SYSTEMROOT) env.SYSTEMROOT = process.env.SYSTEMROOT;
    if (process.env.TEMP) env.TEMP = process.env.TEMP;
  } else if (process.env.HOME) {
    env.HOME = process.env.HOME;
  }
  return env;
}

/** Run the CLI in `cwd` and return { status, stdout, stderr }. */
function run(args, cwd) {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    encoding: 'utf8',
    env: cleanEnv(),
  });
  assert.ifError(r.error);
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

/** Create a throwaway project directory; registered for cleanup. */
const tempDirs = [];
function mkProject(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'env-saaf-cli-test-'));
  tempDirs.push(dir);
  for (const [name, content] of Object.entries(files)) {
    const p = path.join(dir, name);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
  }
  return dir;
}

function cleanup() {
  for (const d of tempDirs.splice(0)) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ }
  }
}

const SRC_WITH_USAGE = 'const port = process.env.PORT;\nconst db = process.env.DATABASE_URL;\nconsole.log(port, db);\n';
const EXAMPLE_BOTH = 'PORT=\nDATABASE_URL=\n';
const SCHEMA = "module.exports = { PORT: { type: 'port', required: true } };\n";

try {
  // --- check: clean project exits 0 and says so on stdout -------------------
  {
    const dir = mkProject({ 'src/app.js': SRC_WITH_USAGE, '.env.example': EXAMPLE_BOTH });
    const r = run(['check', dir], dir);
    assert.strictEqual(r.status, 0, `clean check should exit 0, got ${r.status}: ${r.stdout}${r.stderr}`);
    assert.match(r.stdout, /all clean/);
  }

  // --- check: code reads a key the example does not document -> exit 1, MISSING on stdout
  {
    const dir = mkProject({ 'src/app.js': 'console.log(process.env.SECRET_TOKEN);\n', '.env.example': 'PORT=\n' });
    const r = run(['check', dir], dir);
    assert.strictEqual(r.status, 1, 'missing key must exit 1');
    assert.match(r.stdout, /MISSING in \.env\.example: SECRET_TOKEN/);
  }

  // --- check --json: stdout is one parseable JSON line, findings are fields -
  {
    const dir = mkProject({ 'src/app.js': 'console.log(process.env.SECRET_TOKEN);\n', '.env.example': 'PORT=\n' });
    const r = run(['check', dir, '--json'], dir);
    assert.strictEqual(r.status, 1);
    const parsed = JSON.parse(r.stdout); // must not throw
    assert.strictEqual(parsed.ok, false);
    assert.deepStrictEqual(parsed.missing, ['SECRET_TOKEN']);
    assert.strictEqual(r.stderr, '', 'findings belong on stdout in --json mode');
  }

  // --- check --schema: an invalid value in the real .env fails the check ----
  {
    const dir = mkProject({
      'src/app.js': SRC_WITH_USAGE,
      '.env.example': EXAMPLE_BOTH,
      '.env': 'PORT=not-a-port\nDATABASE_URL=x\n',
      'env.schema.js': SCHEMA,
    });
    const r = run(['check', dir, '--schema', 'env.schema.js'], dir);
    assert.strictEqual(r.status, 1);
    assert.match(r.stdout, /INVALID: PORT/);
    const rj = run(['check', dir, '--schema', 'env.schema.js', '--json'], dir);
    const parsed = JSON.parse(rj.stdout);
    assert.strictEqual(parsed.ok, false);
    assert.ok(Array.isArray(parsed.invalid) && parsed.invalid.length === 1 && /PORT/.test(parsed.invalid[0]));
  }

  // --- check --values: undocumented keys in the values file are EXTRA and fail
  // (issue #494: a typo'd deployment key passed the gate silently before) -----
  {
    const dir = mkProject({
      'src/app.js': SRC_WITH_USAGE,
      '.env.example': EXAMPLE_BOTH,
      'env.schema.js': SCHEMA,
      'prod.env': 'PORT=3000\nEXTRA=zzz\nPORTT=4000\n',
    });
    const r = run(['check', dir, '--schema', 'env.schema.js', '--values', 'prod.env'], dir);
    assert.strictEqual(r.status, 1, 'extra keys in the values file must exit 1');
    assert.match(r.stdout, /EXTRA in prod\.env: EXTRA \(not in \.env\.example\)/);
    assert.match(r.stdout, /EXTRA in prod\.env: PORTT/);
    assert.doesNotMatch(r.stdout, /EXTRA in prod\.env: PORT\n/, 'the documented key itself is not extra');
    const rj = run(['check', dir, '--schema', 'env.schema.js', '--values', 'prod.env', '--json'], dir);
    const parsed = JSON.parse(rj.stdout);
    assert.strictEqual(parsed.ok, false);
    assert.strictEqual(parsed.valuesFile, 'prod.env');
    assert.deepStrictEqual(parsed.envExtra, ['EXTRA', 'PORTT']);
  }

  // --- check --values: a values file with no extra keys behaves as before ----
  {
    const dir = mkProject({
      'src/app.js': 'console.log(process.env.PORT);\n',
      '.env.example': 'PORT=\n',
      'env.schema.js': SCHEMA,
      'prod.env': 'PORT=3000\n',
    });
    const r = run(['check', dir, '--schema', 'env.schema.js', '--values', 'prod.env'], dir);
    assert.strictEqual(r.status, 0, `clean values file should exit 0, got ${r.status}: ${r.stdout}${r.stderr}`);
    assert.match(r.stdout, /all clean/);
    const rj = run(['check', dir, '--schema', 'env.schema.js', '--values', 'prod.env', '--json'], dir);
    const parsed = JSON.parse(rj.stdout);
    assert.strictEqual(parsed.ok, true);
    assert.deepStrictEqual(parsed.envExtra, []);
  }

  // --- check: missing .env.example exits 2 with a hint ----------------------
  {
    const dir = mkProject({ 'src/app.js': SRC_WITH_USAGE });
    const r = run(['check', dir], dir);
    assert.strictEqual(r.status, 2);
    assert.match(r.stderr, /\.env\.example not found/);
    assert.match(r.stderr, /env-saaf example/);
  }

  // --- scan: lists used vars on stdout, exit 0 -------------------------------
  {
    const dir = mkProject({ 'src/app.js': SRC_WITH_USAGE, 'lib/util.js': 'module.exports = process.env.PORT;\n' });
    const r = run(['scan', dir], dir);
    assert.strictEqual(r.status, 0);
    assert.strictEqual(r.stdout.trim(), 'DATABASE_URL\nPORT');
  }

  // --- scan --json on an empty project: ok with empty vars, note on stderr --
  {
    const dir = mkProject({ 'README.md': '# nothing here\n' });
    const r = run(['scan', dir, '--json'], dir);
    assert.strictEqual(r.status, 0);
    assert.deepStrictEqual(JSON.parse(r.stdout), { ok: true, vars: [], locations: {} });
    const plain = run(['scan', dir], dir);
    assert.strictEqual(plain.status, 0);
    assert.match(plain.stderr, /No process\.env usage found\./);
  }

  // --- scan: UNUSED warnings go to stderr and never change the exit code -----
  {
    const dir = mkProject({ 'src/app.js': SRC_WITH_USAGE, '.env.example': EXAMPLE_BOTH + 'LEGACY_KEY=\n' });
    const r = run(['scan', dir], dir);
    assert.strictEqual(r.status, 0);
    assert.match(r.stderr, /UNUSED: LEGACY_KEY/);
    assert.strictEqual(r.stdout.trim(), 'DATABASE_URL\nPORT');
  }

  // --- example --write: creates the file, then refuses without --force ------
  {
    const dir = mkProject({ 'src/app.js': SRC_WITH_USAGE });
    const w = run(['example', dir, '--write'], dir);
    assert.strictEqual(w.status, 0);
    const written = fs.readFileSync(path.join(dir, '.env.example'), 'utf8');
    assert.match(written, /^DATABASE_URL=$/m);
    assert.match(written, /^PORT=$/m);
    const again = run(['example', dir, '--write'], dir);
    assert.strictEqual(again.status, 1, 'refuses to overwrite');
    assert.match(again.stderr, /already exist/);
    const forced = run(['example', dir, '--write', '--force'], dir);
    assert.strictEqual(forced.status, 0);
  }

  // --- example --write on a project with no usage: refuses, writes nothing ---
  {
    const dir = mkProject({ 'README.md': 'no code\n' });
    const r = run(['example', dir, '--write'], dir);
    assert.strictEqual(r.status, 1);
    assert.match(r.stderr, /nothing to write/);
    assert.ok(!fs.existsSync(path.join(dir, '.env.example')));
  }

  // --- init -> check round-trip in a CommonJS project ------------------------
  {
    const dir = mkProject({ 'src/app.js': SRC_WITH_USAGE, 'package.json': '{"name":"tmp-cjs"}\n' });
    const init = run(['init', dir], dir);
    assert.strictEqual(init.status, 0, init.stderr);
    assert.ok(fs.existsSync(path.join(dir, 'env.schema.js')), 'CJS project gets env.schema.js');
    assert.ok(fs.existsSync(path.join(dir, '.env.example')));
    // The scanned keys are folded into the scaffold (issue #171), so the
    // post-init check reports no MISSING lines; the scaffold's own fixed keys
    // are still UNUSED until code reads them, which fails the check per #113.
    const example = fs.readFileSync(path.join(dir, '.env.example'), 'utf8');
    assert.match(example, /^PORT=/m);
    assert.match(example, /^DATABASE_URL=/m);
    const check = run(['check', dir, '--schema', 'env.schema.js'], dir);
    assert.ok(!/MISSING/.test(check.stdout), `no MISSING after init: ${check.stdout}`);
    assert.match(check.stdout, /UNUSED: APP_NAME/);
    // init refuses to overwrite without --force
    const again = run(['init', dir], dir);
    assert.strictEqual(again.status, 1);
    assert.match(again.stderr, /already exist/);
  }

  // --- init -> check round-trip in a "type": "module" project (issue #184) ---
  {
    const dir = mkProject({
      'package.json': '{"name":"tmp-esm","type":"module"}\n',
      'src/app.js': SRC_WITH_USAGE,
    });
    const init = run(['init', dir], dir);
    assert.strictEqual(init.status, 0, init.stderr);
    assert.ok(fs.existsSync(path.join(dir, 'env.schema.cjs')), 'ESM project gets env.schema.cjs');
    assert.ok(!fs.existsSync(path.join(dir, 'env.schema.js')));
    const check = run(['check', dir, '--schema', 'env.schema.cjs'], dir);
    assert.ok(!/MISSING/.test(check.stdout), `no MISSING after init in ESM project: ${check.stdout}`);
  }

  // --- init --from-example infers url for non-http schemes (issue #470) ------
  {
    const dir = mkProject({
      '.env.example': [
        'DATABASE_URL=postgres://localhost:5432/db',
        'WEBHOOK=wss://socket.example.com',
        'API_URL=https://api.example.com/v1',
        'HOST_PORT=localhost:5432',
        'DOMAIN=example.com/path',
        'WORD=hello',
      ].join('\n') + '\n',
    });
    const init = run(['init', dir, '--from-example'], dir);
    assert.strictEqual(init.status, 0, init.stderr);
    const schema = fs.readFileSync(path.join(dir, 'env.schema.js'), 'utf8');
    for (const key of ['DATABASE_URL', 'WEBHOOK', 'API_URL']) {
      assert.match(schema, new RegExp(`\\b${key}: \\{ type: 'url' \\}`), `${key} should infer as url:\n${schema}`);
    }
    for (const key of ['HOST_PORT', 'DOMAIN', 'WORD']) {
      assert.match(schema, new RegExp(`\\b${key}: \\{ type: 'string' \\}`), `${key} should stay string:\n${schema}`);
    }
  }

  // --- missing directory: exit 2, clear message, no stack trace --------------
  {
    const dir = mkProject({});
    const missing = path.join(dir, 'nope');
    const r = run(['check', missing], dir);
    assert.strictEqual(r.status, 2);
    assert.match(r.stderr, /does not exist/);
    assert.ok(!/at Object\.|at Module\./.test(r.stderr), 'no raw Node stack trace');
    const rj = run(['scan', missing, '--json'], dir);
    assert.strictEqual(rj.status, 2);
    assert.strictEqual(JSON.parse(rj.stdout).ok, false);
  }

  // --- global flags: --version exits 0 before any command --------------------
  {
    const dir = mkProject({});
    const v = run(['--version'], dir);
    assert.strictEqual(v.status, 0);
    assert.match(v.stdout, /^env-saaf \d+\.\d+\.\d+/);
    const after = run(['check', dir, '--version'], dir);
    assert.strictEqual(after.status, 0);
    assert.match(after.stdout, /^env-saaf /);
  }

  // --- unknown command prints usage and exits 2 -------------------------------
  {
    const dir = mkProject({});
    const r = run(['frobnicate', dir], dir);
    assert.strictEqual(r.status, 2);
    assert.match(r.stdout, /Usage: env-saaf/);
  }

  // --- print: credentials embedded in URLs are redacted (issue #505) ---------
  {
    const dir = mkProject({
      'env.schema.js': [
        'module.exports = {',
        "  DATABASE_URL: { type: 'url', required: true },",
        "  CACHE_URL: { type: 'url', required: true },",
        "  HOMEPAGE: { type: 'url', required: true },",
        "  REPLICAS: { type: 'array', of: 'url', required: true },",
        "  NAME: { type: 'string', required: true },",
        '};',
        '',
      ].join('\n'),
      '.env': [
        'DATABASE_URL=postgres://user:pass@localhost:5432/mydb?sslmode=require',
        'CACHE_URL=redis://:s3cr3t@cache:6379/0',
        'HOMEPAGE=https://user@example.com/path',
        'REPLICAS=mysql://ro:pw1@db1:3306/app,mysql://ro:pw2@db2:3306/app',
        'NAME=a:b@c',
        '',
      ].join('\n'),
    });
    const text = run(['print', dir, '--schema', 'env.schema.js'], dir);
    assert.strictEqual(text.status, 0, text.stderr);
    assert.match(text.stdout, /^DATABASE_URL=postgres:\/\/user:\*\*\*@localhost:5432\/mydb\?sslmode=require$/m);
    assert.match(text.stdout, /^CACHE_URL=redis:\/\/:\*\*\*@cache:6379\/0$/m);
    // No password: the URL prints exactly as before, as does a non-URL value.
    assert.match(text.stdout, /^HOMEPAGE=https:\/\/user@example\.com\/path$/m);
    assert.match(text.stdout, /^NAME=a:b@c$/m);
    for (const secret of ['pass@', 's3cr3t', 'pw1', 'pw2']) {
      assert.ok(!text.stdout.includes(secret), `text output leaks ${secret}`);
    }

    const json = run(['print', dir, '--schema', 'env.schema.js', '--json'], dir);
    assert.strictEqual(json.status, 0, json.stderr);
    const values = JSON.parse(json.stdout);
    assert.strictEqual(values.DATABASE_URL, 'postgres://user:***@localhost:5432/mydb?sslmode=require');
    assert.strictEqual(values.CACHE_URL, 'redis://:***@cache:6379/0');
    assert.deepStrictEqual(values.REPLICAS, ['mysql://ro:***@db1:3306/app', 'mysql://ro:***@db2:3306/app']);
    assert.strictEqual(values.HOMEPAGE, 'https://user@example.com/path');

    // --reveal still prints the real value.
    const revealed = run(['print', dir, '--schema', 'env.schema.js', '--json', '--reveal'], dir);
    assert.strictEqual(JSON.parse(revealed.stdout).DATABASE_URL, 'postgres://user:pass@localhost:5432/mydb?sslmode=require');
  }

  // --- the assertions are real: a deliberately wrong exit-code expectation fails
  {
    const dir = mkProject({ 'src/app.js': SRC_WITH_USAGE, '.env.example': EXAMPLE_BOTH });
    const r = run(['check', dir], dir);
    assert.throws(
      () => assert.strictEqual(r.status, 99, 'deliberately wrong expectation'),
      /deliberately wrong expectation/,
    );
  }
} finally {
  cleanup();
}

console.log('test-cli.js: all CLI integration tests passed');
