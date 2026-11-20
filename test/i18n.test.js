// Copyright (c) 2026 Miloš Petrović (Trench Logic Studio) · SPDX-License-Identifier: MIT
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractKeys, placeholders } from './i18n-keys.js';
import { DICTIONARIES, LOCALES, onMissingTranslation, translator, negotiate } from '../src/i18n/index.js';
import { FLASH } from '../src/views/dashboard.js';
import { makeApp, Browser, mailEnv, offerKeys, requestIds, PASSWORD } from './helpers.js';

const KEYS = extractKeys();
const LANGS = LOCALES.filter((l) => l !== 'en');
const DAY = 86400000;
const LS = {
  BILLING_PROVIDER: 'lemonsqueezy',
  CHECKOUT_URL: 'https://studio.lemonsqueezy.com/checkout/buy/variant-123',
  BILLING_WEBHOOK_SECRET: 'whsec_lemon_test_secret',
  BILLING_PORTAL_URL: 'https://studio.lemonsqueezy.com/billing',
  PRICE_LABEL: '€19 / month',
};

test('every language has every string, with the same placeholders and nothing left over', () => {
  const problems = [];
  for (const loc of LANGS) {
    const dict = DICTIONARIES[loc];
    for (const key of KEYS.keys()) {
      if (!Object.prototype.hasOwnProperty.call(dict, key)) {
        problems.push(`${loc} missing: ${JSON.stringify(key)}`);
        continue;
      }
      const value = dict[key];
      if (typeof value !== 'string' || !value.trim()) problems.push(`${loc} empty: ${JSON.stringify(key)}`);
      else if (placeholders(value).join() !== placeholders(key).join()) problems.push(`${loc} placeholders: ${JSON.stringify(key)} → ${JSON.stringify(value)}`);
      else if (value.trim() !== value && key.trim() === key) problems.push(`${loc} spaces: ${JSON.stringify(value)}`);
      else if (/[<>]/.test(value) && !/[<>]/.test(key)) problems.push(`${loc} markup: ${JSON.stringify(value)}`);
      else if (/\.\s*$/.test(key) !== /[.!?。]\s*$/.test(value) && /\.\s*$/.test(key)) problems.push(`${loc} full stop: ${JSON.stringify(value)}`);
    }
    for (const key of Object.keys(dict)) if (!KEYS.has(key)) problems.push(`${loc} unused: ${JSON.stringify(key)}`);
  }
  assert.equal(problems.length, 0, `${problems.length} problems:\n${problems.slice(0, 80).join('\n')}`);
});

test('dates, numbers, money and plurals follow each language', () => {
  const de = translator('de');
  assert.equal(de.money(4050, 'EUR'), '40,50 €');
  assert.equal(de.n(1, '{n} chair', '{n} chairs'), de('{n} chair', { n: 1 }));
  assert.equal(translator('fr').weekday(1), 'lundi');
  assert.equal(translator('pt').money(4050, 'BRL'), 'R$ 40,50');
  assert.equal(translator('nl').date('2026-11-03'), 'di 3 nov');
  assert.equal(translator('en').money(4050, 'USD'), '$40.50');
  assert.equal(negotiate('pt-BR,pt;q=0.9,en;q=0.5'), 'pt');
  assert.equal(negotiate('sr-RS,sr;q=0.9', 'de'), 'de', 'unknown languages fall back');
});

/**
 * Walks through every page, form error, email and state of the product in one
 * language, with or without billing. Any string shown that has no translation is
 * reported by the i18n missing-translation hook.
 */
