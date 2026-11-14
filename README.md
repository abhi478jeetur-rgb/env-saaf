# env-saaf

Zero-dependency environment variable validator for Node.js. Fail fast at startup with clear errors, and get **typed** values back.

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

### Strict mode — catch typos in variable names

By default `validateEnv` only looks at keys in the schema. With `{ strict: true }` it also flags variables that are set but not in the schema — so a typo like `DATABSE_URL` next to the real `DATABASE_URL` no longer slips through:

```js
const env = validateEnv(schema, process.env, { strict: true });
// throws EnvSaafError listing e.g. "DATABSE_URL: set but not in schema (strict mode)"
```

Default stays off — many apps share one environment with other tools.

### Loading a real `.env` file

One call does it — read the file, parse it, validate it:

```js
const { loadEnv } = require('env-saaf');

const env = loadEnv({
  PORT:    { type: 'port', required: true },
  API_URL: { type: 'url', required: true },
}); // reads `.env` by default
```

Options: `{ path: '.env.local' }` to read another file, `{ override: true }` to let the file win over `process.env` (by default existing `process.env` values win), `{ assign: true }` to write the validated values back into `process.env` as strings. A missing file throws a clear error unless every variable is optional. By default `process.env` is never mutated.

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

### TypeScript: return type schema se infer hota hai

`validateEnv` ka return type ab schema se banta hai — `type: 'port'` wali key `number` hoti hai, `boolean` wali `boolean`, aur `required`/`default` ke bina wali key `| undefined`:

```ts
import { validateEnv } from 'env-saaf';

const env = validateEnv({
  PORT:  { type: 'port', required: true },
  DEBUG: { type: 'boolean' },
});

env.PORT.toFixed(0); // OK — PORT: number
env.DEBUG;           // boolean | undefined
env.TYPO;            // TypeScript error — schema me nahi hai
```

Schema seedha `validateEnv(...)` ko inline pass karo (ya `as const` use karo), taaki TypeScript literal types dekh sake. `EnvResult<S>` aur `EnvValue<R>` types alag se bhi export hote hain.

### Keep `.env.example` honest (CLI)

```bash
npx env-saaf scan ./src     # every env var your code actually uses
npx env-saaf check .        # code vs .env.example diff — exit 1 if undocumented vars exist (CI-ready)
npx env-saaf example ./src  # draft a .env.example from a code scan
```

### Log config without leaking secrets

```js
const { maskSecrets } = require('env-saaf');
console.log(maskSecrets(process.env)); // values masked: sk***56
```

## Versions

- **v0.1.0** — core `validateEnv`: types (string/number/boolean/url/port), required, defaults, choices, all-errors-at-once.
- **v0.2.0** — `.env` file parsing, code scanning (used vs documented diff), CLI (`check` / `scan`).
- **v1.0.0** — secret masking, `.env.example` generation from schema and from code scan, TypeScript definitions, stable API.

## Contributing

Issues and pull requests are welcome — including tiny ones. Start with the issues labelled [`good first issue`](https://github.com/abhi478jeetur-rgb/env-saaf/labels/good%20first%20issue), and please read [CONTRIBUTING.md](CONTRIBUTING.md) first: it explains the zero-dependency rule, how to run the tests, and why releases here batch 10–15 improvements before a version bump.

## License

MIT © Abhijeet Kumar
