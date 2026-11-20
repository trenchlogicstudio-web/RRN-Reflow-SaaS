// Copyright (c) 2026 Miloš Petrović (Trench Logic Studio) · SPDX-License-Identifier: MIT
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, Browser, offerKeys, requestIds, setupSalon, clientRequests, PASSWORD } from './helpers.js';

const DAY = 86400000;

test('happy path: sign up, set up, client requests, owner confirms, numbers add up', async () => {
  const t = makeApp();
  const owner = new Browser(t.app);

  // Sign up lands on the dashboard with the setup checklist.
  const signup = await owner.post('/signup', {
    salon: 'Studio Lumen',
    email: 'Owner@Lumen.test',
    password: PASSWORD,
    timezone: 'Europe/Berlin',
    currency: 'EUR',
    terms: 'on',
  });
  assert.equal(signup.status, 303);
  assert.equal(signup.location, '/app?ok=welcome');
  let dash = await owner.get('/app?ok=welcome');
  assert.equal(dash.status, 200);
  assert.match(dash.text, /Get your request page ready/);
  assert.match(dash.text, /localhost:8787\/s\/studio-lumen/);

  // A service alone is not enough: the engine needs +30% of upgrades.
  assert.equal((await owner.post('/app/services', { name: 'Cut & finish', duration: '45', price: '40,00' })).status, 303);
  let services = await owner.get('/app/services');
  assert.match(services.text, /needs upgrades worth at least 14 extra minutes/);

  assert.equal((await owner.post('/app/upgrades', { name: 'Deep conditioning', minutes: '15', service: 'all' })).status, 303);
  services = await owner.get('/app/services');
  assert.match(services.text, /Offered as Cut &amp; finish \+ Deep conditioning: 1 h instead of 45 min/);

  assert.equal((await owner.post('/app/hours', { day: ['2', '4'], start: '13:00', end: '16:00', capacity: '1' })).status, 303);
  const hours = await owner.get('/app/hours');
  assert.match(hours.text, /<svg class="week"/);
  assert.equal((hours.text.match(/action="\/app\/hours\/\d+\/delete"/g) || []).length, 2);

  dash = await owner.get('/app');
  assert.doesNotMatch(dash.text, /Get your request page ready/);

  // The client's page reads like the salon's price list.
  const client = new Browser(t.app, { ip: '198.51.100.7' });
  const salonPage = await client.get('/s/studio-lumen');
  assert.equal(salonPage.status, 200);
  assert.match(salonPage.text, /Cut &amp; finish/);
  assert.match(salonPage.text, /€40\.00/);
  assert.equal(salonPage.headers.get('set-cookie'), null, 'client pages set no cookies');

  const serviceId = (await t.db.prepare('SELECT id FROM services').first()).id;
  const offers = await client.get(`/s/studio-lumen/offers?service=${serviceId}`);
  assert.equal(offers.status, 200);
  const keys = offerKeys(offers.text);
  assert.equal(keys.length, 3, 'one offer per day, three days');
  assert.match(offers.text, /Tue 3 Nov, <span class="offer-time">13:00–14:00/);
  assert.equal((offers.text.match(/€40\.00 <span>your usual price/g) || []).length, 3);
  assert.equal((offers.text.match(/1 h instead of 45 min/g) || []).length, 3);

  // Request: the server ignores any price the browser sends.
  const sent = await client.post('/s/studio-lumen/request', {
    service: serviceId,
    offer: keys[0],
    name: 'Nora Hale',
    contact: '+44 7700 900123',
    consent: 'on',
    price: '1',
    price_cents: '100',
  });
  assert.equal(sent.status, 303);
  assert.match(sent.location, /^\/r\/[A-Za-z0-9_-]{32}$/);
  const status = await client.get(sent.location);
  assert.match(status.text, /Request sent/);
  assert.match(status.text, /Tuesday 3 November/);
  assert.doesNotMatch(status.text, /Nora Hale/, 'the status page shows no personal data');
  const stored = await t.db.prepare('SELECT * FROM requests').first();
  assert.equal(stored.price_cents, 4000);
  assert.equal(stored.standard_price_cents, 4000);
  assert.equal(stored.added_min, 15);
  assert.equal(stored.total_min, 60);
  assert.equal(stored.consent_version, 'c1');

  // The owner sees it and confirms it.
  dash = await owner.get('/app');
  assert.match(dash.text, /Nora Hale/);
  assert.match(dash.text, /href="tel:\+447700900123"/);
  const [id] = requestIds(dash.text);
  const confirm = await owner.post(`/app/requests/${id}/confirm`, {});
  assert.equal(confirm.location, '/app?ok=confirmed');

  const after = await client.get(sent.location);
  assert.match(after.text, /Confirmed/);
  assert.match(after.text, /See you on Tuesday 3 November at 13:00/);

  dash = await owner.get('/app');
  assert.match(dash.text, /<dt>Requests received<\/dt><dd>1<\/dd>/);
  assert.match(dash.text, /<dt>Confirmed<\/dt><dd>1<\/dd>/);
  assert.match(dash.text, /<dt>Booked value<\/dt><dd>€40\.00<\/dd>/);
  assert.match(dash.text, /<dt>Discount given<\/dt><dd>€0\.00<\/dd>/);
  assert.match(dash.text, /Hi Nora, your appointment at Studio Lumen is confirmed: Tuesday 3 November at 13:00\./);

  // The confirmed slot no longer appears for the next client (capacity 1).
  const next = await new Browser(t.app, { ip: '198.51.100.8' }).get(`/s/studio-lumen/offers?service=${serviceId}`);
  assert.doesNotMatch(next.text, /Tue 3 Nov, <span class="offer-time">13:00/);
  assert.match(next.text, /Tue 3 Nov, <span class="offer-time">14:00–15:00/);

  // The audit chain holds every step and verifies.
  const audit = await owner.get('/app/audit');
  assert.match(audit.text, /Chain intact: 6 entries checked/);
});