async function tour(loc, { billing }) {
  const env = { ...mailEnv(), ...(billing ? LS : {}) };
  const t = makeApp({ env });
  const ok = (res, status, what) => assert.equal(res.status, status, `${loc} ${what}: ${res.status} ${res.text.slice(0, 300)}`);

  // Public site, sign-up with mistakes, then for real.
  const owner = new Browser(t.app, { language: loc });
  for (const path of ['/', '/signup', '/login', '/forgot', '/privacy', '/terms', '/no-such-page']) await owner.get(path);
  ok(await owner.post('/signup', { lang: loc, salon: '', email: 'not-an-email', password: 'short', timezone: 'Mars/Base', currency: 'XXX' }), 400, 'signup errors');
  ok(await owner.post('/signup', { lang: loc, salon: 'Studio Lumen', email: 'owner@lumen.test', password: PASSWORD, timezone: 'Europe/Berlin', currency: 'EUR', terms: 'on' }), 303, 'signup');
  await owner.get('/app');

  // Guided setup: every template, a failed attempt, then the hair salon.
  await owner.get('/app/setup');
  for (const tpl of ['hair', 'barber', 'nails', 'beauty']) await owner.get(`/app/setup?template=${tpl}`);
  ok(await owner.post('/app/setup', { template: 'hair', s0_on: 'on', s0_name: '', s0_minutes: '1', s0_price: 'abc', u0_on: 'on', u0_name: '', u0_minutes: '1', start: 'x', end: '', capacity: '0' }), 400, 'setup errors');
  ok(await owner.post('/app/setup', { template: 'hair', s0_on: 'on', s0_name: '', s0_minutes: '45', s0_price: '40' }), 400, 'setup without upgrades');
  const setup = { template: 'hair', day: ['2', '3'], start: '13:00', end: '16:00', capacity: '1' };
  for (let i = 0; i < 4; i++) Object.assign(setup, { [`s${i}_on`]: 'on', [`s${i}_name`]: `Service ${i}`, [`s${i}_minutes`]: '45', [`s${i}_price`]: '40', [`u${i}_on`]: 'on', [`u${i}_name`]: `Upgrade ${i}`, [`u${i}_minutes`]: '15' });
  ok(await owner.post('/app/setup', setup), 303, 'setup');

  // Services, upgrades and quiet hours: lists, errors, edits, hide and show.
  await owner.get('/app/services');
  ok(await owner.post('/app/services', { name: '', duration: 'x', price: '' }), 400, 'service errors');
  ok(await owner.post('/app/services', { name: 'Marathon', duration: '600', price: '300' }), 303, 'long service');
  const services = (await t.db.prepare('SELECT id FROM services ORDER BY id').all()).results.map((r) => r.id);
  ok(await owner.post(`/app/services/${services[0]}`, { action: 'save', name: '', duration: '1', price: 'x' }), 400, 'service edit errors');
  await owner.post(`/app/services/${services[0]}`, { action: 'save', name: 'Service 0', duration: '45', price: '40' });
  await owner.post(`/app/services/${services[1]}`, { action: 'hide' });
  await owner.post(`/app/services/${services[1]}`, { action: 'show' });
  await owner.post('/app/services/99999', { action: 'hide' });
  await owner.get('/app/upgrades');
  ok(await owner.post('/app/upgrades', { name: '', minutes: '1', service: 'nope' }), 400, 'upgrade errors');
  await owner.post('/app/upgrades', { name: 'Only for one', minutes: '15', service: String(services[0]) });
  const upgrades = (await t.db.prepare('SELECT id FROM upgrades ORDER BY id').all()).results.map((r) => r.id);
  await owner.post(`/app/upgrades/${upgrades[0]}`, { action: 'save', name: '', minutes: '1', service: 'all' });
  await owner.post(`/app/upgrades/${upgrades[1]}`, { action: 'hide' });
  await owner.post(`/app/upgrades/${upgrades[1]}`, { action: 'show' });
  await owner.get('/app/hours');
  ok(await owner.post('/app/hours', { start: '25:00', end: '', capacity: '0' }), 400, 'hours errors');
  await owner.post('/app/hours', { day: '9', start: '13:00', end: '13:10', capacity: '1' });
  await owner.post('/app/hours', { day: '4', start: '10:00', end: '12:00', capacity: '3' });
  const win = await t.db.prepare('SELECT id FROM windows ORDER BY id DESC').first();
  await owner.post(`/app/hours/${win.id}/delete`, {});

  // Every confirmation message.
  for (const code of Object.keys(FLASH)) await owner.get(`/app?ok=${code}`);

  // Clients in this language: offers, a waitlist, mistakes, and requests.
  const slug = (await t.db.prepare('SELECT slug FROM salons').first()).slug;
  const client = new Browser(t.app, { language: loc, ip: '198.51.100.7' });
  await client.get(`/s/${slug}`);
  const offers = await client.get(`/s/${slug}/offers?service=${services[0]}`);
  const keys = offerKeys(offers.text);
  assert.ok(keys.length >= 2, `${loc}: offers shown`);
  ok(await client.post(`/s/${slug}/request`, { lang: loc, service: services[0], offer: keys[0], name: '', contact: 'nope' }), 400, 'request errors');
  ok(await client.post(`/s/${slug}/request`, { lang: loc, service: services[0], offer: '2020-01-01@600#9', name: 'Nora Hale', contact: 'nora@example.com', consent: 'on' }), 409, 'stale offer');
  const sent = await client.post(`/s/${slug}/request`, { lang: loc, service: services[0], offer: keys[0], name: 'Nora Hale', contact: 'nora@example.com', consent: 'on' });
  ok(sent, 303, 'request');
  const second = await new Browser(t.app, { language: loc, ip: '198.51.100.8' }).post(`/s/${slug}/request`, { lang: loc, service: services[0], offer: keys[1], name: 'Lena Brandt', contact: 'lena@example.com', consent: 'on' });
  ok(second, 303, 'second request');
  await client.get(`/s/${slug}/offers?service=${services[4]}`); // too long for any quiet hour: waitlist
  ok(await client.post(`/s/${slug}/waitlist`, { lang: loc, service: services[4], name: '', contact: '' }), 400, 'waitlist errors');
  ok(await client.post(`/s/${slug}/waitlist`, { lang: loc, service: services[4], name: 'Tom Fischer', contact: '+49 30 1234567', note: 'Any Friday', consent: 'on' }), 303, 'waitlist');
  await client.get(sent.location);
  await client.get('/r/not-a-real-token-but-long-enough');
  await client.get(`/s/no-such-salon`);

  // The owner answers: confirm, decline, close; then the client's pages and files.
  await owner.get('/app');
  const pending = requestIds((await owner.get('/app')).text);
  await owner.post(`/app/requests/${pending[0]}/confirm`, {});
  await owner.post(`/app/requests/${pending[1]}/decline`, {});
  const waitId = requestIds((await owner.get('/app')).text, 'close')[0];
  await owner.post(`/app/requests/${waitId}/close`, {});
  await owner.post(`/app/requests/${pending[0]}/confirm`, {});
  await owner.get('/app');
  await client.get(sent.location);
  await client.get(`${sent.location}/calendar.ics`);
  await client.get(second.location);

  // Share kit, settings, account, calendar, export, plan, audit.
  for (const path of ['/app/share', '/app/poster', '/app/qr.svg', '/app/settings', '/app/plan', '/app/audit', '/app/export/requests.csv']) await owner.get(path);
  ok(await owner.post('/app/settings', { name: '', slug: '-', address: 'x'.repeat(200), phone: 'y'.repeat(50), timezone: 'Mars/Base', currency: 'XXX', locale: 'xx', uplift: '5', lead: '7' }), 400, 'settings errors');
  await owner.post('/app/settings', { name: 'Studio Lumen', slug, address: '12 Example Street', phone: '+49 30 1234567', timezone: 'Europe/Berlin', currency: 'EUR', locale: loc, uplift: '30', lead: '120' });
  await owner.post('/app/settings/account', { locale: loc });
  await owner.post('/app/settings/account', { locale: loc, notify: 'on' });
  await owner.post('/app/settings/calendar', {});
  await owner.get('/app/settings');
  await owner.post('/app/settings/password', { current: 'wrong password', password: 'short' });
  await owner.post('/app/settings/password', { current: PASSWORD, password: 'an even better password' });
  await owner.post('/app/plan/interest', { tier: 'relay' });
  await owner.get('/app/plan');
  await owner.get('/app/audit');

  // Billing states, as the owner sees them.
  if (billing) {
    await owner.post('/app/billing/checkout', {});
    for (const status of ['trialing', 'active', 'past_due', 'canceled', 'paused', 'expired']) {
      await t.db.prepare('UPDATE salons SET billing_status = ?, billing_period_end = ?, billing_subscription_id = ?').bind(status, '2026-12-01T00:00:00Z', 'sub_1').run();
      await owner.get('/app/plan');
      await owner.get('/app');
    }
    await t.db.prepare("UPDATE salons SET billing_status = 'trialing', trial_ends_at = ?").bind(new Date(t.now.getTime() + 3 * DAY).toISOString()).run();
    await owner.get('/app');
    await t.db.prepare("UPDATE salons SET billing_status = 'expired'").run();
    await client.get(`/s/${slug}/offers?service=${services[0]}`);
    await client.post(`/s/${slug}/request`, { lang: loc, service: services[0], offer: keys[0], name: 'Late', contact: 'late@example.com', consent: 'on' });
  }

  // Forgotten password, from the email to a new password.
  const visitor = new Browser(t.app, { language: loc, ip: '192.0.2.80' });
  ok(await visitor.post('/forgot', { lang: loc, email: 'nope' }), 400, 'forgot errors');
  await visitor.post('/forgot', { lang: loc, email: 'owner@lumen.test' });
  const resetMail = env.MAIL_SINK.find((m) => m.kind === 'user.reset');
  assert.ok(resetMail, `${loc}: reset email sent`);
  const link = /http:\/\/localhost:8787(\/reset\/[A-Za-z0-9_-]+)/.exec(resetMail.text)[1];
  await visitor.get(link);
  ok(await visitor.post(link, { lang: loc, password: 'short' }), 400, 'reset errors');
  const done = await visitor.post(link, { lang: loc, password: 'the newest password' });
  await visitor.get(done.location);
  await visitor.get(link);
  ok(await visitor.post('/login', { lang: loc, email: 'owner@lumen.test', password: 'wrong' }), 400, 'login error');
  ok(await visitor.post('/login', { lang: loc, email: '', password: '' }), 400, 'login empty');

  // Time passes: an unanswered request expires, details are erased.
  const late = await new Browser(t.app, { language: loc, ip: '198.51.100.9' }).get(`/s/${slug}/offers?service=${services[2]}`);
  const lateKey = offerKeys(late.text)[0];
  if (lateKey) {
    const r = await new Browser(t.app, { language: loc, ip: '198.51.100.9' }).post(`/s/${slug}/request`, { lang: loc, service: services[2], offer: lateKey, name: 'Ines', contact: '+351 912 345 678', consent: 'on' });
    t.advance(20 * DAY);
    await client.get(r.location);
  }
  t.advance(100 * DAY);
  await client.get(sent.location);

  // A demo in this language, and finally deleting the account.
  const demo = new Browser(t.app, { language: loc, ip: '192.0.2.81' });
  ok(await demo.post('/demo', { lang: loc, timezone: 'Europe/Lisbon' }), 303, 'demo');
  for (const path of ['/app', '/app/services', '/app/upgrades', '/app/hours', '/app/share', '/app/settings', '/app/plan', '/app/audit']) await demo.get(path);
  const again = new Browser(t.app, { language: loc, ip: '192.0.2.82' });
  await again.post('/login', { lang: loc, email: 'owner@lumen.test', password: 'the newest password' });
  await again.post('/app/settings/delete', { password: 'wrong' });
  const gone = await again.post('/app/settings/delete', { password: 'the newest password' });
  await again.get(gone.location);
  return env.MAIL_SINK;
}

