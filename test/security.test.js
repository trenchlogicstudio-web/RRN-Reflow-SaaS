// Copyright (c) 2026 Miloš Petrović (Trench Logic Studio) · SPDX-License-Identifier: MIT
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, Browser, requestIds, setupSalon, clientRequests, PASSWORD } from './helpers.js';

test('every response carries the security headers; client pages set no cookies', async () => {
  const t = makeApp();
  const b = new Browser(t.app);
  for (const path of ['/', '/login', '/s/nope', '/static/app.css']) {
    const res = await b.get(path);
    const csp = res.headers.get('content-security-policy');
    assert.match(csp, /default-src 'none'/, path);
    assert.match(csp, /frame-ancestors 'none'/, path);
    assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval|https?:/, path);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(res.headers.get('x-frame-options'), 'DENY');
    assert.equal(res.headers.get('referrer-policy'), 'same-origin');
  }
  assert.equal((await b.get('/')).headers.get('cache-control'), 'no-store');
});

test('no page references another website', async () => {
  const t = makeApp();
  const { owner, slug, serviceId } = await setupSalon(t);
  const pages = [
    await new Browser(t.app).get('/'),
    await new Browser(t.app).get(`/s/${slug}`),
    await new Browser(t.app).get(`/s/${slug}/offers?service=${serviceId}`),
    await owner.get('/app'),
    await owner.get('/app/hours'),
    await new Browser(t.app).get('/static/app.css'),
  ];
  for (const p of pages) {
    // Absolute links to this same site (canonical and language alternates) are fine.
    const external = p.text.match(/(?:src|href)\s*=\s*"https?:\/\/(?!localhost:8787\/)[^"]*"|@import|url\(\s*['"]?https?:/g);
    assert.equal(external, null, `external reference: ${external}`);
    assert.doesNotMatch(p.text, /googleapis|gstatic|cdn\.|style="/);
  }
});

test('session cookie: HttpOnly and SameSite always; Secure and __Host- prefix on HTTPS', async () => {
  const t = makeApp();
  let res = await t.app.fetch(
    new Request('http://localhost:8787/signup', {
      method: 'POST',
      headers: { origin: 'http://localhost:8787', 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ salon: 'Local', email: 'l@l.test', password: PASSWORD, timezone: 'UTC', currency: 'EUR', terms: 'on' }),
    }),
    { ip: '192.0.2.1' },
  );
  let cookie = res.headers.get('set-cookie');
  assert.match(cookie, /^rrn_sid=[A-Za-z0-9_-]+; Path=\/; SameSite=Lax; HttpOnly; Max-Age=2592000$/);

  res = await t.app.fetch(
    new Request('https://reflow.example/signup', {
      method: 'POST',
      headers: { origin: 'https://reflow.example', 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ salon: 'Prod', email: 'p@p.test', password: PASSWORD, timezone: 'UTC', currency: 'EUR', terms: 'on' }),
    }),
    { ip: '192.0.2.2' },
  );
  cookie = res.headers.get('set-cookie');
  assert.match(cookie, /^__Host-rrn_sid=[A-Za-z0-9_-]+; Path=\/; SameSite=Lax; HttpOnly; Secure; Max-Age=2592000$/);
  assert.equal(res.headers.get('strict-transport-security'), 'max-age=31536000');
  const tokenRow = await t.db.prepare('SELECT token_hash FROM sessions LIMIT 1').first();
  assert.match(tokenRow.token_hash, /^[0-9a-f]{64}$/, 'only a hash of the session token is stored');
});

test('cross-site form posts are blocked', async () => {
  const t = makeApp();
  const { owner, slug, serviceId } = await setupSalon(t);
  const { token } = await clientRequests(t, slug, serviceId);
  const id = requestIds((await owner.get('/app')).text)[0];
  let res = await owner.post(`/app/requests/${id}/confirm`, {}, { headers: { origin: 'https://evil.example' } });
  assert.equal(res.status, 403);
  res = await owner.post(`/app/requests/${id}/confirm`, {}, { sameOrigin: false });
  assert.equal(res.status, 403, 'no Origin and no Referer');
  res = await owner.post(`/app/requests/${id}/confirm`, {}, { headers: { origin: 'null' } });
  assert.equal(res.status, 403);
  assert.equal((await t.db.prepare('SELECT status FROM requests').first()).status, 'pending');
  res = await owner.post(`/app/requests/${id}/confirm`, {}, { sameOrigin: false, headers: { referer: 'http://localhost:8787/app' } });
  assert.equal(res.location, '/app?ok=confirmed', 'a same-site Referer is accepted when Origin is absent');
  assert.ok(token);
});

