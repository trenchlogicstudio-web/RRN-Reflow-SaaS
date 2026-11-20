// Copyright (c) 2026 Miloš Petrović (Trench Logic Studio) · SPDX-License-Identifier: MIT
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, Browser, mailEnv, offerKeys, requestIds, setupSalon, clientRequests, PASSWORD } from './helpers.js';
import { createApp } from '../src/app.js';
import { createD1 } from '../src/db/node-d1.js';
import { SCHEMA_SQL, schemaStatements } from '../src/db/schema.js';

const DAY = 86400000;

test('emails: the salon hears about requests, the client about the answer, in their own language', async () => {
  const env = mailEnv();
  const t = makeApp({ env });
  const { owner, slug, serviceId } = await setupSalon(t);
  // A client writes in German and leaves an email address.
  const client = new Browser(t.app, { ip: '198.51.100.21', language: 'de' });
  const page = await client.get(`/s/${slug}/offers?service=${serviceId}&lang=de`);
  const key = offerKeys(page.text)[0];
  const res = await client.post(`/s/${slug}/request`, { lang: 'de', service: serviceId, offer: key, name: 'Lena Brandt', contact: 'lena@example.com', consent: 'on' });
  assert.equal(res.status, 303);
  const row = await t.db.prepare('SELECT locale FROM requests').first();
  assert.equal(row.locale, 'de');

  assert.equal(env.MAIL_SINK.length, 2);
  const [toOwner, toClient] = env.MAIL_SINK;
  assert.equal(toOwner.to, 'owner@lumen.test');
  assert.equal(toOwner.replyTo, 'lena@example.com', 'the owner can reply straight to the client');
  assert.match(toOwner.subject, /^New request: Tue 3 Nov 13:00$/);
  assert.match(toOwner.text, /Lena Brandt, lena@example\.com/);
  assert.match(toOwner.html, /href="http:\/\/localhost:8787\/app"/);
  assert.equal(toClient.to, 'lena@example.com');
  assert.equal(toClient.replyTo, 'owner@lumen.test');
  assert.match(toClient.text, /\/r\/[A-Za-z0-9_-]{32}/);

  const id = requestIds((await owner.get('/app')).text)[0];
  await owner.post(`/app/requests/${id}/confirm`, {});
  assert.equal(env.MAIL_SINK.length, 3);
  const confirmed = env.MAIL_SINK[2];
  assert.equal(confirmed.kind, 'client.confirmed');
  assert.match(confirmed.html, /calendar\.ics/);

  // Outbox rows are marked sent, and are pruned after 30 days.
  assert.equal((await t.db.prepare("SELECT COUNT(*) AS n FROM outbox WHERE status = 'sent'").first()).n, 3);
  t.advance(31 * DAY);
  await new Browser(t.app).get('/');
  assert.equal((await t.db.prepare('SELECT COUNT(*) AS n FROM outbox').first()).n, 0);
});

test('emails: phone-only clients get no email, owners can switch notifications off, HTML is escaped', async () => {
  const env = mailEnv();
  const t = makeApp({ env });
  const { owner, slug, serviceId } = await setupSalon(t);
  await clientRequests(t, slug, serviceId, { name: '<b>Evil</b>', contact: '+44 7700 900123' });
  assert.equal(env.MAIL_SINK.length, 1, 'owner only');
  assert.doesNotMatch(env.MAIL_SINK[0].html, /<b>Evil<\/b>/);
  assert.match(env.MAIL_SINK[0].html, /&lt;b&gt;Evil&lt;\/b&gt;/);
  await owner.post('/app/settings/account', { locale: 'en' });
  await clientRequests(t, slug, serviceId, { name: 'Ada', contact: '+44 7700 900124', ip: '198.51.100.30' });
  assert.equal(env.MAIL_SINK.length, 1, 'notifications are off now');
});