test('capacity: a full slot cannot be confirmed twice', async () => {
  const t = makeApp();
  const { owner, slug, serviceId } = await setupSalon(t, { capacity: 2 });
  const a = await clientRequests(t, slug, serviceId, { name: 'Ada', ip: '198.51.100.1' });
  const b = await clientRequests(t, slug, serviceId, { name: 'Ben', ip: '198.51.100.2' });
  assert.equal(a.key, b.key, 'two chairs: both clients are offered the same time');

  // The salon now has only one chair at that time.
  const hours = await owner.get('/app/hours');
  const windowId = Number(/\/app\/hours\/(\d+)\/delete/.exec(hours.text)[1]);
  await owner.post(`/app/hours/${windowId}/delete`, {});
  await owner.post('/app/hours', { day: '2', start: '13:00', end: '16:00', capacity: '1' });

  const dash = await owner.get('/app');
  const ids = requestIds(dash.text);
  assert.equal(ids.length, 2);
  assert.equal((await owner.post(`/app/requests/${ids[0]}/confirm`, {})).location, '/app?ok=confirmed');
  assert.equal((await owner.post(`/app/requests/${ids[1]}/confirm`, {})).location, '/app?ok=full');
  const rows = (await t.db.prepare('SELECT status FROM requests ORDER BY id').all()).results.map((r) => r.status);
  assert.deepEqual(rows, ['confirmed', 'pending']);
  // Confirming twice is harmless.
  assert.equal((await owner.post(`/app/requests/${ids[0]}/confirm`, {})).location, '/app?ok=decided');
  // Declining the second one frees the client to choose again.
  assert.equal((await owner.post(`/app/requests/${ids[1]}/decline`, {})).location, '/app?ok=declined');
  const page = await b.client.get(`/r/${b.token}`);
  assert.match(page.text, /Not available/);
  assert.match(page.text, /Choose another time/);
});

test('pending requests hold their time so two clients are not offered the last chair', async () => {
  const t = makeApp();
  const { slug, serviceId } = await setupSalon(t, { capacity: 1 });
  const a = await clientRequests(t, slug, serviceId, { ip: '198.51.100.1' });
  const page = await new Browser(t.app, { ip: '198.51.100.2' }).get(`/s/${slug}/offers?service=${serviceId}`);
  assert.ok(!offerKeys(page.text).includes(a.key));
});

