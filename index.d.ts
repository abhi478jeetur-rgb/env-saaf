export type EnvType = 'string' | 'number' | 'int' | 'boolean' | 'url' | 'port' | 'email' | 'json' | 'uuid' | 'hex' | 'ipv4' | 'semver' | 'base64' | 'date' | 'file' | 'duration' | 'host';

export interface EnvRule {
  type?: EnvType;
  required?: boolean;
  /** A default may be an already-parsed object or array for `type: 'json'`, or a `Date` for `type: 'date'`. */
  default?: string | number | boolean | Date | Record<string, unknown> | unknown[] | null;
  choices?: Array<string | number | boolean>;
  /**
   * Allowed range for numeric values (`number`, `int`, `port`, `duration`).
   * `min` alone or `max` alone both work; out-of-range values are
   * rejected with an error naming the allowed range.
   */
  min?: number;
  /** See `min`. */
  max?: number;
  /**
   * Allowed length for string values (`string`, `email`, `url`, `file`, `uuid`, `hex`,
   * `ipv4`, `semver`, `base64`, `host`).
   * `minLength` alone or `maxLength` alone both work; a too-short or
   * too-long value is rejected with an error naming the allowed length.
   * Checked after coercion, before `pattern`.
   */
  minLength?: number;
  /** See `minLength`. */
  maxLength?: number;
  /**
   * Exact length in characters for `hex` values (e.g. a 64-character
   * hash). A wrong-length value is rejected with an error naming the
   * expected length. Ignored for other types.
   */
  length?: number;
  /**
   * Allowed schemes for `url` values (e.g. `['https']`). A value whose
   * scheme is outside the list is rejected with an error naming the
   * allowed schemes. Matching is case-insensitive, and entries may be
   * written with or without a trailing colon. Ignored for other types.
   */
  protocols?: string[];
  /**
   * A regular expression a string value must match (e.g. a slug, or a
   * prefixed key like `sk_...`). Checked after coercion and `choices`,
   * before `transform`; a mismatch error names the pattern.
   */
  pattern?: RegExp;
  /**
   * Custom step applied after coercion and the `choices` check; its return
   * value is what lands in the result (e.g. split a comma list into an
   * array). Runs only on values actually provided, not on `default`s.
   */
  transform?: (value: any) => any;
  /**
   * Whether to trim surrounding whitespace before validation (default
   * true). Set `trim: false` for values where the whitespace is part of
   * the value (e.g. a password with a significant trailing space).
   * Only affects string-like types; numbers and booleans are unaffected.
   */
  trim?: boolean;
  /**
   * Always mask this key's value in validation errors and CLI output, even
   * when its name does not look like a secret (e.g. `SESSION_ID`, `LICENSE_KEY`).
   * Also leaves its placeholder empty in `generateExample`. Default is false.
   */
  sensitive?: boolean;
}

export type EnvSchema = Record<string, EnvRule>;

/**
 * The value type of a rule, from the schema's `type` field:
 * 'number' / 'int' / 'port' / 'duration' -> number, 'boolean' -> boolean,
 * 'json' -> unknown (parsed JSON can be any shape), 'date' -> Date,
 * everything else (string / url / file / email / uuid / hex / ipv4 / semver / base64
 * / host / no type given) -> string.
 * A rule with a `transform` returns the transform's return type instead.
 */
export type EnvValue<R extends EnvRule> =
  R extends { transform: (value: any) => infer T } ? T :
  R extends { type: 'number' } ? number :
  R extends { type: 'int' } ? number :
  R extends { type: 'port' } ? number :
  R extends { type: 'duration' } ? number :
  R extends { type: 'boolean' } ? boolean :
  R extends { type: 'json' } ? unknown :
  R extends { type: 'date' } ? Date :
  string;

/**
 * The return type of `validateEnv` — inferred from the schema.
 * A key with `required: true` or a `default` is always present;
 * the other keys are optional (`| undefined`), because validateEnv
 * omits missing keys from the result entirely.
 * Pass the schema inline to validateEnv(...) (or use `as const`)
 * so TypeScript can see the literal types.
 * If the schema already has a loose type (such as `EnvSchema`), the
 * result falls back to `Record<string, string | number | boolean>`.
 */
export type EnvResult<S extends EnvSchema> = string extends keyof S
  ? Record<string, string | number | boolean>
  : {
      [K in keyof S as S[K] extends { required: true } ? K : S[K] extends { default: unknown } ? K : never]: EnvValue<S[K]>;
    } & {
      [K in keyof S as S[K] extends { required: true } ? never : S[K] extends { default: unknown } ? never : K]?: EnvValue<S[K]> | undefined;
    };

export class EnvSaafError extends Error {
  errors: string[];
}

export interface ValidateOptions {
  /** Report variables that are set but not in the schema (default false). */
  strict?: boolean;
  /**
   * Throw an `EnvSaafError` when a value fails validation (default true).
   * Pass `false` to get `{ env, errors }` back instead of an exception
   * (issue #55). A malformed schema still throws: that is a bug in the code,
   * not a problem in the environment.
   */
  throwOnError?: boolean;
}

/** The result of `validateEnv(..., { throwOnError: false })`. */
export interface ValidateResult<S extends EnvSchema> {
  /** Every value that validated — the same object the throwing API returns. */
  env: EnvResult<S>;
  /** The same messages `EnvSaafError.errors` would carry, in the same order. */
  errors: string[];
}

export function validateEnv<S extends EnvSchema>(schema: S, env: Record<string, string | undefined> | undefined, options: ValidateOptions & { throwOnError: false }): ValidateResult<S>;
export function validateEnv<S extends EnvSchema>(schema: S, env?: Record<string, string | undefined>, options?: ValidateOptions): EnvResult<S>;

export interface LoadEnvOptions {
  /** One file, or several files in order (later files win). */
  path?: string | string[];
  /** Alias for passing several files at once. */
  paths?: string[];
  env?: Record<string, string | undefined>;
  override?: boolean;
  assign?: boolean;
  /** Passed through to validateEnv (e.g. strict: true). */
  strict?: boolean;
}

export function loadEnv<S extends EnvSchema>(schema: S, options?: LoadEnvOptions): EnvResult<S>;
export function parseEnvFile(text: string): Record<string, string>;
export function scanCode(text: string): string[];
export function scanDir(dir: string): string[];
export function diffEnv(usedKeys: string[], documentedKeys: string[]): { usedNotDocumented: string[]; documentedNotUsed: string[] };
export function maskValue(value: unknown): string;
export function maskSecrets<T extends Record<string, unknown>>(obj: T): Record<keyof T, string>;
export function generateExample(schema: EnvSchema): string;
