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

### Loading a real `.env` file

By default `validateEnv` reads from `process.env`. To validate the values in an actual `.env` file instead, parse the file and pass it in:

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
