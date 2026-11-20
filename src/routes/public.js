// Copyright (c) 2026 Miloš Petrović (Trench Logic Studio) · SPDX-License-Identifier: MIT
// Public pages: landing, a salon's request page, offers, the client's status page.

import { HttpError, readForm, redirect, textResponse, jsonResponse } from '../http.js';
import { FormReader, contactKind } from '../validate.js';
import { randomToken, shortRef } from '../crypto.js';
import { writeWithEvent } from '../events.js';
import { hit, limiterKey } from '../ratelimit.js';
import { localNow, addDays, fmtTime, localToUtc } from '../time.js';
import { CONSENT_VERSION } from '../config.js';
import { isLocale, negotiate, LOCALES, htmlLang } from '../i18n/index.js';
import { salonBySlug, salonById, listServices, getService, listUpgrades, listWindows, busySlots, requestByToken, parseUpgrades } from '../repo.js';
import { expireForSalon } from '../maintenance.js';
import { hasAccess, ensureBillingTrial } from '../billing.js';
import { bump, isBot } from '../stats.js';
import { availabilityGuard, validSlotInstant } from '../availability.js';
import { findQuotedOffer } from '../quote.js';
import { notifyNewRequest } from '../notify.js';
import { deliverDue } from '../mail.js';
import { calendar } from '../ics.js';
import { computeOffers, assertOffer, DEFAULTS, selfTest, ENGINE } from '../../engines/reflow/engine.js';
import { SCHEMA_VERSION } from '../db/schema.js';
import { landingView } from '../views/landing.js';
import { withLang } from '../views/layout.js';
import { salonView, offersView, waitlistView, statusView, privacyView, termsView, legalView } from '../views/public.js';
import { CSS, JS, FAVICON, ROBOTS, OG_PNG, TOUCH_ICON_PNG } from '../views/assets.js';
import { page, toId, nowSec } from './util.js';

const STATIC_CACHE = { 'cache-control': 'public, max-age=604800, immutable' };

const fromBase64 = (b64) => Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
const png = (b64) =>
  new Response(fromBase64(b64), {
    headers: { 'content-type': 'image/png', 'cache-control': 'public, max-age=604800', 'cross-origin-resource-policy': 'cross-origin' },
  });

/** The operator's legal notice (imprint), when one is configured. */
async function legalNotice(c) {
  if (!c.config.legalNotice.length) throw new HttpError(404, 'This page does not exist.');
  return page(legalView(c));
}

