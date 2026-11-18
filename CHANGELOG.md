# Changelog

## Unreleased

- Added: CLI `check` now compares the keys in a real `.env` with the template when the file is present, reporting typo'd keys (`EXTRA in .env`) and unset template keys (`MISSING in .env`); `--json` output gains `envExtra` and `envMissing` fields (fixes #100)
- Added: CLI `--version` / `-v` prints the installed version from `package.json` and exits 0, before or after a subcommand (fixes #98)
- Added: `env-saaf example --write[=<file>]` writes the draft straight to `.env.example` (or the file named) instead of printing it, with a short confirmation; an existing file is only overwritten when `--force` is also passed (fixes #102)
- Fixed: `env-saaf example --write` now warns on stderr and exits 1 without writing a file when the scan finds no variables; plain `example` output is unchanged (fixes #116)
- Fixed: CLI now recognises `--help` / `-h` after a subcommand (e.g. `env-saaf scan --help`), printing usage and exiting 0 instead of treating the flag as a directory (fixes #97)
- Fixed: `parseEnvFile` no longer ends a quoted value at an escaped quote — `B='it\'s'` parses to `it's` and `D="it\"s"` to `it"s`; other backslashes (e.g. `C:\path`) stay literal (fixes #117)
- Fixed: `port` accepts 0 so a server can ask the operating system for an available port (fixes #101).

## 1.3.0 — 2026-11-18

- Added: `uuid` type — validates canonical UUIDs (8-4-4-4-12 hex groups, upper- and lowercase); malformed values are rejected with an error naming the key (fixes #37)
- Added: `hex` type — validates hexadecimal strings, with an optional `length` option for fixed-size values (e.g. hashes); wrong-length values are rejected with an error naming the expected length (fixes #42)
- Fixed: `loadEnv` with `assign: true` now JSON-stringifies object/array values (e.g. the `json` type) instead of writing `"[object Object]"`; strings, numbers, booleans and `null` keep their existing `String(value)` behaviour (fixes #88)
- Fixed: `loadEnv` infers return type from schema (`EnvResult<S>`) like `validateEnv` does, rather than returning a loose `Record<string, string | number | boolean>` (fixes #91)
- Fixed: `generateExample` leaves an empty placeholder for secret-looking keys (`API_KEY`, `DB_PASSWORD`, …) instead of `your_value_here` — an explicit `default` still wins (fixes #56)
- Added: `trim: false` option — keep leading/trailing whitespace for values where it is part of the value (e.g. a password with a significant space); trimming stays the default, and numbers/booleans are unaffected (fixes #84)
- Fixed: `loadEnv` rejects non-schema first arguments with a clear error showing the correct `loadEnv(schema, { path: '.env' })` call (fixes #83)
- Fixed: `parseEnvFile` now throws a clear error when passed a file path by mistake (e.g. `parseEnvFile('.env')`) instead of silently returning `{}`; the message points at `loadEnv(schema, { path: ... })`. Normal .env text still parses as before (fixes #82)
- Fixed: the `parseEnvFile` path guard no longer misfires on comment-only text — a lone `# ...` line that merely mentions a path parses to `{}`, as before
- Added: `json` type — parse JSON values from env strings (objects, arrays, primitives); invalid JSON is rejected with an error naming the key, and a `default` may be given as an already-parsed object (fixes #32)
- Added: `minLength`/`maxLength` options for string values — too-short or too-long values are rejected with an error naming the allowed length; either option works alone and they combine with `pattern` (fixes #48)

## 1.2.0 — 2026-11-16

- Added: `int` type — whole numbers only (`42` and `1e3` pass, `3.5` fails); plus `min`/`max` options for numeric values (`number`, `int`, `port`) — either alone or together, out-of-range values are rejected with an error naming the allowed range (fixes #45, fixes #47)
- Docs: add four `validateEnv` recipes for database settings, feature flags, optional analytics keys, and development/production schemas.

- Docs: landing page quick-start example now shows the new `email` type.
- Added: `email` type — pragmatic email validation (one `@`, non-empty local/domain, a dot in the domain); plus a `pattern` option for strings — a `RegExp` the value must match (e.g. slugs, prefixed keys like `sk_...`), with the mismatch error naming the pattern (fixes #23)
- Tests: CLI scanning now has regression coverage for TypeScript namespaces, enums, const assertions, destructuring, and bracket reads (fixes #70).
- Tests: cover generated `.env` inputs with deterministic quoting, escaping, whitespace, and malformed-line cases (fixes #69).
- Added: `parseEnvFile` now expands `${VAR}` references in double-quoted and unquoted values — the file's own values first, then `process.env`; nested references expand too, single-quoted values and `\${VAR}` escapes stay literal, unknown names expand to an empty string (fixes #22)
- Added: `loadEnv` accepts multiple files — `path` may be an array or use `paths: [...]`; files are read in order and later files override earlier ones, e.g. `['.env', '.env.local']` (fixes #25)
- Fixed: `parseEnvFile` no longer breaks on multiline quoted values (PEM keys, JSON blobs) — a quoted value now continues until its closing quote (fixes #30)
- Added: CLI `check` and `scan` accept `--json` for machine-readable output (`{ ok, missing, extra, invalid }` for check; `{ ok, vars }` for scan). Exit codes unchanged. Human-readable output remains the default.
- Added: per-key `transform` option — a custom function applied after coercion and the `choices` check (e.g. split a comma-separated list into an array, upper-case a value); a throwing transform is collected as a normal validation error naming the key, and the result type is inferred from the transform's return type (fixes #34)
- Fixed: `scanCode` now also finds `process.env[\`KEY\`]` template-literal access (plain identifiers only — interpolated names like `process.env[\`PREFIX_${X}\`]` stay unmatched, since they cannot be known statically) (fixes #33)
- Added: the CLI accepts `--no-color` before or after the command. Terminal and piped output stay plain (fixes #62).

## 1.1.0
- Fixed: CLI `--help` / `-h` now prints usage and exits 0 (previously exit code 2, like a real error); unknown commands still exit 2
- Fixed: boolean type now also accepts `on`/`off` and `y`/`n` (case-insensitive, like `true`/`false` and `yes`/`no`); the error message now lists all accepted spellings
- Fixed: `scanCode` now recognizes `let` and `var` destructuring of `process.env` (previously only `const` was matched)
- Fixed: `parseEnvFile` now strips inline comments after unquoted values (`PORT=3000 # my port` parses as `3000`); `#` inside quotes stays untouched, and a quoted value followed by a comment (`NAME="x" # note`) parses as `x`
- Fixed: `scanDir` now also scans `.mts` and `.cts` files (TypeScript ESM/CJS modules were silently skipped)
- Docs: README now shows how to load a real `.env` file (`parseEnvFile` + `validateEnv`) and includes an ES module import example
- Added: `loadEnv(schema, options?)` — read a `.env` file and validate it in one call (`path`, `override`, `assign` options; `process.env` untouched by default)
- Added: strict mode — `validateEnv(schema, env, { strict: true })` reports variables that are set but not in the schema (typos like `DATABSE_URL` no longer slip through)
- TypeScript: the return type of `validateEnv` is now inferred from the schema — `type: 'port'`/`'number'` → `number`, `'boolean'` → `boolean`; keys with `required` or `default` are always present, the rest are `| undefined`; accessing a key that is not in the schema is now a TypeScript error
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
