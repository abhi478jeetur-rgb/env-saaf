# env-saaf

Zero-dependency environment variable validator for Node.js. Fail fast at startup with clear errors, and get **typed** values back.

[![npm version](https://img.shields.io/npm/v/env-saaf.svg)](https://www.npmjs.com/package/env-saaf) [![npm downloads](https://img.shields.io/npm/dm/env-saaf.svg)](https://www.npmjs.com/package/env-saaf) [![GitHub stars](https://img.shields.io/github/stars/abhi478jeetur-rgb/env-saaf.svg)](https://github.com/abhi478jeetur-rgb/env-saaf/stargazers) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://github.com/abhi478jeetur-rgb/env-saaf/blob/main/LICENSE)

**Read in other languages:** [Español](README.es.md) · [Português](README.pt-BR.md) · [हिंदी](README.hi.md) · [简体中文](README.zh-CN.md)

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

`validateEnv` treats an empty string (`''`) the same as an unset variable: an optional key with no `default` is omitted from the result, a `required` key fails as missing (`missing required variable`), and a key with a `default` uses that default instead. Whitespace-only input such as `'   '` is also treated as unset by default. Setting `trim: false` preserves it as provided. This is similar to `${VAR:-fallback}` in [Loading a real `.env` file](#loading-a-real-env-file), but that shell-style expansion treats empty values as unset and does not treat whitespace-only values as unset.

### How validation works

`loadEnv` parses the file and expands `${VAR}` parameter forms (`:-`, `-`, `:?`, `?`, `:+`, `+`) first; after that, both `validateEnv` and `loadEnv` run the same pipeline, so the order below is the whole contract:

1. **Options and schema** are checked before any value: an unknown option or a malformed rule throws even when the variable is absent.
2. **Groups are flattened** to full names (`DB_HOST`), so every later step works on the name that appears in the environment and errors name it.
3. **`strict`** reports keys that are set but not declared (or known as an alias) in the schema.
4. For each key, in schema order:
   1. **`null` counts as unset**, like `undefined`.
   2. **Aliases** resolve: a set canonical key wins (populated aliases are reported as ignored), otherwise the first populated alias supplies the value with a deprecation warning. Empty strings count as unset.
   3. An **object or array** in a hand-built env fails here, except for `json` rules and arrays on `array` rules.
   4. A **`default`** applies when the key is absent or empty; the default then goes through every step below. `required` and `requiredIf` are deferred if there is still nothing.
   5. **Coercion** turns the string into its type (`port` to a number, `boolean` from `true`/`1`/`on`, and so on).
   6. **Bounds and shape**: `min`/`max`, `minItems`/`maxItems`, `unique`, `minLength`/`maxLength`, the `hex` `length`.
   7. **`choices`** (per item for array rules), then **`pattern`**.
   8. **`validate(value, env)`** receives the coerced value.
   9. **`transform(value)`** runs only for a supplied value, never a default; its result is re-checked against the declared `type`.
5. **`conflictsWith` and `requiredIf`** run in a second pass over all keys, after every value has been coerced and defaulted, so declaration order never matters.
6. The result is **re-nested** for groups and **frozen**.
7. **`options.rules`** (when given) runs if all earlier steps produced no errors, receiving that complete frozen result and appending any returned error strings before `validateEnv` / `loadEnv` returns or throws one `EnvSaafError`.

The order explains the three surprises people hit most:

- `validate` never sees the raw string; use `type: 'string', trim: false` if you need it verbatim.
- `transform` does not run on a `default`, so a default is already in its final shape.
- An alias (or a default) is resolved before coercion, so a `validate` or `transform` receives the value from whichever source won.

### Types reference

Environment inputs are strings. Output below is before an optional `transform`.

| Type | Accepted input | JavaScript output | Additional rule options |
| --- | --- | --- | --- |
| `string` | Any non-missing text (default type) | `string` | `trim`, `minLength`, `maxLength`, `pattern` (`RegExp` or string) |
| `number` | Non-empty decimal text, including fractions and exponent notation. Plain integer text must be within the safe-integer range. Rejects radix prefixes (`0x`, `0b`, `0o`), `NaN` and non-finite values. | `number` | `trim`, `min`, `max` |
| `int` | Plain integer literal within the safe-integer range: optional sign + digits, e.g. `42`, `-3`, `007`. Decimal and scientific spellings (`1.0`, `1e3`) are rejected, as are radix prefixes | `number` | `trim`, `min`, `max` |
| `bigint` | Plain integer literal: optional sign + digits, e.g. `9007199254740993`, `-3`, `007`. Decimal and scientific spellings (`1.0`, `1e3`) are rejected, as are radix prefixes. Values above `Number.MAX_SAFE_INTEGER` keep full precision | `bigint` | `trim`, `min`, `max` (bigint, integer or integer string) |
| `boolean` | Case-insensitive `true/false`, `1/0`, `yes/no`, `on/off`, `y/n` | `boolean` | None |
| `url` | Absolute URL accepted by `new URL()`, without normalization | `string` | `trim`, `minLength`, `maxLength`, `pattern`, `protocols` |
| `file` | Path to an existing, readable regular file. Relative paths use the process working directory. | `string` | `trim`, `minLength`, `maxLength`, `pattern` |
| `port` | Plain integer literal from 0 to 65535. Decimal and scientific spellings (`8080.0`, `1e3`) are rejected, as are radix prefixes | `number` | `min`, `max` |
| `email` | One `@`, non-empty local part, domain with an interior dot, no leading or trailing domain dot, no whitespace | `string` | `trim`, `minLength`, `maxLength`, `pattern` |
| `json` | Valid JSON text (object, array or primitive). Accepts already-parsed defaults. | Parsed JSON value | `trim`. For numeric results, `min` and `max`. |
| `uuid` | Canonical 8-4-4-4-12 hexadecimal groups, either case | `string` | `trim`, `minLength`, `maxLength`, `pattern` |
| `jwt` | JSON Web Token shape: three base64url segments (`header.payload.signature`), with the header and payload decoding to JSON objects. Shape only — the signature is never verified | `string` | `trim`, `minLength`, `maxLength`, `pattern` |
| `hex` | One or more hexadecimal characters, no `0x` prefix | `string` | `trim`, `length`, `minLength`, `maxLength`, `pattern` |
| `ipv4` | Four decimal octets, each 0 to 255; no leading zeroes | `string` | `trim`, `minLength`, `maxLength`, `pattern` |
| `ipv6` | Any address `net.isIP` reports as IPv6, including compressed, IPv4-mapped and `%zone` forms | `string` | `trim`, `minLength`, `maxLength`, `pattern` |
| `semver` | `MAJOR.MINOR.PATCH`, optional prerelease and build suffixes, and one optional lowercase `v` prefix (`v1.2.3`). Leading numeric zeroes and uppercase `V` are rejected. | `string` | `trim`, `minLength`, `maxLength`, `pattern` |
| `base64` | Standard or URL-safe alphabet, with optional padding. | `string` | `trim`, `minLength`, `maxLength`, `pattern` |
| `date` | Valid `YYYY-MM-DD` or datetime with `T` and hours/minutes; optional seconds, fraction and `Z` or numeric offset. Accepts valid `Date` defaults. | `Date` | `trim`, `min`, `max` (ISO date strings) |
| `duration` | Human duration: `500ms`, `30s`, `15m`, `2h`, `1d`, `1w`, compounds like `1h30m`; a bare number is milliseconds | `number` (milliseconds) | `trim`, `min`, `max` (milliseconds or duration strings, e.g. `min: '30s'`) |
| `host` | Hostname (`db.internal`, `localhost`, `example.com.`) or IPv4/IPv6 address; one trailing DNS root dot is preserved; no scheme, path or port | `string` | `trim`, `minLength`, `maxLength`, `pattern` |
| `array` | Delimited list split by `separator` (default `,`) with each item coerced as `of` (default `string`). Empty items are rejected. Accepts array defaults. | Typed array (`T[]`) | `of`, `separator`, `trim`, `protocols` (when `of: 'url'`), `minItems`, `maxItems`, `unique`, `skipEmpty` |

All types support `required`, `requiredIf`, `conflictsWith`, `default`, `description`, `validate`, `transform`, `sensitive` and `aliases`. A `description` string documents the variable: it leads the comment `generateExample` writes for the key and becomes the property's `description` in `toJsonSchema`, without changing validation. Setting `sensitive: true` always masks the key's value in validation errors and CLI output, whatever its name (e.g. `SESSION_ID`, `LICENSE_KEY`), and leaves its placeholder empty in `generateExample`. Setting `aliases: ['OLD_NAME']` accepts deprecated variable names as fallbacks and emits a warning (see below). Custom `validate(value, env)` functions run after coercion and built-in checks (including on defaults), before `transform`. Transforms run on provided values after validation. Missing optional keys are omitted and defaults are validated. A key with a `default` can never be missing, so `required: true` together with a `default` is rejected as a schema error. The `choices` option matches coerced strings, numbers, booleans or bigints. A parsed JSON value can match a choice when it has one of the string, number or boolean types. String input is trimmed by default. Setting `trim: false` leaves whitespace in place for string-like types. For `number`, `int` and `bigint`, whitespace surrounding a valid numeric value is accepted either way. Whitespace-only text is treated as unset by default; with `trim: false`, it converts to `0` for `number`, while `int` and `bigint` reject it. Boolean matching always ignores surrounding whitespace. The `length` option applies only to `hex`. The `pattern`, `minLength` and `maxLength` options apply only to string-valued types (`string`, `email`, `url`, `file`, `uuid`, `jwt`, `hex`, `ipv4`, `ipv6`, `semver`, `base64`, `host`) and are rejected up front on any other type. See the sections below for examples.


### Conditional requirements (`requiredIf`)

Require a variable only when another variable matches a specific value (`equals`) or one of several values (`in`):

```js
const { validateEnv } = require('env-saaf');

const env = validateEnv({
  SENTRY_DSN:    { type: 'url', requiredIf: { key: 'MODE', equals: 'production' } },
  ALERT_WEBHOOK: { type: 'url', requiredIf: { key: 'MODE', in: ['staging', 'production'] } },
  MODE:          { type: 'string', choices: ['development', 'staging', 'production'], default: 'development' },
});
```

`validateEnv` evaluates schemas in **two passes**:

1. **Pass 1** coerces every provided variable, applies `default` values, runs all per-key checks (`min`/`max`, `minLength`/`maxLength`, `length`, `choices`, `pattern`, `transform`), and records unconditional `required: true` errors.
2. **Pass 2** evaluates every `requiredIf` rule for keys that were absent and had no `default`, comparing against the validated values from Pass 1 (falling back to the raw `env` object if the referenced key is not declared in the schema).

Because Pass 2 runs after Pass 1 finishes, key declaration order in the schema does not matter (`SENTRY_DSN` can be declared before `MODE`), and conditions match coerced values (such as `boolean` `true` or `int` `3`) as well as `default` values. When the condition holds and the key is missing, `validateEnv` reports the usual `<KEY>: missing required variable` error (or collects it in `errors` with `{ throwOnError: false }`). When the condition is false — or when the referenced key is absent or failed Pass 1 validation — the key stays optional. If the key is provided anyway, it is still coerced and validated as usual. Two combinations are rejected up front as schema errors: `required: true` together with `requiredIf` on the same key, and a `requiredIf` that names its own key — both are contradictory, so the schema fails instead of silently ignoring the condition.

A `requiredIf.key` that is not declared in the flattened schema emits a warning,
including inside groups. Check the name for a typo. External flags such as
`NODE_ENV` remain supported and still read from the raw environment. Warnings do
not fail validation. `validateEnv` and `loadEnv` use their existing `onWarn` hook;
standalone `validateSchema(schema)` writes these warnings to `console.warn`.
Without a hook, runtime validation also uses `console.warn`.

### Mutually exclusive variables (`conflictsWith`)

Reject configurations that set two incompatible variables at the same time, such as alternative credentials or a connection URL alongside split host/port variables:

```js
const { validateEnv } = require('env-saaf');

const env = validateEnv({
  API_KEY:          { type: 'string', sensitive: true, conflictsWith: 'OAUTH_TOKEN_FILE' },
  OAUTH_TOKEN_FILE: { type: 'file' },
  DATABASE_URL:     { type: 'url', conflictsWith: ['DB_HOST', 'DB_PORT'] },
  DB: {
    prefix: 'DB_',
    schema: {
      HOST: { type: 'host' },
      PORT: { type: 'port' },
    },
  },
});
```

- Pass a single key name (`'OAUTH_TOKEN_FILE'`) or a list of key names (`['DB_HOST', 'DB_PORT']`).
- Conflicts run in the second pass after `aliases` and `default` values are resolved, so a value supplied through an alias or a `default` counts as set (`''`, `null` and `undefined` without a `default` count as unset).
- Either side alone passes; when both keys are set, validation fails with `<KEY>: conflicts with <OTHER> (cannot set both)`. Diagnostics name only the conflicting keys and never echo values.
- The check is symmetric even when declared on only one key, and reciprocal declarations (`A` naming `B` and `B` naming `A`) report a single conflict error rather than a duplicate.
- Inside grouped schemas, `conflictsWith` uses full flattened env names (`DB_HOST`, `DATABASE_URL`).
- `validateSchema` rejects a `conflictsWith` that names an undeclared key, the key itself, or an empty/non-string entry.

### Cross-field validation rules (`options.rules`)

For invariants that span several coerced keys, pass a function (or an array of functions) via `options.rules` in `validateEnv`, `loadEnv`, or `loadEnvAsync`:

```js
const { validateEnv } = require('env-saaf');

const env = validateEnv(
  {
    CACHE_TTL:       { type: 'duration', default: '5m' },
    SESSION_TTL:     { type: 'duration', default: '30m' },
    WORKERS:         { type: 'int', default: 4 },
    QUEUE_DEPTH:     { type: 'int', default: 10 },
    MAX_CONNECTIONS: { type: 'int', default: 50 },
    SENTRY_DSN:      { type: 'url' },
    LOG_FILE:        { type: 'string' },
  },
  process.env,
  {
    rules: [
      (cfg) => (cfg.CACHE_TTL >= cfg.SESSION_TTL ? 'CACHE_TTL must be smaller than SESSION_TTL' : undefined),
      (cfg) => (!cfg.SENTRY_DSN && !cfg.LOG_FILE ? 'At least one of SENTRY_DSN, LOG_FILE must be set' : undefined),
      (cfg) => (cfg.WORKERS * cfg.QUEUE_DEPTH > cfg.MAX_CONNECTIONS
        ? 'WORKERS * QUEUE_DEPTH must not exceed MAX_CONNECTIONS'
        : undefined),
    ],
  },
);
```

- Each hook receives the frozen, coerced result object (including `default` values, resolved `aliases`, post-`transform` values, and nested `group` objects).
- Return a non-empty error string, an array of error strings, or nothing (`undefined`, `null`, `''`, or `[]`) when the check passes. Multiple hooks all run in order and aggregate every returned error.
- **Incomplete-snapshot rule:** `options.rules` runs only when all earlier steps (`strict`, per-key coercion and bounds, `conflictsWith`, and `requiredIf`) produced zero errors. If any key already failed, hooks are skipped so they never inspect a partial environment or emit cascading secondary errors.
- Returned errors join the normal error list in `EnvSaafError.errors`, `error.details` (`{ key: '', message }`, or `{ key, message }` when prefixed with `KEY: `), `formatError`, and `{ throwOnError: false }` results. Rule messages are added verbatim, so name the keys involved rather than echoing secret values.

### Non-throwing mode — collect errors instead of throwing

A health check, a CLI, or a server that wants to boot in a degraded mode cannot use an API that throws on the first bad value. Pass `{ throwOnError: false }` and `validateEnv` returns `{ env, errors, details }` instead: `env` holds every value that validated, `errors` is the same list `EnvSaafError` would have carried, and `details` is the same list split into `{ key, message }` objects (see [Structured error details](#structured-error-details)).

```js
const { validateEnv } = require('env-saaf');

const { env, errors, details } = validateEnv(
  {
    PORT:  { type: 'port', required: true },
    DEBUG: { type: 'boolean', default: false },
  },
  process.env,
  { throwOnError: false }
);

if (errors.length) {
  console.warn('config problems:', errors);
  for (const { key, message } of details) showFieldError(key, message);
  // keep booting: env.DEBUG is still usable, env.PORT is absent
}
```

The default is unchanged: without the option, or with `{ throwOnError: true }`, an invalid value still throws one `EnvSaafError` listing every problem. A malformed schema still throws as well — that is a bug in the code, not in the environment. `loadEnv` keeps throwing too, because with `{ assign: true }` it writes into `process.env` and a half-applied write is worse than a failed start; call `validateEnv` when you want the error list.

### Custom error messages: `formatError`

`EnvSaafError.message` is a fixed bullet list. To feed failures into structured logs, a Slack alert or a startup banner, pass an optional `formatError(errors, context)` to `validateEnv` (or `loadEnv`, which passes it through):

```js
const { validateEnv } = require('env-saaf');

try {
  validateEnv(schema, process.env, {
    formatError: (errors, { keys }) =>
      `config check failed (${errors.length} of ${keys.length} keys): ${errors.join(' | ')}`,
  });
} catch (err) {
  console.error(err.message); // your string
  console.error(err.errors);  // still the raw per-key messages
}
```

- `errors` is a read-only copy of the same raw diagnostics `error.errors` carries. These are the existing messages, so they can include non-sensitive input examples (values of `sensitive: true` keys stay masked, as before). `context` is separate and contains only `{ keys }`, the schema's key names; the environment object and schema rules are never passed in.
- The string you return becomes `error.message`. `error.errors` is unchanged, and without the option the message is byte-for-byte what it was.
- If the hook throws, its error propagates out of `validateEnv` / `loadEnv` unchanged — a broken hook is a programming error, so it is never silently replaced by the default message. A hook that returns anything other than a string still falls back to the default message. A `formatError` that is not a function is a `TypeError`.
- With `{ throwOnError: false }` no error is thrown, so the hook is not called and `errors` in the result stays raw. `loadEnv` always throws, so it forwards the hook for validation failures. Failures before validation, such as an unreadable or unparsable `.env` file, throw their own errors and are outside the hook's scope. Malformed-schema errors are not formatted either.

In TypeScript, `{ throwOnError: false }` (not `formatError`) narrows the return type to `ValidateResult<S>` (`{ env: EnvResult<S>; errors: string[]; details: ErrorDetail[] }`), so `env.PORT` keeps the type inferred from the schema.

### Structured error details

For programmatic handling — mapping failures back to form fields, translating messages, grouping by key — both the thrown error and the non-throwing result expose a `details` array of `{ key, message }` objects. It mirrors `errors` one-to-one, in the same order, without changing the printable strings or `error.message`. `key` is the full env name (including the group prefix for grouped keys, e.g. `DB_HOST`), and `message` is the text with the `key: ` prefix removed. Errors that are not tied to a key (such as an unknown option) use `key: ''` and keep the full text as `message`.

When a bad value came from a file loaded by `loadEnv` / `loadEnvAsync`, the printable string names that file (`PORT (from .env.local): ...`) and the matching `details` entry includes a `source` field with the same path. Layered `paths` report the file that supplied the winning value; ambient environment values keep today's message shape with no `source`. `validateEnv` called on its own is unchanged.

```js
try {
  validateEnv(schema, process.env);
} catch (err) {
  for (const { key, message } of err.details) {
    // key: 'DB_PORT', message: 'expected a port (0-65535, e.g. 3000), got "abc"'
    showFieldError(key, message);
  }
}
```

The same field is available without throwing: `const { env, errors, details } = validateEnv(schema, process.env, { throwOnError: false })`. A custom `formatError` changes only `error.message`; `errors` and `details` stay raw.

### Strict mode — catch typos in variable names

By default `validateEnv` only looks at keys in the schema. With `{ strict: true }` it also flags variables that are set but not in the schema — so a typo like `DATABSE_URL` next to the real `DATABASE_URL` no longer slips through:

```js
const env = validateEnv(schema, process.env, { strict: true });
// throws EnvSaafError listing e.g. "DATABSE_URL: set but not in schema (strict mode)"
```

A near miss is named: when a required key is missing and a set-but-undeclared key is the same name ignoring case or one edit away (a `PROT`/`PORT` swap), the message ends with `(did you mean PROT? it is set but not in the schema)`. The strict-mode extra gets the matching hint in the other direction. Only key names are suggested — values are never echoed, even for `sensitive` rules.

Default stays off — many apps share one environment with other tools.

### Renaming variables safely with `aliases`

To retire a variable, set `deprecated: true` or supply a migration hint such as `deprecated: 'Use MODE instead'`. A populated key emits a warning through `onWarn` (default `console.warn`) and follows its usual validation rules. Missing or empty values and schema defaults are silent. The generated example documents the deprecation alongside the variable's description.

Renaming an environment variable across a fleet usually means old and new names coexist for weeks. Declare the old names with `aliases` on the canonical key:

```js
const { validateEnv } = require('env-saaf');

const env = validateEnv(
  {
    DATABASE_URL: { type: 'url', required: true, aliases: ['DB_URL'] },
  },
  process.env,
  { onWarn: msg => logger.warn(msg) } // optional; defaults to console.warn
);
// env.DATABASE_URL receives the coerced, validated value (never env.DB_URL)
```

- When `DATABASE_URL` is unset (or empty `""`) and `DB_URL` is set, the first populated alias supplies the value under `env.DATABASE_URL`, runs through normal coercion, validation and `transform`, and emits a deprecation warning (`env-saaf: DB_URL is deprecated; use DATABASE_URL instead`).
- When both `DATABASE_URL` and `DB_URL` are set, `DATABASE_URL` wins and a warning notes the alias is ignored (`env-saaf: DB_URL is ignored because DATABASE_URL is set`).
- Warnings never fail validation. By default they are logged with `console.warn`; pass `onWarn: fn` to `validateEnv` or `loadEnv` to route them to your own logger (or `() => {}` to silence them).
- In `{ strict: true }` mode, declared aliases are recognised and are not flagged as unknown variables.
- An alias cannot equal a declared schema key (including its own key) or be shared by different rules. These schema mistakes throw `EnvSaafError` before reading values, even with `{ throwOnError: false }`. Repeating an alias within one rule is allowed.

### Grouped (nested) schemas with a key prefix

Schemas that repeat a prefix can group the rules under it instead:

```js
const env = validateEnv(
  {
    DB: {
      prefix: 'DB_',
      schema: {
        HOST: { type: 'host', required: true },
        PORT: { type: 'port', default: 5432 },
      },
    },
  },
  process.env,
);
// reads DB_HOST / DB_PORT, returns { DB: { HOST: '...', PORT: 5432 } }
```

- A group is a rule with a `schema` object and no `type`, plus a non-empty `prefix`. Every inner rule is read from `prefix + INNER_NAME`, so errors always name the full env var (`DB_HOST: missing required variable`).
- Groups can contain other groups at any depth. Their prefixes concatenate, while the result follows the group keys:

  ```js
  const env = validateEnv({
    APP: {
      prefix: 'APP_',
      schema: {
        DB: {
          prefix: 'DB_',
          schema: {
            HOST: { type: 'host', required: true },
            PORT: { type: 'port', default: 5432 },
          },
        },
      },
    },
  }, process.env);
  // reads APP_DB_HOST / APP_DB_PORT
  // returns { APP: { DB: { HOST: '...', PORT: 5432 } } }
  ```

- The result nests under the group key: `{ DB: { HOST, PORT } }`. If no inner key is present, the group key is omitted, just like an absent optional flat key.
- The returned result and each group object are frozen. Rule values keep their existing mutability, including parsed JSON, arrays, and objects supplied by defaults or transforms.
- `strict`, `aliases`, `requiredIf`, `conflictsWith` and `default` all work inside groups; inside a group, `aliases`, `requiredIf.key` and `conflictsWith` use **full env var names** (e.g. `aliases: ['DATABASE_HOST']`, `requiredIf: { key: 'NODE_ENV', equals: 'production' }`, or another group's `'DB_HOST'`).
- `generateExample` still emits flat env names (`DB_HOST=...`) with a comment at each group level (`# group APP`, `# group APP.DB`). `toJsonSchema` follows the nested result shape.
- `loadEnv(..., { assign: true })` writes the flat names back (`DB_HOST=...`), never a nested object.
- Malformed groups are rejected up front by `validateSchema` (now exported): a missing/empty `prefix`, a non-object or empty `schema`, a `type` on the group, circular group references, extra options on the group, or a composed prefix that collides with another key (e.g. a declared `APP_DB_HOST` plus nested `APP_` / `DB_` groups) all throw `EnvSaafError` naming the problem. The same sub-schema can be reused in separate groups.
- In TypeScript, `EnvResult` nests groups too: `env.DB` is `{ HOST: string; PORT: number; ... } | undefined` (the group key is optional; inner keys keep their own required/default optionality). `EnvGroupRule` is exported for typing a standalone group rule.

### Per-key `validate` — custom validation rules

Some rules are app-specific — a path must be an existing directory, or two keys must differ. Pass a `validate(value, env)` function on the key instead of forking the library:

```js
const fs = require('node:fs');
const { validateEnv } = require('env-saaf');

const env = validateEnv({
  DATA_DIR: {
    type: 'string',
    required: true,
    validate: v => fs.existsSync(v) && fs.statSync(v).isDirectory() || 'must be an existing directory',
  },
  PRIMARY_HOST: { type: 'host', required: true },
  REPLICA_HOST: {
    type: 'host',
    required: true,
    validate: (v, rawEnv) => v !== rawEnv.PRIMARY_HOST || 'must differ from PRIMARY_HOST',
  },
});
```

`validate` runs after type coercion and built-in checks (`min`/`max`, `minLength`/`maxLength`, `length`, `choices`, `pattern`), before `transform`, and also validates `default` values. It receives the coerced `value` and the input `env` object. Return `true` (or `undefined`/`null`) to pass, `false` for a generic error naming the key, or a non-empty string error message to fail. A throwing validator is collected in `EnvSaafError` (or `errors` with `{ throwOnError: false }`) as a validation failure naming the key instead of crashing, and respects `sensitive: true` masking.

### Per-key `transform` — one custom step after coercion

Some values need one small custom step after type coercion that env-saaf cannot guess — normalising case, adjusting a numeric unit, or post-processing a parsed array:

```js
const { validateEnv } = require('env-saaf');

const env = validateEnv({
  ALLOWED_ORIGINS: { type: 'array', transform: xs => xs.map(s => s.toLowerCase()) },
  SHOUTY_NAME:     { type: 'string', transform: v => v.toUpperCase() },
});
// env.ALLOWED_ORIGINS is a lower-cased string[], env.SHOUTY_NAME is upper-cased
```

The transform runs after coercion, built-in checks (`min`/`max`, `minLength`/`maxLength`, `length`, `choices`, `pattern`), and custom `validate`; if it throws, the error is collected like any other validation error (with the key named). Its return value is verified against the rule's declared `type` (e.g. `number`/`int`/`port`/`duration` must remain a finite number/integer/port, `bigint` must remain a bigint, `boolean` a boolean, `date` a valid `Date`, `array` an array of `of` items, `string` and string-typed rules a valid string) — returning the wrong type produces a validation error naming the key and expected type. It runs only on values actually provided — not on `default` values (defaults are still coerced and validated like any value, so a bad default fails with an error naming the key). In TypeScript the result type for that key is inferred from the transform's return type.

### `email` type and `pattern` — validate formats

```js
const env = validateEnv({
  ADMIN_EMAIL: { type: 'email', required: true },
  SLUG:        { type: 'string', pattern: '^[a-z0-9-]+$' },
  API_KEY:     { type: 'string', pattern: /^sk_[A-Za-z0-9]+$/ },
});
```

The `email` check is pragmatic: one `@`, a non-empty local part and domain, and a dot in the domain. It does not implement full RFC 5322. `pattern` accepts a `RegExp` or a regular expression source string on string-valued types (`string`, `email`, `url`, `file`, `uuid`, `jwt`, `hex`, `ipv4`, `ipv6`, `semver`, `base64`, `host`). A source string has no `/.../` delimiters and is compiled without flags. Use a `RegExp` for flags such as `i`. Invalid sources and uses on non-string types produce a schema error naming the key. Matching runs after coercion and the `choices` check, and a mismatch names the pattern.

### `int` type and `min`/`max` — whole numbers and ranges

```js
const env = validateEnv({
  MAX_RETRIES: { type: 'int', min: 0, max: 5, default: 3 },
  TIMEOUT_MS:  { type: 'number', min: 100, max: 30000 },
});
```

`int` is like `number` but only accepts plain integer literals — `42`, `-3` and `007` pass, while `3.5`, `1.0` and `1e3` fail (decimal and scientific spellings are not integer literals, even when the value happens to be whole). `port` follows the same rule. `min` and `max` work on `number`, `int` and `port`; either one can be used alone, and an out-of-range value is rejected with an error naming the allowed range.

`int` values (including numeric defaults) and plain integer text for `number` must be between `-Number.MAX_SAFE_INTEGER` and `Number.MAX_SAFE_INTEGER` (±9007199254740991, inclusive). Larger integers are rejected instead of silently rounding; use `type: 'bigint'` to preserve their exact value. Signs, leading zeroes, whitespace and underscore separators do not bypass this check. Decimal and exponent spellings for `number`, and already-numeric `number` inputs/defaults, keep their floating-point behaviour.

### `bigint` type and `min`/`max` — exact integers beyond the safe range

```js
const env = validateEnv({
  ORDER_ID:   { type: 'bigint', required: true },
  SNOWFLAKE:  { type: 'bigint', min: '9007199254740993', max: 9007199254740995n },
});
```

`bigint` is like `int` but returns a real `bigint`, so values above `Number.MAX_SAFE_INTEGER` — order IDs, snowflake IDs, wei amounts — keep full precision instead of silently rounding. It accepts the same plain integer literals (`9007199254740993`, `-3`, `007`, `1_000`) and rejects decimals, exponents and radix prefixes. `min` and `max` take a bigint, an integer, or an integer string, and both ends are inclusive. JSON Schema has no bigint, so `toJsonSchema` renders the type as `{ type: 'string', pattern: '^-?[0-9]+$' }` without the bounds; `generateExample` emits a value above the safe-integer range so the point of the type is visible.

### `date` type and `min`/`max` — chronological bounds

```js
const env = validateEnv({
  LAUNCH_DATE: { type: 'date', min: '2026-01-01', max: '2026-12-31' },
});
```

For `date` rules, `min` and `max` are ISO date (or datetime) strings — or `Date` objects — compared chronologically against the parsed value, so `2026-01-01T00:00:00Z` is exactly on the `2026-01-01` bound. Either bound can be used alone, both ends are inclusive, and an out-of-range value is rejected with an error naming the allowed range (`expected a date on or after 2026-01-01, got "2025-12-31"`). A numeric bound is rejected up front as a schema error, as is a bound that is not a valid date or a `min` above `max`. `generateExample` uses the bound itself when the default `2026-01-31` example falls outside the range, so a generated `.env.example` still passes `check`. JSON Schema has no keyword for comparing date strings, so `toJsonSchema` cannot make the exported schema reject an out-of-range date: it carries the bounds as a `$comment` next to the date formats instead (`env-saaf bounds (inclusive, enforced by validateEnv only): min 2026-01-01, max 2026-12-31`). That is an annotation for whoever reads the schema; no validator enforces it, and `validateEnv` stays the only place the bounds apply. A date-time bound without an offset is local time, so it is left out of the comment.

### `json` type and `minLength`/`maxLength` — structured values and string lengths

```js
const env = validateEnv({
  FEATURE_FLAGS: { type: 'json', default: { beta: false } },
  API_TOKEN:     { type: 'string', minLength: 10, maxLength: 64, required: true },
});
```

`json` parses the value with `JSON.parse` — objects, arrays and primitives all come back parsed; invalid JSON is rejected with an error naming the key. A `default` may be given as an already-parsed object. `minLength` and `maxLength` work on string-valued types (`string`, `email`, `url`, `file`, `uuid`, `jwt`, `hex`, `ipv4`, `ipv6`, `semver`, `base64`, `host`) and are rejected up front on any other type; either one can be used alone, and a too-short or too-long value is rejected with an error naming the allowed length. They combine with `pattern` — length is checked first, then the pattern.

### `uuid`, `jwt` and `hex` types — IDs, tokens and hex strings

```js
const env = validateEnv({
  TENANT_ID: { type: 'uuid', required: true },
  AUTH_TOKEN: { type: 'jwt', required: true },
  API_HASH:  { type: 'hex', length: 64 },
});
```

`uuid` accepts a canonical UUID (`8-4-4-4-12` hex groups, upper- and lowercase) and returns it unchanged; a malformed value is rejected with an error naming the key. `jwt` accepts a JSON Web Token shape — exactly three base64url segments (`header.payload.signature`) whose header and payload decode to JSON objects — and returns it unchanged. It is a shape check only: the signature is never verified, so a well-formed token from any issuer passes and a truncated or mangled token fails at boot instead of later as a confusing `401` from the API. `hex` accepts hexadecimal strings only (`deadBEEF42` passes, `0x1234` does not); the optional `length` option pins the exact size in characters, for fixed-size tokens and hashes.

### `ipv4`, `semver` and `base64` types — network addresses, versions and encoded values

```js
const env = validateEnv({
  BIND_ADDR: { type: 'ipv4', required: true },
  APP_VERSION: { type: 'semver', required: true },
  WEBHOOK_SECRET: { type: 'base64', required: true },
});
```

`ipv4` accepts a dotted-quad address (`192.168.0.1` passes, `256.1.1.1` and `1.2.3` do not); an octet with a leading zero (`01.2.3.4`) is rejected because it is ambiguous. `semver` accepts `MAJOR.MINOR.PATCH` with optional pre-release and build suffixes (`1.2.3-beta.1` passes) and one optional lowercase `v` prefix (`v1.2.3` passes, returned unchanged — the form `git describe` and release pipelines emit); `1.2`, `vv1.2.3` and uppercase `V1.2.3` do not. `base64` accepts either the standard alphabet (`A-Za-z0-9+/`) or the URL-safe alphabet (`A-Za-z0-9-_`). Padding can be omitted. When present, it must be complete and appear at the end. All three return the value unchanged, and `minLength`/`maxLength` work on them like on any other string type.

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

`duration` parses a human duration (`500ms`, `30s`, `15m`, `2h`, `1d`, `1w`) into a number of milliseconds; compound values sum their parts, so `1h30m` is 5,400,000 ms and `2d12h` is 216,000,000 ms (every part needs a unit — `1h30` is rejected); a bare number is already milliseconds, so `'250'` and `250` both mean 250 ms. Each unit may appear at most once in a compound value; repeats such as `1h1h` or `1s500ms250ms` are rejected. Units are case-insensitive and decimals are allowed (`1.5h` is 5,400,000 ms); `w` is a week of 7 days, so `1w` is 604,800,000 ms. Unknown units (`15min`, `15sec`), negatives and malformed values are rejected with an error naming the key. A number given as a `default` is taken as milliseconds, and `min`/`max` work on the millisecond result like on any other number. `generateExample` suggests `15m` for the type.

Duration `choices` may mix human duration strings and numeric milliseconds. For
example, `{ type: 'duration', choices: ['15m', 1800000] }` accepts `15m` or `30m`
and rejects `45m`. Equivalent spellings such as `900s` also match `15m`. This
works for `array` rules with `of: 'duration'` too. JSON Schema exports the choices
as millisecond numbers, while generated examples keep the original spelling.

### `host` type — a hostname or IP address, no scheme or port

```js
const env = validateEnv({
  DB_HOST: { type: 'host', required: true },
  BIND_ADDR: { type: 'host', default: 'localhost' },
}, process.env);
```

`host` accepts a hostname (`db.internal`, `localhost`) or an IPv4/IPv6 address (`10.0.0.5`, `::1`) and returns it unchanged, including a single trailing DNS root dot on a hostname (`example.com.`). Empty labels, leading dots and multiple trailing dots remain invalid. A value with a scheme (`https://db.internal`), a path (`db/x`) or a port (`example.com:8080`) is rejected with an error naming the key — those belong to the `url` type or to a separate port variable. `minLength`/`maxLength` and `pattern` work on it like on any other string type, and `generateExample` suggests `localhost` for the type.

### `url` type and `protocols` — allowlist schemes

```js
const env = validateEnv({
  WEBHOOK_URL: { type: 'url', protocols: ['https'], required: true },
});
```

`url` validates with `new URL()` and returns the value exactly as given (no normalization — a bare origin gains no trailing slash). `protocols` allowlists the schemes a value may use (`['https']` rejects `ftp://...` and `javascript:...` with an error naming the allowed schemes); matching is case-insensitive, and entries may be written with or without a trailing colon (`'https'` and `'https:'` mean the same). Without the option, any valid URL passes, as before.

### `array` type — split a delimited string into a typed array

```js
const env = validateEnv({
  ALLOWED_ORIGINS: { type: 'array', of: 'url', protocols: ['https'], required: true },
  PORTS:           { type: 'array', of: 'port', separator: ';', default: [80, 443] },
  ADMIN_EMAILS:    { type: 'array', of: 'email' },
});
```

`array` splits a delimited string on `separator` (default `','`), trims each item by default (`trim: false` keeps surrounding whitespace), and coerces every item with `of` (default `'string'`; any built-in scalar type is supported, and nested `'array'` is rejected up front). Empty items (such as `a,,b` or a trailing comma `a,b,`) are rejected rather than silently dropped — set `skipEmpty: true` to drop them instead, after which `minItems`/`maxItems` and `unique` count the remaining items — and any invalid item reports its 0-based index and offending value (`PORTS[1]: expected a port (0-65535, e.g. 3000), got "abc"` — masked when `sensitive: true`). `minItems` and `maxItems` bound the number of items (both non-negative integers, `minItems` must not exceed `maxItems`); a violation reports the key with the count and the bound (`TAGS: expected at least 2 items, got 1`), and the bounds apply to `default` values too. `unique: true` rejects repeated items, compared after item coercion (`'1,01'` for `of: 'int'` counts as a duplicate); a violation reports the key and the duplicated item (`TAGS: duplicate value "a" (unique: true)`), and it applies to `default` values too. Malformed values and use on a non-`array` rule are rejected up front, and `toJsonSchema` renders `unique: true` as `uniqueItems: true`. An already-parsed array may be passed as a `default` (including `[]`), and `generateExample` suggests three example items of the `of` type joined by `separator` — `a,b,c` for the default `string`, but `1,2,3` for `int`, `3000,8080,5432` for `port`, and so on — so the generated value itself validates against the rule; the comment above each array key names the item type (`# type: array, items: int`). In TypeScript the element type is inferred from `of`.

For `of: 'duration'`, `min` and `max` bound each item in milliseconds and also accept human duration strings, just like scalar durations. For example, `{ type: 'array', of: 'duration', min: '2h', max: '1d' }` accepts `'3h,4h'` and rejects `'3h,25h'`. Both bounds are inclusive and apply to defaults too; `minItems` / `maxItems` still control the number of items. Generated duration-array examples respect the item bounds, and `toJsonSchema` exports them as `items.minimum` / `items.maximum` in milliseconds.

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

Values may reference other values with `${VAR}` — handy for building URLs from parts. References resolve from the same file first, then `process.env`; with several files, `loadEnv` and `loadEnvAsync` resolve them against the whole stack (the later file's value wins), then `process.env`. Single-quoted values and `\${VAR}` escapes stay literal:

```env
HOST=example.com
API_URL=https://${HOST}/api
```

Standard POSIX-style parameter expansions are resolved statically (no shell is invoked):

- `${VAR:-fallback}` uses `fallback` when `VAR` is unset or expands to `''`; `${VAR-fallback}` uses it only when `VAR` is unset (for example, `API_URL=https://${HOST:-localhost}/api`).
- `${VAR:+alt}` expands to `alt` when `VAR` is set and non-empty, or `''` otherwise; `${VAR+alt}` expands to `alt` whenever `VAR` is set (even if `''`), or `''` when unset.
- `${VAR:?message}` throws an error naming the key, line number, `VAR`, and `message` (plus `(from <path>)` when loaded via `loadEnv` / `loadEnvAsync`) if `VAR` is unset or empty, and otherwise expands to `VAR`'s value; `${VAR?message}` throws only when `VAR` is unset.

Defaults, alternates, and error messages may include nested references such as `${HOST:-${DEFAULT_HOST}}` or `${SSL:+https://${HOST}:8443}`.

Quoted values may also span several lines (PEM keys, JSON blobs) — parsing continues until the closing quote. A backslash-escaped quote (`\'` inside single quotes, `\"` inside double quotes) stays part of the value, so `B='it\'s'` is `it's`; other backslashes, such as a Windows path, are kept as-is. Inside double quotes, `\n` and `\r` become a real newline and carriage return (as in dotenv), so a PEM key can be written on one line as `PRIVATE_KEY="-----BEGIN-----\n..."`; write `\\n` for a literal backslash-n, and use single quotes when every backslash must stay literal.

A bare line without `=`, or an assignment with an invalid key (such as `MY KEY`), raises a syntax error with its line number, without echoing the value. Assignment keys must match `[A-Za-z_][A-Za-z0-9_.-]*`: dots and dashes are allowed after the first character (as in `app.name` and `MY-KEY`), but spaces within a key are not. Use `KEY=` for an empty value.

In async code, use `loadEnvAsync` to read files without blocking on filesystem I/O.

```js
const { loadEnvAsync } = require('env-saaf');

async function readConfig() {
  return await loadEnvAsync(
    { PORT: { type: 'port', default: 3000 } },
    { paths: ['.env', '.env.local'] }
  );
}
```

It accepts the same options as `loadEnv`, including file precedence, `override`, and `assign`. The promise resolves with the validated values and rejects on the same errors that `loadEnv` throws.

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

Validate the mode first, then choose an ordinary schema in application code when you need different
`default` values or types per environment. For making a key required only under a specific mode, use
`requiredIf` in a single schema instead.

### Fastify

Validate configuration at startup **before** registering plugins or calling `fastify.listen(...)`, then attach the typed, frozen config object to the Fastify instance with `fastify.decorate('config', config)`. Running validation before `register` and `listen` ensures the process fails fast before plugins open database pools or the server binds a port, and decorating the instance gives routes and plugins typed access via `fastify.config` without re-reading `process.env`:

```js
const Fastify = require('fastify');
const { EnvSaafError, validateEnv } = require('env-saaf');

function buildApp() {
  let config;
  try {
    // Runs before registering plugins or calling listen(), so a bad config
    // fails fast before opening database pools or binding a port.
    config = validateEnv({
      PORT:         { type: 'port', default: 3000 },
      HOST:         { type: 'host', default: '127.0.0.1' },
      DATABASE_URL: { type: 'url', required: true },
      LOG_LEVEL:    { type: 'string', choices: ['info', 'warn', 'error'], default: 'info' },
    });
  } catch (err) {
    if (!(err instanceof EnvSaafError)) throw err;
    console.error(err.message);
    process.exit(1);
  }

  const fastify = Fastify({ logger: { level: config.LOG_LEVEL } });
  fastify.decorate('config', config);

  fastify.get('/health', async () => ({
    ok: true,
    port: fastify.config.PORT,
  }));

  return fastify;
}

const fastify = buildApp();
fastify.listen({ port: fastify.config.PORT, host: fastify.config.HOST });
```

For local development with a `.env` file, replace `validateEnv(schema)` with `loadEnv(schema)` (or `loadEnv(schema, { paths: ['.env', '.env.local'] })`) in the same startup block.

A runnable version of this recipe, with a schema in `server.js` and an `.env.example`, is in [`examples/fastify/`](examples/fastify/).

### Next.js

Put your server-only schema in a shared module (such as `lib/env.ts`) and import it from Next.js's `instrumentation.ts` `register()` hook, which runs **once when the Node.js server boots** — before handling requests, Route Handlers, or Server Components. Guard with `process.env.NEXT_RUNTIME === 'nodejs'` if your app also uses the Edge runtime, since `env-saaf` uses Node built-ins (`node:fs`, `node:net`, `node:path`). You can also import the same validation module at the top of `next.config.mjs` if you want `next build` to fail fast on missing build-time config.

```ts
// lib/env.ts — server-only configuration (never import in Client Components)
import { validateEnv } from 'env-saaf';

export const serverEnv = validateEnv({
  DATABASE_URL: { type: 'url', required: true },
  AUTH_SECRET:  { type: 'string', minLength: 32, required: true },
  API_TIMEOUT:  { type: 'duration', default: '10s' },
});
```

```ts
// instrumentation.ts — runs once when the Next.js Node.js server starts
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./lib/env');
  }
}
```

Next.js loads `.env`, `.env.local`, and environment-specific `.env.*` files into `process.env` automatically before `instrumentation.ts` runs, so `validateEnv` reads them directly without calling `loadEnv`.

A runnable version of this recipe is in [`examples/nextjs/`](examples/nextjs/): `instrumentation.ts` imports the server-only schema module, and `lib/env.ts` exits with the env-saaf message when a required value is missing.

**`NEXT_PUBLIC_` variables are out of scope for secrets:** Next.js inlines every `NEXT_PUBLIC_*` variable into the browser bundle at build time. Never store secrets (API keys, database URLs, signing secrets) in `NEXT_PUBLIC_*` variables — keep secrets in unprefixed server-only variables validated in server-only modules like `lib/env.ts`. If you also want to validate public client settings (such as `NEXT_PUBLIC_SITE_URL`), pass an explicit object (`validateEnv({ NEXT_PUBLIC_SITE_URL: { type: 'url', required: true } }, { NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL })`) because Next.js statically replaces literal `process.env.NEXT_PUBLIC_*` references in client bundles rather than exposing a full `process.env` object.

### Vite

Vite exposes only `VITE_`-prefixed variables to client code, and only through `import.meta.env` — `process.env` is not available in the browser bundle. Validate that object once in a module imported before the app renders, so a missing or malformed value fails on the first page load instead of at the API call that needed it:

```ts
// src/env.ts — imported first from src/main.tsx
import { validateEnv } from 'env-saaf';

export const env = validateEnv(
  {
    VITE_API_URL:      { type: 'url', required: true },
    VITE_WS_URL:       { type: 'url', protocols: ['wss'], default: 'wss://api.example.com/ws' },
    VITE_API_TIMEOUT:  { type: 'duration', default: '10s' },
    VITE_FEATURE_JSON: { type: 'json', default: '{}' },
    VITE_DEBUG:        { type: 'boolean', default: 'false' },
  },
  {
    // Literal import.meta.env.VITE_* reads: Vite replaces these at build time.
    VITE_API_URL:      import.meta.env.VITE_API_URL,
    VITE_WS_URL:       import.meta.env.VITE_WS_URL,
    VITE_API_TIMEOUT:  import.meta.env.VITE_API_TIMEOUT,
    VITE_FEATURE_JSON: import.meta.env.VITE_FEATURE_JSON,
    VITE_DEBUG:        import.meta.env.VITE_DEBUG,
  },
);
```

```ts
// src/main.tsx
import { env } from './env'; // first: throws here on a bad environment
import { createRoot } from 'react-dom/client';
import { App } from './App';

createRoot(document.getElementById('root')!).render(<App config={env} />);
```

Pass the keys explicitly rather than the whole `import.meta.env`: Vite only replaces literal `import.meta.env.VITE_*` expressions in client code, and `import.meta.env` also carries non-string values such as `DEV` and `MODE`. The validated result is typed from the schema (`env.VITE_API_TIMEOUT` is a `number`, `env.VITE_FEATURE_JSON` is `unknown`), so components can take `env` as a prop or through a context instead of reading `import.meta.env` again.

**A validated `VITE_` value is still public.** Vite inlines every `VITE_*` variable into the bundle: anyone can read it in DevTools. `sensitive: true` hides a value in error messages and masking output; it does not encrypt the bundle. Never put an API key, a database URL or a signing secret behind a `VITE_` prefix — keep those server-side.

For a build-time check, the CLI's scanner already understands Vite: `scanCode` and `scan` find `import.meta.env.VITE_*` reads in dot, bracket, optional-chaining and destructured forms, so `npx env-saaf scan src` lists every key the client code reads, and `npx env-saaf check --schema env.schema.js` fails when one is missing from the deployment's environment. To validate the same schema in Node before Vite starts building (and without the browser bundle), import the schema module at the top of `vite.config.ts` and call `validateEnv` there with `process.env` from `loadEnv`.


### NestJS

Nest reads configuration through `@nestjs/config` (usually with Joi) by default. To validate with env-saaf instead, keep the schema in its own module so tests can use it, validate at import time so a bad environment fails before Nest boots, and expose the typed result as a provider rather than reading `process.env` in services.

```ts
// src/config/schema.ts — the schema alone, so tests can import it without
// triggering a load
export const envSchema = {
  PORT:          { type: 'port', default: 3000 },
  DATABASE_URL:  { type: 'url', required: true },
  JWT_SECRET:    { type: 'string', minLength: 32, required: true, sensitive: true },
  LOG_LEVEL:     { type: 'string', choices: ['info', 'warn', 'error'], default: 'info' },
  CACHE_TTL:     { type: 'duration', default: '5m' },
} as const;
```

```ts
// src/config/env.ts — runs when this module is first imported
import { loadEnv } from 'env-saaf';
import { envSchema } from './schema';

export const env = loadEnv(envSchema);   // throws EnvSaafError on a bad value
export type Env = typeof env;            // PORT: number, CACHE_TTL: number, ...
```

```ts
// src/config/env.module.ts
import { Global, Module } from '@nestjs/common';
import { env } from './env';

export const ENV = Symbol('ENV');

@Global()
@Module({
  providers: [{ provide: ENV, useValue: env }],
  exports: [ENV],
})
export class EnvModule {}
```

Import `src/config/env` first in `main.ts`. Module imports are evaluated in order, so validation runs before `NestFactory.create()` and the process exits on a bad environment instead of starting a half-configured app:

```ts
// src/main.ts
import './config/env';   // first: throw before Nest boots
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { env } from './config/env';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  await app.listen(env.PORT);
}
void bootstrap();
```

Add `EnvModule` to `AppModule`'s imports, then inject the object where it is needed — a property access on `env` is typed (`env.PORT` is a `number`, `env.CACHE_TTL` is milliseconds):

```ts
// src/users/users.service.ts
import { Inject, Injectable } from '@nestjs/common';
import { ENV } from '../config/env.module';
import type { Env } from '../config/env';

@Injectable()
export class UsersService {
  constructor(@Inject(ENV) private readonly config: Env) {}

  cacheTtl(): number {
    return this.config.CACHE_TTL;
  }
}
```

**With an existing `@nestjs/config` setup.** Two options:

- *Replace it.* Drop `ConfigModule.forRoot({ validationSchema: Joi.object(...) })` and use `EnvModule` as above. Keep the rest of the app off `ConfigService`, or wrap it: `{ provide: ConfigService, useValue: { get: (key: keyof Env) => env[key] } }`.
- *Coexist.* Keep `ConfigModule` for features that read it, and still validate with env-saaf. Both read `.env`, and env-saaf gives `process.env` precedence by default; pass `{ override: true }` to make the file win, or `{ assign: true }` to write the validated values back into `process.env` before `ConfigModule` reads them.

In tests, import only `schema.ts` and pass a fixture object — no file and no process environment involved:

```ts
import { validateEnv } from 'env-saaf';
import { envSchema } from './schema';

const { env, errors } = validateEnv(
  envSchema,
  { DATABASE_URL: 'postgres://db/app', JWT_SECRET: 'x'.repeat(32) },
  { throwOnError: false },
);

expect(errors).toEqual([]);
expect(env.CACHE_TTL).toBe(300_000);
```

### Keep `.env.example` honest (CLI)

CLI output is plain text by default, including in pipes and CI. For scripts that set a shared color preference, pass `--no-color` before or after the command, or set `NO_COLOR=1`.

```bash
npx env-saaf --version      # print the installed version
npx env-saaf scan ./src     # every env var your code actually uses
npx env-saaf scan src/server.js  # scan a single code file (also accepted by check)
npx env-saaf scan . --exclude fixtures --exclude 'src/generated/**'  # leave vendored or generated code out
                           # scans .js/.cjs/.mjs/.ts/.mts/.cts/.tsx/.jsx and .vue/.svelte/.astro components
git show HEAD:src/config.js | npx env-saaf scan --stdin  # scan code piped on standard input
npx env-saaf check .        # compare code against .env.example
npx env-saaf check . --file .env.sample  # compare against a differently-named template file instead
npx env-saaf check . --json # machine-readable check results for CI or tooling
npx env-saaf check . --schema ./env.schema.js  # also validate the values in .env against a schema — exit 1 on a type error
npx env-saaf check . --fix  # append missing keys to .env.example (placeholders from --schema when given) instead of only reporting them
npx env-saaf check . --schema ./env.schema.js --values .env.production  # validate another environment file's values
npx env-saaf print . --schema ./env.schema.js  # print the coerced values (defaults applied, secrets masked)

npx env-saaf scan ./src --json  # JSON object containing the used vars
npx env-saaf check . --watch    # re-run check whenever the code, .env.example/.env or schema changes (Ctrl-C to stop)
npx env-saaf example ./src  # draft a .env.example from a code scan
npx env-saaf example ./src --write  # save the draft to .env.example (refuses, exit 1, when the scan finds no variables)
npx env-saaf example . --schema ./env.schema.js  # generate .env.example from a schema instead — with type placeholders and alias/requiredIf annotations
npx env-saaf init .  # scaffold a starter env.schema.js (commented type examples) + a matching .env.example (refuses to overwrite without --force)
npx env-saaf init . --from-example  # infer the starter schema from an existing .env.example instead (it is left untouched)
npx env-saaf init . --from-example --groups  # fold keys sharing a prefix into a grouped schema
```

### Project configuration

Repeat the same flags on every invocation? Declare the defaults once in the project's `package.json`, under an `env-saaf` key:

```json
{
  "env-saaf": {
    "schema": "config/env.schema.js",
    "file": ".env.sample",
    "dir": "app"
  }
}
```

`schema` and `file` mirror the `--schema` / `--file` flags, and `dir` names the directory to check, scan or print when no directory argument is given. An explicit flag (or directory argument) always wins over the config, and paths in the config are resolved relative to the directory the command runs on — the configured `dir`, or the project root. A config with an unknown key, a non-object value or a non-string value is a usage error (exit 2), so a typo cannot silently do nothing; a project without the key behaves exactly as before.

Starting a new project? `env-saaf init` writes a starter `env.schema.js` with commented examples of the main types (`string`, `int`, `boolean`, `port`, `url`, `email`, `duration`, `host`) and generates a matching `.env.example` from it. Every suggested placeholder is a value that validates against its own rule, so a generated `.env.example` passes `check` out of the box (the `file` type is the exception — its `./config.json` path must exist first). In a project whose `package.json` has `"type": "module"`, the starter is written as `env.schema.cjs` instead, so it still loads with `require()` — name your own schema with a `.cjs` extension there too. The first `check` after `init` passes with a note until code reads the variables — keys the scaffold declares but no code uses yet are not treated as drift. Once code reads at least one variable, unused keys fail the check again, as before. Either file being present is a refusal (exit 1, naming the files) unless `--force` is passed; `--schema <file>` names the schema file instead of `env.schema.js`.

Already have a `.env.example` and no schema? `env-saaf init --from-example` (optionally `--from-example=FILE` for another name) parses the example file and infers a starter rule per key from its sample value, in this priority order: a port-looking number (a whole number in 1024-65535) -> `port`, `true`/`false` -> `boolean`, an absolute URL with a `scheme://` authority (http, https, postgres, redis, wss, …) -> `url`, an email address -> `email`, a UUID -> `uuid`, an ISO date or datetime -> `date`, a duration such as `30m` or `1h30m` -> `duration`, a semantic version such as `1.4.2` -> `semver`, an object or array that parses as JSON -> `json`, an even-length hex string of at least eight characters -> `hex`, any other integer -> `int`, a decimal -> `number`, anything else (including empty values and ambiguous strings such as `cafe`) -> `string`. Each candidate is confirmed with the real validator, so an inferred rule always accepts the sample it came from. Every inferred rule is written with a comment saying it was inferred and should be reviewed — the sample values themselves are not copied into the schema, so a password in the example cannot leak into the committed file. Keys the code scan finds that the example does not list are folded in as `string` rules, as with the fixed scaffold. The example file is never written or overwritten in this mode — only the schema file is, still refusing to overwrite it without `--force`. The generated schema validates against the example's own sample values, so `env-saaf check . --file .env.example --schema env.schema.js` passes right after. Pass `--groups` (`env-saaf init --from-example --groups`) to fold keys sharing a common prefix into a grouped schema (e.g. `DB_HOST` and `DB_PORT` become a `DB` group with `prefix: 'DB_'`) when the prefix is at least two characters and at least two keys share it.

When `.env.example` (or the file given with `--file`) sits in the scanned directory, `scan` also warns about keys declared there that no code reads, one per line on stderr: `UNUSED: OLD_KEY (in .env.example, never used in code)`. With `--json` they are listed in an `unused` array next to `vars`, and a `locations` map lists each use as `{ file, line }` (paths relative to the scanned directory, 1-based lines; piped `--stdin` uses `file: "-"`). Plain text output is unchanged. It is only a warning: stdout still holds just the used variables, and `scan` still exits 0 (use `check` to fail a CI job on drift). Without a template file, nothing changes. Library callers can use `scanCodeLocations` / `scanDirLocations` for the same map.

When scanning a directory, `scanDir` skips `node_modules`, `.git*` and common build output (`dist`, `build`, `coverage`, `.next`, `out`, `target`), so a stale bundle cannot make an unused key look used. A scan reads code, not comments or the text inside string and template literals: a variable named only in a comment (`// set process.env.FOO first`), a string (`'see process.env.BAR'`) or a template's text isn't reported, so it can't quietly satisfy `check` or land in an `example` draft. A read inside a template's `${...}` is still a read, and so are `process.env['X']`, ``process.env[`X`]`` and destructuring. Optional chaining is a read too — `process.env?.MAYBE` and `import.meta.env?.VITE_MAYBE` are reported just like the plain dot form (as are `process.env?.['X']` and ``process.env?.[`X`]``). Vite's `import.meta.env` reads are found the same way (dot access, bracket access and destructuring), so Vite projects scan correctly too.

When a real `.env` sits next to the template, `check` also compares their keys: a key in `.env` that is not documented (`EXTRA in .env: FOO (not in .env.example)`) is usually a typo, and a template key with no local value is reported as `MISSING in .env: BAR (in .env.example, not set locally)`. `--file` selects the template for both comparisons; with no `.env` file this extra check is skipped. In `--json` mode the findings appear as `envExtra` and `envMissing` alongside the existing `missing`, `extra`, `unused`, `invalid` and `secrets` fields. The `unused` field lists the documented-but-unused keys under the same name `scan --json` uses, and `extra` keeps the identical list for compatibility.

`check` also inspects the template's own values and flags entries that look like real secrets rather than placeholders (`sk-...`, `AKIA...`, URLs such as `postgres://user:pass@host` with a non-empty password, hex tokens, PEM keys, JWTs, or long high-entropy strings) as `SECRET in .env.example: KEY (value [REDACTED] looks like a real secret; use an empty value or placeholder)` and lists the keys in `secrets` under `--json`, without ever printing the value; empty values, common placeholders (`your-key-here`, `<redacted>`, `xxx`) and `generateExample` outputs pass. Whenever the template has a flagged value, `--schema` output is guarded whichever file is validated (`.env`, `--values` or the template itself): schema errors for a flagged key, its aliases and the elements of a flagged list or JSON value are left out, and any other message that quotes a flagged value is replaced by a generic `details withheld` diagnostic, so the value is never echoed; the key is still named under `SECRET`. Without findings the schema output is unchanged.

The scanner finds dot access and static bracket keys through simple local aliases declared with `const`, `let` or `var`, such as `const env = process.env; env.PORT`. This also works with `import.meta.env`. The text scanner tracks reads after declaration. Reassignment, shadowing, alias chains and destructuring through an alias are outside its scope.

Both `scan` and `check` also accept a path to a single readable code file (such as `npx env-saaf scan src/server.js` or `npx env-saaf check src/server.js`), applying the same code-extension filter and comment/literal masking without scanning sibling files; `scan --json` reports `locations` using the file path as given.

#### Exit codes

These codes describe a single CLI run.

| Code | Meaning |
| --- | --- |
| `0` | The command completed successfully. Its output may include warnings or notes. |
| `1` | A check found drift or invalid values, or the command refused to write its output. |
| `2` | Usage or input error, such as an unknown command, a missing project directory, or an invalid input file. |

- `check` exits `1` for missing keys, unused template keys, secret-looking template values, differences between `.env` and the template, or schema validation failures. If no code reads environment variables and unused template keys are the only finding, it exits `0` with a scaffold note. In comparison JSON, `ok: true` means exit `0` and `ok: false` means exit `1`. Usage and input errors such as a missing or malformed template exit `2` with `ok: false` and an `error` field in JSON mode.
- `scan` exits `0` even when it finds unused keys or no environment variable reads. In JSON mode, `ok: true` accompanies `vars`, a `locations` map for each use, and any template comparison appears in `unused`. A malformed template, a missing directory, or `--stdin` combined with a directory argument exits `2` with `ok: false` and an `error` field in JSON mode.
- `example` exits `0` when it prints or writes a draft. Printing with no discovered keys still succeeds. Writing a scan-based draft with no keys, or overwriting an existing output without `--force`, exits `1`. An unloadable schema exits `2`.
- `init` exits `0` when it creates the scaffold or infers a schema. An existing output without `--force` exits `1`. A missing `--from-example` input exits `2`.

`example` and `init` use text output. Passing `--json` to either command exits `2` with a JSON error object containing `ok: false` and `error`.


`env-saaf print` loads and validates the env file (`.env` by default, or `--file`) against the schema and prints the effective configuration — coerced values and defaults — with every `sensitive: true` rule and every secret-named key masked, and the password of any URL that embeds credentials redacted (`postgres://user:***@host/db`), in text and `--json` output alike; `--json` prints the same object. `--reveal` prints the real values instead, for local debugging only — never use it in CI logs. A validation failure uses the same messages and exit 1 as `check --schema`, so it doubles as a pre-flight check. It requires `--schema`.


`--schema` is opt-in: without it, `check` only compares key presence. With it, `check` loads the schema file (`module.exports = { PORT: { type: 'port', required: true } }`, resolved relative to the checked directory) and runs the same `validateEnv` the library uses over the values of the real `.env` file. A type error is reported as `INVALID: PORT: expected a port (0-65535, e.g. 3000), got "not-a-port"` and fails the check (exit 1); in `--json` mode the failures appear in the `invalid` field. `--values <file>` validates that file instead (for example `.env.production` or `.env.staging`), and a missing file is a usage error; its undocumented keys get the same `EXTRA in <file>: KEY (not in .env.example)` finding the real `.env` gets (listed in `envExtra` under `--json`, failing the check), so a typo'd key in a deployment file no longer passes silently; An explicit `--file` names the file to validate instead; with no `.env` file and no explicit `--file`, the schema step is skipped — the template's placeholders are not real values. With `--schema`, `check` also reconciles the schema with the example file: a key declared in the schema but absent from `.env.example` is reported as `NOT DOCUMENTED`, and an example key the schema does not declare as `NOT IN SCHEMA` (grouped schemas compare by flattened names such as `DB_HOST`). Both fail the check and appear in `--json` as `schemaNotDocumented` and `documentedNotInSchema`. A schema file that cannot be loaded (or does not export a schema object) is a usage error: a clear message and exit 2. With `--json-schema`, `check` prints the `--schema` file as a draft 2020-12 JSON Schema document to stdout instead of running the check, so editors and CI validators can consume it directly; the `.env.example` is never read, so a schema converts even before an example file exists. Without `--schema` there is nothing to convert, so the flag is a usage error (exit 2).


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

Real secrets come from the repository's Actions secrets (Settings, Secrets and variables, Actions), never from the repo: commit only `.env.example` and keep `.env` in `.gitignore`. The `.env` above exists only inside the job's temporary checkout. `check` compares key names only and never prints values, so a secret does not end up in the log. Without a `.env` the job still compares code and `.env.example`; with one it also reports `EXTRA in .env` / `MISSING in .env` keys (available since 1.4.0; with 1.3.0 `check` compares code and `.env.example` only). The final step uses the CLI exit status directly. Exit `0` passes the step, exit `1` fails it on drift, and exit `2` fails it on a usage or input error.

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

Keys that look like secrets (`API_KEY`, `DB_PASSWORD`, …) get an empty placeholder — nothing safe to suggest for them. Other keys get a type-based placeholder, and an explicit `default` is used as-is. Keys with `aliases` note the deprecated fallback names (`# type: url, required; also accepts DATABASE_URL (deprecated)`), and keys with `requiredIf` note the condition (`# type: url; required when MODE is 'production'`, or `required when MODE is one of 'staging', 'production'` for the `in` form).

Numeric placeholders (`number`, `int`, `port`, `duration`) are adjusted to fit `min` and `max` when the range allows a value of that type. Integer bounds are rounded inward, ports stay within 0–65535, and durations stay non-negative. A duration keeps the `15m` example when it fits; otherwise its example is written in milliseconds. Explicit defaults, choices and empty secret placeholders keep their existing precedence.

Built-in string placeholders are adjusted to fit `minLength` and `maxLength` without changing their type's format. To keep the template small, each adjusted placeholder can be up to 4,096 characters, with up to 16,384 characters of growth from string adjustments per call. If the bounds cannot fit within those limits, the ordinary type placeholder is used instead. These limits do not truncate supplied defaults or choices.

### Export JSON Schema from your schema

`toJsonSchema(schema)` returns a [draft 2020-12 JSON Schema](https://json-schema.org/draft/2020-12)
for documentation, editor tooling, or validation of **coerced values**, not raw `.env` strings.
It does not read environment variables or run custom callbacks.
Grouped schemas nest as object schemas, with the inner rules as `properties`
and their required keys in the group's own `required` list.
String `pattern` sources are copied verbatim into JSON Schema.

```js
const { toJsonSchema } = require('env-saaf');

const schema = toJsonSchema({
  PORT: { type: 'port', required: true },
  LOG_LEVEL: { choices: ['info', 'warn'], default: 'info' },
});

console.log(JSON.stringify(schema, null, 2));
// PORT is required and must be an integer from 0 to 65535.
// LOG_LEVEL is an optional string with enum ['info', 'warn'] and default 'info'.
```

Numeric, length and item bounds become JSON Schema keywords. Arrays describe
their coerced items, durations are milliseconds, and dates serialize to ISO
date-time strings (the schema also accepts the `date` format). The `json` type
allows any JSON shape. JSON-compatible `choices` become `enum` values; duration
strings are normalized to milliseconds. Representable defaults are exported in coerced form as annotations;
JSON Schema does not fill in missing values. Avoid putting secrets in schema
defaults, choices or condition values that will be shared.

`requiredIf` becomes [conditional validation](https://json-schema.org/understanding-json-schema/reference/conditionals#if-then-else)
with `if` / `then`, using `const` for `equals` and `enum` for `in`. Multiple or
grouped conditions use `allOf`. A condition tests a present, canonical value
without re-coercing it. For groups, use the full env name in `requiredIf.key`;
the exported test and requirement use the respective nested JSON paths.
Resolve aliases and apply defaults before validating if they affect the values
you supply: an omitted discriminator does not match, even if it has a `default`
annotation. A target with its own default does not become conditionally required.

Conditions on undeclared env keys, discriminators with custom validation or
transforms, and `date` or `array` discriminators are not exported. Comparisons
that depend on object identity or custom membership behavior are also omitted.
For a `json` discriminator, JSON scalars (including `null`) can match; values
like `Infinity` cannot match canonical JSON and are ignored in membership lists.

**Not represented:** `conflictsWith`, `transform`, `validate`, `aliases`, `sensitive`,
input trimming and splitting, regular-expression flags (flagged patterns are omitted),
and defaults that cannot be converted to JSON without loss or depend on local time.
File existence and the detailed `base64` check remain runtime-only.
Standard formats are annotations by default, and their rules can differ from
env-saaf's checks. JSON Schema counts Unicode characters for string lengths;
env-saaf counts JavaScript UTF-16 code units. Use `validateEnv` or `loadEnv`
for runtime validation.

### Mask config values

```js
const { maskSecrets } = require('env-saaf');
console.log(maskSecrets(process.env)); // values masked: sk***56
```

An empty value stays empty — `maskValue('')` returns `''`, so an unset secret no longer looks set in logs.

`maskValue` masks strings, numbers and bigints with the same rule, so a secret validated as a number is masked like its text (`maskValue(123456)` returns `'12***56'`, like `maskValue('123456')`). Booleans always become `'****'`, so `true` and `false` cannot be told apart. Empty strings stay empty; symbols, `null`, `undefined`, functions and objects pass through unchanged.

`maskSecrets` recurses into plain objects and arrays, copies their shape and masks every string, number, boolean and bigint leaf, whatever its key (`{ PORT: 8080 }` becomes `{ PORT: '****' }`). `null`, `undefined` and non-plain objects (`Date`, `RegExp`, class instances) keep their values and identity. A repeated plain-object or array reference, including a cycle, becomes `'[Circular]'`. The input is never mutated. TypeScript's `Masked<T>` types masked leaves as `string` and keeps the other leaf types. These helpers have no schema or sensitive-key context: a secret stored inside a class instance is not masked, so do not treat their output as automatically safe to log.

## Troubleshooting

Each message below is quoted as the current version prints it. Triggering the error is the quickest way to see the whole message: `validateEnv` prints nothing on success, so the text in a failed run is exactly what a search engine will index.

### `unknown option "..."`

```
Invalid schema:
  - PORT: unknown option "requried"
```

A misspelled option in a rule. The message names the key and the option as written; the [types reference](#types-reference) lists the options each type accepts, and the paragraph after the table lists the ones every type shares (`required`, `requiredIf`, `conflictsWith`, `default`, `description`, `validate`, `transform`, `sensitive`, `aliases`, plus `choices` and `trim` where they apply).

The same message shape appears for a misspelled call option:

```
Invalid environment variables:
  - unknown option "throwOnErr" (validateEnv accepts: throwOnError, strict, onWarn, formatError, rules)
```

Fix the spelling. `validateSchema(schema)` runs the same check without an environment, so a typo fails in a test rather than at boot.

### `unknown type "..."`

```
Invalid schema:
  - PORT: unknown type "prot"
```

The `type` is not one the library knows. Kinds are listed in the [types reference](#types-reference) (`string`, `number`, `int`, `boolean`, `url`, `port`, `duration`, `date`, `json`, `array`, `email`, `uuid`, `jwt`, `hex`, `ipv4`, `ipv6`, `semver`, `base64`, `host`, `file`). `number` and `int` differ: `int` rejects `3.5`.

### `default: unknown option "PORT"`

```
Invalid schema:
  - default: unknown option "PORT"
```

A schema file whose `export default` was not unwrapped, so the schema object became a key named `default` whose value is the real schema. This happens when the whole module namespace is passed to `validateEnv`:

```js
import * as schema from './env.schema.mjs';   // { default: { PORT: ... } }
validateEnv(schema, process.env);             // -> default: unknown option "PORT"
```

Import the default export instead, or unwrap it:

```js
import schema from './env.schema.mjs';
validateEnv(schema, process.env);
```

The CLI's `--schema` already unwraps a single `default` export when it loads the file, so this only affects code that imports the schema itself. A CommonJS schema (`module.exports = { ... }`) works as-is; in a `"type": "module"` project name it `*.cjs` if the CLI must `require()` it.

### Strict mode reports variables your deployment has but the schema does not

```
Invalid environment variables:
  - EXTRA: set but not in schema (strict mode)
```

With `{ strict: true }`, any key present in the environment that the schema does not declare is an error, which is the point: a typo in a variable name cannot silently fall back to a default. When the variable is real but not used by this app (a platform-injected `HOSTNAME`, a CI variable, a shared `.env`), declare it rather than turning strict mode off:

```js
const env = validateEnv(
  {
    PORT: { type: 'port', default: 3000 },
    // Used by the platform, not by this app; declared so strict mode stays on.
    HOSTNAME: { type: 'string' },
  },
  process.env,
  { strict: true },
);
```

If a whole prefix is outside your control, read the environment into an explicit object and pass that instead of `process.env`.

### `parseEnvFile expects .env text, not a file path`

```
parseEnvFile expects .env text, not a file path — did you mean loadEnv(schema, { path: '.env' })?
```

`parseEnvFile` parses a string; it never reads a file. When you already have the text (a test fixture, a secret store, a downloaded blob) keep it, but if the value came from `fs.readFileSync`, pass `utf8` and the result, or let `loadEnv` read the file for you:

```js
// Before: the path is parsed as .env text and the call fails.
parseEnvFile('.env');

// The file's contents:
parseEnvFile(fs.readFileSync('.env', 'utf8'));

// Or read and validate in one step:
const env = loadEnv({ PORT: { type: 'port', required: true } }, { path: '.env' });
```

### `expected KEY=VALUE` and `duplicate key`

```
line 2: expected KEY=VALUE
```

```
env-saaf: duplicate key A at line 2 (first defined at line 1)
```

Both come from the `.env` parser and carry the line number.

- A line without `=` is not an assignment. Comments start with `#`; blank lines are ignored. If the text is YAML, JSON or a shell script, parse it with that format's reader and pass the resulting object to `validateEnv`.
- A duplicate key is an error rather than last-one-wins, because two entries for the same variable usually mean a merge went wrong and the value that wins depends on the parser. Keep one entry per key; to layer files, pass a list (`{ paths: ['.env', '.env.local'] }`) where a later file may override an earlier one on purpose.

Both errors name the line, so `nl -ba .env` shows the offending row.

## How env-saaf compares to envalid, joi, and zod

| | `env-saaf` | `envalid` | `joi` | `zod` |
| --- | --- | --- | --- | --- |
| **Scope** | Environment variables only (flat key-value maps) | Environment variables only | General-purpose schema validation (requests, payloads, config) | General-purpose schema validation (requests, forms, config) |
| **Runtime dependencies** | Zero | Zero | Multiple `@hapi/*` packages | Zero |
| **`.env` loading & CLI tooling** | Built-in `.env` parser (`loadEnv`/`parseEnvFile`), `scan`/`check`/`example`/`init` CLI, secret masking | Validation only (pair with Node `--env-file` or `dotenv`) | Validation only (pair with Node `--env-file` or `dotenv`) | Validation only (pair with Node `--env-file` or `dotenv`) |
| **Error aggregation** | Collects all errors in one pass (`EnvSaafError`, or `{ env, errors }` with `throwOnError: false`) | Collects all errors in one pass (passed to default or custom `reporter`) | Stops on first error by default; pass `{ abortEarly: false }` to collect all | Collects all issues in one pass (`ZodError` via `parse`, or `{ success, error }` via `safeParse`) |
| **TypeScript inference** | Ships `index.d.ts`; infers flat object types from inline / `as const` schemas (`json` infers as `unknown`, `choices` stays widened) | Written in TypeScript; infers validator return types including literal unions for `choices` | Ships types, but does not infer static TS types from schemas (define interfaces separately or use codegen) | TypeScript-first static inference (`z.infer<typeof schema>`) across nested objects, unions, literals, and transforms |

A comparison is not a migration path, though — see [Migrating to env-saaf](#migrating-to-env-saaf) below for concrete before/after steps from `dotenv`, `dotenv-safe` and `envalid`.

### When `env-saaf` is a good fit

- You want startup env validation, `.env` file loading (with layering and `${VAR}` interpolation), secret masking, and a CI CLI (`env-saaf check`) to keep `.env.example` in sync with code — all in one zero-dependency Node.js package.

### When another library is a better fit

- **Validating HTTP requests, API payloads, forms, or nested JSON:** `env-saaf` validates environment variable maps rather than arbitrary nested JSON payloads. Use **zod** (especially in TypeScript) or **joi** when you need general data validation.
- **You already use `zod` or `joi` in the project:** If you already depend on one of them for request/data validation and do not need `env-saaf`'s `.env` parser or `scan`/`check` CLI, validating `process.env` with your existing library avoids adding another tool.
- **Richer TypeScript inference or non-Node runtimes:** Use **zod** for full static type inference (nested shapes, discriminated unions, narrowed literal enums) or browser/edge runtime support (`env-saaf` uses Node built-ins `node:fs`, `node:net`, and `node:path`). Use **envalid** if you want env-only validation with `devDefault`, proxy-guarded env access, or literal-union inference from `choices`.

## Migrating to env-saaf

Three short paths, each ending with a complete snippet that runs against the current API (verified against this release). The `.env` file itself never has to change.

### From `dotenv` (manual `process.env` reads)

Keep the `.env` file exactly as it is. Replace the scattered `process.env.X` reads with one schema plus `loadEnv`, which parses `.env`, validates every value and returns typed results — and run `env-saaf scan` first to find every read you have.

```bash
npx env-saaf scan ./src          # every env var your code actually uses, one per line
npx env-saaf scan ./src --json   # same list as JSON, for scripts
```

```js
// before — dotenv + hand-rolled reads, nothing validated
require('dotenv').config();
const port = Number(process.env.PORT || 3000);   // 'abc' -> NaN, silently
const dbUrl = process.env.DATABASE_URL;          // may be undefined

// after — same .env file, one schema, typed + validated at startup
const { loadEnv } = require('env-saaf');
const env = loadEnv({
  PORT: { type: 'port', default: 3000 },          // validated integer 0-65535, default 3000
  DATABASE_URL: { type: 'url', required: true },  // throws if missing or malformed
  DEBUG: { type: 'boolean', default: false },     // 'yes'/'on'/'1' -> true
});
// env.PORT is a number, env.DATABASE_URL a valid URL; a bad or missing value
// throws EnvSaafError listing *every* problem at once (or pass
// { throwOnError: false } to get { env, errors } instead).
```

### From `dotenv-safe` (the `.env.example` contract)

`dotenv-safe` fails at boot when `.env` is missing a key that `.env.example` declares. env-saaf keeps the same `.env.example` file and moves the contract check to where drift actually happens — CI — plus a schema check at boot.

| `dotenv-safe` | env-saaf |
| --- | --- |
| `require('dotenv-safe').config({ example: '.env.example' })` in code; boot crash on a missing key | keep `.env.example` unchanged; `npx env-saaf check` compares it with your code and your real `.env` (exit 1 on any `MISSING` / `EXTRA` / `UNUSED` / `INVALID` finding) |
| no type validation — every value stays a string | `loadEnv(schema)` coerces and validates each value (`port`, `url`, `boolean`, …) at boot |
| `allowEmptyValues: false` option | `sensitive: true` masks the value in errors/output and leaves its `.env.example` placeholder empty; empty *optional* values stay allowed |

```js
// before — dotenv-safe
require('dotenv-safe').config({ example: '.env.example', allowEmptyValues: false });
const port = process.env.PORT; // still a string

// after — same .env.example, checked in CI and validated at boot
// (CI)   npx env-saaf check .          -> exit 1 listing every drift finding
// (boot) const { loadEnv } = require('env-saaf');
//        const env = loadEnv({ PORT: { type: 'port', required: true } });
//        env.PORT // number, already validated
```

### From `envalid` (validator mapping)

The common validators map one-to-one onto env-saaf rule types:

| envalid | env-saaf rule | difference that matters |
| --- | --- | --- |
| `str()` | `{ type: 'string' }` | trimmed by default (`trim: false` to keep whitespace); `pattern` / `minLength` / `maxLength` available |
| `str({ default: 'dev' })` | `{ type: 'string', default: 'dev' }` | defaults are validated like provided values |
| `str({ choices: ['dev', 'prod'] })` | `{ choices: ['dev', 'prod'] }` | `choices` matches the *coerced* value (works for numbers/booleans too) |
| `num()` | `{ type: 'number' }` | `min` / `max` bound the parsed number |
| `port()` | `{ type: 'port' }` | integer 0–65535, parsed to a number |
| `bool()` | `{ type: 'boolean' }` | accepts `true/false`, `yes/no`, `on/off`, `1/0`, `y/n` |
| `url()` | `{ type: 'url' }` | `protocols: ['https']` allowlists schemes |
| `email()` | `{ type: 'email' }` | — |
| `json()` | `{ type: 'json' }` | parsed to a real JS value, not a string |

Both libraries aggregate all errors in one pass; env-saaf throws an `EnvSaafError` whose `.errors` lists every problem (or returns `{ env, errors }` with `throwOnError: false`).

```js
// before — envalid
const { cleanEnv, str, port, bool, url } = require('envalid');
const env = cleanEnv(process.env, {
  API_URL: url(),
  PORT: port({ default: 3000 }),
  DEBUG: bool({ default: false }),
});

// after — env-saaf (same .env, same behaviour, zero-dependency, plus .env parsing + scan/check CLI)
const { loadEnv } = require('env-saaf');
const env = loadEnv({
  API_URL: { type: 'url', required: true },
  PORT: { type: 'port', default: 3000 },
  DEBUG: { type: 'boolean', default: false },
});
```

## Versions

- **v0.1.0** — core `validateEnv`: types (string/number/boolean/url/port), required, defaults, choices, all-errors-at-once.
- **v0.2.0** — `.env` file parsing, code scanning (used vs documented diff), CLI (`check` / `scan`).
- **v1.0.0** — secret masking, `.env.example` generation from schema and from code scan, TypeScript definitions, stable API.
- **v1.1.0** — CLI `--help` exits 0, boolean `on`/`off`/`y`/`n`, `scanCode` finds `let`/`var` destructuring, inline comments stripped in `parseEnvFile`, `.mts`/`.cts` files scanned.
- **v1.2.0** — `email` type and `pattern` option, CLI `--json` output, per-key `transform`, `${VAR}` interpolation, multi-file `loadEnv`, multiline quoted values, CLI `--no-color`, `int` type with `min`/`max`, README recipes.
- **v1.5.0** — `duration` and `host` types, `date` and `file` types, non-throwing mode, `${VAR:-default}` interpolation, CLI `--schema` validation, duplicate-key and bare-line errors in `.env` files, `scan`/`check`/`example` directory validation, Express example, README types reference table.
- **v1.4.0** — `ipv4`, `semver` and `base64` types, CLI `check` compares real `.env` keys, CLI `--version`, `example --write`, `scan` UNUSED warnings, `check` exits 1 on every finding, `scanCode` ignores comments/strings, defaults validated like provided values, `--help` after a subcommand, escaped quotes in `parseEnvFile`, `port` accepts 0, GitHub Actions workflow docs.
- **v1.3.0** — `json`, `uuid` and `hex` types, `minLength`/`maxLength` and `hex` `length` options, `trim: false`, `loadEnv` return-type inference, safer `.env.example` generation for secret keys, `assign: true` JSON fix.
- **v1.6.0** — `bigint` and `ipv6` types, grouped (nested) schemas, `array` type with per-item coercion, `requiredIf`/`aliases`/`conflictsWith`/`deprecated` rule options, `loadEnvAsync`, `toJsonSchema` export, CLI `init` and `print` commands, `check --fix`, real-secret detection in `check`, single-file `scan`/`check`, property-based fuzz tests — the biggest release yet, with many outside contributions.
- **v1.7.0** — `jwt` type for JSON Web Token shape validation, stricter schemas (non-array `choices` and `length` off `hex` rejected up front), layered `loadEnv` interpolation across files, `scanCode` alias destructuring, masked non-string secrets, safe-integer rejection for `int`/`number`, secret masking in `print`, and the empty-project `scan --json` test fix.

## Contributing

Issues and pull requests are welcome — including tiny ones. Start with the issues labelled [`good first issue`](https://github.com/abhi478jeetur-rgb/env-saaf/labels/good%20first%20issue), and please read [CONTRIBUTING.md](CONTRIBUTING.md) first: it explains the zero-dependency rule and how to run the tests.

## Contributors

env-saaf exists thanks to everyone who has contributed code, fixes and ideas. **23 people** outside the maintainer have landed merged pull requests so far:

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
- [@jamesyshd19-cmyk](https://github.com/jamesyshd19-cmyk) — `init` uses the custom schema path
- [@abhinavrastogi2627](https://github.com/abhinavrastogi2627) — ambiguous aliases are rejected
- `DeviousCardi` — grouped schemas, CLI watch mode, migration guide and more (nine PRs)
- [@ghosh-shrestha](https://github.com/ghosh-shrestha) — unknown rule options are rejected
- [@echuq](https://github.com/echuq) — radix-prefixed numbers and invalid env-file keys are rejected
- [@sharkohark1234](https://github.com/sharkohark1234) — `toJsonSchema` handles grouped schemas; `check --json-schema`
- [@saadBinMumtaz](https://github.com/saadBinMumtaz) — `init --from-example --groups`

This wall grows on its own as new pull requests land:

<a href="https://github.com/abhi478jeetur-rgb/env-saaf/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=abhi478jeetur-rgb/env-saaf" alt="env-saaf contributors" />
</a>

New guides live in the [project wiki](https://github.com/abhi478jeetur-rgb/env-saaf/wiki) — start with the CLI guide and the types reference there.

## License

MIT © Abhijeet Kumar
