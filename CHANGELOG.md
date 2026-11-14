# Changelog

## Unreleased

_Sudhaar yahan jama hote hain. Jab 10–15 sudhaar jama ho jayenge, tabhi agla version (1.1.0) npm par aayega — har chhote fix par version nahi badhta._

- Fixed: `scanDir` now also scans `.mts` and `.cts` files (TypeScript ESM/CJS modules were silently skipped)
- Docs: README now shows how to load a real `.env` file (`parseEnvFile` + `validateEnv`) and includes an ES module import example
- Added: `loadEnv(schema, options?)` — read a `.env` file and validate it in one call (`path`, `override`, `assign` options; `process.env` untouched by default)
- Added: strict mode — `validateEnv(schema, env, { strict: true })` reports variables that are set but not in the schema (typos like `DATABSE_URL` no longer slip through)
- TypeScript: `validateEnv` ka return type ab schema se infer hota hai — `type: 'port'`/`'number'` → `number`, `'boolean'` → `boolean`; `required`/`default` wali key hamesha maujood, baaki `| undefined`; galat key par ab TypeScript error aata hai
- Fixed: `url` values are returned exactly as provided — validation no longer normalizes them (a bare origin no longer gains a trailing slash)
- Added: CLI `check` accepts `--file <name>` to compare code usage against a file other than `.env.example` (e.g. `.env.sample`)

## 1.0.0
- `maskValue` / `maskSecrets` — log-safe masked copies of env values (real secrets never printed in full)
- `generateExample(schema)` — generate `.env.example` text from a schema (placeholders/defaults only)
- CLI: `env-saaf example [dir]` — draft a `.env.example` straight from a code scan
- TypeScript definitions (`index.d.ts`)
- Stable 1.0 API

## 0.2.0
- `parseEnvFile(text)` — parse .env content (quotes, `export `, comments)
- `scanCode(text)` / `scanDir(dir)` — find every `process.env` usage (dot, bracket, destructuring)
- `diffEnv(used, documented)` — used-but-not-documented and documented-but-never-used
- CLI: `env-saaf check [dir]` (CI-friendly exit codes) and `env-saaf scan [dir]`

## 0.1.0
- Core `validateEnv(schema, env)` with typed coercion: string, number, boolean, url, port
- `required`, `default`, `choices`
- All errors collected and reported together via `EnvSaafError`
- Frozen result object, zero dependencies