/** The public, indexable pages in every language, linked to each other. */
async function sitemap(c) {
  const origin = c.url.origin;
  const url = (path, l) => `${origin}${withLang(path, l)}`;
  const pages = ['/', '/privacy', '/terms', ...(c.config.legalNotice.length ? ['/legal'] : [])];
  const entries = pages.flatMap((path) =>
    LOCALES.map(
      (l) => `  <url>
    <loc>${url(path, l)}</loc>
${LOCALES.map((o) => `    <xhtml:link rel="alternate" hreflang="${htmlLang(o)}" href="${url(path, o)}"/>`).join('\n')}
  </url>`,
    ),
  );
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${entries.join('\n')}
</urlset>
`;
  return new Response(xml, { headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=86400' } });
}

async function loadSalon(c) {
  const slug = String(c.params.slug || '').toLowerCase();
  if (!/^[a-z0-9-]{2,40}$/.test(slug)) throw new HttpError(404, 'There is no salon at this address. Check the link you were given.');
  const salon = await salonBySlug(c.db, slug);
  if (!salon) throw new HttpError(404, 'There is no salon at this address. Check the link you were given.');
  // Clients see their own browser language when it is one we have, otherwise the salon's.
  c.useLocale(c.langParam || negotiate(c.request.headers.get('accept-language'), salon.locale));
  await ensureBillingTrial(c.db, salon, c.billing, c.now);
  return salon;
}

async function loadService(c, salon, raw) {
  let id;
  try {
    id = toId(raw);
  } catch {
    return null;
  }
  const service = await getService(c.db, salon.id, id);
  return service && service.active === 1 ? service : null;
}

/** Count one step of the funnel, for people only and in the salon's own calendar day. */
function count(c, salon, metric) {
  if (isBot(c.request.headers.get('user-agent'))) return;
  const day = localNow(salon.timezone, c.now).date;
  c.defer(() => bump(c.db, salon.id, metric, day));
}

export function deliverSoon(c) {
  if (!c.mail.provider) return;
  c.defer(() => deliverDue(c.db, c.env, c.mail, c.now, { fetchImpl: c.fetch, productName: c.config.productName }));
}

/** The engine's answer for one service right now, from live salon data. */
export async function offersFor(c, salon, service, excludeId = 0) {
  await expireForSalon(c.db, salon, c.now);
  const now = localNow(salon.timezone, c.now);
  const [upgrades, windows, busy] = await Promise.all([
    listUpgrades(c.db, salon.id),
    listWindows(c.db, salon.id),
    busySlots(c.db, salon.id, now.date, addDays(now.date, DEFAULTS.horizonDays), excludeId),
  ]);
  const result = computeOffers({ service, upgrades, windows, busy, now, upliftPct: salon.min_uplift_pct, leadMin: salon.lead_min });
  if (result.offers) result.offers = result.offers.filter((slot) => validSlotInstant(slot, salon.timezone));
  if (result.status === 'upgrade_redirect' && !result.offers.length) result.status = 'waitlist';
  return result;
}

async function home(c) {
  return page(landingView(c, await c.getUser()));
}

async function salonPage(c) {
  const salon = await loadSalon(c);
  const services = await listServices(c.db, salon.id, { activeOnly: true });
  count(c, salon, 'view');
  return page(salonView(c, salon, services));
}

async function offersPage(c) {
  const salon = await loadSalon(c);
  const service = await loadService(c, salon, c.url.searchParams.get('service'));
  if (!service) return redirect(c.link(`/s/${salon.slug}`));
  const locked = !hasAccess(salon, c.billing, c.now);
  const result = locked ? null : await offersFor(c, salon, service);
  count(c, salon, !locked && result.status === 'upgrade_redirect' ? 'offers' : 'noslot');
  return page(offersView(c, salon, service, result || {}, { locked }));
}

function readClient(f) {
  const name = f.text('name', { label: 'Your name', max: 80 });
  const contact = f.text('contact', { label: 'Phone or email', max: 120 });
  if (contact && !contactKind(contact)) f.fail('contact', f.t('Enter a phone number or an email address.'));
  if (!f.checkbox('consent')) f.fail('consent', f.t('Please agree, so the salon can contact you about this request.'));
  return { name, contact };
}

async function guardSubmission(c, salon) {
  const sec = nowSec(c);
  const perIp = await hit(c.db, await limiterKey('request-ip', c.ip), 15, 3600, sec);
  const perSalon = await hit(c.db, `request-salon:${salon.id}`, 300, 86400, sec);
  if (!perIp || !perSalon) throw new HttpError(429, 'Too many requests were sent from here. Please try again in an hour, or contact the salon directly.');
}

/** Form posts carry the page language in a hidden field. */
function formLocale(c, form, salon) {
  const lang = form.get('lang');
  c.useLocale(isLocale(lang) ? lang : salon.locale);
  if (isLocale(lang) && lang !== salon.locale) c.langParam = lang;
}

async function createRequest(c) {
  const salon = await loadSalon(c);
  const form = await readForm(c.request);
  formLocale(c, form, salon);
  const f = new FormReader(form, c.t);
  if (f.raw('website')) throw new HttpError(400, 'This request could not be sent. Please contact the salon directly.');
  const service = await loadService(c, salon, f.raw('service'));
  if (!service) return redirect(c.link(`/s/${salon.slug}`));
  const values = { name: f.raw('name'), contact: f.raw('contact'), consent: f.checkbox('consent'), offer: f.raw('offer'), note: '' };
  if (!hasAccess(salon, c.billing, c.now)) return page(waitlistView(c, salon, service, { values, locked: true }), 409);

  const client = readClient(f);
  const key = f.raw('offer');
  const result = await offersFor(c, salon, service);
  if (!key) f.fail('offer', c.t('Choose one of the times.'));
  if (!f.ok) return page(offersView(c, salon, service, result, { values, errors: f.errors }), 400);

  const offer = findQuotedOffer(result, key);
  if (!offer) {
    return page(
      offersView(c, salon, service, result, { values: { ...values, offer: '' }, message: c.t('That time was just taken or has changed. Here is what is free now.') }),
      409,
    );
  }
  await guardSubmission(c, salon);
  assertOffer(offer, service); // I1 and I2 once more, right before the write

  const token = randomToken(24);
  const stamp = c.now.toISOString();
  let ref = shortRef();
  const guard = availabilityGuard(salon.id, offer, c.now);
  const reserved = await writeWithEvent(
    c.db,
    salon.id,
    'request.offer',
    () => ({
      ref,
      service_id: service.id,
      slot: `${offer.slot_date} ${fmtTime(offer.start_min)}`,
      base_min: offer.base_min,
      added_min: offer.added_min,
      uplift_pct: offer.uplift_pct,
      upgrades: offer.upgrades.map((u) => u.id),
      standard_price_cents: offer.standard_price_cents,
      price_cents: offer.price_cents,
      currency: salon.currency,
    }),
    (attempt) => {
      if (attempt > 0) ref = shortRef();
      return [
        c.db
          .prepare(
            `INSERT INTO requests (salon_id, token, ref, kind, status, service_id, service_name, base_min, added_min, total_min,
               uplift_pct, upgrades_json, standard_price_cents, price_cents, currency, slot_date, start_min, end_min, capacity,
               client_name, client_contact, consent_at, consent_version, created_at, locale, hold_expires_at)
             SELECT ?, ?, ?, 'offer', 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
             WHERE (${guard.sql}) AND EXISTS (SELECT 1 FROM services WHERE id = ? AND salon_id = ? AND active = 1 AND price_cents = ? AND duration_min = ?)`,
          )
          .bind(
            salon.id,
            token,
            ref,
            service.id,
            service.name,
            offer.base_min,
            offer.added_min,
            offer.total_min,
            offer.uplift_pct,
            JSON.stringify(offer.upgrades),
            offer.standard_price_cents,
            offer.price_cents,
            salon.currency,
            offer.slot_date,
            offer.start_min,
            offer.end_min,
            offer.capacity,
            client.name,
            client.contact,
            stamp,
            CONSENT_VERSION,
            stamp,
            c.locale,
            new Date(c.now.getTime() + salon.hold_hours * 3600000).toISOString(),
            ...guard.params, service.id, salon.id, service.price_cents, service.duration_min,
          ),
      ];
    },
    { condition: 'EXISTS (SELECT 1 FROM requests WHERE token = ?)', conditionParams: [token], at: () => c.now },
  );
  if (reserved[0].meta.changes !== 1) return page(offersView(c, salon, service, await offersFor(c, salon, service), { values, message: c.t('That time was just taken or has changed. Here is what is free now.') }), 409);
  count(c, salon, 'request');
  const created = await requestByToken(c.db, token);
  await notifyNewRequest({ db: c.db, mail: c.mail, now: c.now, origin: c.url.origin }, salon, created);
  deliverSoon(c);
  return redirect(`/r/${token}`);
}

async function createWaitlist(c) {
  const salon = await loadSalon(c);
  const form = await readForm(c.request);
  formLocale(c, form, salon);
  const f = new FormReader(form, c.t);
  if (f.raw('website')) throw new HttpError(400, 'This request could not be sent. Please contact the salon directly.');
  const service = await loadService(c, salon, f.raw('service'));
  if (!service) return redirect(c.link(`/s/${salon.slug}`));
  const client = readClient(f);
  const note = f.multiline('note', { label: 'Your note', max: 300 });
  if (!f.ok) {
    const values = { name: f.raw('name'), contact: f.raw('contact'), consent: f.checkbox('consent'), note: f.raw('note') };
    return page(waitlistView(c, salon, service, { values, errors: f.errors, locked: !hasAccess(salon, c.billing, c.now) }), 400);
  }
  await guardSubmission(c, salon);

  const token = randomToken(24);
  const stamp = c.now.toISOString();
  let ref = shortRef();
  await writeWithEvent(
    c.db,
    salon.id,
    'request.waitlist',
    () => ({ ref, service_id: service.id, standard_price_cents: service.price_cents, currency: salon.currency }),
    (attempt) => {
      if (attempt > 0) ref = shortRef();
      return [
        c.db
          .prepare(
            `INSERT INTO requests (salon_id, token, ref, kind, status, service_id, service_name, base_min, added_min, total_min,
               uplift_pct, upgrades_json, standard_price_cents, price_cents, currency,
               client_name, client_contact, note, consent_at, consent_version, created_at, locale)
             VALUES (?, ?, ?, 'waitlist', 'pending', ?, ?, ?, 0, ?, ?, '[]', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            salon.id,
            token,
            ref,
            service.id,
            service.name,
            service.duration_min,
            service.duration_min,
            salon.min_uplift_pct,
            service.price_cents,
            service.price_cents,
            salon.currency,
            client.name,
            client.contact,
            note || null,
            stamp,
            CONSENT_VERSION,
            stamp,
            c.locale,
          ),
      ];
    },
    { at: () => c.now },
  );
  count(c, salon, 'waitlist');
  const created = await requestByToken(c.db, token);
  await notifyNewRequest({ db: c.db, mail: c.mail, now: c.now, origin: c.url.origin }, salon, created);
  deliverSoon(c);
  return redirect(`/r/${token}`);
}