test('emails: Resend gets a well-formed request, and failures are retried with back-off', async () => {
  const calls = [];
  let fail = 2;
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (fail-- > 0) return new Response('busy', { status: 503 });
    return new Response(JSON.stringify({ id: 'em_1' }), { status: 200 });
  };
  const t = makeApp({ env: { RESEND_API_KEY: 're_test_key', MAIL_FROM: 'Reflow <requests@reflow.example>' }, fetchImpl });
  const { slug, serviceId } = await setupSalon(t);
  await clientRequests(t, slug, serviceId, { contact: '+44 7700 900123' });
  assert.equal(calls.length, 1);
  const { url, init } = calls[0];
  assert.equal(url, 'https://api.resend.com/emails');
  assert.equal(init.headers.authorization, 'Bearer re_test_key');
  assert.match(init.headers['idempotency-key'], /^[A-Za-z0-9_-]{20,100}$/);
  const body = JSON.parse(init.body);
  assert.equal(body.from, '"Studio Lumen via Reflow" <requests@reflow.example>');
  assert.deepEqual(body.to, ['owner@lumen.test']);
  let row = await t.db.prepare('SELECT status, attempts, last_error FROM outbox').first();
  assert.deepEqual([row.status, row.attempts], ['pending', 1]);
  assert.match(row.last_error, /HTTP 503/);
  // The daily housekeeping retries once the back-off has passed.
  t.advance(16 * 60000);
  await new Browser(t.app).get('/');
  row = await t.db.prepare('SELECT status, attempts FROM outbox').first();
  assert.equal(row.status, 'pending');
  t.advance(16 * 60000);
  await new Browser(t.app).get('/');
  row = await t.db.prepare('SELECT status, attempts FROM outbox').first();
  assert.deepEqual([row.status, row.attempts], ['sent', 3]);
  assert.equal(calls[2].init.headers['idempotency-key'], calls[0].init.headers['idempotency-key'], 'retry preserves provider idempotency key');
});

test('forgot password: an emailed one-time link, and the same answer for unknown addresses', async () => {
  const env = mailEnv();
  const t = makeApp({ env });
  await setupSalon(t);
  const b = new Browser(t.app, { ip: '192.0.2.70' });
  let res = await b.post('/forgot', { email: 'nobody@example.com' });
  assert.match(res.text, /If an account exists for that address/);
  assert.equal(env.MAIL_SINK.length, 0);
  res = await b.post('/forgot', { email: 'owner@lumen.test' });
  assert.match(res.text, /If an account exists for that address/);
  assert.equal(env.MAIL_SINK.length, 1);
  const link = /http:\/\/localhost:8787(\/reset\/[A-Za-z0-9_-]+)/.exec(env.MAIL_SINK[0].text)[1];
  assert.equal((await b.post(link, { password: 'brand new password' })).location, '/login?ok=reset');
  assert.equal((await b.post('/login', { email: 'owner@lumen.test', password: 'brand new password' })).status, 303);
  assert.equal((await b.get(link)).status, 410);
});

test('calendar: a private feed for the salon and a file for the client, with correct times', async () => {
  const t = makeApp();
  const { owner, slug, serviceId } = await setupSalon(t);
  const { token } = await clientRequests(t, slug, serviceId, { name: 'Nora Hale' });
  const anon = new Browser(t.app);
  assert.equal((await anon.get(`/r/${token}/calendar.ics`)).status, 404, 'not before it is confirmed');
  const id = requestIds((await owner.get('/app')).text)[0];
  await owner.post(`/app/requests/${id}/confirm`, {});

  const ics = await anon.get(`/r/${token}/calendar.ics`);
  assert.equal(ics.status, 200);
  assert.match(ics.headers.get('content-type'), /text\/calendar/);
  assert.match(ics.text, /DTSTART:20261103T120000Z/, '13:00 in Berlin is 12:00 UTC in November');
  assert.match(ics.text, /DTEND:20261103T130000Z/);
  assert.doesNotMatch(ics.text, /Nora/, 'the client file holds no client data');

  let settings = await owner.get('/app/settings');
  assert.match(settings.text, /Create calendar address/);
  await owner.post('/app/settings/calendar', {});
  settings = await owner.get('/app/settings');
  const feed = /localhost:8787(\/cal\/[A-Za-z0-9_-]+\.ics)/.exec(settings.text)[1];
  const cal = await anon.get(feed);
  assert.equal(cal.status, 200);
  assert.match(cal.text, /SUMMARY:Cut & finish \+ Deep conditioning \(Nora\)/);
  assert.match(cal.text, /Nora Hale\\, \+44 7700 900123/);
  await owner.post('/app/settings/calendar', {});
  assert.equal((await anon.get(feed)).status, 404, 'a new address retires the old one');
  assert.equal((await anon.get('/cal/not-a-token.ics')).status, 404);
});

