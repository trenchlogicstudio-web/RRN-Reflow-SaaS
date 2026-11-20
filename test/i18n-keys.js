// Copyright (c) 2026 Miloš Petrović (Trench Logic Studio) · SPDX-License-Identifier: MIT
// Finds every English source string the code translates, so test/i18n.test.js
// can check each language has all of them. Run directly for a report:
//   node test/i18n-keys.js            keys missing per language
//   node test/i18n-keys.js --list     every key with where it is used

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const STR = String.raw`'((?:[^'\\\n]|\\.)*)'`;

// Where translatable strings appear. Every pattern captures string literals only.
const PATTERNS = [
  new RegExp(String.raw`(?<![\w$])t[cs]?\(\s*${STR}`, 'g'), // t('…') · c.t('…') · f.t('…') · ts/tc: a second language on one page
  new RegExp(String.raw`translator\([^()]*\)\(\s*${STR}`, 'g'), // translator(locale)('…')
  new RegExp(String.raw`(?<![\w$])tk\(\s*${STR}`, 'g'), // tk('…'): translated later
  new RegExp(String.raw`(?<![\w$])t\.n\(\s*[^,()]+,\s*${STR}\s*,\s*${STR}`, 'g'), // t.n(n, 'one', 'other')
  new RegExp(String.raw`(?<![\w$])rich\(\s*t\s*,\s*${STR}`, 'g'), // rich(t, '… {link} …', parts)
  new RegExp(String.raw`(?<![\w$-])label\s*[:=]\s*${STR}`, 'g'), // form field labels
  new RegExp(String.raw`(?<![\w$])message\s*[:=]\s*${STR}`, 'g'), // validation messages
  new RegExp(String.raw`new HttpError\(\s*\d+\s*,\s*${STR}`, 'g'), // error pages
];

function unescape(body) {
  return body.replace(/\\(u\{[0-9a-fA-F]+\}|u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|.)/g, (m, e) => {
    if (e[0] === 'u') return String.fromCodePoint(parseInt(e.replace(/[u{}]/g, ''), 16));
    if (e[0] === 'x') return String.fromCharCode(parseInt(e.slice(1), 16));
    return { n: '\n', t: '\t', r: '\r', 0: '\0' }[e] ?? e;
  });
}

function* files(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* files(path);
    else if (name.endsWith('.js')) yield path;
  }
}

/** Map of English key → list of 'file:line' where it is used. */
export function extractKeys() {
  const keys = new Map();
  const sources = [...files(join(ROOT, 'src')), ...files(join(ROOT, 'engines'))].filter((p) => !/[\\/]i18n[\\/](?!index\.js)/.test(p));
  for (const path of sources) {
    const text = readFileSync(path, 'utf8');
    const lineAt = (i) => text.slice(0, i).split('\n').length;
    for (const re of PATTERNS) {
      for (const m of text.matchAll(re)) {
        for (const body of m.slice(1)) {
          if (body === undefined) continue;
          const key = unescape(body);
          if (!key.trim()) continue;
          if (!keys.has(key)) keys.set(key, []);
          keys.get(key).push(`${relative(ROOT, path)}:${lineAt(m.index)}`);
        }
      }
    }
  }
  return keys;
}

/** '{name} and {count}' → ['count', 'name'] */
export function placeholders(text) {
  return [...new Set([...String(text).matchAll(/\{(\w+)\}/g)].map((m) => m[1]))].sort();
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const keys = extractKeys();
  if (process.argv.includes('--list')) {
    for (const [k, where] of keys) console.log(`${JSON.stringify(k)}  ← ${where.join(', ')}`);
  } else {
    const { DICTIONARIES } = await import('../src/i18n/index.js');
    for (const [loc, dict] of Object.entries(DICTIONARIES)) {
      if (!dict) continue;
      const missing = [...keys.keys()].filter((k) => !Object.prototype.hasOwnProperty.call(dict, k));
      const stale = Object.keys(dict).filter((k) => !keys.has(k));
      console.log(`${loc}: ${keys.size - missing.length}/${keys.size} translated, ${missing.length} missing, ${stale.length} unused`);
    }
  }
  console.log(`${keys.size} keys`);
}