async function loadRequest(c) {
  const token = String(c.params.token || '');
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) throw new HttpError(404, 'This request link is not valid.');
  let r = await requestByToken(c.db, token);
  if (!r) throw new HttpError(404, 'This request link is not valid.');
  const salon = await salonById(c.db, r.salon_id);
  if (r.status === 'pending') {
    await expireForSalon(c.db, salon, c.now);
    r = await requestByToken(c.db, token);
  }
  c.useLocale(c.langParam || r.locale);
  return { r, salon };
}

async function statusPage(c) {
  const { r, salon } = await loadRequest(c);
  return page(statusView(c, salon, r, parseUpgrades(r.upgrades_json)), 200, { 'x-robots-tag': 'noindex' });
}

/** One confirmed appointment as a calendar file, for the client. */
async function clientCalendar(c) {
  const { r, salon } = await loadRequest(c);
  if (r.kind !== 'offer' || r.status !== 'confirmed' || r.outcome === 'no_show') throw new HttpError(404, 'This appointment is not confirmed yet.');
  const t = c.t;
  const upgrades = parseUpgrades(r.upgrades_json);
  const body = calendar({
    name: salon.name,
    now: c.now,
    events: [
      {
        uid: `${r.ref}-${r.token.slice(0, 8)}@${c.url.host}`,
        start: localToUtc(r.slot_date, r.start_min, salon.timezone),
        end: localToUtc(r.slot_date, r.end_min, salon.timezone),
        summary: `${salon.name}: ${[r.service_name, ...upgrades.map((u) => u.name)].join(' + ')}`,
        description: [
          t('{total} instead of {base}', { total: t.duration(r.total_min), base: t.duration(r.base_min) }),
          t('Price: {price}, the standard price', { price: t.money(r.price_cents, r.currency) }),
          t('Reference: {ref}', { ref: r.ref }),
          salon.phone ? t('Phone: {phone}', { phone: salon.phone }) : '',
        ]
          .filter(Boolean)
          .join('\n'),
        location: salon.address || '',
      },
    ],
  });
  return new Response(body, {
    headers: {
      'content-type': 'text/calendar; charset=utf-8',
      'content-disposition': `attachment; filename="appointment-${r.ref}.ics"`,
      'x-robots-tag': 'noindex',
    },
  });
}

