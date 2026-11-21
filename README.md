# env-saaf

Zero-dependency environment variable validator for Node.js. Fail fast at startup with clear errors, and get **typed** values back.

[![npm version](https://img.shields.io/npm/v/env-saaf.svg)](https://www.npmjs.com/package/env-saaf) [![npm downloads](https://img.shields.io/npm/dm/env-saaf.svg)](https://www.npmjs.com/package/env-saaf) [![GitHub stars](https://img.shields.io/github/stars/abhi478jeetur-rgb/env-saaf.svg)](https://github.com/abhi478jeetur-rgb/env-saaf/stargazers) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://github.com/abhi478jeetur-rgb/env-saaf/blob/main/LICENSE)

## The problem

Research into real developer pain points shows the same `.env` bugs again and again:

- Every `process.env` value is a **string**: `DEBUG=false` is truthy, and `"3000" + 1` becomes `"30001"`.
- A missing variable does not fail at startup — it fails **in production**, on the first request that needs it.
- `.env.example` only says what *should* exist, not what your code *actually uses* — the two drift apart silently.
- Checking variables one by one is tedious, and the first error hides all the others.

Existing fixes (zod, envalid) are powerful but heavy for small projects. `env-saaf` (`saaf` = साफ़, clean/clear) does the essential job with **zero dependencies**.

## Install

```bash
npm install env-saaf
```

## Use

```js
const { validateEnv } = require('env-saaf');

const env = validateEnv({
  PORT:      { type: 'port', required: true },
  DEBUG:     { type: 'boolean', default: false },
  API_URL:   { type: 'url', required: true },
  LOG_LEVEL: { type: 'string', choices: ['info', 'warn', 'error'], default: 'info' },
});

// env.PORT is a number, env.DEBUG is a real boolean
// Missing/invalid vars throw ONE error listing ALL problems
```

### Types reference

Environment inputs are strings. Output below is before an optional `transform`.

| Type | Accepted input | JavaScript output | Additional rule options |
| --- | --- | --- | --- |
| `string` | Any non-missing text (default type) | `string` | `trim`, `minLength`, `maxLength`, `pattern` |
| `number` | Non-empty text accepted by `Number()`, including fractions and exponent notation. Rejects `NaN` and non-finite values. | `number` | `trim`, `min`, `max` |
| `int` | Numeric text resolving to an integer, e.g. `42`, `1e3` | `number` | `trim`, `min`, `max` |
| `boolean` | Case-insensitive `true/false`, `1/0`, `yes/no`, `on/off`, `y/n` | `boolean` | None |
| `url` | Absolute URL accepted by `new URL()`, without normalization | `string` | `trim`, `minLength`, `maxLength`, `pattern`, `protocols` |
| `file` | Path to an existing, readable regular file. Relative paths use the process working directory. | `string` | `trim`, `minLength`, `maxLength`, `pattern` |
| `port` | Numeric text resolving to an integer from 0 to 65535 | `number` | `min`, `max` |
| `email` | One `@`, non-empty local part, domain with an interior dot, no leading or trailing domain dot, no whitespace | `string` | `trim`, `minLength`, `maxLength`, `pattern` |
| `json` | Valid JSON text (object, array or primitive). Accepts already-parsed defaults. | Parsed JSON value | `trim`. For numeric results, `min` and `max`. For string results, `minLength`, `maxLength` and `pattern`. |
| `uuid` | Canonical 8-4-4-4-12 hexadecimal groups, either case | `string` | `trim`, `minLength`, `maxLength`, `pattern` |
| `hex` | One or more hexadecimal characters, no `0x` prefix | `string` | `trim`, `length`, `minLength`, `maxLength`, `pattern` |
| `ipv4` | Four decimal octets, each 0 to 255; no leading zeroes | `string` | `trim`, `minLength`, `maxLength`, `pattern` |
| `semver` | `MAJOR.MINOR.PATCH`, optional prerelease and build suffixes. Excludes `v` prefixes and leading numeric zeroes. | `string` | `trim`, `minLength`, `maxLength`, `pattern` |
| `base64` | Standard alphabet, length multiple of four, padding where needed. Excludes base64url. | `string` | `trim`, `minLength`, `maxLength`, `pattern` |
| `date` | Valid `YYYY-MM-DD` or datetime with `T` and hours/minutes; optional seconds, fraction and `Z` or numeric offset. Accepts valid `Date` defaults. | `Date` | `trim` |
| `duration` | Human duration: `500ms`, `30s`, `15m`, `2h`, `1d`, `1w`; a bare number is milliseconds | `number` (milliseconds) | `trim`, `min`, `max` |
| `host` | Hostname (`db.internal`, `localhost`) or IPv4/IPv6 address; no scheme, path or port | `string` | `trim`, `minLength`, `maxLength`, `pattern` |

All types support `required`, `default` and `transform`. Transforms run on provided values after validation. Missing optional keys are omitted and defaults are validated. The `choices` option matches coerced strings, numbers or booleans. A parsed JSON value can match a choice when it has one of those three types. String input is trimmed by default. Setting `trim: false` leaves whitespace in place for string-like types. For `number` and `int`, whitespace around a numeric value is accepted either way, but whitespace-only text is rejected by default and converts to `0` with `trim: false`. Boolean matching always ignores surrounding whitespace. The `length` option applies only to `hex`. See the sections below for examples.
### Non-throwing mode — collect errors instead of throwing

A health check, a CLI, or a server that wants to boot in a degraded mode cannot use an API that throws on the first bad value. Pass `{ throwOnError: false }` and `validateEnv` returns `{ env, errors }` instead: `env` holds every value that validated, and `errors` is the same list `EnvSaafError` would have carried.

```js
const { validateEnv } = require('env-saaf');

const { env, errors } = validateEnv(
  {
    PORT:  { type: 'port', required: true },
    DEBUG: { type: 'boolean', default: false },
  },
  process.env,
  { throwOnError: false }
);

if (errors.length) {
  console.warn('config problems:', errors);
  // keep booting: env.DEBUG is still usable, env.PORT is absent
}
```

The default is unchanged: without the option, or with `{ throwOnError: true }`, an invalid value still throws one `EnvSaafError` listing every problem. A malformed schema still throws as well — that is a bug in the code, not in the environment. `loadEnv` keeps throwing too, because with `{ assign: true }` it writes into `process.env` and a half-applied write is worse than a failed start; call `validateEnv` when you want the error list.

In TypeScript the option narrows the return type to `ValidateResult<S>` (`{ env: EnvResult<S>; errors: string[] }`), so `env.PORT` keeps the type inferred from the schema.

### Strict mode — catch typos in variable names

By default `validateEnv` only looks at keys in the schema. With `{ strict: true }` it also flags variables that are set but not in the schema — so a typo like `DATABSE_URL` next to the real `DATABASE_URL` no longer slips through:

```js
const env = validateEnv(schema, process.env, { strict: true });
// throws EnvSaafError listing e.g. "DATABSE_URL: set but not in schema (strict mode)"
```

Default stays off — many apps share one environment with other tools.

### Per-key `transform` — one custom step after coercion

Some values need one small custom step after type coercion that env-saaf cannot guess — splitting a comma-separated list, normalising case:

```js
const { validateEnv } = require('env-saaf');

const env = validateEnv({
  ALLOWED_ORIGINS: { type: 'string', transform: v => v.split(',').map(s => s.trim()) },
  SHOUTY_NAME:     { type: 'string', transform: v => v.toUpperCase() },
});
// env.ALLOWED_ORIGINS is an array, env.SHOUTY_NAME is upper-cased
```

The transform runs after coercion and after the `choices` check; if it throws, the error is collected like any other validation error (with the key named). It runs only on values actually provided — not on `default` values (defaults are still coerced and validated like any value, so a bad default fails with an error naming the key). In TypeScript the result type for that key is inferred from the transform's return type.

### `email` type and `pattern` — validate formats

```js
const env = validateEnv({
  ADMIN_EMAIL: { type: 'email', required: true },
  SLUG:        { type: 'string', pattern: /^[a-z0-9-]+$/ },
  API_KEY:     { type: 'string', pattern: /^sk_[A-Za-z0-9]+$/ },
});
```

The `email` check is pragmatic — one `@`, a non-empty local part and domain, and a dot in the domain — not full RFC 5322. `pattern` takes a `RegExp` that a string value must match; it runs after coercion and the `choices` check, and a mismatch error names the pattern that failed.

### `int` type and `min`/`max` — whole numbers and ranges

```js
const env = validateEnv({
  MAX_RETRIES: { type: 'int', min: 0, max: 5, default: 3 },
  TIMEOUT_MS:  { type: 'number', min: 100, max: 30000 },
});
```

`int` is like `number` but rejects fractional values (`3.5` fails, `42` and `1e3` pass). `min` and `max` work on `number`, `int` and `port`; either one can be used alone, and an out-of-range value is rejected with an error naming the allowed range.

### `json` type and `minLength`/`maxLength` — structured values and string lengths

```js
const env = validateEnv({
  FEATURE_FLAGS: { type: 'json', default: { beta: false } },
  API_TOKEN:     { type: 'string', minLength: 10, maxLength: 64, required: true },
});
```

`json` parses the value with `JSON.parse` — objects, arrays and primitives all come back parsed; invalid JSON is rejected with an error naming the key. A `default` may be given as an already-parsed object. `minLength` and `maxLength` work on string values (`string`, `email`, `url`, `uuid`, `hex`, `ipv4`, `semver`, `base64`); either one can be used alone, and a too-short or too-long value is rejected with an error naming the allowed length. They combine with `pattern` — length is checked first, then the pattern.

### `uuid` and `hex` types — IDs and hex strings

```js
const env = validateEnv({
  TENANT_ID: { type: 'uuid', required: true },
  API_HASH:  { type: 'hex', length: 64 },
});
```

`uuid` accepts a canonical UUID (`8-4-4-4-12` hex groups, upper- and lowercase) and returns it unchanged; a malformed value is rejected with an error naming the key. `hex` accepts hexadecimal strings only (`deadBEEF42` passes, `0x1234` does not); the optional `length` option pins the exact size in characters, for fixed-size tokens and hashes.

### `ipv4`, `semver` and `base64` types — network addresses, versions and encoded values

```js
const env = validateEnv({
  BIND_ADDR: { type: 'ipv4', required: true },
  APP_VERSION: { type: 'semver', required: true },
  WEBHOOK_SECRET: { type: 'base64', required: true },
});
```

`ipv4` accepts a dotted-quad address (`192.168.0.1` passes, `256.1.1.1` and `1.2.3` do not); an octet with a leading zero (`01.2.3.4`) is rejected because it is ambiguous. `semver` accepts `MAJOR.MINOR.PATCH` with optional pre-release and build suffixes (`1.2.3-beta.1` passes, `1.2` and `v1.2.3` do not — the leading `v` is rejected). `base64` accepts standard base64 only (`A-Za-z0-9+/` with `=` padding, length a multiple of 4); base64url (`-` and `_`) is not accepted. All three return the value unchanged, and `minLength`/`maxLength` work on them like on any other string type.

### `date` type — ISO 8601 dates as `Date` objects

```js
const env = validateEnv({
  LAUNCH_DATE: { type: 'date', required: true },
  CUTOFF:      { type: 'date' },
}, process.env);

if (env.LAUNCH_DATE < new Date()) console.log('Launched!');
```

`date` parses an ISO 8601 date (`2026-01-31`) or datetime (`2026-01-31T10:00:00Z`, with optional seconds, fractional seconds and a `Z` or `±HH:MM` offset) and returns a JavaScript `Date`, so cut-off dates, launch dates and expiry dates need no hand-rolled parsing. Impossible dates are rejected with an error naming the key — `2026-02-31` fails instead of silently rolling over to March, and so do malformed values such as `31-01-2026` or `2026/01/31`. A `Date` given as a `default` passes through unchanged, and `generateExample` suggests `2026-01-31` for the type.

### `duration` type — human timeouts as milliseconds

```js
const env = validateEnv({
  CACHE_TTL: { type: 'duration', required: true },
  TIMEOUT:   { type: 'duration', default: '30s' },
}, process.env);

setTimeout(refresh, env.CACHE_TTL); // 900000 for '15m'
```

`duration` parses a human duration (`500ms`, `30s`, `15m`, `2h`, `1d`, `1w`) into a number of milliseconds; a bare number is already milliseconds, so `'250'` and `250` both mean 250 ms. Units are case-insensitive and decimals are allowed (`1.5h` is 5,400,000 ms); `w` is a week of 7 days, so `1w` is 604,800,000 ms. Unknown units (`15min`, `15sec`), negatives and malformed values are rejected with an error naming the key. A number given as a `default` is taken as milliseconds, and `min`/`max` work on the millisecond result like on any other number. `generateExample` suggests `15m` for the type.

### `host` type — a hostname or IP address, no scheme or port

```js
const env = validateEnv({
  DB_HOST: { type: 'host', required: true },
  BIND_ADDR: { type: 'host', default: 'localhost' },
}, process.env);
```

`host` accepts a hostname (`db.internal`, `localhost`) or an IPv4/IPv6 address (`10.0.0.5`, `::1`) and returns it unchanged. A value with a scheme (`https://db.internal`), a path (`db/x`) or a port (`example.com:8080`) is rejected with an error naming the key — those belong to the `url` type or to a separate port variable. `minLength`/`maxLength` and `pattern` work on it like on any other string type, and `generateExample` suggests `localhost` for the type.

### `url` type and `protocols` — allowlist schemes

```js
const env = validateEnv({
  WEBHOOK_URL: { type: 'url', protocols: ['https'], required: true },
});
```

`url` validates with `new URL()` and returns the value exactly as given (no normalization — a bare origin gains no trailing slash). `protocols` allowlists the schemes a value may use (`['https']` rejects `ftp://...` and `javascript:...` with an error naming the allowed schemes); matching is case-insensitive, and entries may be written with or without a trailing colon (`'https'` and `'https:'` mean the same). Without the option, any valid URL passes, as before.

### `trim: false` — keep whitespace when it matters

Values are trimmed before validation by default — handy for secrets pasted from dashboards with stray spaces. When the whitespace *is* the value, switch trimming off for that key:

```js
const env = validateEnv({
  TOKEN: { type: 'string', trim: false, required: true },
});
// TOKEN: '  secret  ' stays '  secret  '
```

`trim: false` only affects string-like types; numbers and booleans are unaffected (`' 42 '` still parses as `42`, `' true '` still parses as `true`).

### Loading a real `.env` file

One call does it — read the file, parse it, validate it:

```js
const { loadEnv } = require('env-saaf');

const env = loadEnv({
  PORT:    { type: 'port', required: true },
  API_URL: { type: 'url', required: true },
}); // reads `.env` by default
```

Options: `{ path: '.env.local' }` to read another file, `{ override: true }` to let the file win over `process.env` (by default existing `process.env` values win), `{ assign: true }` to write the validated values back into `process.env` as strings. An explicitly passed `path` that does not exist throws an error naming the path — a typo'd file must not boot silently. Without a `path` option the implicit default `.env` may be absent (every variable then needs a default or optional), and missing entries of a file list (`paths: [...]` or `path` as an array) are skipped; a list throws only when no file at all is found and a required variable is missing. By default `process.env` is never mutated.

Several files can be layered — later files override earlier ones:

```js
const env = loadEnv(schema, { paths: ['.env', '.env.local'] });
// or: { path: ['.env', '.env.local'] }
```

Values may reference other values with `${VAR}` — handy for building URLs from parts. References resolve from the same file first, then `process.env`; single-quoted values and `\${VAR}` escapes stay literal:

```env
HOST=example.com
API_URL=https://${HOST}/api
```

Use `${VAR:-fallback}` to supply a fallback when a value is unset or expands to an empty string. Use `${VAR-fallback}` to supply it only when the name is unset. For example, `API_URL=https://${HOST:-localhost}/api` uses `localhost` when `HOST` has no value. Defaults can include references such as `${HOST:-${DEFAULT_HOST}}`.

Quoted values may also span several lines (PEM keys, JSON blobs) — parsing continues until the closing quote. A backslash-escaped quote (`\'` inside single quotes, `\"` inside double quotes) stays part of the value, so `B='it\'s'` is `it's`; other backslashes, such as a Windows path, are kept as-is.

A bare line without `=` raises a syntax error with its line number. Use `KEY=` for an empty value.

The manual way still works too — parse the file and pass it in:

```js
const fs = require('node:fs');
const { parseEnvFile, validateEnv } = require('env-saaf');

const fileEnv = parseEnvFile(fs.readFileSync('.env', 'utf8'));
const env = validateEnv({
  PORT:    { type: 'port', required: true },
  API_URL: { type: 'url', required: true },
}, fileEnv);
```

ES modules work too:

```js
import { validateEnv } from 'env-saaf';
```

### TypeScript: the return type is inferred from the schema

The return type of `validateEnv` is inferred from the schema — a key with `type: 'port'` becomes `number`, a `boolean` key becomes `boolean`, and a key without `required` or `default` is `| undefined`:

```ts
import { validateEnv } from 'env-saaf';

const env = validateEnv({
  PORT:  { type: 'port', required: true },
  DEBUG: { type: 'boolean' },
});

env.PORT.toFixed(0); // OK — PORT: number
env.DEBUG;           // boolean | undefined
env.TYPO;            // TypeScript error — not in the schema
```

Pass the schema inline to `validateEnv(...)` (or use `as const`) so TypeScript can see the literal types. The `EnvResult<S>` and `EnvValue<R>` types are also exported separately.

### Bun and Deno

`env-saaf` is plain CommonJS with zero dependencies and only uses Node's `node:fs`, `node:net`, and `node:path` built-ins, so it runs in Bun and Deno as well as Node.js.

#### Bun

Install with `bun add` and load `env-saaf` with `require` (Bun runs CommonJS npm packages natively) or ES module `import`:

```bash
bun add env-saaf
```

```js
// config.js — `import { EnvSaafError, validateEnv } from 'env-saaf'` works too
const { EnvSaafError, validateEnv } = require('env-saaf');

try {
  const env = validateEnv({
    PORT:      { type: 'port', required: true },
    DEBUG:     { type: 'boolean', default: false },
    API_URL:   { type: 'url', required: true },
    LOG_LEVEL: { type: 'string', choices: ['info', 'warn', 'error'], default: 'info' },
  });
  console.log(`Ready on port ${env.PORT} (${typeof env.PORT}), debug=${env.DEBUG} (${typeof env.DEBUG}), api=${env.API_URL}`);
} catch (err) {
  if (!(err instanceof EnvSaafError)) throw err;
  console.error(err.message);
  process.exit(1);
}
```

Run with valid variables:

```bash
PORT=3000 DEBUG=true API_URL=https://api.example.com bun run config.js
# Ready on port 3000 (number), debug=true (boolean), api=https://api.example.com
```

Run with missing or invalid variables to fail fast with every problem listed together (exit code `1`):

```bash
PORT=not-a-port DEBUG=maybe bun run config.js
# Invalid environment variables:
#   - PORT: expected a port (0-65535), got "not-a-port"
#   - DEBUG: expected a boolean (true/false, yes/no, on/off, 1/0, y/n), got "maybe"
#   - API_URL: missing required variable
```

Bun automatically loads a local `.env` file into `process.env`, so `validateEnv` picks it up without extra setup. Use `loadEnv(schema, { path: '.env.local' })` (or `{ paths: ['.env', '.env.local'] }`) when you want to read a specific file or layer multiple files explicitly.

#### Deno

Import directly via Deno's `npm:` specifier — no install step needed:

```ts
// config.ts
import { EnvSaafError, validateEnv } from 'npm:env-saaf';

try {
  const env = validateEnv({
    PORT:      { type: 'port', required: true },
    DEBUG:     { type: 'boolean', default: false },
    API_URL:   { type: 'url', required: true },
    LOG_LEVEL: { type: 'string', choices: ['info', 'warn', 'error'], default: 'info' },
  });
  console.log(`Ready on port ${env.PORT} (${typeof env.PORT}), debug=${env.DEBUG} (${typeof env.DEBUG}), api=${env.API_URL}`);
} catch (err) {
  if (!(err instanceof EnvSaafError)) throw err;
  console.error(err.message);
  Deno.exit(1);
}
```

Run with `--allow-env` so `validateEnv` can read `process.env`:

```bash
PORT=3000 DEBUG=true API_URL=https://api.example.com deno run --allow-env config.ts
# Ready on port 3000 (number), debug=true (boolean), api=https://api.example.com
```

With missing or invalid variables, `validateEnv` prints the same combined `EnvSaafError` list and exits with code `1`.

Permissions needed in Deno:
- `validateEnv(schema)` reads `process.env` and requires `--allow-env`. You can restrict it to the keys in your schema (for example `--allow-env=PORT,DEBUG,API_URL,LOG_LEVEL`), except with `{ strict: true }`, which enumerates all environment keys and requires unscoped `--allow-env`.
- `loadEnv(schema)` reads `.env` files via `node:fs` (`fs.readFileSync`) and merges them with `process.env`, so it needs both `--allow-env` and `--allow-read` (for example `deno run --allow-env --allow-read=.env config.ts`).
- Schemas that use `type: 'file'` check the path with `node:fs` (`fs.statSync` and `fs.openSync`), so they also require `--allow-read` for those paths.

## Recipes

These short patterns use only `validateEnv` options available in the current API.

### Database URL and connection-pool size

```js
const { validateEnv } = require('env-saaf');

const env = validateEnv({
  DATABASE_URL: { type: 'url', required: true },
  DB_POOL_SIZE: { type: 'number', default: 10 },
});
// env.DATABASE_URL is present; env.DB_POOL_SIZE is a number.
```

`url` validates URL syntax, while `number` converts the pool size from its environment string.

### Feature flags

```js
const { validateEnv } = require('env-saaf');

const env = validateEnv({
  ENABLE_EXPORTS: { type: 'boolean', default: false },
  ENABLE_PREVIEW: { type: 'boolean', default: false },
});

if (env.ENABLE_EXPORTS) console.log('Exports are enabled');
```

The boolean type accepts `true`/`false`, `yes`/`no`, `on`/`off`, and `1`/`0` (also `y`/`n`),
case-insensitively.

### Optional analytics key

```js
const { validateEnv } = require('env-saaf');

const env = validateEnv({
  ANALYTICS_WRITE_KEY: { type: 'string' },
});

if (env.ANALYTICS_WRITE_KEY !== undefined) {
  console.log('Analytics is configured'); // Use the key with your analytics client; do not log it.
}
```

Without `required` or `default`, a missing key is omitted from the result and has the TypeScript
type `string | undefined`.

### Different development and production requirements

```js
const { validateEnv } = require('env-saaf');

const mode = validateEnv({
  NODE_ENV: {
    type: 'string',
    choices: ['development', 'test', 'production'],
    default: 'development',
  },
}).NODE_ENV;

const env = validateEnv({
  DATABASE_URL:
    mode === 'production'
      ? { type: 'url', required: true }
      : { type: 'url', default: 'http://localhost:5432/app' },
});
```

Validate the mode first, then choose an ordinary schema in application code. `validateEnv` does not
provide conditional rules inside a schema.

### Keep `.env.example` honest (CLI)

CLI output is plain text by default, including in pipes and CI. For scripts that set a shared color preference, pass `--no-color` before or after the command, or set `NO_COLOR=1`.

```bash
npx env-saaf --version      # print the installed version
npx env-saaf scan ./src     # every env var your code actually uses
npx env-saaf check .        # code vs .env.example diff — exit 1 on any finding (CI-ready)
npx env-saaf check . --file .env.sample  # compare against a differently-named template file instead
npx env-saaf check . --json # machine-readable JSON output (ok/missing/extra) for CI or tooling
npx env-saaf check . --schema ./env.schema.js  # also validate the values in .env against a schema — exit 1 on a type error
npx env-saaf scan ./src --json  # JSON list of used vars
npx env-saaf example ./src  # draft a .env.example from a code scan
npx env-saaf example ./src --write  # save the draft to .env.example (refuses, exit 1, when the scan finds no variables)
npx env-saaf init .  # scaffold a starter env.schema.js (commented type examples) + a matching .env.example (refuses to overwrite without --force)
```

Starting a new project? `env-saaf init` writes a starter `env.schema.js` with commented examples of the main types (`string`, `int`, `boolean`, `port`, `url`, `email`, `duration`, `host`) and generates a matching `.env.example` from it, so the first `check` already has something to compare against. Either file being present is a refusal (exit 1, naming the files) unless `--force` is passed; `--schema <file>` names the schema file instead of `env.schema.js`.

When `.env.example` (or the file given with `--file`) sits in the scanned directory, `scan` also warns about keys declared there that no code reads, one per line on stderr: `UNUSED: OLD_KEY (in .env.example, never used in code)`. With `--json` they are listed in an `unused` array next to `vars`. It is only a warning: stdout still holds just the used variables, and `scan` still exits 0 (use `check` to fail a CI job on drift). Without a template file, nothing changes.

A scan reads code, not comments or the text inside string and template literals: a variable named only in a comment (`// set process.env.FOO first`), a string (`'see process.env.BAR'`) or a template's text isn't reported, so it can't quietly satisfy `check` or land in an `example` draft. A read inside a template's `${...}` is still a read, and so are `process.env['X']`, ``process.env[`X`]`` and destructuring.

When a real `.env` sits next to the template, `check` also compares their keys: a key in `.env` that is not documented (`EXTRA in .env: FOO (not in .env.example)`) is usually a typo, and a template key with no local value is reported as `MISSING in .env: BAR (in .env.example, not set locally)`. `--file` selects the template for both comparisons; with no `.env` file this extra check is skipped. In `--json` mode the findings appear as `envExtra` and `envMissing` alongside the existing `missing`, `extra` and `invalid` fields.

`check` exits 1 whenever it prints any finding, and `--json` `ok` carries the same value, so a CI job fails exactly when the output reports a problem; a fully clean project exits 0. `UNUSED` counts as a finding too: a key left in the template after its code usage is gone fails the run, so remove it from the template when you remove the last usage.

`--schema` is opt-in: without it, `check` only compares key presence. With it, `check` loads the schema file (`module.exports = { PORT: { type: 'port', required: true } }`, resolved relative to the checked directory) and runs the same `validateEnv` the library uses over the values of the real `.env` file. A type error is reported as `INVALID: PORT: expected a port (0-65535), got "not-a-port"` and fails the check (exit 1); in `--json` mode the failures appear in the `invalid` field. An explicit `--file` names the file to validate instead; with no `.env` file and no explicit `--file`, the schema step is skipped — the template's placeholders are not real values. A schema file that cannot be loaded (or does not export a schema object) is a usage error: a clear message and exit 2.

### Run `check` in GitHub Actions

A minimal workflow that fails a pull request when the code and `.env.example` drift apart. Copy it to `.github/workflows/env-check.yml`:

```yaml
name: env-check

on: [push, pull_request]

jobs:
  env-check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      # Optional: build a .env from Actions secrets so `check` can also compare its keys
      # with the template. Leave this step out to check only code against .env.example.
      - name: Write .env from secrets
        env:
          DATABASE_URL: ${{ secrets.DATABASE_URL }}
          API_KEY: ${{ secrets.API_KEY }}
        run: printf 'DATABASE_URL=%s\nAPI_KEY=%s\n' "$DATABASE_URL" "$API_KEY" > .env
      - run: npx env-saaf check .
```

Real secrets come from the repository's Actions secrets (Settings, Secrets and variables, Actions), never from the repo: commit only `.env.example` and keep `.env` in `.gitignore`. The `.env` above exists only inside the job's temporary checkout. `check` compares key names only and never prints values, so a secret does not end up in the log. Without a `.env` the job still compares code and `.env.example`; with one it also reports `EXTRA in .env` / `MISSING in .env` keys (available since 1.4.0; with 1.3.0 `check` compares code and `.env.example` only). Any finding exits 1 and fails the job.

Two limits of the optional `.env` step: a key is only *missing* when it is absent, so a secret that is not set still writes `API_KEY=` with an empty value and passes the key check (`check` is not a value check; use `validateEnv` at startup for that). And `printf` writes each secret verbatim, so keep every secret on a single line; a multi-line secret would be read as extra `NAME=value` entries.

### Generate `.env.example` from a schema

The schema already knows every key — generate the example file from it instead of writing it by hand:

```js
const { generateExample } = require('env-saaf');
const fs = require('node:fs');
fs.writeFileSync('.env.example', generateExample({
  PORT:    { type: 'port', required: true },
  API_KEY: { type: 'string', required: true },
}));
```

```env
# Generated by env-saaf — put real values in .env (never commit .env)
# type: port, required
PORT=3000
# type: string, required
API_KEY=
```

Keys that look like secrets (`API_KEY`, `DB_PASSWORD`, …) get an empty placeholder — nothing safe to suggest for them. Other keys get a type-based placeholder, and an explicit `default` is used as-is.

### Log config without leaking secrets

```js
const { maskSecrets } = require('env-saaf');
console.log(maskSecrets(process.env)); // values masked: sk***56
```

An empty value stays empty — `maskValue('')` returns `''`, so an unset secret no longer looks set in logs.

## Versions

- **v0.1.0** — core `validateEnv`: types (string/number/boolean/url/port), required, defaults, choices, all-errors-at-once.
- **v0.2.0** — `.env` file parsing, code scanning (used vs documented diff), CLI (`check` / `scan`).
- **v1.0.0** — secret masking, `.env.example` generation from schema and from code scan, TypeScript definitions, stable API.
- **v1.1.0** — CLI `--help` exits 0, boolean `on`/`off`/`y`/`n`, `scanCode` finds `let`/`var` destructuring, inline comments stripped in `parseEnvFile`, `.mts`/`.cts` files scanned.
- **v1.2.0** — `email` type and `pattern` option, CLI `--json` output, per-key `transform`, `${VAR}` interpolation, multi-file `loadEnv`, multiline quoted values, CLI `--no-color`, `int` type with `min`/`max`, README recipes.
- **v1.5.0** — `duration` and `host` types, `date` and `file` types, non-throwing mode, `${VAR:-default}` interpolation, CLI `--schema` validation, duplicate-key and bare-line errors in `.env` files, `scan`/`check`/`example` directory validation, Express example, README types reference table.
- **v1.4.0** — `ipv4`, `semver` and `base64` types, CLI `check` compares real `.env` keys, CLI `--version`, `example --write`, `scan` UNUSED warnings, `check` exits 1 on every finding, `scanCode` ignores comments/strings, defaults validated like provided values, `--help` after a subcommand, escaped quotes in `parseEnvFile`, `port` accepts 0, GitHub Actions workflow docs.
- **v1.3.0** — `json`, `uuid` and `hex` types, `minLength`/`maxLength` and `hex` `length` options, `trim: false`, `loadEnv` return-type inference, safer `.env.example` generation for secret keys, `assign: true` JSON fix.

## Contributing

Issues and pull requests are welcome — including tiny ones. Start with the issues labelled [`good first issue`](https://github.com/abhi478jeetur-rgb/env-saaf/labels/good%20first%20issue), and please read [CONTRIBUTING.md](CONTRIBUTING.md) first: it explains the zero-dependency rule and how to run the tests.

## Contributors

env-saaf exists thanks to everyone who has contributed code, fixes and ideas. **16 people** outside the maintainer have landed merged pull requests so far:

- [@abdul-karim-mia](https://github.com/abdul-karim-mia) — the first outside contributor
- `@HarshRajSinghania` — CLI `--json` output
- [@Golden007-prog](https://github.com/Golden007-prog)
- [@harshit3355](https://github.com/harshit3355)
- [@bfs2021](https://github.com/bfs2021)
- [@enidchen0125](https://github.com/enidchen0125)
- [@theroimasters1-dev](https://github.com/theroimasters1-dev)
- [@kamrullab](https://github.com/kamrullab)
- [@Veeramanikandanr48](https://github.com/Veeramanikandanr48)
- [@rise11hx-cmyk](https://github.com/rise11hx-cmyk)
- `@P1LOTRX` — defaults validated like provided values
- [@emreocell](https://github.com/emreocell)
- [@IG-ABHINAV](https://github.com/IG-ABHINAV)
- [@flipcyde101](https://github.com/flipcyde101)
- [@swpswpswp](https://github.com/swpswpswp)
- [@tnalbant](https://github.com/tnalbant)

This wall grows on its own as new pull requests land:

<a href="https://github.com/abhi478jeetur-rgb/env-saaf/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=abhi478jeetur-rgb/env-saaf" alt="env-saaf contributors" />
</a>

New guides live in the [project wiki](https://github.com/abhi478jeetur-rgb/env-saaf/wiki) — start with the CLI guide and the types reference there.

## License

MIT © Abhijeet Kumar
