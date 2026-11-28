#!/usr/bin/env node
'use strict';
/**
 * env-saaf CLI
 *   env-saaf check [dir] [--file name] [--schema file] [--values file] [--json] [--json-schema] [--watch] — scan code for process.env usage, compare with
 *                           .env.example (or the --file given); exit 1 if anything
 *                           used is not documented or if an example value looks like a
 *                           real secret (key named, value never printed; issue #416).
 *                           --schema counts declared keys as used and validates the values
 *                           of the real .env file against the schema the file exports
 *                           (issue #90); --json emits machine-readable output. --json-schema
 *                           prints the schema file as a draft 2020-12 JSON Schema
 *                           document instead of running the check (issue #268). --fix
 *                           appends the missing keys to .env.example (placeholders
 *                           from the schema when one is given) instead of only
 *                           reporting them, and the check then passes (issue #428).
 *                           A scaffold
 *                           with no code usage yet passes with a single note instead of
 *                           one UNUSED line per key (issue #170).
 *   env-saaf scan  [dir | file | --stdin] [--file name] [--json] [--watch]: just list the env vars your code uses; keys in
 *                           .env.example (or the --file given) that no code reads are reported
 *                           as UNUSED warnings (stderr; `unused` in --json), never an exit code
 *   env-saaf print [dir] [--schema file] [--file name] [--json] [--reveal] — load and validate the env file, then print the coerced values with sensitive rules and secret-named keys masked; --reveal prints the real values instead (local debugging only, never in CI logs)
 *   env-saaf example [dir] [--write[=file]] [--force] [--schema file] — print a .env.example draft from code
 *                           usage (v1.0.0); --write saves it to .env.example (or the file
 *                           named) instead, refusing to overwrite unless --force is given
 *   env-saaf init  [dir] [--schema file] [--force] — write a starter env.schema.js
 *                           (commented examples of the main types) and a matching
 *                           .env.example generated from it; refuses to overwrite
 *                           either file unless --force is passed (issue #60). Keys
 *                           the code already reads are folded into the scaffold as
 *                           string entries and listed on stdout (issue #171). In a
 *                           "type": "module" project the starter is env.schema.cjs
 *                           instead, so it still loads with require() (issue #184)
 *   env-saaf init  [dir] --from-example[=file] [--schema file] [--force] [--groups] — like the
 *                           above, but the starter schema is inferred from an
 *                           existing example file (default .env.example): each key's
 *                           sample value picks the rule type (port-looking number ->
 *                           port, true/false -> boolean, http(s) URL -> url, email ->
 *                           email, integer -> int, decimal -> number, else string),
 *                           every inferred rule is commented as inferred, and the
 *                           example file itself is left untouched (issue #232).
 *                           With --groups, keys sharing a common prefix (e.g. DB_HOST,
 *                           DB_PORT) are folded into a grouped schema (issue #263)
 */
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { types: { isModuleNamespaceObject } } = require('node:util');
const { scanCode, scanCodeLocations, scanDir, scanDirLocations, parseEnvFile, diffEnv, validateEnv, EnvSaafError, generateExample, toJsonSchema, maskValue } = require('./index');

const argv = process.argv.slice(2);
// --version / -v is global: report the installed version wherever it appears, before anything else runs
if (argv.includes('--version') || argv.includes('-v')) {
  console.log(`env-saaf ${require('./package.json').version}`);
  process.exit(0);
}
// Output is already plain in every mode, including when NO_COLOR is set.
while (argv[0] === '--no-color') argv.shift();
const cmd = argv[0];
const USAGE = 'Usage: env-saaf check [dir | file] [--file name] [--schema file] [--values file] [--exclude pattern] [--json] [--json-schema] [--watch] [--fix] | env-saaf scan [dir | file | --stdin] [--file name] [--exclude pattern] [--json] [--watch] | env-saaf print [dir] [--schema file] [--file name] [--json] [--reveal] | env-saaf example [dir] [--write[=file]] [--force] [--schema file] | env-saaf init [dir] [--schema file] [--force] [--from-example[=file]]\n'
  + 'Global options: --no-color, --version / -v (before or after the command).';
// --help / -h / help: print usage and exit 0 (asking for help is not an error — this used to exit 2)
if (cmd === '--help' || cmd === '-h' || cmd === 'help') {
  console.log(USAGE);
  process.exit(0);
}
// --file <name> or --file=<name> ('check' and 'scan'): which template file to compare against
// --schema <file> or --schema=<file> ('check' only): validate the env values against the
// schema the file exports (issue #90). Opt-in: without it the check is presence-only.
// --json: machine-readable output for check and scan
// --json-schema ('check' only): print the --schema file as a draft 2020-12
// JSON Schema document to stdout instead of running the check (issue #268).
// Without --schema there is nothing to convert, so the flag errors out.
// --fix ('check' only): append the keys the code uses but the template does
// not document yet to the template file (issue #428) instead of only
// reporting them — placeholders from the schema when one is given, otherwise
// the bare key with an empty value. It only ever adds: existing keys and
// values are untouched, nothing is removed, and the real .env is never written.
// --write / --write=<file> ('example' only): save the draft to .env.example (or the file
// named) instead of printing it; --force allows overwriting an existing file
// --watch ('check' and 'scan' only): run once, then re-run (debounced) whenever the scanned
// tree, the env template or the schema file changes (issue #230)
let fileOpt = '.env.example';
let fileExplicit = false;
let schemaOpt = null;
let jsonMode = false;
// Issue #474: --reveal ('print' only) prints the real values instead of the
// masked ones — an explicit opt-in for local debugging, never for CI logs.
let revealOpt = false;
let jsonSchemaOpt = false;
let writeOpt = null;
let forceOpt = false;
// Issue #230: --watch ('check' and 'scan' only) re-runs the command when watched inputs change.
let watchOpt = false;
let stdinOpt = false;
// Issue #428: --fix ('check' only) appends missing keys to the template file.
let fixOpt = false;
// Issue #352: check --schema --values validates another file's values.
let valuesOpt = null;
// Issue #355: repeatable --exclude patterns for scan and check.
const excludeOpts = [];

// Issue #230: in watch mode an error exit must not kill the watcher — fatalExit
// throws WatchExit instead, so watchLoop's runOnce can log the exit code and
// keep watching. Outside watch mode fatalExit is exactly process.exit.
let watchActive = false;
class WatchExit extends Error {
  constructor(code) { super(`exit ${code}`); this.code = code; }
}
function fatalExit(code) {
  if (watchActive) throw new WatchExit(code);
  process.exit(code);
}
let fromExampleOpt = null; // null = off; true = bare flag; string = --from-example=file
let groupsOpt = false;
// Issue #278: tokens starting with `--` that match no known flag, and
// value-taking flags left without a value, are collected here and rejected
// after parsing — they used to fall into `positional` and vanish silently.
const unknownFlags = [];
const valuelessFlags = [];
const positional = [];
for (let i = 1; i < argv.length; i++) {
  const a = argv[i];
  // --help / -h anywhere after the command: asking for help is never a directory
  if (a === '--help' || a === '-h') {
    console.log(USAGE);
    process.exit(0);
  }
  if (a === '--file' && argv[i + 1]) { fileOpt = argv[++i]; fileExplicit = true; }
  else if (a.startsWith('--file=')) { fileOpt = a.slice('--file='.length); fileExplicit = true; }
  else if (a === '--schema' && argv[i + 1]) schemaOpt = argv[++i];
  else if (a.startsWith('--schema=')) schemaOpt = a.slice('--schema='.length);
  else if (a === '--values' && argv[i + 1]) valuesOpt = argv[++i];
  else if (a.startsWith('--values=')) valuesOpt = a.slice('--values='.length);
  else if (a === '--exclude' && argv[i + 1]) excludeOpts.push(argv[++i]);
  else if (a.startsWith('--exclude=')) excludeOpts.push(a.slice('--exclude='.length));
  else if (a === '--json') jsonMode = true;
  else if (a === '--reveal') revealOpt = true;
  else if (a === '--json-schema') jsonSchemaOpt = true;
  else if (a === '--write') writeOpt = '.env.example';
  else if (a.startsWith('--write=')) writeOpt = a.slice('--write='.length) || '.env.example';
  else if (a === '--force') forceOpt = true;
  else if (a === '--watch') watchOpt = true;
  else if (a === '--fix') fixOpt = true;
  else if (a === '--stdin') stdinOpt = true;
  else if (a === '--from-example') fromExampleOpt = true;
  else if (a.startsWith('--from-example=')) fromExampleOpt = a.slice('--from-example='.length) || '.env.example';
  else if (a === '--groups') groupsOpt = true;
  else if (a === '--no-color') { /* global flag, allowed on every command */ }
  else if (a === '--file' || a === '--schema' || a === '--values' || a === '--exclude') valuelessFlags.push(a);
  else if (a.startsWith('--')) unknownFlags.push(a);
  else positional.push(a);
}
let dir = positional[0] || process.cwd();
// Same code-file extensions directory scanning accepts (see SCAN_EXTENSIONS in index.js).
const SCAN_EXTENSIONS = /\.(js|cjs|mjs|ts|mts|cts|tsx|jsx|vue|svelte|astro)$/;

function resolveReadableCodeFile(rawPath) {
  if (!SCAN_EXTENSIONS.test(rawPath)) return null;
  try {
    const actualFile = path.join(fs.realpathSync.native(path.dirname(rawPath)), path.basename(rawPath));
    if (!fs.statSync(actualFile).isFile()) return null;
    fs.closeSync(fs.openSync(actualFile, 'r'));
    return actualFile;
  } catch {
    return null;
  }
}

