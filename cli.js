#!/usr/bin/env node
'use strict';
/**
 * env-saaf CLI
 *   env-saaf check [dir]  — scan code for process.env usage, compare with .env.example
 *                           exit 1 if anything used is not documented
 *   env-saaf scan  [dir]  — just list the env vars your code uses
 */
const fs = require('node:fs');
const path = require('node:path');
const { scanDir, parseEnvFile, diffEnv } = require('./index');

const [cmd, dirArg] = process.argv.slice(2);
const dir = dirArg || process.cwd();

if (cmd === 'scan') {
  console.log(scanDir(dir).join('\n'));
} else if (cmd === 'check') {
  const examplePath = path.join(dir, '.env.example');
  if (!fs.existsSync(examplePath)) {
    console.error('env-saaf: .env.example not found in ' + dir);
    process.exit(2);
  }
  const documented = Object.keys(parseEnvFile(fs.readFileSync(examplePath, 'utf8')));
  const used = scanDir(dir);
  const { usedNotDocumented, documentedNotUsed } = diffEnv(used, documented);
  usedNotDocumented.forEach(k => console.log(`MISSING in .env.example: ${k} (used in code)`));
  documentedNotUsed.forEach(k => console.log(`UNUSED: ${k} (in .env.example, never used in code)`));
  if (!usedNotDocumented.length && !documentedNotUsed.length) console.log('env-saaf: all clean — code and .env.example match.');
  process.exit(usedNotDocumented.length ? 1 : 0);
} else {
  console.log('Usage: env-saaf check [dir] | env-saaf scan [dir]');
  process.exit(cmd ? 2 : 0);
}