test('a full tour of the product in every language finds no untranslated text', async () => {
  const missing = new Map();
  onMissingTranslation((loc, key) => {
    if (!missing.has(key)) missing.set(key, new Set());
    missing.get(key).add(loc);
  });
  try {
    const kinds = new Set();
    for (const loc of LANGS) {
      for (const billing of [false, true]) {
        const mails = await tour(loc, { billing });
        mails.forEach((m) => kinds.add(m.kind));
      }
    }
    assert.deepEqual([...kinds].sort(), ['client.confirmed', 'client.declined', 'client.offer', 'owner.offer', 'owner.waitlist', 'user.reset']);
  } finally {
    onMissingTranslation(null);
  }
  // Strings the key finder cannot see come first: they need tk() where they are defined.
  const entries = [...missing].sort(([a], [b]) => Number(KEYS.has(a)) - Number(KEYS.has(b)));
  const report = entries.map(([key, locs]) => `${[...locs].join(',')}: ${JSON.stringify(key)}${KEYS.has(key) ? '' : '  (not found by test/i18n-keys.js: mark it with tk())'}`);
  assert.equal(report.length, 0, `${report.length} untranslated strings shown:\n${report.slice(0, 120).join('\n')}`);
});

test('pages say which language they are in and link to the others', async () => {
  const t = makeApp();
  for (const loc of LOCALES) {
    const res = await new Browser(t.app, { language: loc }).get('/');
    assert.match(res.text, new RegExp(`<html lang="${loc === 'pt' ? 'pt-BR' : loc}">`));
    for (const other of LOCALES) assert.match(res.text, new RegExp(`href="/\\?lang=${other}"`));
  }
});