function findFilePackageDir(actualFile) {
  const cwdReal = fs.realpathSync.native(process.cwd());
  for (let d = path.dirname(actualFile); ; ) {
    if (fs.existsSync(path.join(d, 'package.json'))) return d;
    if (d === cwdReal) return null;
    const parent = path.dirname(d);
    if (parent === d) return null;
    d = parent;
  }
}

let scanFile = null;
let scanLocationFile = null;
let filePkgDir = null;
if ((cmd === 'scan' || cmd === 'check') && positional[0] !== undefined) {
  scanFile = resolveReadableCodeFile(positional[0]);
  if (scanFile !== null) {
    scanLocationFile = positional[0];
    filePkgDir = findFilePackageDir(scanFile);
  }
}
const COMMAND_FLAGS = {
  check: ['--file', '--schema', '--values', '--exclude', '--json', '--json-schema', '--watch', '--fix'],
  scan: ['--file', '--exclude', '--json', '--watch', '--stdin'],
  print: ['--schema', '--file', '--json', '--reveal'],
  example: ['--write', '--force', '--schema'],
  init: ['--schema', '--force', '--from-example', '--groups'],
};
// Issue #354: project config — the CLI reads defaults from the `env-saaf` key
// in the project's package.json, so `check` / `scan` / `print` / `example` /
// `init` do not repeat the same --schema / --file on every invocation.
// Precedence: an explicit flag (or directory argument) always wins over the
// config; the config wins over the built-in defaults. Config paths are
// resolved relative to the directory the command runs on, exactly like the
// flags are. Unknown keys are a usage error (exit 2), like the library's
// unknown-option errors, so a typo'd key cannot silently do nothing. A
// missing package.json simply means "no config"; a malformed one is an
// error, because a config the user meant to apply must not be skipped.
let configPkgDir = null;
const CONFIG_KEYS = ['schema', 'file', 'dir'];
if (COMMAND_FLAGS[cmd]) {
  const configDir = scanFile !== null ? filePkgDir : (positional[0] || process.cwd());
  let pkg = null;
  // existsSync first: a missing package.json means "no config", and for an
  // explicit single-file target (#418) findFilePackageDir locates its project.
  if (configDir !== null && fs.existsSync(path.join(configDir, 'package.json'))) {
    const pkgPath = path.join(configDir, 'package.json');
    try {
      pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    } catch (e) {
      // A malformed package.json is an error: a config the user meant to
      // apply must not be silently skipped. A file that vanished between the
      // check and the read is treated as no config; any other read failure
      // names the directory.
      if (e.code !== 'ENOENT' && e.code !== 'ENOTDIR') {
        const message = `env-saaf: cannot read project config in ${configDir}: ${e.message}`;
        if (jsonMode) console.log(JSON.stringify({ ok: false, error: message }));
        else console.error(message);
        process.exit(2);
      }
    }
  }
  const config = pkg && pkg['env-saaf'];
  if (config !== undefined && config !== null) {
    let configError = null;
    if (typeof config !== 'object' || Array.isArray(config)) {
      configError = 'the "env-saaf" key in package.json must be an object, e.g. { "schema": "config/env.schema.js" }';
    } else {
      const unknown = Object.keys(config).filter(k => !CONFIG_KEYS.includes(k));
      if (unknown.length) {
        configError = `unknown key${unknown.length === 1 ? '' : 's'} in the "env-saaf" config of package.json: ${unknown.join(', ')} (supported: ${CONFIG_KEYS.join(', ')})`;
      } else {
        const bad = Object.entries(config).find(([, v]) => typeof v !== 'string' || v === '');
        if (bad) configError = `the "env-saaf.${bad[0]}" value in package.json must be a non-empty string`;
      }
    }
    if (configError) {
      const message = `env-saaf: ${configError}`;
      if (jsonMode) console.log(JSON.stringify({ ok: false, error: message }));
      else console.error(message);
      process.exit(2);
    }
    let usedPkgDefault = false;
    if (positional[0] === undefined && config.dir !== undefined) dir = path.resolve(configDir, config.dir);
    if (COMMAND_FLAGS[cmd].includes('--schema') && schemaOpt === null && config.schema !== undefined) {
      schemaOpt = config.schema;
      usedPkgDefault = true;
    }
    if (COMMAND_FLAGS[cmd].includes('--file') && !fileExplicit && config.file !== undefined) {
      fileOpt = config.file;
      fileExplicit = true;
      usedPkgDefault = true;
    }
    if (usedPkgDefault) configPkgDir = fs.realpathSync.native(configDir);
  }
}
// Issue #232: with a bare `--from-example`, a second positional names the
// example file instead of being mistaken for the directory.
let exampleOpt = null;
if (fromExampleOpt !== null) {
  if (fromExampleOpt === true) exampleOpt = positional[1] || '.env.example';
  else exampleOpt = fromExampleOpt;
}

// Issue #278: flags are per-command. A flag the parser recognised but the
// command does not support — or one it does not recognise at all — used to
// be silently ignored, so `scan --json-schema` ran a plain scan and a typo
// like `--jsoon` in CI produced text output where JSON was expected. Fail
// fast with exit 2, in the same message shape as other usage errors.
if (COMMAND_FLAGS[cmd]) {
  const seenFlags = new Set();
  if (fileExplicit) seenFlags.add('--file');
  if (schemaOpt !== null) seenFlags.add('--schema');
  if (jsonMode) seenFlags.add('--json');
  if (revealOpt) seenFlags.add('--reveal');
  if (jsonSchemaOpt) seenFlags.add('--json-schema');
  if (writeOpt !== null) seenFlags.add('--write');
  if (forceOpt) seenFlags.add('--force');
  if (watchOpt) seenFlags.add('--watch');
  if (fixOpt) seenFlags.add('--fix');
  if (stdinOpt) seenFlags.add('--stdin');
  if (valuesOpt !== null) seenFlags.add('--values');
  if (excludeOpts.length) seenFlags.add('--exclude');
  if (fromExampleOpt !== null) seenFlags.add('--from-example');
  if (groupsOpt) seenFlags.add('--groups');
  let flagError = null;
  if (valuelessFlags.length) flagError = `${valuelessFlags[0]} needs a value`;
  else if (unknownFlags.length) flagError = `unknown flag ${unknownFlags[0]} for ${cmd}`;
  else {
    const bad = [...seenFlags].find(f => !COMMAND_FLAGS[cmd].includes(f));
    if (bad) flagError = `flag ${bad} is not supported for ${cmd}`;
    else if (stdinOpt && positional.length > 0) flagError = '--stdin cannot be combined with a directory argument';
    else if (stdinOpt && watchOpt) flagError = '--stdin cannot be combined with --watch';
    else if (valuesOpt !== null && !schemaOpt) flagError = '--values needs --schema <file>';
  }
  if (flagError) {
    const message = `env-saaf: ${flagError}`;
    if (jsonMode) console.log(JSON.stringify({ ok: false, error: message }));
    else console.error(message);
    process.exit(2);
  }
}

// Issue #60: the scaffold `init` writes. Commented examples of the main types
// so a new user sees what is available at a glance; the .env.example that
// accompanies it is generated from this same object, so the two cannot drift.
// Issue #171: `scannedKeys` are keys the project's code already reads (the
// same scan `check`/`example` use). They are folded into the scaffold as
// string rules under a comment saying where they came from, so the generated
// .env.example covers them and the first `check` after `init` reports no
// MISSING lines to merge by hand.
const starterSchema = (validationHint, scannedKeys = []) => {
  const scanned = scannedKeys.length
    ? `\n  // Found by scanning this project's code (process.env reads) — typed as\n  // string for now; tighten the type, or delete, as needed.\n`
      + scannedKeys.map(k => `  ${k}: { type: 'string' },\n`).join('')
    : '';
  return `// Starter schema generated by env-saaf init — edit freely.
// ${validationHint}
module.exports = {
  // free-form text
  APP_NAME: { type: 'string', required: true },
  // whole numbers, coerced from the string in .env
  RETRIES: { type: 'int', default: 3 },
  // true/false (also yes/no, on/off, 1/0)
  DEBUG: { type: 'boolean', default: false },
  // TCP port 0-65535
  PORT: { type: 'port', default: 3000 },
  // full URL with a scheme
  API_URL: { type: 'url', required: true },
  // email address
  SUPPORT_EMAIL: { type: 'email' },
  // human duration parsed to milliseconds ('500ms', '30s', '15m', '2h')
  SHUTDOWN_TIMEOUT: { type: 'duration', default: '15m' },
  // hostname or IP address, no scheme or port
  DB_HOST: { type: 'host', default: 'localhost' },
${scanned}};
`;
};

// Issue #171: the keys the fixed part of the scaffold always declares. Scanned
// keys matching any of these are skipped, so code reading PORT (say) does not
// produce a duplicate entry in the generated schema. The test pinning a fresh
// scaffold to exactly these keys keeps this list from drifting off the template.
const starterKeys = ['APP_NAME', 'RETRIES', 'DEBUG', 'PORT', 'API_URL', 'SUPPORT_EMAIL', 'SHUTDOWN_TIMEOUT', 'DB_HOST'];

