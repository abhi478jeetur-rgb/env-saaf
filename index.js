'use strict';
/**
 * env-saaf — zero-dependency env validator.
 * v0.2.0 adds: parseEnvFile, scanCode (process.env usage in code),
 * diffEnv (used vs documented), and a CLI (bin: env-saaf).
 * v0.1.0 core: validateEnv with typed coercion.
 */
const fs = require('node:fs');
const path = require('node:path');

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
    case 'string': return String(v);
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
    default: throw new Error(`${key}: unknown type "${type}"`);
  }
}

function validateEnv(schema, env = process.env) {
  const out = {}; const errors = [];
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

/** Parse .env text -> { KEY: value }. Handles quotes, `export `, comments. */
function parseEnvFile(text) {
  const out = {};
  for (const line of String(text).split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const m = t.replace(/^export\s+/, '').match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let val = m[2].trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    out[m[1]] = val;
  }
  return out;
}

/** Find every process.env.KEY usage in JS/TS source text. Returns sorted unique names. */
function scanCode(text) {
  const found = new Set();
  const patterns = [
    /process\.env\.([A-Za-z_][A-Za-z0-9_]*)/g,
    /process\.env\[['"]([A-Za-z_][A-Za-z0-9_]*)['"]\]/g,
  ];
  for (const re of patterns) for (const m of String(text).matchAll(re)) found.add(m[1]);
  const destructure = /const\s*\{([^}]+)\}\s*=\s*process\.env/g;
  for (const m of String(text).matchAll(destructure)) {
    for (const part of m[1].split(',')) {
      const name = part.split(':')[0].split('=')[0].trim();
      if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) found.add(name);
    }
  }
  return [...found].sort();
}

/** Scan a folder (recursive, .js/.cjs/.mjs/.ts) for env usage. */
function scanDir(dir) {
  const found = new Set();
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name.startsWith('.git')) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(js|cjs|mjs|ts|tsx|jsx)$/.test(e.name)) scanCode(fs.readFileSync(p, 'utf8')).forEach(k => found.add(k));
    }
  };
  walk(dir);
  return [...found].sort();
}

/** Compare code usage vs a documented set (e.g. keys of .env.example). */
function diffEnv(usedKeys, documentedKeys) {
  const doc = new Set(documentedKeys);
  const used = new Set(usedKeys);
  return {
    usedNotDocumented: usedKeys.filter(k => !doc.has(k)),
    documentedNotUsed: documentedKeys.filter(k => !used.has(k)),
  };
}

/** Mask a secret for safe logging: "sk_live_123456" -> "sk***56". Short values are fully masked. */
function maskValue(v) {
  const s = String(v);
  if (s.length <= 4) return '****';
  return s.slice(0, 2) + '***' + s.slice(-2);
}

/** Return a copy of an env object with every value masked — safe to print/log. */
function maskSecrets(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) out[k] = maskValue(v);
  return out;
}

/** Generate .env.example text from a schema. Values are placeholders/defaults only — never real secrets. */
function generateExample(schema) {
  const lines = ['# Generated by env-saaf — put real values in .env (never commit .env)'];
  for (const [key, rule] of Object.entries(schema)) {
    lines.push(`# type: ${rule.type || 'string'}${rule.required ? ', required' : ''}${rule.choices ? ', one of: ' + rule.choices.join('|') : ''}`);
    const placeholder = rule.default !== undefined ? rule.default : (rule.type === 'port' ? 3000 : rule.type === 'url' ? 'https://example.com' : 'your_value_here');
    lines.push(`${key}=${placeholder}`);
  }
  return lines.join('\n') + '\n';
}

module.exports = { validateEnv, EnvSaafError, parseEnvFile, scanCode, scanDir, diffEnv, maskValue, maskSecrets, generateExample };
