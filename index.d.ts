export type EnvType = 'string' | 'number' | 'boolean' | 'url' | 'port';

export interface EnvRule {
  type?: EnvType;
  required?: boolean;
  default?: string | number | boolean;
  choices?: Array<string | number | boolean>;
}

export type EnvSchema = Record<string, EnvRule>;

export class EnvSaafError extends Error {
  errors: string[];
}

export function validateEnv<S extends EnvSchema>(schema: S, env?: Record<string, string | undefined>): Record<string, string | number | boolean>;

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