async function healthz(c) {
  const engine = selfTest();
  let db = 'ok';
  try {
    await c.db.prepare('SELECT 1 AS ok').first();
  } catch {
    db = 'error';
  }
  const ok = engine.ok && db === 'ok';
  return jsonResponse(
    {
      ok,
      version: c.config.version,
      schema: SCHEMA_VERSION,
      engine: { name: ENGINE.name, version: ENGINE.version, selftest: engine.ok ? 'pass' : 'fail', checks: engine.checks },
      db,
      email: c.mail.provider ? 'on' : 'off',
      billing: c.billing.enabled ? c.billing.provider : 'off',
      deployment_ready: c.readiness.ready,
    },
    { status: ok ? 200 : 500 },
  );
}

export function registerPublic(r) {
  r.get('/', home);
  r.get('/privacy', async (c) => page(privacyView(c)));
  r.get('/terms', async (c) => page(termsView(c)));
  r.get('/healthz', healthz);
  r.get('/static/app.css', async () => new Response(CSS, { headers: { 'content-type': 'text/css; charset=utf-8', ...STATIC_CACHE } }));
  r.get('/static/app.js', async () => new Response(JS, { headers: { 'content-type': 'text/javascript; charset=utf-8', ...STATIC_CACHE } }));
  r.get('/favicon.svg', async () => new Response(FAVICON, { headers: { 'content-type': 'image/svg+xml', 'cache-control': 'public, max-age=86400' } }));
  r.get('/og.png', async () => png(OG_PNG));
  r.get('/apple-touch-icon.png', async () => png(TOUCH_ICON_PNG));
  r.get('/legal', legalNotice);
  r.get('/robots.txt', async (c) => textResponse(`${ROBOTS}\nSitemap: ${c.url.origin}/sitemap.xml\n`, { headers: { 'cache-control': 'public, max-age=86400' } }));
  r.get('/sitemap.xml', sitemap);
  r.get('/s/:slug', salonPage);
  r.get('/s/:slug/offers', offersPage);
  r.post('/s/:slug/request', createRequest);
  r.post('/s/:slug/waitlist', createWaitlist);
  r.get('/r/:token', statusPage);
  r.get('/r/:token/calendar.ics', clientCalendar);
}