test('a stale or forged offer is refused and the current options are shown', async () => {
  const t = makeApp();
  const { slug, serviceId } = await setupSalon(t);
  const client = new Browser(t.app, { ip: '198.51.100.3' });
  for (const offer of ['2026-11-03@780#999', '2026-11-03@60#1', 'garbage']) {
    const res = await client.post(`/s/${slug}/request`, { service: serviceId, offer, name: 'Ada', contact: 'ada@example.com', consent: 'on' });
    assert.equal(res.status, 409, offer);
    assert.match(res.text, /That time was just taken or has changed/);
  }
  assert.equal((await t.db.prepare('SELECT COUNT(*) AS n FROM requests').first()).n, 0);
});

test('client form validation, consent and the spam trap', async () => {
  const t = makeApp();
  const { slug, serviceId } = await setupSalon(t);
  const client = new Browser(t.app, { ip: '198.51.100.4' });
  const key = offerKeys((await client.get(`/s/${slug}/offers?service=${serviceId}`)).text)[0];
  let res = await client.post(`/s/${slug}/request`, { service: serviceId, offer: key, name: '', contact: 'nope', consent: '' });
  assert.equal(res.status, 400);
  assert.match(res.text, /Your name is required/);
  assert.match(res.text, /Enter a phone number or an email address/);
  assert.match(res.text, /Please agree, so the salon can contact you/);
  res = await client.post(`/s/${slug}/request`, { service: serviceId, offer: key, name: 'Bot', contact: 'bot@example.com', consent: 'on', website: 'http://spam' });
  assert.equal(res.status, 400);
  assert.equal((await t.db.prepare('SELECT COUNT(*) AS n FROM requests').first()).n, 0);
});

test('waitlist when no upgraded time exists, and the owner marks it contacted', async () => {
  const t = makeApp();
  const { owner, slug, serviceId } = await setupSalon(t, { windows: [] });
  const client = new Browser(t.app, { ip: '198.51.100.5' });
  const page = await client.get(`/s/${slug}/offers?service=${serviceId}`);
  assert.match(page.text, /No upgraded time is free right now/);
  assert.match(page.text, /action="\/s\/studio-lumen\/waitlist"/);
  const res = await client.post(`/s/${slug}/waitlist`, {
    service: serviceId,
    name: 'Ada',
    contact: 'ada@example.com',
    consent: 'on',
    note: 'Weekday mornings',
  });
  assert.equal(res.status, 303);
  assert.match((await client.get(res.location)).text, /You are on the waitlist/);
  const dash = await owner.get('/app');
  assert.match(dash.text, /Weekday mornings/);
  assert.match(dash.text, /href="mailto:ada@example.com"/);
  const [id] = requestIds(dash.text, 'close');
  assert.equal((await owner.post(`/app/requests/${id}/close`, {})).location, '/app?ok=closed');
  assert.match((await client.get(res.location)).text, /Handled/);
  // A waitlist entry can never be "confirmed" as an appointment.
  assert.equal((await owner.post(`/app/requests/${id}/confirm`, {})).status, 400);
});

test('expired and erased: time passes, pending requests expire, client details are deleted after 90 days', async () => {
  const t = makeApp();
  const { owner, slug, serviceId } = await setupSalon(t);
  const kept = await clientRequests(t, slug, serviceId, { name: 'Ada Kept', index: 0, ip: '198.51.100.1' });
  const lost = await clientRequests(t, slug, serviceId, { name: 'Ben Lost', index: 0, ip: '198.51.100.2' });
  const ids = requestIds((await owner.get('/app')).text);
  await owner.post(`/app/requests/${ids[0]}/confirm`, {});

  t.advance(2 * DAY); // past Tuesday 3 November
  assert.match((await lost.client.get(`/r/${lost.token}`)).text, /Expired/);
  assert.equal(requestIds((await owner.get('/app')).text).length, 0);

  t.advance(91 * DAY);
  assert.equal((await owner.get('/app')).status, 303, 'sessions last 30 days');
  // Any traffic triggers the daily housekeeping, even without a scheduled job.
  await new Browser(t.app).get('/');
  const row = await t.db.prepare("SELECT client_name, client_contact, erased_at, status, price_cents FROM requests WHERE status = 'confirmed'").first();
  assert.equal(row.client_name, null);
  assert.equal(row.client_contact, null);
  assert.ok(row.erased_at);
  assert.equal(row.price_cents, 4000);
  await owner.post('/login', { email: 'owner@lumen.test', password: PASSWORD });
  const dash = await owner.get('/app');
  assert.match(dash.text, /<dt>Booked value<\/dt><dd>€40\.00<\/dd>/, 'metrics survive erasure');
  assert.doesNotMatch(dash.text, /Ada Kept|Ben Lost/);
  assert.match((await kept.client.get(`/r/${kept.token}`)).text, /Confirmed/);
});

