# Changelog

## 0.1.0
- Core `validateEnv(schema, env)` with typed coercion: string, number, boolean, url, port
- `required`, `default`, `choices`
- All errors collected and reported together via `EnvSaafError`
- Frozen result object, zero dependencies
