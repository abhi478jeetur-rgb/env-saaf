# Changelog

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