test('the client page follows the salon’s own time zone', async () => {
  // 2026-11-02 21:30 UTC is Monday 22:30 in Berlin but already Tuesday 10:30 in Auckland.
  const t = makeApp({ start: '2026-11-02T21:30:00Z' });
  const berlin = await setupSalon(t, { name: 'Berlin Salon', email: 'b@b.test', timezone: 'Europe/Berlin' });
  const auckland = await setupSalon(t, { name: 'Auckland Salon', email: 'a@a.test', timezone: 'Pacific/Auckland' });
  const c = new Browser(t.app);
  const pb = await c.get(`/s/${berlin.slug}/offers?service=${berlin.serviceId}`);
  const pa = await c.get(`/s/${auckland.slug}/offers?service=${auckland.serviceId}`);
  assert.match(pb.text, /Tue 3 Nov, <span class="offer-time">13:00/, 'Berlin: Tuesday is tomorrow');
  assert.match(pa.text, /Tue 3 Nov, <span class="offer-time">13:00/, 'Auckland: today, 13:00 is more than two hours away');
  t.setNow('2026-11-03T00:00:00Z'); // 13:00 in Auckland: inside the notice period
  const pa2 = await c.get(`/s/${auckland.slug}/offers?service=${auckland.serviceId}`);
  assert.doesNotMatch(pa2.text, /Tue 3 Nov, <span class="offer-time">13:00/);
  assert.match(pa2.text, /Tue 3 Nov, <span class="offer-time">15:00/);
});

test('services: edit, hide, invalid input, escaped output', async () => {
  const t = makeApp();
  const { owner, slug, serviceId } = await setupSalon(t);
  let res = await owner.post('/app/services', { name: '', duration: '3', price: 'abc' });
  assert.equal(res.status, 400);
  assert.match(res.text, /Name is required/);
  assert.match(res.text, /Length must be between 5 and 600/);
  assert.match(res.text, /Enter a price such as 40 or 40\.50/);

  res = await owner.post('/app/services', { name: '<script>alert(1)</script>', duration: '30', price: '25' });
  assert.equal(res.status, 303);
  const pub = await new Browser(t.app).get(`/s/${slug}`);
  assert.doesNotMatch(pub.text, /<script>alert/);
  assert.match(pub.text, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);

  res = await owner.post(`/app/services/${serviceId}`, { action: 'save', name: 'Cut & finish', duration: '50', price: '45.50' });
  assert.equal(res.location, '/app/services?ok=service_saved');
  const svc = await t.db.prepare('SELECT duration_min, price_cents FROM services WHERE id = ?').bind(serviceId).first();
  assert.deepEqual({ ...svc }, { duration_min: 50, price_cents: 4550 });
  const offers = await new Browser(t.app).get(`/s/${slug}/offers?service=${serviceId}`);
  assert.match(offers.text, /€45\.50 <span>your usual price/);

  res = await owner.post(`/app/services/${serviceId}`, { action: 'hide' });
  assert.equal(res.location, '/app/services?ok=service_hidden');
  const hidden = await new Browser(t.app).get(`/s/${slug}/offers?service=${serviceId}`);
  assert.equal(hidden.status, 303, 'a hidden service cannot be requested');
});

