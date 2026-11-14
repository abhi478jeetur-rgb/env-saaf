export type EnvType = 'string' | 'number' | 'boolean' | 'url' | 'port';

export interface EnvRule {
  type?: EnvType;
  required?: boolean;
  default?: string | number | boolean;
  choices?: Array<string | number | boolean>;
}

export type EnvSchema = Record<string, EnvRule>;

/**
 * Ek rule ka value type — schema ke `type` field se:
 * 'number' / 'port' -> number, 'boolean' -> boolean,
 * baaki (string / url / type nahi diya) -> string.
 */
export type EnvValue<R extends EnvRule> =
  R extends { type: 'number' } ? number :
  R extends { type: 'port' } ? number :
  R extends { type: 'boolean' } ? boolean :
  string;

/**
 * `validateEnv` ka return type — schema se infer hota hai.
 * `required: true` ya `default` wali key hamesha maujood hoti hai;
 * baaki keys optional hain (`| undefined`), kyunki validateEnv unhe
 * missing hone par result me daalta hi nahi.
 * Schema seedha validateEnv(...) ko inline pass karo (ya `as const`),
 * taaki TypeScript literal types dekh sake.
 * Agar schema pehle se loose type ka hai (jaise `EnvSchema`), to
 * purana loose `Record<string, string | number | boolean>` milta hai.
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
}

export function validateEnv<S extends EnvSchema>(schema: S, env?: Record<string, string | undefined>, options?: ValidateOptions): EnvResult<S>;

export interface LoadEnvOptions {
  path?: string;
  env?: Record<string, string | undefined>;
  override?: boolean;
  assign?: boolean;
  /** Passed through to validateEnv (e.g. strict: true). */
  strict?: boolean;
}

export function loadEnv<S extends EnvSchema>(schema: S, options?: LoadEnvOptions): Record<string, string | number | boolean>;
export function parseEnvFile(text: string): Record<string, string>;
export function scanCode(text: string): string[];
export function scanDir(dir: string): string[];
export function diffEnv(usedKeys: string[], documentedKeys: string[]): { usedNotDocumented: string[]; documentedNotUsed: string[] };
export function maskValue(value: unknown): string;
export function maskSecrets<T extends Record<string, unknown>>(obj: T): Record<keyof T, string>;
export function generateExample(schema: EnvSchema): string;