// Issue #232: infer a starter rule type from a sample value found in an
// existing example file. Priority order (first match wins): a port-looking
// number -> 'port', true/false -> 'boolean', an http(s) URL -> 'url', an
// email -> 'email', then the unambiguous shapes uuid/date/duration/semver/
// json/hex (issue #356), an integer -> 'int', a decimal -> 'number', anything
// else -> 'string' (including empty values). "Port-looking" means a whole
// number in 1024-65535 — the range app servers actually listen on; smaller
// whole numbers are more often counts or flags, so they infer as 'int'.
function inferTypeFromSample(sample) {
  const v = String(sample).trim();
  if (v === '') return 'string';
  // Issue #356: shapes that are unambiguous once seen. Each candidate is
  // confirmed with the real validator, so an inferred rule always accepts the
  // sample it came from (an impossible date or a padded UUID stays 'string').
  const accepts = (type) => {
    try {
      validateEnv({ SAMPLE: { type } }, { SAMPLE: v });
      return true;
    } catch {
      return false;
    }
  };
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v) && accepts('uuid')) return 'uuid';
  if (/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/.test(v) && accepts('date')) return 'date';
  if (/^(?:\d+(?:\.\d+)?(?:ms|s|m|h|d|w))+$/i.test(v) && accepts('duration')) return 'duration';
  if (/^v?(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(v) && accepts('semver')) return 'semver';
  if ((v.startsWith('{') || v.startsWith('[')) && accepts('json')) return 'json';
  // Even-length hex of at least four bytes: 'deadbeef', not 'cafe' or 'face'.
  if (/^(?:[0-9a-fA-F]{2}){4,}$/.test(v) && accepts('hex')) return 'hex';
  if (/^-?\d+$/.test(v)) {
    const n = Number(v);
    return n >= 1024 && n <= 65535 ? 'port' : 'int';
  }
  if (/^(true|false)$/i.test(v)) return 'boolean';
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(v)) {
    // Issue #470: infer 'url' for any absolute URL with an explicit scheme://
    // authority, not just http(s). The real validator (new URL) confirms the
    // sample and rejects invalid ports such as 'postgres://host:abc/db'.
    try {
      const parsed = new URL(v);
      if (parsed.host && accepts('url')) return 'url';
    } catch { /* not a parseable URL — fall through */ }
  }
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) {
    // Match the 'email' validator: the domain must not start or end with a
    // dot — 'a@.b.com' fails check ("domain may not start with a dot"), so it
    // must not infer as 'email' (falls through to 'string').
    const domain = v.slice(v.indexOf('@') + 1);
    if (!domain.startsWith('.') && !domain.endsWith('.')) return 'email';
  }
  if (Number.isFinite(Number(v))) return 'number';
  return 'string';
}

// Issue #232: build the starter schema text from parsed example entries
// ([[key, sample], ...]). Every inferred rule carries a comment saying it was
// inferred and should be reviewed — the sample value itself is deliberately
// NOT echoed into the comment, so a password in .env.example cannot leak into
// the committed schema. Keys the code scan already found are folded in as
// string rules (same as the fixed scaffold does) unless the example already
// lists them, so nothing is duplicated.
// Issue #263: with --groups, keys sharing a common prefix (at least two
// characters before the first '_', shared by at least two keys) fold into
// a grouped schema (prefix: 'PREFIX_') keeping the same per-key type inference.
function schemaFromExample(hint, exampleName, entries, scannedKeys = [], groups = false) {
  const jsKey = k => (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(k) ? k : JSON.stringify(k));
  const seen = new Set(entries.map(([k]) => k));
  let inferred;
  if (!groups) {
    inferred = entries.map(([k, sample]) => {
      const type = inferTypeFromSample(sample);
      return `  // inferred as '${type}' from the sample value in ${exampleName} — review this rule\n  ${jsKey(k)}: { type: '${type}' },`;
    });
  } else {
    const groupCounts = new Map();
    for (const [k] of entries) {
      const idx = k.indexOf('_');
      if (idx >= 2) {
        const group = k.slice(0, idx);
        const innerKey = k.slice(idx + 1);
        if (innerKey.length > 0 && !seen.has(group)) {
          groupCounts.set(group, (groupCounts.get(group) || 0) + 1);
        }
      }
    }
    inferred = [];
    const emittedGroups = new Set();
    for (const [k, sample] of entries) {
      const idx = k.indexOf('_');
      const group = idx >= 2 ? k.slice(0, idx) : null;
      const isGrouped = group !== null && (groupCounts.get(group) || 0) >= 2;
      if (!isGrouped) {
        const type = inferTypeFromSample(sample);
        inferred.push(`  // inferred as '${type}' from the sample value in ${exampleName} — review this rule\n  ${jsKey(k)}: { type: '${type}' },`);
      } else if (!emittedGroups.has(group)) {
        emittedGroups.add(group);
        const prefix = group + '_';
        const groupEntries = entries.filter(([key]) => key.startsWith(prefix) && key.length > prefix.length);
        const innerRules = groupEntries.map(([key, s]) => {
          const innerKey = key.slice(prefix.length);
          const type = inferTypeFromSample(s);
          return `      // inferred as '${type}' from the sample value in ${exampleName} — review this rule\n      ${jsKey(innerKey)}: { type: '${type}' },`;
        });
        inferred.push(`  ${jsKey(group)}: {\n    prefix: '${prefix}',\n    schema: {\n${innerRules.join('\n')}\n    },\n  },`);
      }
    }
  }
  const extra = scannedKeys.filter(k => !seen.has(k));
  const scanned = extra.length
    ? `\n  // Found by scanning this project's code (process.env reads) — not in ${exampleName};\n  // typed as string for now; tighten the type, or delete, as needed.\n`
      + extra.map(k => `  ${jsKey(k)}: { type: 'string' },\n`).join('')
    : '';
  return `// Starter schema inferred by env-saaf init --from-example from ${exampleName} — review every rule.\n// ${hint}\nmodule.exports = {\n${inferred.join('\n')}\n${scanned}};\n`;
}

function resolveFileContextDir(actualFile, pkgDir) {
  if (configPkgDir !== null) return configPkgDir;
  const cwdReal = fs.realpathSync.native(process.cwd());
  const probe = jsonSchemaOpt && schemaOpt ? schemaOpt : fileOpt;
  for (let d = path.dirname(actualFile); ; ) {
    if (fs.existsSync(path.resolve(d, probe))) return d;
    if (d === cwdReal) return process.cwd();
    if (d === pkgDir) return d;
    const parent = path.dirname(d);
    if (parent === d) return path.dirname(actualFile);
    d = parent;
  }
}

// Issue #133 / #418: validate the target argument before any command uses it.
// scan and check also accept one readable supported code file; anything else
// that is missing or not a directory reports a clear message and exits 2.
if (cmd === 'scan' || cmd === 'check' || cmd === 'example' || cmd === 'init' || cmd === 'print') {
  if (scanFile !== null) {
    dir = resolveFileContextDir(scanFile, filePkgDir);
  } else {
    let stat = null;
    if (fs.existsSync(dir)) {
      try { stat = fs.statSync(dir); } catch { stat = null; }
    }
    let invalidDir = null;
    if (!stat) {
      invalidDir = `${dir} does not exist`;
    } else if (!stat.isDirectory()) {
      const cfgScanFile = cmd === 'scan' || cmd === 'check' ? resolveReadableCodeFile(dir) : null;
      if (cfgScanFile !== null) {
        scanFile = cfgScanFile;
        scanLocationFile = path.relative(process.cwd(), scanFile).split(path.sep).join('/');
        dir = resolveFileContextDir(scanFile, null);
      } else {
        invalidDir = `${dir} is not a directory`;
      }
    }
    if (invalidDir) {
      const message = `env-saaf: ${invalidDir}`;
      if (jsonMode) {
        console.log(JSON.stringify({ ok: false, error: message }));
      } else {
        console.error(message);
      }
      process.exit(2);
    }
  }
}

// Issue #358: the env names a schema declares, groups flattened to DB_HOST.
function flattenedSchemaKeys(schema, prefix = '') {
  const keys = [];
  for (const [key, rule] of Object.entries(schema)) {
    if (rule && typeof rule === 'object' && rule.schema && typeof rule.prefix === 'string') {
      keys.push(...flattenedSchemaKeys(rule.schema, prefix + rule.prefix));
    } else {
      keys.push(prefix + key);
    }
  }
  return keys;
}

// Issue #428: the schema rules by flattened env name (groups flattened to
// DB_HOST, like flattenedSchemaKeys), so --fix can look up the rule for a
// missing key.
function flattenedSchemaRules(schema, prefix = '') {
  const rules = new Map();
  for (const [key, rule] of Object.entries(schema)) {
    if (rule && typeof rule === 'object' && rule.schema && typeof rule.prefix === 'string') {
      for (const [k, r] of flattenedSchemaRules(rule.schema, prefix + rule.prefix)) rules.set(k, r);
    } else {
      rules.set(prefix + key, rule);
    }
  }
  return rules;
}

// Issue #428: the placeholder generateExample would write for one key's rule.
// A single-key schema reuses every placeholder rule (defaults, bounds,
// choices, empty values for secret-looking keys); anything generateExample
// cannot render falls back to the bare key with an empty value.
function placeholderForKey(key, rules) {
  const rule = rules ? rules.get(key) : undefined;
  if (rule === undefined) return '';
  try {
    const generated = generateExample({ [key]: rule });
    const line = generated.split('\n').find(l => l.startsWith(`${key}=`));
    return line === undefined ? '' : line.slice(key.length + 1);
  } catch {
    return '';
  }
}