test('guided setup: a salon type, your prices, and the request page is live', async () => {
  const t = makeApp();
  const owner = new Browser(t.app);
  await owner.post('/signup', { salon: 'Nail Atelier', email: 'n@n.test', password: PASSWORD, timezone: 'Europe/Berlin', currency: 'EUR', terms: 'on' });
  let res = await owner.get('/app/setup');
  assert.match(res.text, /Nail studio/);
  res = await owner.get('/app/setup?template=nails');
  assert.match(res.text, /name="s0_name" maxlength="80" value="Gel manicure"/);
  // Missing price: refused, everything entered is kept.
  const form = {
    template: 'nails',
    s0_on: 'on', s0_name: 'Gel manicure', s0_minutes: '50', s0_price: '',
    s1_name: 'Classic manicure', s1_minutes: '35', s1_price: '',
    u0_on: 'on', u0_name: 'Hand massage', u0_minutes: '10',
    u1_on: 'on', u1_name: 'Paraffin treatment', u1_minutes: '15',
    day: ['2', '3'], start: '13:00', end: '16:00', capacity: '2',
  };
  res = await owner.post('/app/setup', form);
  assert.equal(res.status, 400);
  assert.match(res.text, /Check the name, minutes and price of this service/);
  res = await owner.post('/app/setup', { ...form, s0_price: '45' });
  assert.equal(res.location, '/app?ok=setup_done');
  const counts = await t.db.prepare('SELECT (SELECT COUNT(*) FROM services) AS s, (SELECT COUNT(*) FROM upgrades) AS u, (SELECT COUNT(*) FROM windows) AS w').first();
  assert.deepEqual({ ...counts }, { s: 1, u: 2, w: 2 });
  const dash = await owner.get('/app');
  assert.doesNotMatch(dash.text, /Get your request page ready/);
  const offers = await new Browser(t.app).get('/s/nail-atelier/offers?service=1');
  assert.match(offers.text, /Gel manicure \+ Paraffin treatment/);
  assert.match(offers.text, /€45\.00 <span>your usual price/);
});

