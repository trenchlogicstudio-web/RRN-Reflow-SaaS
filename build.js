// Copyright (c) 2026 Miloš Petrović (Trench Logic Studio) · SPDX-License-Identifier: MIT
// Builds the single-file Cloudflare bundle (dist/worker.js) and a reference copy
// of the database schema (dist/schema.sql) with nothing but Node itself: no
// packages to install and no network needed. The finished bundle ships in the
// package, so this is only needed after changing the source.
//
//   npm run build
//
// `npm test` rebuilds the bundle in memory and checks that dist/worker.js matches
// the source byte for byte, so the shipped file can always be traced to the code.
//
// How it bundles: every module of the Worker (worker.js and everything it imports)
// becomes one function scope, in dependency order; `import` lines become constants
// taken from the modules before it, and `export` lines become the module's return
// value. It accepts only the plain module syntax this code base uses and stops with
// a clear message on anything else.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, relative, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCHEMA_SQL } from './src/db/schema.js';
import { VERSION } from './src/config.js';

const ROOT = dirname(fileURLToPath(import.meta.url));
const IMPORT = /^import\s+([\s\S]*?)\s+from\s+'([^']+)';[ \t]*$/gm;
const NAME = /^[A-Za-z_$][\w$]*$/;

function fail(file, message) {
  throw new Error(`build.js: ${file}: ${message}`);
}

/** `x`, `{ a, b as c }`, `x, { a }` or `* as ns` → what to take from the imported module. */
function parseClause(clause, file) {
  const out = { def: null, ns: null, named: [] };
  let rest = clause.trim();
  const ns = /^\*\s+as\s+([A-Za-z_$][\w$]*)$/.exec(rest);
  if (ns) {
    out.ns = ns[1];
    return out;
  }
  const braces = /\{([\s\S]*)\}\s*$/.exec(rest);
  if (braces) {
    for (const part of braces[1].split(',').map((p) => p.trim()).filter(Boolean)) {
      const m = /^([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/.exec(part);
      if (!m) fail(file, `cannot read import "${part}"`);
      out.named.push([m[1], m[2] || m[1]]);
    }
    rest = rest.slice(0, braces.index).replace(/,\s*$/, '').trim();
  }
  if (rest) {
    if (!NAME.test(rest)) fail(file, `cannot read import "${clause}"`);
    out.def = rest;
  }
  return out;
}

/** Bundle a Worker entry: { code, modules: [{ path, exports }] }, paths relative to the project folder. */
export function build(entry = 'worker.js', { root = ROOT, version = VERSION } = {}) {
  const order = [];
  const state = new Map();
  const visit = (file, from) => {
    if (state.get(file) === 'done') return;
    if (state.get(file) === 'open') fail(relative(root, from), `circular import of ${relative(root, file)}`);
    state.set(file, 'open');
    let code;
    try {
      code = readFileSync(file, 'utf8');
    } catch {
      fail(relative(root, from || file), `cannot read ${relative(root, file)}`);
    }
    for (const m of code.matchAll(IMPORT)) {
      if (!m[2].startsWith('.')) fail(relative(root, file), `only relative imports can be bundled, found '${m[2]}'`);
      visit(resolve(dirname(file), m[2]), file);
    }
    state.set(file, 'done');
    order.push({ file, code });
  };
  visit(resolve(root, entry), null);

  const ids = new Map(order.map((m, i) => [m.file, `__m${i}`]));
  const modules = [];
  const parts = [`// RRN SaaS v${version} (Reflow tier): single-file Cloudflare Worker, built from source by build.js (no dependencies). Do not edit by hand.\n// Copyright (c) 2026 Miloš Petrović (Trench Logic Studio) · SPDX-License-Identifier: MIT`];
  for (const { file, code } of order) {
    const rel = relative(root, file).split('\\').join('/');
    const exported = [];
    let body = code.replace(IMPORT, (match, clause, spec) => {
      const target = ids.get(resolve(dirname(file), spec));
      const { def, ns, named } = parseClause(clause, rel);
      const lines = [];
      if (def) lines.push(`const ${def} = ${target}.default;`);
      if (ns) lines.push(`const ${ns} = ${target};`);
      if (named.length) lines.push(`const { ${named.map(([name, local]) => (name === local ? name : `${name}: ${local}`)).join(', ')} } = ${target};`);
      return lines.join(' ');
    });
    body = body.replace(/^export (async function|function|class|const|let|var)\s+([A-Za-z_$][\w$]*)/gm, (match, kind, name) => {
      exported.push([name, name]);
      return `${kind} ${name}`;
    });
    body = body.replace(/^export \{([^}]*)\};?[ \t]*$/gm, (match, list) => {
      for (const part of list.split(',').map((p) => p.trim()).filter(Boolean)) {
        const m = /^([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/.exec(part);
        if (!m) fail(rel, `cannot read export "${part}"`);
        exported.push([m[2] || m[1], m[1]]);
      }
      return '';
    });
    body = body.replace(/^export default /gm, () => {
      exported.push(['default', '__default']);
      return 'const __default = ';
    });
    if (/^[ \t]*(?:export|import)\b/m.test(body)) fail(rel, 'module syntax this builder does not support (an import or export it could not rewrite)');
    if (/\bimport\s*\(|\bimport\.meta\b/.test(body)) fail(rel, 'dynamic import() and import.meta cannot be bundled');
    const names = exported.map(([name, local]) => (name === local ? name : `${name}: ${local}`));
    parts.push(`// ${rel}\nconst ${ids.get(file)} = (() => {\n${body.trimEnd()}\nreturn { ${names.join(', ')} };\n})();`);
    modules.push({ path: rel, exports: exported.map(([name]) => name) });
  }
  parts.push(`export default ${ids.get(order[order.length - 1].file)}.default;`);
  return { code: `${parts.join('\n\n')}\n`, modules };
}

/** The bundle as a string. */
export function bundle(entry, options) {
  return build(entry, options).code;
}

export function schemaFile(version = VERSION) {
  return `-- RRN SaaS v${version}: BASE SCHEMA ONLY (v1). On startup the app applies migrations in src/db/schema.js to the current version. Do not treat this file as a complete migration or restore script.\n-- Copyright (c) 2026 Miloš Petrović (Trench Logic Studio) · SPDX-License-Identifier: MIT\n${SCHEMA_SQL.trim()}\n`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  mkdirSync(join(ROOT, 'dist'), { recursive: true });
  writeFileSync(join(ROOT, 'dist/worker.js'), bundle());
  writeFileSync(join(ROOT, 'dist/schema.sql'), schemaFile());
  console.log(`Built dist/worker.js and dist/schema.sql for v${VERSION}`);
}
