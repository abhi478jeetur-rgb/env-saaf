# Changelog

## Unreleased

- Fixed: `print` no longer shows the password of a URL that embeds credentials (`postgres://user:pass@host/db` prints as `postgres://user:***@host/db`), in text and `--json` output, for `url` and `array`-of-URL values; other values and `--reveal` are unchanged (fixes #505).

- Fixed: `scanCode` now reports keys destructured from `process.env` in function parameter defaults, including renames and defaults (fixes #459).

- Fixed: `generateExample` now uses usable allowed URL schemes for scalar `url` rules and `array` URL items, preferring HTTPS when allowed and otherwise using the first usable scheme; invalid or empty allowlists fall back to HTTPS (fixes #454).

- Added: `init --from-example` now infers `url` for any absolute sample with an explicit `scheme://` authority (`postgres://`, `redis://`, `wss://`, …), not just `http(s)`. Values without `://` — plain hosts, `host:port`, and ordinary words — keep their previous inference (fixes #470).
- Added: `toJsonSchema` now emits JSON Schema's boolean `deprecated: true` keyword for rules with `deprecated: true` or a message string, so schema consumers can surface retirement hints. `deprecated: false` and rules without the option stay unchanged (fixes #464).
- Fixed: `check --values <file>` now reports the values file's undocumented keys with the same `EXTRA in <file>: KEY (not in .env.example)` finding the real `.env` gets, listing them in `envExtra` under `--json` and failing the check (exit 1); keys documented in the schema count as documented. Invalid values and missing keys in the values file behave exactly as before, so a typo'd deployment key (`PORTT` for `PORT`) can no longer pass the gate silently (fixes #494).
- Fixed: the `validateEnv` range error for a `date` rule no longer cuts a `Date` bound to its UTC day. A bound that is not a UTC midnight (`new Date('2026-06-01T12:30:00Z')`, or a local midnight east of Greenwich) is shown as its full instant, so the message no longer names a day the rejected value is on or the day before the bound, and an expanded year stays whole (`+010000-01-01`). It is written the same way as the `$comment` of `toJsonSchema`; string bounds and UTC-midnight `Date` bounds show as before (fixes #497).
- Fixed: `toJsonSchema` no longer drops the `min` / `max` of a `date` rule: they travel as a `$comment` next to the date formats (`env-saaf bounds (inclusive, enforced by validateEnv only): min …, max …`), as the rule wrote them and only when present. It is an annotation, not validation: JSON Schema has no keyword for comparing dates, and Ajv's default strict mode accepts `$comment` where a custom `x-` keyword would fail to compile. A date-time bound without an offset is left out. Rules without bounds and other types are unchanged (fixes #482).
- Docs: refreshed the sitemap `lastmod` dates on both landing pages (GitHub Pages and Vercel) to the v1.7.0 release date.

## 1.7.0 — 2026-11-27

- Added: `jwt` type for JSON Web Tokens — validates the token shape (exactly three base64url segments, `header.payload.signature`, with the header and payload decoding to JSON objects) and returns the value unchanged. This is a shape check only: the signature is never verified, so a well-formed token from any issuer passes and a truncated or mangled token fails at boot instead of later as a confusing `401` from the API. It joins the string types, so `minLength` / `maxLength` / `pattern` / `sensitive` work as for `uuid`; `generateExample` emits a valid example token, `toJsonSchema` renders `{ type: 'string', pattern: ... }` for the three-segment shape, the TypeScript union gains `'jwt'`, and the README (English and all four translations) gains a type-table row and a section (fixes #471).

- Fixed: `validateSchema` now rejects a non-array `choices` (`'abc'`, `42`, `{}`, `null`) with the same `"choices" must be a non-empty array` schema error as an empty list, so a string can no longer degrade to substring matching and a number can no longer crash with a raw TypeError; `generateExample` also no longer crashes on a non-array `choices` (fixes #450).
- Fixed: the hex-only `length` option is now rejected up front on every other type (`"length" only applies to type 'hex'`), like `protocols` off `url` — it was silently ignored there, so dead configuration could look like it did something. `hex` rules with `length` behave exactly as before (fixes #453).
- Fixed: the empty-project `scan --json` test now expects the `locations` field (#335) the CLI already emits, so `npm test` passes on `main` again.

- Fixed: with several files, `loadEnv` and `loadEnvAsync` now resolve `${VAR}` references against the whole layered stack instead of each file alone, so `URL=https://${HOST}/api` in `.env.local` sees `HOST` from `.env` (the later file's value wins, then `process.env`). A `${VAR:?message}` reference that another file satisfies no longer throws, and each value keeps the quote style, line and file of the file that wins it. `parseEnvFile` and single-file loading are unchanged (fixes #449).
- Fixed: `scanCode` now reports source keys when destructuring from a `process.env` alias, including renames and defaults (fixes #456).

- Fixed: `maskValue` and `maskSecrets` mask number, boolean and bigint values instead of returning them in clear, so a secret coerced to a number (a numeric PIN or password) no longer reaches logs unmasked. Numbers and bigints use the string rule (`123456` → `'12***56'`), booleans always become `'****'`, and `null`, `undefined`, symbols, functions and non-plain objects still pass through unchanged. `maskValue` and `Masked<T>` now type those leaves as `string`. This reverses the #281 choice to leave non-string values unmasked (fixes #448).
- Fixed: `scanCode` now follows `process.env` reads through locals assigned from bare `process`, including member, bracket, optional-chain and destructured reads (fixes #481).

- Fixed: `int` values and plain integer text for `number` now reject magnitudes above `Number.MAX_SAFE_INTEGER` with guidance to use `bigint`, preventing silent rounding. Safe boundaries remain inclusive, and decimal/exponent spellings for `number` keep their floating-point behaviour. Generated examples use exponent notation for large numeric `number` defaults, choices and bounds so they still validate (fixes #460).

- Fixed: `print` now masks secret-named keys (e.g. `PASSWORD`, `API_TOKEN`) in text and `--json` output, not just `sensitive: true` rules — including grouped keys, judged by their full flat name; added `--reveal` to `print` as the explicit opt-in to unmasked output for local debugging (never in CI logs) (fixes #447, #474).
- Fixed: `loadEnv` and `loadEnvAsync` assign date values as ISO text without extra quotes (fixes #458).
- Fixed: whitespace-only environment values now count as unset for required checks, defaults and optional keys; trimmed values are shown in validation errors, while `trim: false` preserves whitespace (fixes #439).

## 1.6.0 — 2026-11-26

- Fixed: malformed schema rules and non-object schema or env inputs now throw `EnvSaafError`. Rule errors name the affected key, including group prefixes (fixes #440).

- Added: `bigint` type for exact integers beyond `Number.MAX_SAFE_INTEGER` (order IDs, snowflake IDs, wei amounts). It accepts plain integer literals with an optional sign (`9007199254740993`, `-3`, `007`, `1_000`) and returns a real `bigint`; decimals, exponents and radix prefixes are rejected. `min`/`max` take a bigint, an integer, or an integer string and are inclusive; `choices` compare as bigints and `array` rules accept `of: 'bigint'`. JSON Schema has no bigint, so `toJsonSchema` renders `{ type: 'string', pattern: '^-?[0-9]+$' }`, and `generateExample` emits a value above the safe-integer range (fixes #417).

- Added: `check` flags values in `.env.example` (or `--file`) that look like real secrets, including known credential shapes (`sk-...`, `AKIA...`, URLs with non-empty passwords, hex tokens) and long high-entropy strings. It exits `1`, names the key, redacts the value from output, and adds the key to `secrets` in `--json` while keeping empty values, common placeholders and `generateExample` outputs valid (fixes #416).

- Docs: list the shared conflictsWith and description options in the four translated READMEs.

- Added: `scan` and `check` accept a single readable code file argument (`env-saaf scan src/server.js`, `env-saaf check src/server.js`), applying the same code-extension filter and comment/literal masking without scanning sibling files, and preserving the given file path in `scan --json` `locations` (fixes #418).

- Fixed: `scanCode` (and `scanCodeLocations`) now follows destructured `process.env` aliases such as `const { env } = process` and `const { env: myEnv } = process`, while ignoring other destructured `process` bindings like `argv` (fixes #425).

- Added: seeded property-based tests for `validateEnv` (`test-validate-fuzz.js`,
  part of `npm test`) covering all 18 scalar types and `array`, checking
  coercion idempotence, `.env.example` round-trips, inclusive `min`/`max`
  bounds, key-named diagnostics and `{ throwOnError: false }` parity, and
  `sensitive` raw-value masking (fixes #419).

- Fixed: duration arrays accept human duration strings or numeric milliseconds for `min` / `max` and enforce the bounds on each item. Generated examples respect the bounds, and JSON Schema exports them on `items` (fixes #427).

- Fixed: `duration` choices accept human duration strings such as `15m`, comparing them as milliseconds alongside numeric choices. Array items and JSON Schema enums use the same normalization, without modifying the supplied schema (fixes #426).

- Fixed: `int` and `number` values now accept underscore separators (`1_000`, `1_000.5`), matching JavaScript numeric literals — a single underscore between digits only; leading, trailing or doubled underscores are still rejected with the usual messages (fixes #412).

- Fixed: `generateExample` formats bounded `duration` values as human durations (`2h`, `1h30m`, `45s`) instead of raw milliseconds, so the generated example reads like the unbounded `15m` and still validates against its own schema (fixes #414).

- Fixed: `host` accepts and preserves a single trailing DNS root dot on a hostname, while still rejecting leading dots and empty labels (fixes #413).

- Added: `options.rules` on `validateEnv`, `loadEnv`, and `loadEnvAsync` for
  schema-level cross-field validation hooks. Accepts a function or array of
  functions receiving the frozen coerced result object and returning an error
  string, an array of error strings, or nothing; runs only when earlier checks
  produced a complete error-free snapshot and aggregates errors into
  `EnvSaafError`, `details`, and `{ throwOnError: false }` results (fixes #346).

- Added: the CLI reads defaults from an `env-saaf` key in the project's
  `package.json` (`schema`, `file` and `dir`), so `check` / `scan` / `print` /
  `example` / `init` no longer repeat the same flags; explicit flags always
  win, unknown config keys are a usage error, and projects without the key
  behave as before (fixes #354).
- Docs: the landing page now lists the `print` and `init` commands and the
  `--schema` / `--values` options on `check`.
- Added: with `--schema`, `check` also diffs the schema against
  `.env.example` in both directions — `NOT DOCUMENTED` for schema keys missing
  from the example and `NOT IN SCHEMA` for example keys the schema does not
  declare (flattened group names), in text and as `schemaNotDocumented` /
  `documentedNotInSchema` in `--json` (fixes #358).
- Added: an `ipv6` type. It accepts what `net.isIP` reports as IPv6 (compressed
  forms, IPv4-mapped addresses, `fe80::1%eth0`), joins the string-valued types
  for `minLength`/`maxLength`/`pattern`, emits `format: 'ipv6'` from
  `toJsonSchema` and a valid `::1` example (fixes #342).
- Added: `skipEmpty: true` on `array` rules drops accidental empty items
  (`a,b,`, `a,,b`) instead of failing, with `minItems`/`maxItems` and `unique`
  applying to what remains. The default and its error message are unchanged
  (fixes #348).
- Fixed: `scanDir` follows a directory reached through a symbolic link (once
  per real path), so a package linked into a workspace is scanned; a symlink
  cycle can no longer hang the walk (fixes #339).
- Added: `.env` interpolation support in `parseEnvFile` (and `loadEnv` /
  `loadEnvAsync`) for POSIX `${VAR:?message}` / `${VAR?message}` required-value
  checks and `${VAR:+alt}` / `${VAR+alt}` alternate expansions, including nested
  references, escape and quote preservation, and key/line/file error provenance
  (fixes #347).

- Added: `conflictsWith` rule option (a key name or list of key names) to
  reject mutually exclusive variables when both are set after aliases and
  defaults resolve, including across grouped schemas. Checks are symmetric for
  one-sided declarations, de-duplicated when reciprocal, value-free in
  diagnostics, and validated up front against self-references and undeclared
  keys in `validateSchema` (fixes #345).

- Added: `deprecated` rules warn when a variable is set and annotate generated examples with an optional migration hint (fixes #344).

- Added: `loadEnv` / `loadEnvAsync` validation errors name the winning `.env`
  file a bad value came from (`PORT (from .env.local): ...`) and set
  `error.details[].source` to that path. Ambient-winning and `validateEnv`-only
  messages stay unchanged; sensitive masking is preserved (fixes #350).

- Fixed: `check --schema` reports when a missing `.env` skips value validation, including `envFileFound: false` in JSON output (fixes #338).

- Added: an optional `description` string on any rule. It is validated, leads
  the generated `.env.example` comment and becomes the JSON Schema property
  `description`; it never affects validation (fixes #343).

- Added: runnable `examples/fastify/` and `examples/nextjs/` projects, matching
  the Express example's layout, so the Fastify and Next.js recipes are exercised
  instead of living only as README snippets. Both fail with the env-saaf message
  when a required value is missing (fixes #364).

- Added: `check --schema <file> --values <env-file>` validates another
  environment file (`.env.production`, `.env.staging`) and reports its
  `INVALID` entries, with the file named in `--json` (`valuesFile`). A missing
  values file or `--values` without `--schema` is a usage error (exit 2)
  (fixes #352).
- Added: repeatable `--exclude <pattern>` on `scan` and `check`, backed by
  `scanDir(dir, { exclude })`. A bare name excludes that directory anywhere and
  a path supports `*` and `**`, so vendored or generated code no longer adds
  keys to the scan (fixes #355).
- Added: `init --from-example` infers `uuid`, `date`, `duration`, `semver`,
  `json` and `hex` from unambiguous sample values, each confirmed with the real
  validator, so the generated starter schema needs less hand-editing
  (fixes #356). Existing inferences are unchanged.
- Added: `env-saaf print [dir] --schema <file> [--file name] [--json]` prints
  the effective configuration the schema produces — coerced values and applied
  defaults — with `sensitive` rules masked, and exits 1 with the usual
  validation errors when the config is invalid (fixes #353).
- Added: a near-miss hint on a missing required key and on a strict-mode extra
  when a set key is the same name ignoring case or one edit away (a `PROT` /
  `PORT` swap), e.g. `PORT: missing required variable (did you mean PROT? it is
  set but not in the schema)`. Only key names are suggested (fixes #349).
- Added: `scan --json` includes a `locations` map from each variable to `{ file, line }` uses (relative paths, 1-based lines), driven by `scanCodeLocations` / `scanDirLocations`; plain output and `vars` / `unused` stay unchanged (fixes #335).

- Added: `toJsonSchema` emits a `pattern` for `base64` rules, so a consumer
  validating against the exported schema accepts exactly the standard,
  unpadded and URL-safe forms the runtime accepts and rejects a mixed alphabet
  or bad padding (fixes #351).

- Fixed: `validateSchema` rejects `required: true` together with a `default` (the default means the key can never be missing, so `required` was dead config). The `init` starter schema no longer sets both on `PORT` (fixes #340).

- Added: an `exports` map exposing `.` (`types`, `import`, `require`) and
  `./package.json`, so only the public entry resolves; deep imports such as
  `env-saaf/cli.js` now fail with `ERR_PACKAGE_PATH_NOT_EXPORTED`. `main` and
  `types` stay for older resolvers (fixes #357).

- Fixed: duration bound errors name the duration and show milliseconds for numeric bounds, while preserving explicit units in string bounds (fixes #341).

- Added: CLI `scan --stdin` reads source code from standard input through `scanCode`, supporting `--json` output, standard empty-scan handling, and exit code 2 when combined with a directory argument (fixes #359).

- Docs: document CLI exit codes and JSON results for `check`, `scan`, `example` and `init` (fixes #360).

- Fixed: `scanDir` skips `dist`, `build`, `coverage`, `.next`, `out` and `target` (and `node_modules`/`.git*` as before), so a stale build output no longer makes an unused key look used (fixes #334).

- Docs: added "How validation works" to the README, with the exact order of operations inside `validateEnv` and the three order-dependent behaviours users trip on (fixes #365).

- Added: a packaging smoke test (`test-pack.js`, part of `npm test`) packs the
  package, installs the tarball into CommonJS and ESM scratch projects, checks
  the public exports, runs the installed bin and type-checks a consumer
  (fixes #368).

- Fixed: the published `index.d.ts` now compiles for a consumer without
  `skipLibCheck`; `EnvResult` passed a group member to `EnvValue`, whose
  constraint only allows a rule.

- Added: seeded generative tests for `scanCode` (`test-scan-fuzz.js`, part of
  `npm test`): 300 snippets built from real reads (dot, bracket, template,
  optional chaining, destructuring, `import.meta.env`, reads inside a
  template's `${}`) and decoys (comments, strings, template text, regex
  literals), asserting every planted key is reported, no decoy is, and the
  output is sorted and de-duplicated (fixes #366).

- Fixed: `parseEnvFile` now expands `\n` and `\r` escape sequences in double-quoted values (dotenv parity), so a PEM key written as `"-----BEGIN-----\n..."` loads with real newlines; `\\` stays a single backslash and single-quoted values are unchanged (fixes #333).

- Added: duration rules accept human duration strings for inclusive `min` / `max` bounds, including compound durations. Invalid or reversed bounds fail schema validation; numeric bounds keep their existing behavior. Generated examples and JSON Schema use the parsed bounds (fixes #322).

- Added: generateExample annotates string and RegExp patterns without changing generated values (fixes #293).

- Added: `EnvSaafError.details` and the `{ throwOnError: false }` result expose structured `{ key, message }` entries mirroring `errors` one-to-one, including grouped keys; printable `errors` strings and `message` formatting are unchanged (fixes #294).

- Added: tests validate complete `toJsonSchema` documents against the draft 2020-12 keyword shapes with a hand-rolled, zero-dependency checker, covering all types, groups, choices, defaults, bounds, arrays and `requiredIf` (fixes #296).

- Added: `toJsonSchema` expresses `requiredIf` on canonical values with `if` / `then`, including conditions across groups (fixes #289).

- Added: groups can contain nested groups, with concatenated env prefixes and nested results at each level. Validation, example generation, JSON Schema export, and file loading support the same structure; circular references and composed-prefix collisions are rejected (fixes #287).

- Fixed: CLI `--schema` loading in `check`, `check --json-schema`, `check --watch`, and `example` now supports ES module schemas (`.mjs` and `"type": "module"` `.js`), unwrapping a sole plain-object `default` export while preserving CommonJS schemas (including keys named `default`), named exports, and module load errors (fixes #285).

- Added: `date` rules accept `min` / `max` bounds as ISO date (or datetime) strings — or `Date` objects — compared chronologically against the parsed value, inclusive on both ends; a numeric bound or a `min` above `max` is a schema error, and `generateExample` uses the bound when the default example falls outside the range (fixes #292).

- Fixed: a throwing `formatError` hook no longer vanishes behind the default message — its error now propagates out of `validateEnv` / `loadEnv` / `loadEnvAsync` unchanged, so a bug in the hook is visible instead of silent; a hook returning a non-string still falls back to the default message (fixes #279).
- Fixed: code scanning recognizes dotted and dashed env keys in quoted bracket reads and destructuring, including optional and Vite reads (fixes #321).

- Fixed: grouped result objects are frozen along with the top-level result in `validateEnv`, `loadEnv`, and `loadEnvAsync`, while rule values keep their existing mutability (fixes #284).

- Added: `toJsonSchema` emits the `semver` validation `pattern` on scalar `semver` rules and `array` rules with `of: 'semver'` (fixes #303).

- Added: toJsonSchema marks sensitive rules as writeOnly, including inside groups (fixes #288).

- Fixed: generateExample uses the first allowed choice instead of a generic placeholder, preserving explicit defaults and empty secret placeholders (fixes #273).
- Fixed: `validateSchema` now rejects `choices` entries that can never match the declared type (for example `['1', '2']` on an `int` rule, `['true']` on a `boolean` rule, or any `choices` on a `date` rule) instead of accepting the schema and failing every value at runtime; string-typed rules and non-finite numbers, which `toJsonSchema` drops from `enum`, are unaffected (fixes #305).

- Fixed: `choices` on `array` rules now apply to each coerced item instead of the whole array, with errors naming the offending item and its index; `validateSchema` applies the #305 item-type check against `of`, `toJsonSchema` emits `items.enum`, and `generateExample` builds placeholders from allowed choices while respecting `minItems`/`maxItems` (fixes #320).

- Fixed: maskValue masks only strings; maskSecrets preserves non-string leaves while copying plain objects and arrays. TypeScript return types now retain those leaf types (fixes #281).

- Fixed: `int` (and `port`, which builds on it) now only accepts plain integer literals — optional sign + digits — so decimal and scientific spellings such as `1.0`, `1e3` and `1.5e2` are rejected even when they happen to be whole numbers, instead of silently passing (fixes #277). `number` still accepts them.

- Added: `unique: true` on `array` rules rejects repeated items, compared after item coercion (so `'1,01'` for `of: 'int'` counts as a duplicate), with an error naming the key and the duplicated item; it applies to `default` values too, is rejected up front on non-`array` rules, and `toJsonSchema` renders it as `uniqueItems: true` (fixes #291).

- Added: warn when requiredIf references an undeclared full env name, including inside groups, while preserving external env flag behavior. validateEnv and loadEnv use the existing onWarn hook (fixes #295).

- Fixed: reject repeated units in compound durations, including case variants such as `1h1H`, instead of silently adding them together (fixes #280).

- Fixed: the CLI now rejects unknown flags, flags a command does not support, and `--file` / `--schema` without a value — exit 2 with a clear message — instead of silently ignoring them (fixes #278).

- Fixed: validateEnv no longer stringifies non-string env values — `null` counts as "not set" and objects/arrays on scalar rules fail with an error naming the key, instead of becoming `"null"`, `"[object Object]"` or `""` (fixes #276).

- Fixed: validateSchema now rejects `of` / `separator` on non-`array` rules and `protocols` on rules that are neither `url` nor `array`, instead of silently ignoring dead config (fixes #282).

- Added: `env-saaf init --from-example --groups` folds keys sharing a common prefix into a grouped schema when the prefix is at least two characters and at least two keys share it (fixes #263).
- Added: `check --json-schema` prints the `--schema` file as a draft 2020-12 JSON Schema document instead of running the check (fixes #268).

- Fixed: `toJsonSchema(schema)` renders grouped schemas as nested object schemas (with their own `properties` and `required`) instead of `{"type": "string"}` (fixes #262).

- Added: `loadEnvAsync(schema, options)` reads .env files asynchronously with the same options and behavior as `loadEnv` (fixes #233).

- Added: `toJsonSchema(schema)` exports a draft 2020-12 JSON Schema for coerced configuration values (fixes #229).

- Added: `pattern` accepts regular expression source strings as well as `RegExp`. Invalid sources report a schema error naming the key, and JSON Schema export preserves string sources verbatim (fixes #286).

- Added: opt-in `formatError(errors, { keys })` option for `validateEnv` and `loadEnv`: the returned string becomes the thrown `EnvSaafError`'s `message` while `error.errors` keeps the raw per-key strings; the hook sees only a read-only copy of the errors and the schema keys, falls back to the default message if it throws or returns a non-string, and is not called with `throwOnError: false` (fixes #231).

- Changed: The `base64` type accepts standard and URL-safe strings with or without padding and preserves the input encoding (fixes #226).

- Added: `scanCode` detects static property reads through simple local environment aliases (fixes #252).

- Fixed: `parseEnvFile` reports a line-numbered `SyntaxError` for invalid assignment keys instead of silently dropping them, without exposing their values (fixes #221).

- Added: `parseEnvFile` accepts dots and dashes after the first character of `.env` keys, so `loadEnv` and `init --from-example` can use names like `DB.PORT` and `MY-KEY`. Interpolation syntax is unchanged (fixes #290).

- Fixed: `number`, `int` and `port` reject hexadecimal, binary and octal strings (including array items), while decimal strings and numeric defaults keep working (fixes #219).

- Added: grouped (nested) schemas — a rule with a `schema` object and a `prefix` (and no `type`) reads inner rules from prefixed env vars (`DB_` + `HOST` -> `DB_HOST`) and nests the result (`{ DB: { HOST, ... } }`); errors name the full env var; `strict`/`aliases`/`requiredIf`/`default`/`transform` work inside groups (aliases and requiredIf keys use full env names there); `generateExample` emits the flat prefixed keys with a group comment; `loadEnv` assign writes flat names; `validateSchema` is now exported and rejects malformed groups up front (bad prefix/schema shape, `type` on a group, nested groups, prefix collisions) (fixes #228).
- Added: the `semver` type accepts one optional lowercase `v` prefix (`v1.2.3`, `v1.2.3-rc.1`, `v1.2.3+build`), returned unchanged — the form `git describe` and release pipelines emit; `v1.2`, `vv1.2.3` and uppercase `V1.2.3` are still rejected (fixes #227).
- Fixed: `validateSchema` now rejects contradictory bounds up front — `min` above `max`, `minLength` above `maxLength`, and an empty `choices` array — with a schema error naming the key, even when the variable is absent (fixes #220).
- Fixed: `validateSchema` now rejects unknown schema rule options, such as misspelled `required` or `default`, with an `EnvSaafError` identifying the schema key and offending option, even when the corresponding environment variable is absent (fixes #218).
- Added: `env-saaf init --from-example[=file]` infers a starter schema from an existing example file (default `.env.example`) instead of the fixed template — each key's sample value picks the rule type (port-looking number in 1024-65535 -> `port`, `true`/`false` -> `boolean`, http(s) URL -> `url`, email -> `email`, other integers -> `int`, decimals -> `number`, else `string`, empty -> `string`), every inferred rule is commented as inferred (sample values are never copied into the schema), code-scanned keys the example lacks are folded in as `string` rules, and the example file itself is left untouched; only the schema file is written, still requiring `--force` to overwrite (fixes #232).

- Added: `test-cli.js`, a CLI integration suite wired into `npm test`, that runs `cli.js` as a real subprocess in throwaway temp projects and asserts process-level behaviour — exit codes, stdout vs stderr, `--json` shape, `check`/`scan`/`example --write`/`init` round-trips in CommonJS and `"type": "module"` projects, missing-directory errors — with a scrubbed child environment so developer env vars cannot leak in (fixes #237).
- Added: `scanDir` (and therefore the CLI `scan`/`check`/`example`) also scans single-file components — `.vue`, `.svelte` and `.astro` files — alongside the existing `.js/.cjs/.mjs/.ts/.mts/.cts/.tsx/.jsx` list; `node_modules` and `.git*` skips are unchanged and the comment/string masking in `scanCode` keeps template markup from producing false positives (fixes #235).
- Fixed: `generateExample` now builds the placeholder for `type: 'array'` from the rule's `of` item type instead of always suggesting `a,b,c` — `of: 'int'` suggests `1,2,3`, `of: 'port'` suggests `3000,8080,5432`, etc., so every suggested item itself validates against the rule and the generated `.env.example` passes `check` out of the box; the default `of: 'string'` is unchanged (`a,b,c`), a custom `separator` joins the typed items, an explicit `default` still wins, secret-looking keys still get an empty placeholder, and the comment above an array key now names its item type (`# type: array, items: int`) (fixes #223).
- Added: `--watch` flag for the CLI `check` and `scan` commands — runs once, then re-runs with a ~150 ms debounce whenever the scanned source tree, the env template file (`.env.example`/`--file`) or the `--schema` file changes; each re-run's result is printed with a timestamp and Ctrl-C exits cleanly with code 0. Without `--watch`, output and exit codes are unchanged (fixes #230).
- Fixed: `scanCode` (and therefore `scanDir` and the CLI `scan`/`check`/`example` commands) now reports optional-chained reads — `process.env?.KEY`, `process.env?.['KEY']`, ``process.env?.[`KEY`]`` and the `import.meta.env?.…` equivalents — alongside the plain dot/bracket/destructuring forms, in the same sorted unique list, with the same rule that mentions inside comments and string literals do not count (fixes #222).
- Docs: new "Migrating to env-saaf" README section with concrete, runnable before/after paths from `dotenv`, `dotenv-safe` and `envalid` (validator mapping table included), linked from the comparison section; `test.js` now executes the after-snippets so the guide cannot drift from the current API (fixes #236).
- Added: `maskSecrets` now recurses into nested plain objects and arrays — the returned structure mirrors the input shape and every scalar leaf is masked with the existing `maskValue` rules, so parsed configs and request contexts log safely (`{ DB: { PASSWORD: 'hunter2' } }` → `{ DB: { PASSWORD: 'hu***r2' } }`). Non-plain values (`Date`, class instances) remain leaves via `maskValue`, a repeated reference (e.g. a cycle) is replaced with the fixed placeholder `'[Circular]'` instead of hanging, flat input is byte-for-byte unchanged, the input is never mutated, and the TypeScript return type mirrors the shape recursively via the new exported `Masked<T>` type (fixes #234).

- Added: `scanCode` (and therefore `scanDir` and the CLI `scan`/`check`/`example` commands) detects Vite-style `import.meta.env` reads — dot access (`import.meta.env.VITE_API_KEY`), bracket access and destructuring — returned in the same sorted list as `process.env` reads, with the same rule that mentions inside comments and string literals do not count (fixes #225).

- Added: the `duration` type accepts compound durations — a sequence of number+unit parts is summed into milliseconds, so `1h30m` and `1h 30m` are 5,400,000 ms and `2d12h` is 216,000,000 ms; every part needs an explicit unit (a trailing bare number like `1h30` is rejected), single values and bare numbers behave as before, and the error example now shows `1h30m` (fixes #224).

- Fixed: `validateEnv` now verifies that a `transform` return value matches the rule's declared `type` (primitives, `Date`, `array` and its `of` items, `json`, and string-formatted types), failing with a validation error naming the key and expected type instead of letting wrong types pass through; custom `validate` still sees the pre-transform value and `default` values continue to be type-checked via coercion (fixes #210).

- Fixed: `validateSchema` now rejects `pattern`, `minLength`, and `maxLength` up front when used on non-string types (`number`, `int`, `port`, `duration`, `boolean`, `date`, `array`, `json`), throwing a schema error naming the key and option even when the variable is absent; string-valued types (`string`, `email`, `url`, `file`, `uuid`, `hex`, `ipv4`, `semver`, `base64`, `host`) and numeric `min`/`max` bounds keep working unchanged (fixes #211).

- Added: `generateExample` now annotates `aliases` and `requiredIf` in `.env.example` comments — an aliased key notes its deprecated fallback names (`also accepts DATABASE_URL (deprecated)`), and a conditionally required key notes its condition (`required when MODE is 'production'`, or `is one of ...` for the `in` form); keys without these options keep the existing format, and `sensitive: true` placeholders stay empty. `example --schema <file>` generates the same annotated file from a schema via the CLI (fixes #206).

- Added: `minItems` / `maxItems` rule options for the `array` type — bound the number of items (both non-negative integers, `minItems` must not exceed `maxItems`); a violation reports the key with the count and the bound (e.g. `TAGS: expected at least 2 items, got 1`), the bounds apply to `default` values too, and malformed values or use on a non-`array` rule are rejected up front (fixes #207).

- Fixed: reject aliases that collide with declared schema keys or are shared by different rules before validating environment values, including with `throwOnError: false` (fixes #205).

- Fixed: `validateSchema` now rejects a rule that sets both `required: true` and `requiredIf`, and a `requiredIf` that names its own key — both are contradictory combinations that used to be silently accepted (`required` winning, the self-reference never firing) (fixes #204).
- Added: `requiredIf` rule option (`{ key, equals }` or `{ key, in: [...] }`) — makes a variable conditionally required in a second pass after all keys are coerced and defaults are applied, so schema key order does not matter; missing keys when the condition holds produce the usual `missing required variable` error, while false conditions or absent referenced keys leave the variable optional, and malformed `requiredIf` specs are rejected up front in schema validation (fixes #51).
- Added: `array` type — splits a delimited string on `separator` (default `','`) and coerces each item with `of` (default `'string'`; any built-in scalar type, plus `protocols` when `of: 'url'`). Empty items are rejected rather than silently dropped, invalid items report their 0-based index and value (masked when `sensitive: true`), malformed `of`/`separator` options are rejected up front, array defaults and TypeScript element-type inference are supported, and `generateExample` suggests a delimited placeholder (fixes #46).
- Added: `aliases` rule option — accept deprecated variable names (e.g. `aliases: ['OLD_NAME']`) as fallbacks when the canonical key is unset, running normal coercion, validation, and `transform` under the canonical key while emitting a deprecation warning via `options.onWarn` (default `console.warn`); when both are set, the canonical key wins and a warning notes the ignored alias, and declared aliases are accepted in `{ strict: true }` mode (fixes #53).
- Docs: add a comparison section in README contrasting `env-saaf` with `envalid`, `joi`, and `zod` across scope, runtime dependencies, `.env`/CLI tooling, error aggregation, TypeScript inference, and when another library is a better fit (fixes #68).
- Docs: document that `validateEnv` treats an empty string (`''`) as unset — omitting optional keys, failing required keys as missing, and falling back to `default` — matching `${VAR:-fallback}` interpolation, with tests pinning the behaviour (fixes #186).
- Added: per-key `validate(value, env)` rule option — runs after type coercion and built-in checks (including on `default` values), before `transform`; return `true` (or `undefined`/`null`) to pass, `false` for a generic error, or a non-empty string error message to fail. Throwing validators are collected as validation failures naming the key instead of crashing, non-function `validate` options are rejected up front, and `sensitive: true` masks values in custom validation errors (fixes #52).
- Added: CLI `init` scans the directory first (the same scan `check`/`example` use) and folds keys the code already reads into the starter schema as `{ type: 'string' }` entries under a comment noting they came from the scan — the generated `.env.example` covers them too, so the first `check` after `init` reports no `MISSING in .env.example` lines to merge by hand. The discovered keys are also listed on init's output; keys the scaffold already declares are not duplicated, and a directory with no code yet scaffolds exactly as before (fixes #171).
- Docs: add Fastify and Next.js startup validation examples to README, explaining boot-order placement and calling out `NEXT_PUBLIC_` variables as out of scope for secrets (fixes #65).
- Added: `sensitive: true` rule option — always masks the key's value in validation errors (`validateEnv`, `loadEnv`, CLI `check --schema`) even when the variable name does not look like a secret (e.g. `SESSION_ID`, `LICENSE_KEY`), and leaves its placeholder empty in `generateExample`; non-boolean `sensitive` values are rejected up front, and non-sensitive keys behave unchanged (fixes #54).
- Added: `check --json` exposes the documented-but-unused keys as an `unused` field, the same name `scan --json` already uses for them; the existing `extra` field keeps its identical value, so current consumers of the old shape are unaffected (fixes #187).
- Added: every built-in type's validation error message now includes an example of the expected format (e.g. `expected a valid URL (e.g. https://example.com), got "..."` and `expected a port (0-65535, e.g. 3000), got "..."`), keeping aggregated errors one concise bullet per key (fixes #58)
- Fixed: `init` in a `"type": "module"` project no longer crashes with a raw stack trace — the starter schema is written as `env.schema.cjs` instead of `env.schema.js`, and an explicit `--schema` file Node would treat as an ES module is refused up front with a clear error before anything is written; `check --schema` names the same fix when a schema fails to load as an ES module (fixes #184).
- Fixed: `parseEnvFile` interpolation uses a self-reference's default — `A=${A:-fallback}` now resolves to `fallback` (`:-` and `-` behave the same), because a key's own value is not set while its own line is being resolved, exactly as for a genuinely absent name; a self-reference without an operator (`A=${A}`) and genuine cycles (`A=${B}`, `B=${A}`) stay literal as before (fixes #185).
- Fixed: the first `check` after `init` no longer fails on one UNUSED line per scaffolded key — when no code reads any variable yet, the check passes with a single note saying the scaffold is ahead of the code; once code reads at least one variable, unused keys fail the run exactly as before, and any MISSING, EXTRA or INVALID finding still fails (fixes #170, fixes #178).
- Fixed: Reject non-finite values and overflowing exponent literals in numeric configuration (fixes #175).
- Docs: add a runnable Docker and Docker Compose startup validation example explaining `ENV`, `--env-file`, and Compose `environment:` (fixes #66).
- Added: the `duration` type accepts `w` for weeks (`1w` = 7 days = 604,800,000 ms); like the other units it is case-insensitive and takes decimals (`1.5w`), and the error message now lists `1w` among the examples (fixes #176)
- Fixed: the starter schema generated by `init --schema <file>` shows a validation command that uses the chosen schema path (fixes #169).
- Added: `protocols` option for the `url` type — allowlist the schemes a value may use (e.g. `['https']` rejects `ftp://...` with an error naming the allowed schemes); matching is case-insensitive, with or without a trailing colon, and without the option any valid URL passes as before. A malformed `protocols` value is rejected up front, naming the key (fixes #50)
- Fixed: CLI `check`/`scan` no longer print a doubled `env-saaf:` prefix when the template (or real `.env`) fails to parse — the duplicate-key error already carries the prefix, and the CLI added it again, in text and `--json` output alike (fixes #160)
- Added: CLI `init` command scaffolds a starter `env.schema.js` — commented examples of the main types (string, int, boolean, port, url, email, duration, host) — and generates a matching `.env.example` from it with `generateExample`, refusing to overwrite either file unless `--force` is passed; `--schema <file>` names the schema file (fixes #60)
- Fixed: `maskValue` returns an empty string unchanged instead of `'****'`, so an empty value no longer looks set in logs; `maskSecrets` keeps empty values the same way (fixes #159)
- Fixed: `loadEnv` reports `env-saaf: cannot read .env file at <path>: <reason>` when a file exists but cannot be read — a directory passed as `path` (or as an entry of `paths`) no longer leaks a raw `EISDIR`, and a permission-denied file no longer leaks `EACCES`; missing-file behaviour is unchanged (fixes #157)
- Fixed: `loadEnv` throws `env-saaf: .env file not found: <path>` when an explicitly passed single `path` does not exist, instead of silently returning an empty result — a typo'd path no longer boots the app with defaults; the implicit default `.env` and list forms (`paths: [...]` or `path` as an array) keep skipping missing files (fixes #158)
- Fixed: `generateExample` now suggests a placeholder that itself validates for every scalar type — `email` suggests `user@example.com`, `uuid` a canonical UUID, `number` `3.14`, `int` `42`, `boolean` `true`, `json` `{"key":"value"}`, `base64` `aGVsbG8=`, `hex` `deadbeef` — instead of the literal `your_value_here`, so a generated `.env.example` passes `check` out of the box; the already-correct placeholders (`port`, `url`, `date`, `duration`, `host`, `semver`, `ipv4`) are unchanged, and `file` stays the documented exception (`./config.json` is a path the user must create) (fixes #251)
- Fixed: `validateEnv` and `loadEnv` (and `loadEnvAsync`) now reject unknown options up front with an `EnvSaafError` naming the offending option — a typo like `{ stric: true }` or `{ overide: true }` no longer runs silently as if the option was never passed (same class of bug as #218, one layer up); the check runs even when the variable is absent and even with `{ throwOnError: false }`, and all currently valid options keep working exactly as before (fixes #250)

- Fixed: `generateExample` adjusts numeric placeholders to `min`/`max`, respecting integer, port and duration constraints, so generated values round-trip through their own schema (fixes #274).
- Fixed: `generateExample` adjusts built-in string placeholders to feasible `minLength`/`maxLength` bounds without losing their type's format (fixes #275).

- Added: `check --fix` appends keys the code uses but `.env.example` (or `--file`) does not document yet, using the schema placeholder when `--schema` is given and an empty value otherwise; it never removes or overwrites a key and never touches the real `.env`. The fixed keys are reported as `fixed` in `--json` output, and the check passes once they are added (fixes #428).

## 1.5.0 — 2026-11-20

- Added: `host` type — validates a hostname or an IPv4/IPv6 address (`db.internal`, `localhost`, `10.0.0.5`, `::1`) and rejects values with a scheme, path or port; `minLength`/`maxLength`/`pattern` work on it, and `generateExample` suggests `localhost` (fixes #44)

- Added: `duration` type — parses human durations (`500ms`, `30s`, `15m`, `2h`, `1d`) into milliseconds; a bare number is already milliseconds, decimals and case-insensitive units are accepted, and unknown units and negatives are rejected. `min`/`max` work on the millisecond result, and `generateExample` suggests `15m` (fixes #41)

- Added: `file` validates that a path points to a readable regular file and returns the path string (fixes #57).

- Docs: add a README types reference table covering inputs, outputs and rule options (fixes #135).
- Added: `validateEnv(..., { throwOnError: false })` — a non-throwing mode that returns `{ env, errors }` instead of throwing, where `env` carries every value that validated and `errors` is the same list `EnvSaafError` would carry (empty when the environment is clean). The default stays fail-fast, a malformed schema still throws, and `loadEnv` keeps throwing because it can write into the real environment with `assign: true` (fixes #55)
- Fixed: bare `.env` lines now report the line number. CLI `check` and `scan` report the file and line, including in `--json` output (fixes #145).
- Fixed: `parseEnvFile` and `loadEnv` reject duplicate keys with first and repeated line numbers, without including values (fixes #144).
- Fixed: CLI `scan` reports no process.env usage on stderr with empty stdout and exit 0; JSON and non-empty scans are unchanged (fixes #146).

- Added: `date` type — parses an ISO 8601 date (`2026-01-31`) or datetime (`2026-01-31T10:00:00Z`, with optional seconds, fractional seconds and a `Z` or `±HH:MM` offset) into a JavaScript `Date`; impossible dates such as `2026-02-31` are rejected instead of rolling over to the next month, and a `Date` given as a `default` passes through. `generateExample` suggests `2026-01-31` for it (fixes #40)
- Added: `parseEnvFile` supports `${VAR:-default}` for unset or empty values and `${VAR-default}` for unset values (fixes #136).
- Fixed: CLI `example --write` refuses when the scan finds no `process.env` usage — it prints a warning on stderr and exits 1 instead of writing a header-only `.env.example` (a mistyped directory no longer produces a useless file). Plain `example` (stdout) is unchanged (fixes #116)
- Added: CLI `check --schema <file>` validates the values of the real `.env` file against the schema the file exports (`module.exports = { PORT: { type: 'port', required: true } }`); failures are reported as `INVALID: <key>: ...`, appear in the existing `invalid` field in `--json` output, and make the exit code 1 like a missing key. The flag is opt-in (presence-only checks are unchanged without it); an explicit `--file` names the file to validate, and with no `.env` file the schema step is skipped instead of flagging the template's placeholders (fixes #90)
- Fixed: the `scan`, `check` and `example` commands now validate the directory argument up front — a missing path reports `env-saaf: <path> does not exist` and a file reports `env-saaf: <path> is not a directory`, both exiting 2 with no raw Node stack trace (in `--json` mode the error is a field on stdout). Normal runs on a real directory are unchanged (fixes #133)
- Fixed: `validateEnv` now rejects an invalid schema up front, so a typo like `type: 'emial'` (or a non-RegExp `pattern`, non-function `transform`, and non-numeric `min`/`max`/length options) throws an error naming the key even when the variable is absent — previously an absent optional key skipped coercion and the typo passed silently (fixes #134)

- Docs: add a runnable Express example that validates configuration before startup (fixes #64).

## 1.4.0 — 2026-11-19

- Added: `ipv4`, `semver` and `base64` types — dotted-quad addresses (each octet 0–255, no leading zeroes), semantic versions (`MAJOR.MINOR.PATCH`, optional pre-release/build suffixes, no leading `v`) and standard base64 strings; all three return the value unchanged, and `minLength`/`maxLength` work on them. `generateExample` suggests `192.168.0.1` for `ipv4` and `1.0.0` for `semver` (fixes #38, fixes #39, fixes #43)
- Docs: README gains a copy-pasteable GitHub Actions workflow that runs `npx env-saaf check .`, with the optional `.env`-from-secrets step and a note that real secrets come from Actions secrets, never from the repo (fixes #67)
- Added: CLI `scan` now also reports the reverse drift: keys declared in `.env.example` (or the `--file` template) that no code reads. They are listed as `UNUSED: KEY (in .env.example, never used in code)` warnings on stderr, and as an `unused` array in `--json` output; the list of used variables on stdout, `ok` and the exit code (still 0) are unchanged, and without a template file the output is exactly as before (fixes #63)

- Fixed: `env-saaf check` with no template file now names the fix instead of stopping at "not found" — the message points at `env-saaf example`, and `--json` carries the same hint in a `hint` field so stdout stays parseable and stderr stays empty; exit code is still 2 (fixes #89)

- Fixed: `scanCode` (and so `scan`, `check` and `example`) reads code, not the text inside comments, strings and template literals — a `process.env.FOO` named only in a doc comment or a test string no longer counts as a usage, while reads inside a template's `${...}`, bracket access and destructuring still do (fixes #115)

- Fixed: `validateEnv` now runs a `default` through the same coercion and checks (type, `min`/`max`, `choices`, `pattern`, length) as a provided value, so a bad default such as `{ type: 'port', default: 99999 }` throws an error naming the key; a supplied value still overrides the default, and `transform` still runs only on provided values (fixes #114)
- Added: CLI `check` now compares the keys in a real `.env` with the template when the file is present, reporting typo'd keys (`EXTRA in .env`) and unset template keys (`MISSING in .env`); `--json` output gains `envExtra` and `envMissing` fields (fixes #100)
- Added: CLI `--version` / `-v` prints the installed version from `package.json` and exits 0, before or after a subcommand (fixes #98)
- Added: `env-saaf example --write[=<file>]` writes the draft straight to `.env.example` (or the file named) instead of printing it, with a short confirmation; an existing file is only overwritten when `--force` is also passed (fixes #102)
- Fixed: CLI now recognises `--help` / `-h` after a subcommand (e.g. `env-saaf scan --help`), printing usage and exiting 0 instead of treating the flag as a directory (fixes #97)
- Fixed: `parseEnvFile` no longer ends a quoted value at an escaped quote — `B='it\'s'` parses to `it's` and `D="it\"s"` to `it"s`; other backslashes (e.g. `C:\path`) stay literal (fixes #117)
- Fixed: `port` accepts 0 so a server can ask the operating system for an available port (fixes #101).
- Fixed: `env-saaf check` exits 1 on every finding it prints, including `EXTRA in .env` / `MISSING in .env` (they used to print and still exit 0), and `--json` `ok` now matches the exit code; `UNUSED` counts as a finding too (fixes #113)

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