test('the dashboard requires a login, and redirects back afterwards', async () => {
  const t = makeApp();
  await setupSalon(t);
  const anon = new Browser(t.app);
  for (const path of ['/app', '/app/services', '/app/upgrades', '/app/hours', '/app/settings', '/app/plan', '/app/audit']) {
    const res = await anon.get(path);
    assert.equal(res.status, 303, path);
    assert.equal(res.location, `/login?next=${encodeURIComponent(path)}`);
  }
  assert.equal((await anon.post('/app/services', { name: 'x', duration: '30', price: '1' })).location, '/login?next=%2Fapp');
  assert.equal((await t.db.prepare('SELECT COUNT(*) AS n FROM services').first()).n, 1);
  const res = await anon.post('/login', { email: 'owner@lumen.test', password: PASSWORD, next: '/app/hours' });
  assert.equal(res.location, '/app/hours');
  const evil = await new Browser(t.app).post('/login', { email: 'owner@lumen.test', password: PASSWORD, next: '//evil.example/x' });
  assert.equal(evil.location, '/app', 'open redirects are refused');
});

test('salons are isolated from each other', async () => {
  const t = makeApp();
  const a = await setupSalon(t, { name: 'Salon A', email: 'a@a.test' });
  const b = await setupSalon(t, { name: 'Salon B', email: 'b@b.test' });
  await clientRequests(t, a.slug, a.serviceId, { name: 'Private Client' });
  const idA = requestIds((await a.owner.get('/app')).text)[0];
  const dashB = await b.owner.get('/app');
  assert.doesNotMatch(dashB.text, /Private Client/);
  assert.equal((await b.owner.post(`/app/requests/${idA}/confirm`, {})).status, 404);
  assert.equal((await b.owner.post(`/app/requests/${idA}/decline`, {})).status, 404);
  assert.equal((await b.owner.post(`/app/services/${a.serviceId}`, { action: 'hide' })).status, 404);
  const upgradeA = (await t.db.prepare('SELECT id FROM upgrades WHERE salon_id = 1').first()).id;
  assert.equal((await b.owner.post(`/app/upgrades/${upgradeA}`, { action: 'hide' })).status, 404);
  const windowA = (await t.db.prepare('SELECT id FROM windows WHERE salon_id = 1').first()).id;
  await b.owner.post(`/app/hours/${windowA}/delete`, {});
  assert.equal((await t.db.prepare('SELECT COUNT(*) AS n FROM windows WHERE id = ?').bind(windowA).first()).n, 1);
  // B cannot attach A's service to its own upgrade either.
  const res = await b.owner.post('/app/upgrades', { name: 'Sneaky', minutes: '20', service: String(a.serviceId) });
  assert.equal(res.status, 400);
  // A's service id under B's public page does not resolve.
  assert.equal((await new Browser(t.app).get(`/s/${b.slug}/offers?service=${a.serviceId}`)).status, 303);
  assert.equal((await t.db.prepare("SELECT status FROM requests").first()).status, 'pending');
});

test('login is throttled after repeated failures', async () => {
  const t = makeApp();
  await setupSalon(t);
  const attacker = new Browser(t.app, { ip: '192.0.2.99' });
  for (let i = 0; i < 8; i++) {
    const res = await attacker.post('/login', { email: 'owner@lumen.test', password: `wrong-${i}` });
    assert.equal(res.status, 400);
    assert.match(res.text, /Email or password is incorrect/);
  }
  const blocked = await attacker.post('/login', { email: 'owner@lumen.test', password: PASSWORD });
  assert.equal(blocked.status, 429);
  t.advance(16 * 60 * 1000);
  const ok = await attacker.post('/login', { email: 'owner@lumen.test', password: PASSWORD });
  assert.equal(ok.status, 303);
  // Unknown emails get the same answer as wrong passwords.
  const unknown = await new Browser(t.app, { ip: '192.0.2.98' }).post('/login', { email: 'nobody@x.test', password: 'whatever123' });
  assert.equal(unknown.status, 400);
  assert.match(unknown.text, /Email or password is incorrect/);
});