test('search engines get one address per language, linked together, and a sitemap', async () => {
  const t = makeApp();
  const de = await new Browser(t.app, { language: 'de' }).get('/');
  assert.match(de.text, /<link rel="canonical" href="http:\/\/localhost:8787\/\?lang=de">/);
  for (const loc of LOCALES) assert.match(de.text, new RegExp(`<link rel="alternate" hreflang="${loc === 'pt' ? 'pt-BR' : loc}" href="http://localhost:8787/\\?lang=${loc}">`));
  assert.match(de.text, /<link rel="alternate" hreflang="x-default" href="http:\/\/localhost:8787\/">/);
  assert.match(de.text, /<meta property="og:locale" content="de_DE">/);
  assert.match(de.text, /<meta property="og:description" content="Reflow macht aus „ausgebucht“/);
  // Pages that are not for search engines carry none of this.
  const login = await new Browser(t.app).get('/login');
  assert.doesNotMatch(login.text, /rel="canonical"/);
  const map = await new Browser(t.app).get('/sitemap.xml');
  assert.equal(map.headers.get('content-type'), 'application/xml; charset=utf-8');
  assert.equal((map.text.match(/<url>/g) || []).length, 3 * LOCALES.length);
  assert.match(map.text, /<loc>http:\/\/localhost:8787\/terms\?lang=nl<\/loc>/);
  const robots = await new Browser(t.app).get('/robots.txt');
  assert.match(robots.text, /Disallow: \/s\//);
  assert.match(robots.text, /Sitemap: http:\/\/localhost:8787\/sitemap\.xml/);
});
