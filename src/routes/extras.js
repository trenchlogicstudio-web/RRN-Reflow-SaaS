// Copyright (c) 2026 Miloš Petrović (Trench Logic Studio) · SPDX-License-Identifier: MIT
// Salon calendar feed, payment-provider webhook, and the live demo.

import { HttpError, readForm, readLimited, redirect, jsonResponse } from '../http.js';
import { isLocale, translator } from '../i18n/index.js';
import { isValidTimeZone, localNow, addDays, localToUtc } from '../time.js';
import { calendar } from '../ics.js';
import { parseUpgrades } from '../repo.js';
import { applyBillingEvent } from '../billing-state.js';
import { verifyLemonSqueezy, verifyStripe, parseWebhook } from '../billing.js';
import { createDemoSalon } from '../demo.js';
import { startSession } from '../auth.js';
import { hit, limiterKey } from '../ratelimit.js';
import { nowSec } from './util.js';

/** GET /cal/<token>.ics: confirmed appointments for the salon's own calendar app. */
async function salonCalendar(c) {
  const m = /^([A-Za-z0-9_-]{20,100})\.ics$/.exec(String(c.params.file || ''));
  if (!m) throw new HttpError(404, 'There is nothing at this address.');
  const salon = await c.db.prepare('SELECT id, name, timezone, address FROM salons WHERE calendar_token = ?').bind(m[1]).first();
  if (!salon) throw new HttpError(404, 'There is nothing at this address.');
  const owner = await c.db.prepare('SELECT locale FROM users WHERE salon_id = ? ORDER BY id LIMIT 1').bind(salon.id).first();
  const t = translator(owner ? owner.locale : 'en');
  const from = addDays(localNow(salon.timezone, c.now).date, -30);
  const { results } = await c.db
    .prepare(
      `SELECT ref, token, service_name, upgrades_json, slot_date, start_min, end_min, total_min, price_cents, currency, client_name, client_contact
         FROM requests WHERE salon_id = ? AND kind = 'offer' AND status = 'confirmed' AND (outcome IS NULL OR outcome = 'completed') AND slot_date >= ?
        ORDER BY slot_date, start_min LIMIT 2000`,
    )
    .bind(salon.id, from)
    .all();
  const events = results.map((r) => {
    const what = [r.service_name, ...parseUpgrades(r.upgrades_json).map((u) => u.name)].join(' + ');
    const who = r.client_name || t('Client');
    return {
      uid: `${r.ref}-${r.token.slice(0, 8)}@${c.url.host}`,
      start: localToUtc(r.slot_date, r.start_min, salon.timezone),
      end: localToUtc(r.slot_date, r.end_min, salon.timezone),
      summary: `${what} (${who.split(' ')[0]})`,
      description: [
        `${who}${r.client_contact ? `, ${r.client_contact}` : ''}`,
        t('Price: {price}, the standard price', { price: t.money(r.price_cents, r.currency) }),
        t('Reference: {ref}', { ref: r.ref }),
      ].join('\n'),
      location: salon.address || '',
    };
  });
  return new Response(calendar({ name: salon.name, events, now: c.now }), {
    headers: { 'content-type': 'text/calendar; charset=utf-8', 'cache-control': 'private, max-age=300', 'x-robots-tag': 'noindex' },
  });
}

/** POST /billing/webhook: signed subscription updates from Lemon Squeezy or Stripe. */
async function billingWebhook(c) {
  const b = c.billing;
  if (!b.enabled) throw new HttpError(404, 'There is nothing at this address.');
  const raw = await readLimited(c.request, 256 * 1024);
  const valid =
    b.provider === 'lemonsqueezy'
      ? await verifyLemonSqueezy(b.secret, raw, c.request.headers.get('x-signature'))
      : await verifyStripe(b.secret, raw, c.request.headers.get('stripe-signature'), nowSec(c));
  if (!valid) return jsonResponse({ ok: false, error: 'invalid signature' }, { status: 400 });
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return jsonResponse({ ok: false, error: 'invalid json' }, { status: 400 });
  }
  const upd = parseWebhook(b.provider, payload);
  if (!upd) return jsonResponse({ ok: true, ignored: true });

  try {
    return jsonResponse(await applyBillingEvent(c, upd));
  } catch {
    // Do not acknowledge an event that could not be safely applied. Providers retry.
    return jsonResponse({ ok: false, retry: true }, { status: 503 });
  }
}

/** POST /demo: a private sample salon for 24 hours, logged in straight away. */
async function startDemo(c) {
  if (!c.config.demoEnabled) throw new HttpError(404, 'There is nothing at this address.');
  const form = await readForm(c.request);
  const lang = form.get('lang');
  if (isLocale(lang)) c.useLocale(lang);
  if (!(await hit(c.db, await limiterKey('demo-ip', c.ip), 5, 3600, nowSec(c)))) {
    throw new HttpError(429, 'Too many demos were started from here. Please try again in an hour.');
  }
  await c.db.prepare('DELETE FROM salons WHERE is_demo = 1 AND demo_expires_at < ?').bind(c.now.toISOString()).run();
  const { n } = await c.db.prepare('SELECT COUNT(*) AS n FROM salons WHERE is_demo = 1').first();
  if (n >= 300) throw new HttpError(429, 'The demo is very busy right now. Please try again in a few minutes.');
  const tz = form.get('timezone');
  const { userId } = await createDemoSalon(c.db, { t: c.t, now: c.now, timezone: isValidTimeZone(tz) ? tz : 'Europe/Berlin' });
  const cookie = await startSession(c.db, userId, { secure: c.secure, now: c.now });
  return redirect('/app?ok=demo', { cookies: [cookie] });
}

export function registerExtras(r) {
  r.get('/cal/:file', salonCalendar);
  r.post('/billing/webhook', billingWebhook);
  r.post('/demo', startDemo);
}