test('sign-up: validation, duplicates, and a per-address limit', async () => {
  const t = makeApp();
  const b = new Browser(t.app, { ip: '192.0.2.50' });
  let res = await b.post('/signup', { salon: 'X', email: 'bad', password: 'short', timezone: 'Mars/Base', currency: 'XXX' });
  assert.equal(res.status, 400);
  for (const msg of [/Salon name is too short/, /Enter a valid email address/, /at least 10 characters/, /Choose your time zone/, /Choose a valid currency/, /accept the beta terms/]) {
    assert.match(res.text, msg);
  }
  const ok = { salon: 'Salon One', email: 'one@x.test', password: PASSWORD, timezone: 'UTC', currency: 'EUR', terms: 'on' };
  assert.equal((await b.post('/signup', ok)).status, 303);
  res = await new Browser(t.app, { ip: '192.0.2.51' }).post('/signup', { ...ok, email: 'ONE@x.test' });
  assert.equal(res.status, 400);
  assert.match(res.text, /already exists/);
  // Same salon name, different email: gets its own page address.
  res = await new Browser(t.app, { ip: '192.0.2.52' }).post('/signup', { ...ok, email: 'two@x.test' });
  assert.equal(res.status, 303);
  const slugs = (await t.db.prepare('SELECT slug FROM salons ORDER BY id').all()).results.map((r) => r.slug);
  assert.deepEqual(slugs, ['salon-one', 'salon-one-2']);
  const flood = new Browser(t.app, { ip: '192.0.2.53' });
  for (let i = 0; i < 5; i++) await flood.post('/signup', { ...ok, email: `f${i}@x.test` });
  assert.equal((await flood.post('/signup', { ...ok, email: 'f9@x.test' })).status, 429);
});

test('public requests are rate limited per address', async () => {
  const t = makeApp();
  const { slug, serviceId } = await setupSalon(t, { capacity: 50 });
  const statuses = [];
  for (let i = 0; i < 16; i++) {
    const { res } = await clientRequests(t, slug, serviceId, { ip: '192.0.2.77', name: `Client ${i}` });
    statuses.push(res.status);
  }
  assert.deepEqual(statuses.slice(0, 15), Array(15).fill(303));
  assert.equal(statuses[15], 429);
});

test('the database itself refuses a discount or a thin upgrade', async () => {
  const t = makeApp();
  const { slug, serviceId } = await setupSalon(t);
  await clientRequests(t, slug, serviceId);
  await assert.rejects(t.db.prepare('UPDATE requests SET price_cents = 3600').run(), /CHECK constraint failed: price_cents = standard_price_cents/);
  await assert.rejects(t.db.prepare('UPDATE requests SET added_min = 5, total_min = 50, end_min = start_min + 50').run(), /CHECK constraint failed/);
  await assert.rejects(t.db.prepare('UPDATE salons SET min_uplift_pct = 10').run(), /CHECK constraint failed/);
  const row = await t.db.prepare('SELECT price_cents, standard_price_cents, added_min FROM requests').first();
  assert.deepEqual({ ...row }, { price_cents: 4000, standard_price_cents: 4000, added_min: 15 });
});

test('a tampered audit log is detected', async () => {
  const t = makeApp();
  const { owner, slug, serviceId } = await setupSalon(t);
  await clientRequests(t, slug, serviceId);
  assert.match((await owner.get('/app/audit')).text, /Chain intact/);
  await t.db.prepare(`UPDATE events SET payload = replace(payload, '"price_cents":4000', '"price_cents":3000') WHERE type = 'request.offer'`).run();
  const res = await owner.get('/app/audit');
  assert.match(res.text, /Chain broken at entry/);
});

test('the audit chain cannot fork: one parent, one child', async () => {
  const t = makeApp();
  await setupSalon(t);
  const last = await t.db.prepare('SELECT salon_id, prev_hash FROM events ORDER BY id DESC LIMIT 1').first();
  await assert.rejects(
    t.db
      .prepare("INSERT INTO events (salon_id, type, payload, created_at, prev_hash, hash) VALUES (?, 'x', '{}', 'now', ?, 'h')")
      .bind(last.salon_id, last.prev_hash)
      .run(),
    /UNIQUE constraint failed: events\.salon_id, events\.prev_hash/,
  );
});

test('operator page: off without a key; with a key it logs in, shows traction, issues one-time reset links', async () => {
  const off = makeApp();
  assert.equal((await new Browser(off.app).get('/admin')).status, 404);

  const KEY = 'k'.repeat(32);
  const t = makeApp({ env: { ADMIN_KEY: KEY } });
  await setupSalon(t);
  const op = new Browser(t.app, { ip: '192.0.2.200' });
  assert.match((await op.get('/admin')).text, /Operator key/);
  assert.equal((await op.post('/admin/login', { key: 'x'.repeat(32) })).status, 401);
  assert.equal((await op.post('/admin/login', { key: KEY })).location, '/admin');
  const overview = await op.get('/admin');
  assert.match(overview.text, /Studio Lumen/);
  assert.match(overview.text, /owner@lumen\.test/);

  const userId = (await t.db.prepare('SELECT id FROM users').first()).id;
  const issued = await op.post(`/admin/users/${userId}/reset`, {});
  const link = /localhost:8787(\/reset\/[A-Za-z0-9_-]+)/.exec(issued.text)[1];
  const user = new Browser(t.app, { ip: '192.0.2.201' });
  assert.match((await user.get(link)).text, /Choose a new password/);
  assert.equal((await user.post(link, { password: 'short' })).status, 400);
  assert.equal((await user.post(link, { password: 'a brand new password' })).location, '/login?ok=reset');
  assert.equal((await user.get(link)).status, 410, 'a reset link works once');
  assert.equal((await user.post('/login', { email: 'owner@lumen.test', password: PASSWORD })).status, 400);
  assert.equal((await user.post('/login', { email: 'owner@lumen.test', password: 'a brand new password' })).status, 303);

  // A salon owner is not an operator.
  assert.match((await user.get('/admin')).text, /Operator key/);
  assert.equal((await user.post(`/admin/users/${userId}/reset`, {})).location, '/admin');
});

