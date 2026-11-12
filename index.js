'use strict';
/**
 * env-saaf v0.1.0 — zero-dependency env validator.
 * Problem it solves (from research):
 *  - process.env values are ALWAYS strings: "false" is truthy, "3000" + 1 === "30001"
 *  - Missing vars crash in production, not at startup
 *  - Checking vars one-by-one is tedious; errors should be collected and shown together
 * API: validateEnv(schema, env?) -> typed object, throws EnvSaafError with ALL errors
 * Schema: { KEY: { type, required, default, choices } }
 * Types: string | number | boolean | url | port
 */

class EnvSaafError extends Error {
  constructor(errors) {
    super('Invalid environment variables:\n' + errors.map(e => `  - ${e}`).join('\n'));
    this.name = 'EnvSaafError';
    this.errors = errors;
  }
}

function coerce(key, raw, type) {
  const v = typeof raw === 'string' ? raw.trim() : raw;
  switch (type) {
    case 'string':
      return String(v);
    case 'number': {
      const n = Number(v);
      if (v === '' || Number.isNaN(n)) throw new Error(`${key}: expected a number, got "${raw}"`);
      return n;
    }
    case 'boolean': {
      if (typeof v === 'boolean') return v;
      const s = String(v).toLowerCase();
      if (['true', '1', 'yes'].includes(s)) return true;
      if (['false', '0', 'no'].includes(s)) return false;
      throw new Error(`${key}: expected a boolean (true/false), got "${raw}"`);
    }
    case 'url': {
      try { return new URL(String(v)).toString(); }
      catch { throw new Error(`${key}: expected a valid URL, got "${raw}"`); }
    }
    case 'port': {
      const n = Number(v);
      if (!Number.isInteger(n) || n < 1 || n > 65535) throw new Error(`${key}: expected a port (1-65535), got "${raw}"`);
      return n;
    }
    default:
      throw new Error(`${key}: unknown type "${type}"`);
  }
}

function validateEnv(schema, env = process.env) {
  const out = {};
  const errors = [];
  for (const [key, rule] of Object.entries(schema)) {
    const raw = env[key];
    if (raw === undefined || raw === '') {
      if (rule.default !== undefined) { out[key] = rule.default; continue; }
      if (rule.required) errors.push(`${key}: missing required variable`);
      continue;
    }
    try {
      const val = coerce(key, raw, rule.type || 'string');
      if (rule.choices && !rule.choices.includes(val)) {
        errors.push(`${key}: expected one of [${rule.choices.join(', ')}], got "${raw}"`);
        continue;
      }
      out[key] = val;
    } catch (e) { errors.push(e.message); }
  }
  if (errors.length) throw new EnvSaafError(errors);
  return Object.freeze(out);
}

module.exports = { validateEnv, EnvSaafError };