test('share kit: link, texts in the page language, QR code, poster, website button', async () => {
  const t = makeApp();
  const { owner } = await setupSalon(t);
  await owner.post('/app/settings', { name: 'Studio Lumen', slug: 'studio-lumen', timezone: 'Europe/Berlin', currency: 'EUR', locale: 'fr', uplift: '30', lead: '120' });
  const share = await owner.get('/app/share');
  assert.match(share.text, /in the language of your request page: Français/);
  assert.match(share.text, /<img class="qr" src="\/app\/qr\.svg"/);
  assert.match(share.text, /&lt;a href=&quot;http:\/\/localhost:8787\/s\/studio-lumen&quot;/);
  const qr = await owner.get('/app/qr.svg');
  assert.match(qr.headers.get('content-type'), /image\/svg\+xml/);
  assert.match(qr.text, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 \d+ \d+"/);
  const poster = await owner.get('/app/poster');
  assert.match(poster.text, /<html lang="fr">/);
  assert.equal((await new Browser(t.app).get('/app/qr.svg')).status, 303, 'only the owner gets the QR file');
});

test('results: page visits, offers, requests and confirmations are counted per day, bots are not', async () => {
  const t = makeApp();
  const { owner, slug, serviceId } = await setupSalon(t);
  const bot = new Browser(t.app, { userAgent: 'WhatsApp/2.23 A' });
  await bot.get(`/s/${slug}`);
  const person = new Browser(t.app, { ip: '198.51.100.50' });
  await person.get(`/s/${slug}`);
  await person.get(`/s/${slug}`);
  await clientRequests(t, slug, serviceId, { ip: '198.51.100.51' });
  const id = requestIds((await owner.get('/app')).text)[0];
  await owner.post(`/app/requests/${id}/confirm`, {});
  const { results } = await t.db.prepare('SELECT metric, n FROM stats_daily ORDER BY metric').all();
  assert.deepEqual(Object.fromEntries(results.map((r) => [r.metric, r.n])), { confirmed: 1, offers: 1, request: 1, view: 2 });
  const dash = await owner.get('/app');
  assert.match(dash.text, /Visits to your page/);
  assert.match(dash.text, /<progress max="2" value="2"/);
});

test('CSV export: every request, safe to open in a spreadsheet', async () => {
  const t = makeApp();
  const { owner, slug, serviceId } = await setupSalon(t);
  await clientRequests(t, slug, serviceId, { name: '=HYPERLINK("http://evil")', contact: '+44 7700 900123' });
  const csv = await owner.get('/app/export/requests.csv');
  assert.match(csv.headers.get('content-type'), /text\/csv/);
  assert.match(csv.headers.get('content-disposition'), /attachment; filename="requests-studio-lumen-2026-11-02\.csv"/);
  const lines = csv.text.replace(/^\uFEFF/, '').trim().split('\r\n');
  assert.equal(lines.length, 2);
  assert.match(lines[0], /^Reference,Type,Status,Service/);
  assert.match(lines[1], /,"'=HYPERLINK\(""http:\/\/evil""\)",/);
  assert.match(lines[1], /,40\.00,40\.00,EUR,/);
  assert.equal((await new Browser(t.app).get('/app/export/requests.csv')).status, 303);
});

test('live demo: a private sample salon, logged in at once, gone after a day', async () => {
  const env = mailEnv();
  const t = makeApp({ env });
  const visitor = new Browser(t.app, { ip: '192.0.2.150' });
  const res = await visitor.post('/demo', { lang: 'en', timezone: 'Europe/Berlin' });
  assert.equal(res.location, '/app?ok=demo');
  const dash = await visitor.get('/app?ok=demo');
  assert.match(dash.text, /This is a demo salon/);
  assert.match(dash.text, /Waiting for you/);
  assert.equal(requestIds(dash.text).length, 2, 'two sample requests wait for an answer');
  assert.match(dash.text, /Nora Hale/);
  const salon = await t.db.prepare('SELECT slug, is_demo FROM salons').first();
  assert.equal(salon.is_demo, 1);
  // The visitor can play the client too; no email ever leaves a demo salon.
  const page = await new Browser(t.app, { ip: '192.0.2.151' }).get(`/s/${salon.slug}`);
  assert.equal(page.status, 200);
  const id = requestIds(dash.text)[0];
  await visitor.post(`/app/requests/${id}/confirm`, {});
  assert.equal(env.MAIL_SINK.length, 0);
  // The audit chain of the demo is intact.
  assert.match((await visitor.get('/app/audit')).text, /Chain intact/);
  // Demo salons are not counted on the operator page and expire after 24 hours.
  t.advance(25 * 3600000);
  await new Browser(t.app).get('/');
  assert.equal((await t.db.prepare('SELECT COUNT(*) AS n FROM salons').first()).n, 0);
  assert.equal((await visitor.get('/app')).status, 303);
  // Rate limit and switch.
  const busy = new Browser(t.app, { ip: '192.0.2.160' });
  for (let i = 0; i < 5; i++) await busy.post('/demo', {});
  assert.equal((await busy.post('/demo', {})).status, 429);
  const off = makeApp({ env: { DEMO_MODE: 'off' } });
  assert.equal((await new Browser(off.app).post('/demo', {})).status, 404);
});

test('database upgrade: a version-1 database keeps its data and gains the new features', async () => {
  const db = createD1(':memory:');
  await db.batch(schemaStatements(SCHEMA_SQL).map((s) => db.prepare(s)));
  await db.prepare("INSERT INTO salons (slug, name, timezone, currency, created_at) VALUES ('old-salon', 'Old Salon', 'Europe/Berlin', 'EUR', '2026-10-01T00:00:00Z')").run();
  await db.prepare("INSERT INTO services (salon_id, name, duration_min, price_cents, created_at) VALUES (1, 'Cut', 45, 4000, 'x')").run();
  const app = createApp({ db, env: { PBKDF2_ITERATIONS: '10000' }, clock: () => new Date('2026-11-02T08:00:00Z') });
  const res = await new Browser(app).get('/s/old-salon');
  assert.equal(res.status, 200);
  assert.match(res.text, /Old Salon/);
  const row = await db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").first();
  assert.equal(row.value, '3');
});

test('server errors are logged for the operator without personal data', async () => {
  const db = createD1(':memory:');
  const broken = {
    prepare(sql) {
      if (/FROM salons WHERE slug = \?/.test(sql) && !/LIKE/.test(sql)) throw new Error('disk on fire');
      return db.prepare(sql);
    },
    batch: (s) => db.batch(s),
    exec: (s) => db.exec(s),
  };
  const app = createApp({ db: broken, env: { ADMIN_KEY: 'k'.repeat(32) } });
  const res = await new Browser(app).get('/s/whatever');
  assert.equal(res.status, 500);
  assert.match(res.text, /Something went wrong on our side/);
  const row = await db.prepare('SELECT method, path, message FROM error_log').first();
  assert.deepEqual({ ...row }, { method: 'GET', path: '/s/whatever', message: 'Error' });
});

test('emails: the console provider prints messages instead of sending them (local testing)', async () => {
  const logged = [];
  const original = console.log;
  console.log = (line) => logged.push(String(line));
  try {
    const t = makeApp({ env: { MAIL_PROVIDER: 'console', MAIL_FROM: 'Reflow <requests@reflow.example>' } });
    const { slug, serviceId } = await setupSalon(t);
    await clientRequests(t, slug, serviceId, { contact: 'nora@example.com' });
  } finally {
    console.log = original;
  }
  const text = logged.join('\n');
  assert.match(text, /----- email: owner\.offer -----/);
  assert.match(text, /To: owner@lumen\.test/);
  assert.match(text, /From: "Studio Lumen via Reflow" <requests@reflow\.example>/);
  assert.match(text, /----- email: client\.offer -----/);
});

test('legal notice, link previews and the home-screen icon', async () => {
  const off = makeApp();
  assert.equal((await new Browser(off.app).get('/legal')).status, 404, 'no page without a notice');
  assert.doesNotMatch((await new Browser(off.app).get('/')).text, /href="\/legal"/);
  const t = makeApp({ env: { LEGAL_NOTICE: 'Studio Operations GmbH | Musterstraße 1, 10115 Berlin | VAT ID DE123456789' } });
  const de = new Browser(t.app, { language: 'de' });
  const home = await de.get('/');
  assert.match(home.text, /<a href="\/legal">Impressum<\/a>/);
  const legal = await de.get('/legal');
  assert.equal(legal.status, 200);
  assert.match(legal.text, /<h1>Impressum<\/h1>/);
  assert.match(legal.text, /Studio Operations GmbH<br>Musterstraße 1, 10115 Berlin<br>VAT ID DE123456789/);
  assert.match((await de.get('/sitemap.xml')).text, /\/legal\?lang=de/);
  // Shared salon links show the salon's name and a picture in chat apps.
  const { slug } = await setupSalon(t);
  const salon = await new Browser(t.app, { language: 'fr' }).get(`/s/${slug}`);
  assert.match(salon.text, /<meta property="og:title" content="Studio Lumen">/);
  assert.match(salon.text, /<meta property="og:description" content="C’est complet à l’horaire souhaité/);
  assert.match(salon.text, /<meta property="og:image" content="http:\/\/localhost:8787\/og\.png">/);
  assert.match(salon.text, /<meta name="robots" content="noindex, nofollow">/);
  for (const path of ['/og.png', '/apple-touch-icon.png']) {
    const res = await t.app.fetch(new Request(`http://localhost:8787${path}`));
    const bytes = new Uint8Array(await res.arrayBuffer());
    assert.equal(res.headers.get('content-type'), 'image/png');
    assert.equal(res.headers.get('cross-origin-resource-policy'), 'cross-origin');
    assert.deepEqual([...bytes.slice(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], 'a PNG file');
  }
  assert.equal((await new Browser(t.app).get('/')).headers.get('cross-origin-resource-policy'), 'same-origin');
});

test('calendar text escapes commas, semicolons, backslashes and line breaks (RFC 5545)', async () => {
  const { icsText } = await import('../src/ics.js');
  assert.equal(icsText('Cut; wash, dry\\ done\nnext'), String.raw`Cut\; wash\, dry\\ done\nnext`);
});