// Issue #416: detect values in .env.example that look like real secrets rather
// than placeholders, without ever echoing the value. Empty values, obvious
// placeholders and every shape `generateExample` itself emits must pass.
const PLACEHOLDER_WORDS = new Set([
  'changeme', 'placeholder', 'redacted', 'example', 'sample', 'dummy',
  'todo', 'fixme', 'none', 'unset', 'empty', 'null', 'secret', 'password',
  'passwd', 'token', 'apikey', 'credentials', 'credential',
]);
const KNOWN_SECRET_PREFIXES = [
  /^sk-(?:proj-|ant-(?:api\d+-)?|live-|test-)?([A-Za-z0-9_-]{12,})$/,
  /^(?:[sr]k_(?:live|test)_|whsec_)([A-Za-z0-9_-]{12,})$/,
  /^(?:gh[pousr]_|github_pat_)([A-Za-z0-9_]{20,})$/,
  /^xox[baprs]-([0-9A-Za-z-]{16,})$/,
  /^AIza([0-9A-Za-z_-]{30,})$/,
  /^SG\.([A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,})$/,
  /^(?:npm_|hf_)([A-Za-z0-9]{20,})$/,
  /^glpat-([A-Za-z0-9_-]{16,})$/,
];

function shannonEntropy(str) {
  const counts = new Map();
  for (const ch of str) counts.set(ch, (counts.get(ch) || 0) + 1);
  let entropy = 0;
  for (const count of counts.values()) {
    const p = count / str.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

function isPlaceholderToken(v) {
  if (/^(?:<[^>]+>|\[[^\]]+\]|\$\{[^}]+\})$/.test(v)) return true;
  if (new Set(v).size <= 2) return true;
  const lower = v.toLowerCase();
  if (PLACEHOLDER_WORDS.has(lower)) return true;
  if (/^[a-z0-9_-]+$/.test(v) || /^[A-Z0-9_-]+$/.test(v)) {
    const noRandomSegment = v.split(/[-_]/).every(seg => seg.length < 16 || /^[a-z]+$/i.test(seg));
    if (noRandomSegment) {
      if (/^(?:your|my|insert|enter|put|fill|set|add|paste|replace|change)[-_][a-z0-9_-]+$/.test(lower)) return true;
      if (/^[a-z0-9_-]+[-_](?:here|placeholder|redacted|changeme|example|sample|dummy)$/.test(lower)) return true;
    }
  }
  return false;
}

function isHexPlaceholder(v) {
  const lower = v.toLowerCase();
  const stripped = lower
    .replace(/deadbeef|cafebabe|feedface|badc0ffe|0123456789abcdef|abcdef0123456789/g, '')
    .replace(/^(.)\1+$/, '');
  if (stripped.length < 16) return true;
  return shannonEntropy(lower) < 3.0;
}

function isSecretToken(v) {
  for (const re of KNOWN_SECRET_PREFIXES) {
    const m = re.exec(v);
    if (m && !isPlaceholderToken(m[1])) return true;
  }
  if (/^(?:AKIA|ASIA)[0-9A-Z]{16}$/.test(v) && new Set(v.slice(4)).size >= 4) return true;
  if (/^eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}$/.test(v)) return true;
  if (isPlaceholderToken(v)) return false;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)) return false;
  if (/^[+-]?\d[\d_]*(?:\.\d[\d_]*)?$/.test(v)) return false;
  if (/^(?:\d+(?:\.\d+)?(?:ms|s|m|h|d|w))+$/i.test(v)) return false;
  if (/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/.test(v)) return false;
  if (/^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]{1,15})?$/.test(v)) return false;
  if (net.isIP(v.replace(/%[A-Za-z0-9._-]+$/, '')) !== 0) return false;
  if (/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(v)) return false;
  if (/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}\.?$/i.test(v)) return false;
  if (/^\.\.?\/[A-Za-z0-9._/-]+$/.test(v) || /^\/[a-z0-9._-]+(?:\/[a-z0-9._-]+)+$/.test(v)) return false;
  if ((/^[a-z]+(?:[-_][a-z0-9]+)+$/.test(v) || /^[A-Z]+(?:[-_][A-Z0-9]+)+$/.test(v))
    && v.split(/[-_]/).every(seg => seg.length < 20 || /^[a-z]+$/i.test(seg))) {
    return false;
  }
  if (/^[0-9a-f]{32,}$/i.test(v)) return !isHexPlaceholder(v);
  if (v.length < 20 || !/^[A-Za-z0-9+/=._~-]+$/.test(v) || new Set(v).size < 10) return false;
  const hasLower = /[a-z]/.test(v);
  const hasUpper = /[A-Z]/.test(v);
  const hasDigit = /\d/.test(v);
  const hasB64Sym = /[+/=]/.test(v);
  const entropy = shannonEntropy(v);
  if ((hasLower && hasUpper && (hasDigit || hasB64Sym)) || ((hasLower || hasUpper) && hasDigit && hasB64Sym)) {
    const strippedSeq = v.replace(/ABCDEFGHIJKLMNOPQRSTUVWXYZ|abcdefghijklmnopqrstuvwxyz|0123456789/g, '');
    if (strippedSeq.length < 16) return false;
    return entropy >= 3.75;
  }
  if ((hasLower !== hasUpper) && hasDigit && /^[A-Za-z0-9]+$/.test(v) && v.length >= 24) {
    const transitions = (v.match(/[A-Za-z]\d|\d[A-Za-z]/g) || []).length;
    return transitions >= 6 && entropy >= 3.6;
  }
  return false;
}

