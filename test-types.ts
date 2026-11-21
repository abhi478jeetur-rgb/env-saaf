// env-saaf type tests — sirf `tsc` se check hote hain (`npm test` me shamil).
// Runtime me kuch nahi chalta: ye file sirf TypeScript inference verify karti hai.
// Issue #7: validateEnv ka return type schema se infer hona chahiye.
import { validateEnv, EnvSchema, EnvResult } from './index';

const env = validateEnv({
  PORT: { type: 'port', required: true },
  COUNT: { type: 'number', required: true },
  DEBUG: { type: 'boolean' },
  API_URL: { type: 'url', required: true },
  CONFIG_FILE: { type: 'file', required: true },
  MODE: { type: 'string', default: 'dev' },
  NAME: { type: 'string' },
  TENANT_ID: { type: 'uuid', required: true },
  API_HASH: { type: 'hex', sensitive: true },
  TAGS: { type: 'array', required: true },
  PORTS: { type: 'array', of: 'port', separator: ';', required: true },
  ORIGINS: { type: 'array', of: 'url', protocols: ['https'] },
  FLAGS: { type: 'array', of: 'boolean', default: [true, false] },
});

// required keys: exact types
const port: number = env.PORT;
const count: number = env.COUNT;
const url: string = env.API_URL;
export const configFile: string = env.CONFIG_FILE;
const mode: string = env.MODE;
// uuid and hex values are strings
const tenantId: string = env.TENANT_ID;
const apiHash: string | undefined = env.API_HASH;
// array values infer their element type from `of` (default string[])
const tags: string[] = env.TAGS;
const ports: number[] = env.PORTS;
const origins: string[] | undefined = env.ORIGINS;
const flags: boolean[] = env.FLAGS;
// optional keys: value ya undefined
const debug: boolean | undefined = env.DEBUG;
const name: string | undefined = env.NAME;

// number methods chalne chahiye (issue #7 ka asli gap)
const doubled: number = env.PORT * 2;
const fixed: string = env.COUNT.toFixed(0);

// EnvResult seedha bhi use ho sakta hai
type MyEnv = EnvResult<{ PORT: { type: 'port'; required: true }; DEBUG: { type: 'boolean' } }>;
const myPort: number = null as unknown as MyEnv['PORT'];
const myDebug: boolean | undefined = null as unknown as MyEnv['DEBUG'];

// @ts-expect-error — PORT number hai, string nahi
const wrongType: string = env.PORT;
// @ts-expect-error — galat key: schema me nahi hai
const typo = env.TYPO_KEY;
// @ts-expect-error — optional key undefined ho sakti hai, seedha boolean nahi
const debugStrict: boolean = env.DEBUG;
// @ts-expect-error — PORTS is number[], not string[]
const wrongPorts: string[] = env.PORTS;

// loose schema (jaise EnvSchema type ka variable) par purana loose record milta hai
const looseSchema: EnvSchema = { PORT: { type: 'port', required: true } };
const loose = validateEnv(looseSchema);
const looseValue: string | number | boolean = loose.ANYTHING;

// Issue #55: non-throwing mode returns { env, errors } instead of throwing.
const collected = validateEnv(
  { PORT: { type: 'port', required: true }, DEBUG: { type: 'boolean' } },
  { PORT: '3000' },
  { throwOnError: false }
);
const collectedPort: number = collected.env.PORT;
const collectedDebug: boolean | undefined = collected.env.DEBUG;
const collectedErrors: string[] = collected.errors;
// @ts-expect-error — the non-throwing result is { env, errors }, not the env itself
const collectedAsEnv: number = collected.PORT;

// The default (throwing) return type is unchanged by the new option.
const throwingPort: number = validateEnv(
  { PORT: { type: 'port', required: true } },
  { PORT: '3000' },
  { strict: true }
).PORT;

// Issue #51: requiredIf — conditionally required keys remain optional in the inferred type.
const condEnv = validateEnv(
  {
    MODE: { type: 'string', default: 'development' },
    USE_TLS: { type: 'boolean', default: false },
    SENTRY_DSN: { type: 'url', requiredIf: { key: 'MODE', equals: 'production' } },
    ALERT_WEBHOOK: { type: 'url', requiredIf: { key: 'MODE', in: ['staging', 'production'] } },
    TLS_CERT: { type: 'string', requiredIf: { key: 'USE_TLS', equals: true } },
    FALLBACK_DSN: { type: 'url', default: 'https://example.com', requiredIf: { key: 'MODE', equals: 'production' } },
  },
  { MODE: 'development' }
);
const condSentry: string | undefined = condEnv.SENTRY_DSN;
const condAlert: string | undefined = condEnv.ALERT_WEBHOOK;
const condTls: string | undefined = condEnv.TLS_CERT;
const condFallback: string = condEnv.FALLBACK_DSN;
// @ts-expect-error — conditionally required key without default may be undefined
const condSentryStrict: string = condEnv.SENTRY_DSN;

validateEnv({
  // @ts-expect-error — requiredIf must specify either equals or in, not both
  BAD_BOTH: { type: 'string', requiredIf: { key: 'MODE', equals: 'prod', in: ['prod'] } },
});
validateEnv({
  // @ts-expect-error — requiredIf must specify equals or in
  BAD_NEITHER: { type: 'string', requiredIf: { key: 'MODE' } },
});
// Issue #53: aliases and onWarn keep exact return type inference on canonical keys.
const aliasedWarnings: string[] = [];
const aliased = validateEnv(
  {
    DATABASE_URL: { type: 'url', required: true, aliases: ['DB_URL'] },
    PORT: { type: 'port', aliases: ['APP_PORT'] },
  },
  { DB_URL: 'https://example.com' },
  { onWarn: (msg) => aliasedWarnings.push(msg) }
);
const aliasedUrl: string = aliased.DATABASE_URL;
const aliasedPort: number | undefined = aliased.PORT;
// @ts-expect-error — alias name is not a key on the validated result
const aliasKey = aliased.DB_URL;


// Issue #52: per-key `validate(value, env)` preserves inferred value types.
const validated = validateEnv(
  {
    APP_PORT: { type: 'port', required: true, validate: (v) => v >= 1024 || 'must be unprivileged' },
    REPLICA_HOST: { type: 'host', required: true, validate: (v, e) => v !== e.PRIMARY_HOST || 'must differ from PRIMARY_HOST' },
    FLAG: { type: 'boolean', default: false, validate: (v) => typeof v === 'boolean' },
    NOTES: { type: 'string', validate: () => { /* void return passes */ } },
  },
  { APP_PORT: '8080', REPLICA_HOST: 'replica.internal', PRIMARY_HOST: 'primary.internal' }
);
const validatedPort: number = validated.APP_PORT;
const validatedHost: string = validated.REPLICA_HOST;
const validatedFlag: boolean = validated.FLAG;
const validatedNotes: string | undefined = validated.NOTES;


export { port, count, url, mode, debug, name, doubled, fixed, wrongType, typo, debugStrict, myPort, myDebug, looseValue, tenantId, apiHash, collectedPort, collectedDebug, collectedErrors, collectedAsEnv, throwingPort, condSentry, condAlert, condTls, condFallback, condSentryStrict, validatedPort, validatedHost, validatedFlag, validatedNotes, wrongPorts, tags, ports, origins, flags, aliasedUrl, aliasedPort, aliasKey };
