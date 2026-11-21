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

export { port, count, url, mode, debug, name, doubled, fixed, wrongType, typo, debugStrict, myPort, myDebug, looseValue, tenantId, apiHash, collectedPort, collectedDebug, collectedErrors, collectedAsEnv, throwingPort };