function isSecretExampleValue(raw, depth = 0) {
  if (depth > 6 || typeof raw !== 'string') return false;
  const v = raw.trim();
  if (v.length === 0) return false;
  if (/-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/.test(v)) return true;
  const authMatch = /^(?:Bearer|Basic)\s+(\S+)$/i.exec(v);
  if (authMatch) return isSecretExampleValue(authMatch[1], depth + 1);
  if ((v.startsWith('{') && v.endsWith('}')) || (v.startsWith('[') && v.endsWith(']'))) {
    try {
      const parsed = JSON.parse(v);
      if (parsed !== null && typeof parsed === 'object') {
        const stack = [parsed];
        while (stack.length > 0) {
          const cur = stack.pop();
          const items = Array.isArray(cur) ? cur : Object.values(cur);
          for (const item of items) {
            if (typeof item === 'string') {
              if (isSecretExampleValue(item, depth + 1)) return true;
            } else if (item !== null && typeof item === 'object') {
              stack.push(item);
            }
          }
        }
        return false;
      }
    } catch { /* Fall through when the value is not valid JSON. */ }
  }
  if (!/\s/.test(v) && /^[a-z][a-z0-9+.-]*:\/\//i.test(v)) {
    const authority = /^[a-z][a-z0-9+.-]*:\/\/([^/?#@]*)@([^/?#]+)/i.exec(v);
    if (authority) {
      const userinfo = authority[1];
      const colon = userinfo.indexOf(':');
      if (colon !== -1) {
        let pass = userinfo.slice(colon + 1);
        try { pass = decodeURIComponent(pass); } catch { /* keep raw */ }
        if (pass.length > 0 && !isPlaceholderToken(pass)) return true;
      }
    }
    try {
      const parsed = new URL(v);
      for (const [, paramVal] of parsed.searchParams) {
        if (isSecretExampleValue(paramVal, depth + 1)) return true;
      }
      for (const seg of parsed.pathname.split('/')) {
        if (seg && isSecretToken(seg)) return true;
      }
    } catch { /* non-WHATWG URL placeholder already checked above */ }
    // A delimited list that merely starts with a URL (`https://a.test,<token>`)
    // still needs each element inspected, so only a delimiter-free URL ends here.
    if (!/[,;|]/.test(v)) return false;
  }
  if (!/\s/.test(v) && /[,;|]/.test(v)) {
    const parts = v.split(/[,;|]/);
    if (parts.length >= 2) return parts.some(part => isSecretExampleValue(part, depth + 1));
  }
  return isSecretToken(v);
}

// Parse the template without consulting ambient process.env so `${API_KEY}` in
// .env.example never inherits a live credential from the caller's shell. When a
// key uses `${VAR:?msg}` or `${VAR?msg}` for an ambient-only variable, stub
// only that variable with a benign placeholder so literal secrets on the same
// or later lines are still inspected and ambient values are never reused.
function readExampleValuesIsolated(filePath) {
  const input = fs.readFileSync(filePath, 'utf8');
  const stubEnv = Object.create(null);
  const savedEnv = process.env;
  process.env = stubEnv;
  try {
    for (;;) {
      try {
        return parseEnvFile(input);
      } catch (err) {
        const m = /^env-saaf: [^\s]+ at line \d+: ([A-Za-z_][A-Za-z0-9_]*): /.exec(err && err.message);
        if (!m || stubEnv[m[1]] !== undefined) return {};
        stubEnv[m[1]] = 'placeholder';
      }
    }
  } finally {
    process.env = savedEnv;
  }
}

// Everything a flagged example value could be echoed as: the whole value plus
// the secret-looking pieces of lists, JSON leaves, URL passwords, query values
// and path segments, so a schema message that quotes only a slice is caught.
function addSensitiveFragments(raw, out, force = false) {
  if (typeof raw !== 'string') return;
  const v = raw.trim();
  // A URL password is recorded even when it is one to three characters long;
  // guardValidationErrors matches such short pieces only as a whole quoted value.
  if (v.length < (force ? 1 : 4)) return;
  if (force || isSecretExampleValue(v)) out.add(v);
  // Every piece below is strictly shorter than v, so the recursion terminates.
  const auth = /^(?:Bearer|Basic)\s+(\S+)$/i.exec(v);
  if (auth) addSensitiveFragments(auth[1], out);
  if (/^[[{]/.test(v)) {
    try {
      const stack = [JSON.parse(v)];
      while (stack.length > 0) {
        const cur = stack.pop();
        if (typeof cur === 'string') addSensitiveFragments(cur, out);
        else if (cur !== null && typeof cur === 'object') stack.push(...Object.values(cur));
      }
    } catch { /* not JSON: the whole value is already recorded */ }
  }
  if (!/\s/.test(v) && /^[a-z][a-z0-9+.-]*:\/\//i.test(v)) {
    const userinfo = /^[a-z][a-z0-9+.-]*:\/\/([^/?#@]*)@/i.exec(v);
    if (userinfo && userinfo[1].includes(':')) {
      const pass = userinfo[1].slice(userinfo[1].indexOf(':') + 1);
      addSensitiveFragments(pass, out, true);
      try { addSensitiveFragments(decodeURIComponent(pass), out, true); } catch { /* keep raw */ }
    }
    try {
      const parsed = new URL(v);
      for (const [, paramVal] of parsed.searchParams) addSensitiveFragments(paramVal, out);
      for (const seg of parsed.pathname.split('/')) addSensitiveFragments(seg, out);
    } catch { /* not a WHATWG URL */ }
  }
  if (!/\s/.test(v) && /[,;|]/.test(v)) {
    for (const part of v.split(/[,;|]/)) addSensitiveFragments(part, out);
  }
}

// What check must keep out of schema-validation output once the example file
// has findings: `strip` names are removed from the validated values, `tainted`
// schema keys have their errors withheld, and `fragments` are value pieces no
// message may contain. The decision depends only on the example findings, never
// on which file is validated.
function buildExampleGuard(schema, secrets, exampleValues) {
  const secretSet = new Set(secrets);
  const tainted = new Set(secretSet);
  const strip = new Set(secretSet);
  const walk = (group, prefix) => {
    for (const [key, rule] of Object.entries(group)) {
      if (rule && typeof rule === 'object' && rule.schema && typeof rule.prefix === 'string') {
        walk(rule.schema, prefix + rule.prefix);
        continue;
      }
      const aliases = rule && Array.isArray(rule.aliases) ? rule.aliases : [];
      if (secretSet.has(prefix + key) || aliases.some(a => secretSet.has(a))) {
        tainted.add(prefix + key);
        strip.add(prefix + key);
        for (const a of aliases) strip.add(a);
      }
    }
  };
  walk(schema, '');
  const fragments = new Set();
  for (const k of secrets) addSensitiveFragments(exampleValues[k], fragments);
  return { tainted, strip, fragments };
}

const WITHHELD = 'details withheld because the example file has flagged values';

// Keep a schema message only when it provably carries no flagged value: keyed
// to an untainted schema key and free of every sensitive fragment. Errors for
// tainted keys are already reported by name under SECRET and are dropped; an
// unrecognised shape or a message that quotes a flagged value is replaced by a
// generic diagnostic instead of being printed.
// A one-to-three character piece (a short URL password) would match inside
// ordinary words, so it counts only as a whole token: not touching a letter or
// digit on either side, anywhere in the message (`got "xyz"`, `bad xyz for x`).
function containsWholeToken(message, token) {
  for (let i = message.indexOf(token); i !== -1; i = message.indexOf(token, i + 1)) {
    const before = message[i - 1];
    const after = message[i + token.length];
    if (!(before && /[A-Za-z0-9]/.test(before)) && !(after && /[A-Za-z0-9]/.test(after))) return true;
  }
  return false;
}

function guardValidationErrors(errors, guard) {
  const out = [];
  for (const message of errors) {
    const m = /^([^\s:]+): /.exec(message);
    if (!m) {
      out.push(`schema validation failed (${WITHHELD})`);
      continue;
    }
    const subject = m[1];
    let isTainted = false;
    for (const k of guard.tainted) {
      if (subject === k || subject.startsWith(`${k}[`) || subject.startsWith(`${k}.`)) isTainted = true;
    }
    if (isTainted) continue;
    let carriesValue = false;
    for (const f of guard.fragments) {
      if (f.length >= 4 ? message.includes(f) : containsWholeToken(message, f)) { carriesValue = true; break; }
    }
    out.push(carriesValue ? `${subject}: value rejected by schema (${WITHHELD})` : message);
  }
  return [...new Set(out)];
}

function readEnvFile(filePath) {
  const input = fs.readFileSync(filePath, 'utf8');
  try {
    return parseEnvFile(input);
  } catch (error) {
    // Issue #160: parseEnvFile's own errors already carry the `env-saaf: `
    // prefix (e.g. the duplicate-key error), so strip it before wrapping —
    // otherwise the CLI prints the prefix twice, in text and --json output.
    const detail = error.message.replace(/^env-saaf: /, '');
    const message = `${path.relative(dir, filePath)}: ${detail}`;
    if (jsonMode) console.log(JSON.stringify({ ok: false, error: message }));
    else console.error(`env-saaf: ${message}`);
    fatalExit(2);
  }
}

// Issue #184: would Node treat this schema file as an ES module? A .js file
// is ESM when the nearest package.json above it says "type": "module"
// (a .mjs file always is, a .cjs file never is). A schema Node treats as ESM
// cannot be loaded with require() — the generated `module.exports` starter
// throws `ReferenceError: module is not defined` — so callers check this
// before writing or loading anything.
function schemaIsEsm(schemaPath) {
  const ext = path.extname(schemaPath);
  if (ext === '.mjs') return true;
  if (ext === '.cjs') return false;
  // Callers pass an already-resolved path; resolve it again would break
  // callers that stub path.resolve (see the #169 Windows-path test).
  let d = path.dirname(schemaPath);
  for (;;) {
    const pkgPath = path.join(d, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        return JSON.parse(fs.readFileSync(pkgPath, 'utf8')).type === 'module';
      } catch {
        return false;
      }
    }
    const parent = path.dirname(d);
    if (parent === d) return false;
    d = parent;
  }
}

function readStdin() {
  return new Promise((resolve, reject) => {
    const chunks = [];
    process.stdin.on('data', chunk => chunks.push(chunk));
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    process.stdin.on('error', reject);
  });
}

// Issue #353: print the effective configuration, masking sensitive rules.
// Issue #447: keys whose name looks like a secret are masked too, even without
// `sensitive: true` — the same word list `generateExample` uses in index.js.
// Grouped keys are judged by their full flat name (prefix + key), so DB_TOKEN
// is masked while a bare TOKEN-free name like DB_HOST is not.
const SECRET_WORDS = new Set(['SECRET', 'KEY', 'TOKEN', 'PASSWORD', 'PASSWD', 'PRIVATE', 'CREDENTIAL']);
function looksSecretName(name) {
  return name.split('_').some((part) => SECRET_WORDS.has(part.toUpperCase()));
}

function maskUrlPassword(value) {
  if (typeof value !== 'string') return value;

  const match = /^([a-z][a-z0-9+.-]*:\/\/[^/?#@]*:)([^/?#@]*)@/i.exec(value);
  if (!match) return value;

  return `${match[1]}***@${value.slice(match[0].length)}`;
}

function maskBySchema(schema, values, prefix = '') {
  const out = Array.isArray(values) ? [...values] : { ...values };
  for (const [key, rule] of Object.entries(schema)) {
    if (!Object.prototype.hasOwnProperty.call(out, key)) continue;
    if (rule && typeof rule === 'object' && rule.schema && typeof rule.prefix === 'string') {
      out[key] = maskBySchema(rule.schema, out[key], prefix + rule.prefix);
   } else if (rule && (rule.sensitive === true || looksSecretName(prefix + key))) {
  out[key] = typeof out[key] === 'string' ? maskValue(out[key]) : '[REDACTED]';
} else if (typeof out[key] === 'string') {
  out[key] = maskUrlPassword(out[key]);
}
  }
  return out;
}

function printEffective(schema, values, prefix = '', lines = []) {
  for (const [key, rule] of Object.entries(schema)) {
    if (!Object.prototype.hasOwnProperty.call(values, key)) continue;
    if (rule && typeof rule === 'object' && rule.schema && typeof rule.prefix === 'string') {
      printEffective(rule.schema, values[key], prefix + rule.prefix, lines);
    } else {
      const value = values[key];
      const shown = value instanceof Date ? value.toISOString()
        : value !== null && typeof value === 'object' ? JSON.stringify(value)
          : String(value);
      lines.push(`${prefix}${key}=${shown}`);
    }
  }
  return lines;
}

// Issue #353: async so the schema can be loaded with the ESM-aware loader.
async function runPrint() {
  // Issue #353: an answer to "what did my app load?", with sensitive values
  // masked. Validation failures use the same messages and exit code as check.
  if (!schemaOpt) {
    const message = 'env-saaf: print needs --schema <file>';
    if (jsonMode) console.log(JSON.stringify({ ok: false, error: message }));
    else console.error(message);
    process.exit(2);
  }
  const valuesName = fileExplicit ? fileOpt : '.env';
  const valuesPath = path.join(dir, valuesName);
  if (!fs.existsSync(valuesPath)) {
    const message = `env-saaf: ${valuesName} not found in ${dir}`;
    if (jsonMode) console.log(JSON.stringify({ ok: false, error: message }));
    else console.error(message);
    process.exit(2);
  }
  const schema = await loadSchemaFile();
  let env;
  try {
    env = validateEnv(schema, readEnvFile(valuesPath));
  } catch (error) {
    if (!(error instanceof EnvSaafError)) throw error;
    if (jsonMode) console.log(JSON.stringify({ ok: false, errors: error.errors }));
    else error.errors.forEach((line) => console.error(line));
    process.exit(1);
  }
  // Issue #474: --reveal prints the real values (text and --json alike) — an
  // explicit opt-in for local debugging; without it output is always masked.
  const masked = revealOpt ? env : maskBySchema(schema, env);
  if (jsonMode) {
    console.log(JSON.stringify(masked, null, 2));
  } else {
    printEffective(schema, masked).forEach((line) => console.log(line));
  }
  return 0;
}

function printScanResult(vars, locations) {
  // Issue #63: the reverse drift — keys declared in the template that no code reads any more.
  // Only a warning: stdout stays the plain list of used vars and the exit code is unchanged.
  // Without a template file there is nothing to compare, so the output is exactly as before.
  // Issue #359 / #418: in --stdin or single-file mode there is no scanned directory, so only compare when --file is explicit.
  let unused = null;
  if ((!stdinOpt && scanFile === null) || fileExplicit) {
    const templatePath = path.join(dir, fileOpt);
    if (fs.existsSync(templatePath) && fs.statSync(templatePath).isFile()) {
      const declared = Object.keys(readEnvFile(templatePath));
      unused = diffEnv(vars, declared).documentedNotUsed;
    }
  }
  if (jsonMode) {
    // Issue #335: locations map sits beside unchanged vars/unused; plain output ignores it.
    const result = { ok: true, vars, locations: locations || {} };
    if (unused) result.unused = unused;
    console.log(JSON.stringify(result));
  } else {
    if (vars.length) console.log(vars.join('\n'));
    else console.error('No process.env usage found.');
    if (unused) unused.forEach(k => console.error(`UNUSED: ${k} (in ${fileOpt}, never used in code)`));
  }
  return 0;
}

// Issue #230: the scan/check bodies are plain functions so watch mode can
// re-run them; the non-watch path below calls them exactly once, keeping
// output and exit codes byte-for-byte unchanged.
function readScanFile() {
  try {
    return fs.readFileSync(scanFile, 'utf8');
  } catch (e) {
    if (watchActive && e.code === 'ENOENT') {
      const message = `env-saaf: ${scanLocationFile} does not exist`;
      if (jsonMode) console.log(JSON.stringify({ ok: false, error: message }));
      else console.error(message);
      fatalExit(2);
    }
    throw e;
  }
}

function runScan() {
  if (scanFile !== null) {
    const text = readScanFile();
    if (jsonMode) {
      const { vars, locations } = scanCodeLocations(text, scanLocationFile);
      return printScanResult(vars, locations);
    }
    return printScanResult(scanCode(text));
  }
  // Issue #335: JSON mode reuses scanDirLocations so the CLI does not re-walk.
  if (jsonMode) {
    const { vars, locations } = scanDirLocations(dir, { exclude: excludeOpts });
    return printScanResult(vars, locations);
  }
  return printScanResult(scanDir(dir, { exclude: excludeOpts }));
}

const esmWatchPaths = new Set();
let watchLoadSeq = 0;

function isPlainObject(value) {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function unwrapSchemaModule(mod, loadedViaRequire) {
  if (!isModuleNamespaceObject(mod)) return mod;
  // Node's require(esm) attaches a synthetic __esModule: true alongside default;
  // ignore that marker only on require-loaded namespaces so explicit ESM named
  // exports are never silently dropped.
  const exportKeys = Object.keys(mod).filter(
    key => !(loadedViaRequire && key === '__esModule' && mod[key] === true)
  );
  if (exportKeys.length === 1 && exportKeys[0] === 'default') {
    return mod.default;
  }
  return mod;
}

async function loadSchemaModule(schemaPath) {
  const importFresh = async () => {
    const url = pathToFileURL(schemaPath);
    if (watchActive) url.searchParams.set('watch', String(++watchLoadSeq));
    return { mod: await import(url.href), loadedViaRequire: false };
  };
  if (schemaIsEsm(schemaPath) || (watchActive && esmWatchPaths.has(schemaPath))) {
    return importFresh();
  }
  try {
    // Issue #230: require() caches modules, so in watch mode a schema edit
    // would otherwise re-run against the stale cached schema — drop the
    // cache entry before loading (the init command uses the same pattern).
    if (watchActive) {
      try { delete require.cache[require.resolve(schemaPath)]; } catch { /* not loaded yet */ }
    }
    const mod = require(schemaPath);
    if (watchActive && isModuleNamespaceObject(mod)) {
      esmWatchPaths.add(schemaPath);
    }
    return { mod, loadedViaRequire: true };
  } catch (e) {
    if (e && (e.code === 'ERR_REQUIRE_ESM' || e.code === 'ERR_REQUIRE_ASYNC_MODULE')) {
      if (watchActive) esmWatchPaths.add(schemaPath);
      return importFresh();
    }
    throw e;
  }
}

// Load the --schema file (relative to the checked directory, like --file)
// and check it exports a schema object. Shared by the --schema validation
// step in runCheck, --json-schema (issue #268), and example --schema
// (issue #206). A load failure or a non-object export reports a plain message
// and exits 2.
async function loadSchemaFile() {
  const schemaPath = path.resolve(dir, schemaOpt);
  let loaded;
  try {
    loaded = await loadSchemaModule(schemaPath);
  } catch (e) {
    // Issue #184: when the schema file is one Node treats as an ES module,
    // say so plainly and name the fix instead of surfacing the raw
    // `ReferenceError: module is not defined` text.
    let detail = e && typeof e.message === 'string' ? e.message : String(e);
    if (/ES module|module is not defined/.test(detail)) {
      detail += ' — in a "type": "module" project the schema must be a .cjs file (e.g. env.schema.cjs)';
    }
    const message = `env-saaf: cannot load schema ${schemaOpt}: ${detail}`;
    if (jsonMode) console.log(JSON.stringify({ ok: false, error: message }));
    else console.error(message);
    fatalExit(2);
  }
  const schema = unwrapSchemaModule(loaded.mod, loaded.loadedViaRequire);
  if (!isPlainObject(schema)) {
    const message = `env-saaf: schema ${schemaOpt} must export a schema object (module.exports = { KEY: { type: 'port', ... } })`;
    if (jsonMode) console.log(JSON.stringify({ ok: false, error: message }));
    else console.error(message);
    fatalExit(2);
  }
  return schema;
}

async function runCheck() {
  // Issue #268: --json-schema prints the --schema file as a draft 2020-12
  // JSON Schema document to stdout instead of running the check. The
  // .env.example is never read here, so a schema can be converted even
  // before any example file exists. Without --schema there is nothing to
  // convert; an invalid schema reports its error and exits 2 like the
  // --schema validation path below, never a raw stack trace.
  if (jsonSchemaOpt) {
    if (!schemaOpt) {
      const message = 'env-saaf: --json-schema needs --schema <file>';
      if (jsonMode) console.log(JSON.stringify({ ok: false, error: message }));
      else console.error(message);
      fatalExit(2);
    }
    const schema = await loadSchemaFile();
    let document;
    try {
      document = toJsonSchema(schema);
    } catch (e) {
      if (e instanceof EnvSaafError) {
        const message = `env-saaf: invalid schema ${schemaOpt}: ${e.message}`;
        if (jsonMode) console.log(JSON.stringify({ ok: false, error: message }));
        else console.error(message);
        fatalExit(2);
      }
      throw e;
    }
    console.log(JSON.stringify(document, null, 2));
    return 0;
  }
  const examplePath = path.join(dir, fileOpt);
  // Issue #428: with --fix a missing template is created below instead of
  // erroring out — every used key is missing, so the fix drafts the file.
  const exampleExists = fs.existsSync(examplePath);
  if (!exampleExists && !fixOpt) {
    // Issue #89: point at the command that drafts the file instead of dead-ending
    // a new user. --json keeps stdout parseable, so the hint travels as a field.
    const hint = `run \`env-saaf example\` to draft one, or generate it from your schema with generateExample()`;
    if (jsonMode) {
      console.log(JSON.stringify({ ok: false, error: `${fileOpt} not found in ${dir}`, hint }));
    } else {
      console.error(`env-saaf: ${fileOpt} not found in ${dir} — ${hint}`);
    }
    fatalExit(2);
  }
  const documented = exampleExists ? Object.keys(readEnvFile(examplePath)) : [];
  const isolatedExample = exampleExists ? readExampleValuesIsolated(examplePath) : {};
  const secrets = documented.filter(k => isSecretExampleValue(isolatedExample[k]));
  const used = scanFile !== null
    ? scanCode(readScanFile())
    : scanDir(dir, { exclude: excludeOpts });
  let { usedNotDocumented, documentedNotUsed } = diffEnv(used, documented);
  // The real .env is not committed, so only compare keys when it is actually present
  const envPath = path.join(dir, '.env');
  const envFileFound = fs.existsSync(envPath);
  let envExtra = [];
  let envMissing = [];
  // Issue #494: --values names the deployment file being validated, so its
  // undocumented keys get the same EXTRA treatment the real .env gets — a
  // typo'd key there (PORTT for PORT) passed the gate silently before. A key
  // documented in the schema counts as documented too, since --schema is the
  // other source of truth the values file is judged by.
  let valuesExtra = [];
  if (envFileFound) {
    const envKeys = Object.keys(readEnvFile(envPath));
    const envDiff = diffEnv(envKeys, documented);
    envExtra = envDiff.usedNotDocumented;
    envMissing = envDiff.documentedNotUsed;
  }
  // Issue #90: --schema validates the values of the real env file against the
  // schema the file exports (module.exports = { PORT: { type: 'port', ... } }).
  // An explicit --file names the file to validate; otherwise the real .env wins
  // when present — the template's placeholders are not real values, so with no
  // .env and no explicit --file there is nothing real to validate and the step
  // is skipped. Failures land in the existing `invalid` field (the library's
  // errors already name the key) and fail the check like a missing key.
  let invalid = [];
  // Issue #358: the schema is a third source of truth; report both directions
  // against the example file, using flattened group names.
  let schemaNotDocumented = [];
  let documentedNotInSchema = [];
  // Issue #428: the loaded schema, when one is given, so --fix can look up
  // each missing key's rule for its placeholder.
  let schema = null;
  if (schemaOpt) {
    schema = await loadSchemaFile();
    const declared = flattenedSchemaKeys(schema);
    schemaNotDocumented = declared.filter((key) => !documented.includes(key));
    documentedNotInSchema = documented.filter((key) => !declared.includes(key));
    // A schema used by loadEnv can account for keys without process.env reads.
    documentedNotUsed = documentedNotUsed.filter((key) => !declared.includes(key));
    // Issue #352: --values names another file to validate (for example
    // .env.production); an explicit --file still names the template.
    let targetName = fileExplicit ? fileOpt : (envFileFound ? '.env' : null);
    if (valuesOpt !== null) {
      const valuesPath = path.join(dir, valuesOpt);
      if (!fs.existsSync(valuesPath) || !fs.statSync(valuesPath).isFile()) {
        const message = `env-saaf: --values ${valuesOpt} not found in ${dir}`;
        if (jsonMode) console.log(JSON.stringify({ ok: false, error: message }));
        else console.error(message);
        fatalExit(2);
      }
      targetName = valuesOpt;
    }
    if (targetName) {
      const rawValues = readEnvFile(path.join(dir, targetName));
      // Any example finding protects the schema report, whichever file (the
      // template, .env, --values) supplies the values or an alias resolves to.
      const guard = secrets.length > 0 ? buildExampleGuard(schema, secrets, isolatedExample) : null;
      const values = guard
        ? Object.fromEntries(Object.entries(rawValues).filter(([k]) => !guard.strip.has(k)))
        : rawValues;
      try {
        validateEnv(schema, values);
      } catch (e) {
        if (!(e instanceof EnvSaafError)) throw e;
        invalid = guard ? guardValidationErrors(e.errors, guard) : e.errors;
      }
      if (valuesOpt !== null) {
        valuesExtra = Object.keys(rawValues).filter((k) => !documented.includes(k) && !declared.includes(k));
      }
    }
  }
  // Issue #428: --fix appends the missing keys to the template file instead
  // of only reporting them. It only ever adds: existing keys and values are
  // left untouched, nothing is removed, and the real .env is never written —
  // only the template file (--file names it when given). With a schema, each
  // key gets the placeholder generateExample would emit for its rule;
  // without one the bare key is appended with an empty value. A missing
  // template is created with the same header generateExample writes. The
  // fixed keys stop counting as findings, so the check passes when they were
  // the only drift; every other finding is still reported and still fails.
  let fixed = [];
  if (fixOpt && usedNotDocumented.length) {
    const rules = schema ? flattenedSchemaRules(schema) : null;
    const lines = usedNotDocumented.map(key => `${key}=${placeholderForKey(key, rules)}`);
    if (!exampleExists) {
      fs.writeFileSync(examplePath, '# Generated by env-saaf — put real values in .env (never commit .env)\n' + lines.join('\n') + '\n');
    } else {
      const existing = fs.readFileSync(examplePath, 'utf8');
      fs.appendFileSync(examplePath, (existing.length && !existing.endsWith('\n') ? '\n' : '') + lines.join('\n') + '\n');
    }
    fixed = usedNotDocumented;
    usedNotDocumented = [];
    schemaNotDocumented = schemaNotDocumented.filter(k => !fixed.includes(k));
  }
  // Keep the first-check note when there are no direct code reads, including
  // when a schema accounts for every template key. Other findings still fail.
  const scaffoldAhead = used.length === 0 && documented.length > 0
    && usedNotDocumented.length === 0 && secrets.length === 0
    && envExtra.length === 0 && envMissing.length === 0 && invalid.length === 0
    && valuesExtra.length === 0
    && schemaNotDocumented.length === 0 && documentedNotInSchema.length === 0;
  const scaffoldNote = `no process.env usage found in code yet — ${documented.length} ${documented.length === 1 ? 'key' : 'keys'} in ${fileOpt} ${documented.length === 1 ? 'is' : 'are'} not used by any code yet`;
  const ok = scaffoldAhead || (usedNotDocumented.length === 0 && documentedNotUsed.length === 0
    && secrets.length === 0 && envExtra.length === 0 && envMissing.length === 0 && invalid.length === 0
    && valuesExtra.length === 0
    && schemaNotDocumented.length === 0 && documentedNotInSchema.length === 0);
  // Issue #352: --values validates its own file, so a missing .env is not a skip then.
  const skippedValues = schemaOpt && !fileExplicit && !envFileFound && valuesOpt === null;
  if (skippedValues && !jsonMode) {
    console.log('env-saaf: no .env file found — values were not validated.');
  }
  if (jsonMode) {
    // Issue #187: `scan --json` names the documented-but-unused keys `unused`,
    // so `check --json` now exposes the same list under the same name. `extra`
    // keeps its identical value so existing consumers are unaffected.
    const result = {
      ok,
      missing: usedNotDocumented,
      extra: scaffoldAhead ? [] : documentedNotUsed,
      unused: scaffoldAhead ? [] : documentedNotUsed,
      invalid,
      secrets,
      envExtra: [...new Set([...envExtra, ...valuesExtra])],
      envMissing,
    };
    if (valuesOpt !== null) result.valuesFile = valuesOpt;
    if (schemaOpt) {
      result.schemaNotDocumented = schemaNotDocumented;
      result.documentedNotInSchema = documentedNotInSchema;
    }
    if (skippedValues) result.envFileFound = false;
    if (scaffoldAhead) result.note = scaffoldNote;
    if (fixOpt) result.fixed = fixed;
    console.log(JSON.stringify(result));
  } else if (scaffoldAhead) {
    console.log(`env-saaf: ${scaffoldNote}.`);
  } else {
    fixed.forEach(k => console.log(`FIXED in ${fileOpt}: ${k} (added to ${fileOpt})`));
    usedNotDocumented.forEach(k => console.log(`MISSING in ${fileOpt}: ${k} (used in code)`));
    documentedNotUsed.forEach(k => console.log(`UNUSED: ${k} (in ${fileOpt}, never used in code${schema ? ' or declared in the schema' : ''})`));
    secrets.forEach(k => console.log(`SECRET in ${fileOpt}: ${k} (value [REDACTED] looks like a real secret; use an empty value or placeholder)`));
    envExtra.forEach(k => console.log(`EXTRA in .env: ${k} (not in ${fileOpt})`));
    valuesExtra.forEach(k => console.log(`EXTRA in ${valuesOpt}: ${k} (not in ${fileOpt})`));
    envMissing.forEach(k => console.log(`MISSING in .env: ${k} (in ${fileOpt}, not set locally)`));
    invalid.forEach(e => console.log(`INVALID${valuesOpt !== null ? ` in ${valuesOpt}` : ''}: ${e}`));
    schemaNotDocumented.forEach(k => console.log(`NOT DOCUMENTED: ${k} (in schema, missing from ${fileOpt})`));
    documentedNotInSchema.forEach(k => console.log(`NOT IN SCHEMA: ${k} (in ${fileOpt}, not declared in the schema)`));
    if (!usedNotDocumented.length && !documentedNotUsed.length && !secrets.length && !envExtra.length && !envMissing.length && !invalid.length
      && !valuesExtra.length
      && !schemaNotDocumented.length && !documentedNotInSchema.length) {
      console.log(`env-saaf: all clean — code and ${fileOpt} match.`);
    }
  }
  // Issue #113: the exit code follows the same `ok` the JSON output reports, so a
  // typo'd key in .env (EXTRA / MISSING), or a documented-but-unused key, can no
  // longer print a finding and still pass a CI job. UNUSED counts as a finding.
  return ok ? 0 : 1;
}

// Issue #230: watch mode. Runs the command once, then re-runs it (debounced
// ~150ms) whenever a watched file changes. Watched inputs: the whole scanned
// tree (each subdirectory individually, since recursive fs.watch is not
// available on Linux) plus the directory of the --schema file when it lives
// outside the scanned tree. Ctrl-C exits cleanly with code 0.
function watchLoop() {
  watchActive = true;
  let running = false;
  let rerunPending = false;
  const runOnce = async () => {
    if (running) {
      rerunPending = true;
      return;
    }
    running = true;
    try {
      do {
        rerunPending = false;
        let code;
        try {
          code = cmd === 'scan' ? runScan() : await runCheck();
        } catch (e) {
          // Issue #230: error paths report their exit code and the loop survives.
          if (e instanceof WatchExit) code = e.code;
          else throw e;
        }
        console.error(`env-saaf: [${new Date().toISOString()}] ${cmd} finished, exit ${code}`);
      } while (rerunPending);
    } finally {
      running = false;
    }
  };
  const triggerRun = () => {
    runOnce().catch((err) => {
      console.error(err);
      process.exit(1);
    });
  };
  console.error(`env-saaf: watching ${dir} (${cmd}) — press Ctrl-C to stop`);
  triggerRun();

  const watchDirs = new Set();
  const collect = (d) => {
    const abs = path.resolve(d);
    if (watchDirs.has(abs)) return;
    watchDirs.add(abs);
    let entries;
    try { entries = fs.readdirSync(abs, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.isDirectory() && e.name !== 'node_modules' && !e.name.startsWith('.git')) collect(path.join(abs, e.name));
    }
  };
  collect(dir);
  if (scanFile !== null) watchDirs.add(path.dirname(scanFile));
  if (schemaOpt) {
    const schemaDir = path.dirname(path.resolve(dir, schemaOpt));
    const inside = [...watchDirs].some(w => schemaDir === w || schemaDir.startsWith(w + path.sep));
    if (!inside) collect(schemaDir);
  }

  const watchers = [];
  let scheduled = null;
  const onChange = () => {
    if (scheduled) clearTimeout(scheduled);
    scheduled = setTimeout(() => { scheduled = null; triggerRun(); }, 150);
  };
  for (const d of watchDirs) {
    try { watchers.push(fs.watch(d, onChange)); } catch { /* removed mid-watch */ }
  }
  process.on('SIGINT', () => {
    if (scheduled) clearTimeout(scheduled);
    for (const w of watchers) { try { w.close(); } catch { /* already closed */ } }
    console.error('env-saaf: stopped watching');
    process.exit(0);
  });
}

if (cmd === 'scan' || cmd === 'check') {
  if (watchOpt) {
    watchLoop(); // runs until Ctrl-C
  } else if (stdinOpt) {
    readStdin().then(
      (text) => {
        // Issue #335: piped --json uses the same library locations helper (`file: "-"`).
        if (jsonMode) {
          const { vars, locations } = scanCodeLocations(text, '-');
          process.exitCode = printScanResult(vars, locations);
        } else {
          process.exitCode = printScanResult(scanCode(text));
        }
      },
      (err) => { console.error(err); process.exitCode = 1; }
    );
  } else if (cmd === 'scan') {
    process.exit(runScan());
  } else {
    runCheck().then(
      code => process.exit(code),
      (err) => { console.error(err); process.exit(1); }
    );
  }
} else if (cmd === 'print') {
  runPrint().then(
    (code) => process.exit(code),
    (error) => { console.error(error); process.exit(1); },
  );
} else if (cmd === 'example') {
  // Issue #206: with --schema <file>, generate the example from the schema
  // (type placeholders plus alias/requiredIf annotations) instead of the code
  // scan, which cannot know them. Without --schema the scan draft is unchanged.
  if (schemaOpt) {
    loadSchemaFile().then((schema) => {
      const text = generateExample(schema);
      if (writeOpt === null) {
        process.stdout.write(text);
      } else {
        const target = path.join(dir, writeOpt);
        if (fs.existsSync(target) && !forceOpt) {
          console.error(`env-saaf: ${writeOpt} already exists in ${dir} — pass --force to overwrite it`);
          process.exit(1);
        }
        fs.writeFileSync(target, text);
        const count = Object.keys(schema).length;
        console.log(`env-saaf: wrote ${writeOpt} (${count} variable${count === 1 ? '' : 's'})`);
      }
    }, (err) => {
      console.error(err);
      process.exit(1);
    });
  } else {
  // v1.0.0: draft a .env.example from a code scan (placeholder values only)
  const used = scanDir(dir);
  const lines = ['# Generated by env-saaf from code scan — fill real values in .env'];
  used.forEach(k => lines.push(`${k}=`));
  if (writeOpt === null) {
    console.log(lines.join('\n'));
  } else {
    // Issue #116: refuse to write a header-only file. A scan that finds
    // nothing usually means a mistyped directory, and a useless file plus
    // exit 0 hides that. Plain `example` (stdout) is unchanged.
    if (used.length === 0) {
      console.error(`env-saaf: no process.env usage found in ${dir} — nothing to write; check the directory and try again`);
      process.exit(1);
    }
    const target = path.join(dir, writeOpt);
    if (fs.existsSync(target) && !forceOpt) {
      console.error(`env-saaf: ${writeOpt} already exists in ${dir} — pass --force to overwrite it`);
      process.exit(1);
    }
    fs.writeFileSync(target, lines.join('\n') + '\n');
    console.log(`env-saaf: wrote ${writeOpt} (${used.length} variable${used.length === 1 ? '' : 's'})`);
  }
  }
} else if (cmd === 'init') {
  // Issue #60: scaffold a starter schema and a matching .env.example so a new
  // project starts from a working baseline instead of a blank file. Both
  // files are checked before either is written, so a refusal never leaves a
  // half-written pair behind, and --force is required to overwrite either.
  // Issue #184: in an ES module project the default starter is env.schema.cjs
  // — a .js starter there would be treated as ESM and the require() below
  // would throw a raw stack trace. An explicit --schema name that Node would
  // treat as ESM is refused up front, before anything is written.
  let schemaName = schemaOpt || 'env.schema.js';
  if (!schemaOpt && schemaIsEsm(path.resolve(dir, schemaName))) schemaName = 'env.schema.cjs';
  const schemaPath = path.resolve(dir, schemaName);
  if (schemaOpt && schemaIsEsm(schemaPath)) {
    console.error(`env-saaf: schema ${schemaName} would be treated as an ES module in this project — use a .cjs file instead (e.g. --schema env.schema.cjs)`);
    process.exit(2);
  }
  // Issue #232: with --from-example the example file already exists and is
  // left untouched, so only the schema file participates in the refusal.
  const existing = exampleOpt
    ? [schemaName].filter(n => fs.existsSync(path.join(dir, n)))
    : [schemaName, '.env.example'].filter(n => fs.existsSync(path.join(dir, n)));
  if (existing.length && !forceOpt) {
    const verb = existing.length === 1 ? 'already exists' : 'already exist';
    const them = existing.length === 1 ? 'it' : 'them';
    console.error(`env-saaf: ${existing.join(' and ')} ${verb} in ${dir} — pass --force to overwrite ${them}`);
    process.exit(1);
  }

  // Issue #232: --from-example infers the starter from an existing example
  // file instead of the fixed template. The example is parsed with the same
  // parser `check` uses, so quotes/comments/interpolation behave identically.
  let entries = null;
  if (exampleOpt) {
    const examplePath = path.join(dir, exampleOpt);
    if (!fs.existsSync(examplePath) || !fs.statSync(examplePath).isFile()) {
      console.error(`env-saaf: ${exampleOpt} not found in ${dir} — nothing to infer a schema from`);
      process.exit(2);
    }
    entries = Object.entries(readEnvFile(examplePath));
  }

  // The example runs from the project root, even when init received a directory.
  const relativePath = path.isAbsolute(schemaName) ? schemaPath : path.relative(dir, schemaPath);
  const examplePath = path.isAbsolute(relativePath) ? relativePath : `./${relativePath}`;
  const shellPath = examplePath.split(path.sep).join('/');
  const check = 'npx env-saaf check . --schema';
  let hint = `Validate the real .env against it: ${check} ${shellPath}`;
  if (!/^[\w./:-]+$/.test(shellPath)) {
    if (process.platform === 'win32') {
      if (/^[\w./: '()-]+$/.test(shellPath)) {
        hint = `Validate the real .env against it (cmd.exe): ${check} "${shellPath}"`;
      } else {
        const displayPath = JSON.stringify(examplePath).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
        hint = `To validate the real .env from the project root, run env-saaf check with --schema set to this path (JSON): ${displayPath}`;
      }
    } else {
      let schemaArg = `'${shellPath.replace(/'/g, `'"'"'`)}'`;
      if (/[\r\n\u2028\u2029]/u.test(shellPath)) {
        // Bash/zsh escapes keep literal line breaks inside the generated JS comment.
        const escapes = { '\r': '\\r', '\n': '\\n', '\u2028': '\\342\\200\\250', '\u2029': '\\342\\200\\251' };
        schemaArg = `$'${shellPath.replace(/[\\']/g, '\\$&').replace(/[\r\n\u2028\u2029]/gu, ch => escapes[ch])}'`;
      }
      hint = `Validate the real .env against it (Bash/zsh): ${check} ${schemaArg}`;
    }
  }
  // Issue #171: scan the directory first (the same scan `check`/`example` use)
  // and fold keys the code already reads into the scaffold, so the generated
  // .env.example covers them and the first `check` after `init` reports no
  // MISSING lines to merge by hand. Keys the fixed scaffold already declares
  // are not duplicated; a directory with no code yet scans to nothing and the
  // scaffold is exactly as before.
  const discovered = exampleOpt
    ? scanDir(dir) // schemaFromExample drops the ones the example already lists
    : scanDir(dir).filter(k => !starterKeys.includes(k));
  if (exampleOpt) {
    fs.writeFileSync(schemaPath, schemaFromExample(hint, exampleOpt, entries, discovered, groupsOpt));
  } else {
    fs.writeFileSync(schemaPath, starterSchema(hint, discovered));
  }
  // Load the file just written and generate the example from it: the scaffold
  // goes through the same require a user's schema would take, so a broken
  // starter fails loudly here instead of shipping. The cache entry is dropped
  // so a --force re-run in the same process reads the new content.
  delete require.cache[require.resolve(schemaPath)];
  const starter = require(schemaPath);
  const keys = Object.keys(starter).length;
  if (exampleOpt) {
    // The example file already exists — it is the input, not an output, so it
    // is never written (or overwritten) here.
    console.log(`env-saaf: wrote ${schemaName} inferred from ${exampleOpt} (${keys} variable${keys === 1 ? '' : 's'}) — ${exampleOpt} left untouched`);
  } else {
    fs.writeFileSync(path.join(dir, '.env.example'), generateExample(starter));
    console.log(`env-saaf: wrote ${schemaName} and .env.example (${keys} variable${keys === 1 ? '' : 's'})`);
  }
  if (discovered.length) {
    const folded = exampleOpt ? discovered.filter(k => !entries.some(([ek]) => ek === k)) : discovered;
    if (folded.length) {
      console.log(`env-saaf: folded in ${folded.length} key${folded.length === 1 ? '' : 's'} found by scanning the code: ${folded.join(', ')}`);
    }
  }
} else {
  console.log(USAGE);
  process.exit(cmd ? 2 : 0);
}