test('forms: wrong encoding and oversized bodies are refused', async () => {
  const t = makeApp();
  let res = await t.app.fetch(
    new Request('http://localhost:8787/login', {
      method: 'POST',
      headers: { origin: 'http://localhost:8787', 'content-type': 'application/json' },
      body: '{"email":"a"}',
    }),
  );
  assert.equal(res.status, 415);
  res = await t.app.fetch(
    new Request('http://localhost:8787/login', {
      method: 'POST',
      headers: { origin: 'http://localhost:8787', 'content-type': 'application/x-www-form-urlencoded' },
      body: `email=${'a'.repeat(40000)}`,
    }),
  );
  assert.equal(res.status, 413);
});

test('routing details: HEAD, 405, unknown paths, malformed ids, health check', async () => {
  const t = makeApp();
  const b = new Browser(t.app);
  const head = await b.send('HEAD', '/');
  assert.equal(head.status, 200);
  assert.equal((await b.post('/', {})).status, 405);
  assert.equal((await b.get('/nope/nope')).status, 404);
  assert.equal((await b.get('/r/%E0%A4%A')).status, 404);
  assert.equal((await b.get('/r/../../etc/passwd')).status, 404);
  const { owner } = await setupSalon(t);
  assert.equal((await owner.post('/app/requests/abc/confirm', {})).status, 404);
  assert.equal((await owner.post('/app/requests/0/confirm', {})).status, 404);
  assert.equal((await owner.post('/app/requests/99999999999999999999/confirm', {})).status, 404);
  const health = await b.get('/healthz');
  const body = JSON.parse(health.text);
  assert.equal(health.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.engine.selftest, 'pass');
  assert.ok(body.engine.checks.some((c) => c.name === 'forbidden path refused: discount' && c.pass));
});

test('password hashing: hardened default and legacy hashes upgrade on the next login', async () => {
  assert.equal(makeApp({ env: { PBKDF2_ITERATIONS: '' } }).app.config.pbkdf2Iterations, 100000);
  const t = makeApp();
  await setupSalon(t);
  assert.equal((await t.db.prepare('SELECT pass_iter FROM users').first()).pass_iter, 10000);
  // The operator raises the setting (Workers Paid): same database, new configuration.
  const { createApp } = await import('../src/app.js');
  const stronger = createApp({ db: t.db, env: { PBKDF2_ITERATIONS: '100000' }, clock: () => t.now });
  const b = new Browser(stronger);
  assert.equal((await b.post('/login', { email: 'owner@lumen.test', password: PASSWORD })).status, 303);
  assert.equal((await t.db.prepare('SELECT pass_iter FROM users').first()).pass_iter, 100000);
  assert.equal((await new Browser(stronger).post('/login', { email: 'owner@lumen.test', password: PASSWORD })).status, 303);
  assert.equal(createApp({ db: t.db, env: { PBKDF2_ITERATIONS: '5000000' } }).config.pbkdf2Iterations, 100000, 'out-of-range values fall back');
});

test('a chunked body without a length header is still capped', async () => {
  const t = makeApp();
  const big = new ReadableStream({
    start(controller) {
      for (let i = 0; i < 40; i++) controller.enqueue(new TextEncoder().encode('a'.repeat(1024)));
      controller.close();
    },
  });
  const res = await t.app.fetch(
    new Request('http://localhost:8787/login', {
      method: 'POST',
      headers: { origin: 'http://localhost:8787', 'content-type': 'application/x-www-form-urlencoded' },
      body: big,
      duplex: 'half',
    }),
  );
  assert.equal(res.status, 413);
});

test('numbered SQL placeholders are refused, so code stays portable across Node versions', async () => {
  const { createD1 } = await import('../src/db/node-d1.js');
  const db = createD1(':memory:');
  assert.throws(() => db.prepare('SELECT ?1 AS a'), /plain "\?" placeholders/);
  assert.equal((await db.prepare("SELECT ? AS a, '?1' AS literal").bind(5).first()).a, 5);
});
