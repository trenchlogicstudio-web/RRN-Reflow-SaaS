// Copyright (c) 2026 Miloš Petrović (Trench Logic Studio) · SPDX-License-Identifier: MIT
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build, schemaFile } from '../build.js';
import { createD1 } from '../src/db/node-d1.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

test('dist/worker.js and dist/schema.sql are exactly what build.js makes from this source', () => {
  const { code } = build();
  assert.ok(code === readFileSync(join(ROOT, 'dist/worker.js'), 'utf8'), 'dist/worker.js does not match the source: run npm run build');
  assert.equal(schemaFile(), readFileSync(join(ROOT, 'dist/schema.sql'), 'utf8'));
});

test('the bundle carries every export of every module, exactly as Node reads them', async () => {
  const { modules } = build();
  assert.equal(modules.at(-1).path, 'worker.js', 'the entry comes last');
  assert.ok(modules.length > 40);
  for (const m of modules) {
    const namespace = await import(pathToFileURL(join(ROOT, m.path)).href);
    assert.deepEqual([...m.exports].sort(), Object.keys(namespace).sort(), m.path);
  }
});

test('the bundle itself runs the app: health check, sign-up, setup, a client request, the daily job', async () => {
  const worker = (await import(pathToFileURL(join(ROOT, 'dist/worker.js')).href)).default;
  const env = { DB: createD1(':memory:'), PBKDF2_ITERATIONS: '10000' };
  const pending = [];
  const ctx = { waitUntil: (p) => pending.push(p) };
  let cookie = '';
  const call = async (path, form, { owner = true } = {}) => {
    const headers = { 'cf-connecting-ip': '192.0.2.7', 'accept-language': 'en' };
    if (owner && cookie) headers.cookie = cookie;
    let init = { headers };
    if (form) {
      const body = new URLSearchParams();
      for (const [k, v] of Object.entries(form)) (Array.isArray(v) ? v : [v]).forEach((x) => body.append(k, x));
      init = { method: 'POST', headers: { ...headers, origin: 'http://localhost:8787', 'content-type': 'application/x-www-form-urlencoded' }, body };
    }
    const res = await worker.fetch(new Request(`http://localhost:8787${path}`, init), env, ctx);
    await Promise.all(pending.splice(0));
    return { status: res.status, location: res.headers.get('location'), cookie: res.headers.get('set-cookie'), text: await res.text() };
  };

  const health = JSON.parse((await call('/healthz')).text);
  assert.equal(health.ok, true);
  assert.equal(health.engine.selftest, 'pass');
  let r = await call('/signup', { salon: 'Bundle Salon', email: 'bundle@example.com', password: 'correct horse battery', timezone: 'Europe/Berlin', currency: 'EUR', terms: 'on' });
  assert.equal(r.status, 303);
  cookie = r.cookie.split(';')[0];
  assert.equal((await call('/app/services', { name: 'Cut & finish', duration: '45', price: '40' })).status, 303);
  assert.equal((await call('/app/upgrades', { name: 'Deep conditioning', minutes: '15', service: 'all' })).status, 303);
  assert.equal((await call('/app/hours', { day: ['1', '2', '3', '4', '5', '6', '7'], start: '08:00', end: '20:00', capacity: '2' })).status, 303);

  const salonPage = await call('/s/bundle-salon', null, { owner: false });
  const serviceId = /offers\?service=(\d+)/.exec(salonPage.text)[1];
  const offers = await call(`/s/bundle-salon/offers?service=${serviceId}`, null, { owner: false });
  const key = /name="offer" value="([^"]+)"/.exec(offers.text)[1];
  r = await call('/s/bundle-salon/request', { service: serviceId, offer: key, name: 'Nora Hale', contact: '+44 7700 900123', consent: 'on' }, { owner: false });
  assert.equal(r.status, 303);
  assert.match((await call(r.location, null, { owner: false })).text, /Request sent/);
  assert.match((await call('/app')).text, /\/app\/requests\/\d+\/confirm/);

  await worker.scheduled({ cron: '17 3 * * *' }, env, ctx);
  await Promise.all(pending.splice(0));
  const missing = await worker.fetch(new Request('http://localhost:8787/'), {}, ctx);
  assert.equal(missing.status, 500, 'a clear message when the database binding is missing');
  assert.match(await missing.text(), /Database binding "DB" is missing/);
});

test('the builder refuses module syntax it cannot bundle safely', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rrn-build-'));
  try {
    writeFileSync(join(dir, 'entry.js'), "import { a } from './a.js';\nexport default { a };\n");
    writeFileSync(join(dir, 'a.js'), "export const a = 1;\nexport async function later() { return import('./b.js'); }\n");
    assert.throws(() => build('entry.js', { root: dir }), /dynamic import\(\) and import\.meta cannot be bundled/);
    writeFileSync(join(dir, 'a.js'), "import x from 'some-package';\nexport const a = x;\n");
    assert.throws(() => build('entry.js', { root: dir }), /only relative imports can be bundled/);
    writeFileSync(join(dir, 'a.js'), "import { b } from './b.js';\nexport const a = b;\n");
    writeFileSync(join(dir, 'b.js'), "import { a } from './a.js';\nexport const b = 2;\n");
    assert.throws(() => build('entry.js', { root: dir }), /circular import/);
    writeFileSync(join(dir, 'a.js'), "export const a = 1;\nexport * from './b.js';\n");
    assert.throws(() => build('entry.js', { root: dir }), /module syntax this builder does not support/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