test('quiet hours: validation', async () => {
  const t = makeApp();
  const { owner } = await setupSalon(t, { windows: [] });
  let res = await owner.post('/app/hours', { start: '16:00', end: '15:00', capacity: '0' });
  assert.equal(res.status, 400);
  assert.match(res.text, /Choose at least one day/);
  assert.match(res.text, /Quiet hours must last at least 30 minutes/);
  assert.match(res.text, /Free chairs must be between 1 and 50/);
  res = await owner.post('/app/hours', { day: '8', start: '13:00', end: '14:00', capacity: '1' });
  assert.equal(res.status, 400);
  res = await owner.post('/app/hours', { day: ['1', '1'], start: '00:00', end: '24:00', capacity: '1' });
  assert.equal(res.status, 303);
  assert.equal((await t.db.prepare('SELECT COUNT(*) AS n FROM windows').first()).n, 1);
});

test('settings: uplift never below 30%, page address changes, account deletion removes everything', async () => {
  const t = makeApp();
  const { owner, slug, serviceId } = await setupSalon(t);
  await clientRequests(t, slug, serviceId);
  const base = { name: 'Studio Lumen', slug, timezone: 'Europe/Berlin', currency: 'EUR', lead: '120' };
  let res = await owner.post('/app/settings', { ...base, uplift: '20' });
  assert.equal(res.status, 400);
  assert.match(res.text, /Minimum extra time must be between 30 and 200/);
  res = await owner.post('/app/settings', { ...base, uplift: '40', slug: 'lumen-studio' });
  assert.equal(res.location, '/app/settings?ok=settings_saved');
  assert.equal((await new Browser(t.app).get(`/s/${slug}`)).status, 404);
  assert.equal((await new Browser(t.app).get('/s/lumen-studio')).status, 200);
  // 40% of 45 min = 18 min: the 15-minute upgrade alone is no longer enough.
  const offers = await new Browser(t.app).get(`/s/lumen-studio/offers?service=${serviceId}`);
  assert.match(offers.text, /No upgraded time is free right now/);

  res = await owner.post('/app/settings/delete', { password: 'wrong password' });
  assert.equal(res.status, 400);
  res = await owner.post('/app/settings/delete', { password: PASSWORD });
  assert.match(res.location, /^\/login\?ok=deleted/);
  for (const table of ['salons', 'users', 'sessions', 'services', 'upgrades', 'windows', 'requests', 'events']) {
    assert.equal((await t.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first()).n, 0, table);
  }
  assert.equal((await owner.get('/app')).status, 303);
});

test('plan page: Relay and Nexus collect interest', async () => {
  const t = makeApp();
  const { owner } = await setupSalon(t);
  let plan = await owner.get('/app/plan');
  assert.match(plan.text, /Tell me when Relay opens/);
  assert.match(plan.text, /Tell me when Nexus opens/);
  assert.equal((await owner.post('/app/plan/interest', { tier: 'relay' })).location, '/app/plan?ok=interest');
  assert.equal((await owner.post('/app/plan/interest', { tier: 'relay' })).location, '/app/plan?ok=interest');
  assert.equal((await owner.post('/app/plan/interest', { tier: 'gold' })).status, 400);
  plan = await owner.get('/app/plan');
  assert.doesNotMatch(plan.text, /Tell me when Relay opens/);
  assert.equal((await t.db.prepare('SELECT COUNT(*) AS n FROM interest').first()).n, 1);
});

test('password change logs out other devices', async () => {
  const t = makeApp();
  const { owner } = await setupSalon(t);
  const laptop = new Browser(t.app);
  await laptop.post('/login', { email: 'owner@lumen.test', password: PASSWORD });
  assert.equal((await laptop.get('/app')).status, 200);
  let res = await owner.post('/app/settings/password', { current: 'nope', password: 'a much longer password' });
  assert.equal(res.status, 400);
  res = await owner.post('/app/settings/password', { current: PASSWORD, password: 'a much longer password' });
  assert.equal(res.location, '/app/settings?ok=password_saved');
  assert.equal((await owner.get('/app')).status, 200, 'this device stays logged in');
  assert.equal((await laptop.get('/app')).status, 303, 'the other device is logged out');
});
