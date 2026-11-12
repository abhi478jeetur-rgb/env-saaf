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

## License

MIT © Abhijeet Kumar
