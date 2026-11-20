// Copyright (c) 2026 Miloš Petrović (Trench Logic Studio) · SPDX-License-Identifier: MIT
// The salon's dashboard: requests, services, upgrades, quiet hours, sharing,
// settings and plan. Every query is scoped by the logged-in salon's id.

import { availabilityGuard } from '../availability.js';
import { hit } from '../ratelimit.js';
import { html } from '../html.js';
import { HttpError, readForm, redirect, serializeCookie } from '../http.js';
import { FormReader, isValidSlug } from '../validate.js';
import { parseMoney, CURRENCIES } from '../money.js';
import { localNow, isoWeekday, isValidTimeZone, parseTime, fmtTime, addDays } from '../time.js';
import { randomToken, verifyPassword } from '../crypto.js';
import { writeWithEvent, appendEvent, verifyChain } from '../events.js';
import { createPasswordRecord, replacePassword, startSession, endAllSessions, cookieName } from '../auth.js';
import { LOCALES, isLocale } from '../i18n/index.js';
import { selectBundle, MIN_UPLIFT_PCT } from '../../engines/reflow/engine.js';
import { hasAccess, initialBilling, checkoutLink } from '../billing.js';
import { funnel, bump } from '../stats.js';
import { notifyDecision } from '../notify.js';
import { qrSvg } from '../qr.js';
import { toCsv } from '../csv.js';
import { templateById } from '../templates.js';
import {
  listServices,
  getService,
  listUpgrades,
  listWindows,
  setupCounts,
  metrics,
  requestsWhere,
  requestById,
  parseUpgrades,
} from '../repo.js';
import { expireForSalon, erasePersonalData } from '../maintenance.js';
import { notice, rich } from '../views/layout.js';
import { dashboardView } from '../views/dashboard.js';
import { servicesView, upgradesView, setupChooserView, setupFormView } from '../views/catalog.js';
import { hoursView } from '../views/hours.js';
import { shareView, posterView } from '../views/share.js';
import { settingsView, planView, auditView, billingLine, NOTICE_MINUTES } from '../views/settings.js';
import { deliverSoon } from './public.js';
import { page, toId, requireUser, flashCode, nowSec } from './util.js';

const LIMIT = { services: 50, upgrades: 50, windows: 70 };

async function ensureTrial(c) {
  const s = c.user.salon;
  if (!c.billing.enabled || s.is_demo || s.billing_status !== 'beta') return;
  const bill = initialBilling(c.billing, c.now);
  await c.db
    .prepare("UPDATE salons SET billing_status = ?, trial_ends_at = ? WHERE id = ? AND billing_status = 'beta'")
    .bind(bill.status, bill.trialEndsAt, s.id)
    .run();
  s.billing_status = bill.status;
  s.trial_ends_at = bill.trialEndsAt;
}

/** Wraps a handler so it only runs for a logged-in salon owner, in the owner's language. */
function authed(handler) {
  return async (c) => {
    const { user, response } = await requireUser(c);
    if (response) return response;
    c.user = user;
    if (user.role === 'staff' && !/^\/app(?:$|\/requests\/)/.test(c.url.pathname)) throw new HttpError(403, 'Only the owner can change these settings.');
    c.useLocale(user.locale);
    await ensureTrial(c);
    return handler(c, user.salon);
  };
}

function banners(c) {
  const t = c.t;
  const s = c.user.salon;
  const out = [];
  if (s.is_demo) {
    out.push(
      notice(
        'info',
        rich(t, 'This is a demo salon: it and its sample data are deleted within 24 hours. {signup} to keep a salon of your own.', {
          signup: html`<a href="/signup?lang=${c.locale}">${t('Create your own account')}</a>`,
        }),
      ),
    );
  } else if (c.billing.enabled) {
    const planLink = html`<a href="/app/plan">${t('See your plan')}</a>`;
    if (!hasAccess(s, c.billing, c.now)) {
      out.push(notice('error', rich(t, 'Your request page shows only the waitlist until you subscribe. {plan}', { plan: planLink })));
    } else if (s.billing_status === 'trialing' && Date.parse(s.trial_ends_at) - c.now.getTime() < 7 * 86400000) {
      out.push(notice('info', rich(t, 'Your free trial ends on {date}. {plan}', { date: t.day(s.trial_ends_at, s.timezone), plan: planLink })));
    } else if (s.billing_status === 'past_due') {
      out.push(notice('error', html`${billingLine(c, s)} ${planLink}`));
    }
  }
  return out;
}

const withUpgrades = (r) => ({ ...r, upgrades: parseUpgrades(r.upgrades_json) });
const publicUrl = (c, salon) => `${c.url.origin}/s/${salon.slug}`;

/* -------------------------------- dashboard -------------------------------- */

async function dashboard(c, salon) {
  await expireForSalon(c.db, salon, c.now);
  await erasePersonalData(c.db, c.now, salon.id);
  const today = localNow(salon.timezone, c.now).date;
  const [counts, m, pending, waitlist, upcoming, recent, services, upgrades, f] = await Promise.all([
    setupCounts(c.db, salon.id),
    metrics(c.db, salon.id),
    requestsWhere(c.db, salon.id, "kind = 'offer' AND status = 'pending'", [], { order: 'slot_date, start_min, id' }),
    requestsWhere(c.db, salon.id, "kind = 'waitlist' AND status = 'pending'", [], { order: 'created_at, id' }),
    requestsWhere(c.db, salon.id, "kind = 'offer' AND status = 'confirmed' AND slot_date >= ?", [today], { order: 'slot_date, start_min, id', limit: 50 }),
    requestsWhere(c.db, salon.id, "status <> 'pending' AND NOT (kind = 'offer' AND status = 'confirmed' AND slot_date >= ?)", [today], {
      order: 'COALESCE(decided_at, created_at) DESC, id DESC',
      limit: 10,
    }),
    listServices(c.db, salon.id, { activeOnly: true }),
    listUpgrades(c.db, salon.id),
    funnel(c.db, salon.id, addDays(today, -29)),
  ]);
  const readyServices = services.filter((s) => selectBundle(s, upgrades, salon.min_uplift_pct)).length;
  return page(
    dashboardView(c, {
      flash: flashCode(c),
      setup: { ...counts, readyServices },
      metrics: m,
      funnel: f,
      pending: pending.map(withUpgrades),
      waitlist,
      upcoming: upcoming.map(withUpgrades),
      recent,
      publicUrl: publicUrl(c, salon),
      banners: banners(c),
    }),
  );
}

async function decide(c, salon, action) {
  await expireForSalon(c.db, salon, c.now);
  const id = toId(c.params.id);
  const r = await requestById(c.db, salon.id, id);
  if (!r) throw new HttpError(404, 'That request does not exist.');
  const expectedKind = action === 'close' ? 'waitlist' : 'offer';
  if (r.kind !== expectedKind) throw new HttpError(400, 'That action does not apply to this request.');
  if (r.status !== 'pending') return redirect('/app?ok=decided');

  const decisionRef = randomToken(12);
  const stamp = c.now.toISOString();
  const newStatus = { confirm: 'confirmed', decline: 'declined', close: 'closed' }[action];
  let update;
  let payload = { ref: r.ref, slot: r.slot_date, start: r.start_min, total: r.total_min, price: r.price_cents, currency: r.currency };

  if (action === 'confirm') {
    const guard = availabilityGuard(salon.id, r, c.now, id, true);
    update = () => c.db.prepare(`UPDATE requests SET status = 'confirmed', revision = revision + 1, decided_at = ?, decision_ref = ?, hold_expires_at = NULL
      WHERE id = ? AND salon_id = ? AND status = 'pending' AND kind = 'offer' AND revision = ? AND (${guard.sql})`)
      .bind(stamp, decisionRef, id, salon.id, r.revision, ...guard.params);
  } else {
    update = () =>
      c.db
        .prepare('UPDATE requests SET status = ?, revision = revision + 1, decided_at = ?, decision_ref = ? WHERE id = ? AND salon_id = ? AND status = ? AND kind = ? AND revision = ?')
        .bind(newStatus, stamp, decisionRef, id, salon.id, 'pending', expectedKind, r.revision);
  }

  const results = await writeWithEvent(c.db, salon.id, `request.${newStatus}`, payload, () => [update()], {
    condition: 'EXISTS (SELECT 1 FROM requests WHERE id = ? AND decision_ref = ?)',
    conditionParams: [id, decisionRef],
    at: () => c.now,
  });
  if (results[0].meta.changes === 1) {
    if (newStatus === 'confirmed' && !salon.is_demo) {
      const day = localNow(salon.timezone, c.now).date;
      c.defer(() => bump(c.db, salon.id, 'confirmed', day));
    }
    const fresh = await requestById(c.db, salon.id, id);
    await notifyDecision({ db: c.db, mail: c.mail, now: c.now, origin: c.url.origin }, salon, fresh);
    deliverSoon(c);
    return redirect(`/app?ok=${newStatus}`);
  }
  const fresh = await requestById(c.db, salon.id, id);
  if (fresh && fresh.status !== 'pending') return redirect('/app?ok=decided');
  return redirect('/app?ok=full');
}

/* --------------------------------- services -------------------------------- */

function readService(f) {
  const name = f.text('name', { label: 'Name', max: 80 });
  const duration = f.int('duration', { label: 'Length', min: 5, max: 600 });
  const price = parseMoney(f.raw('price'));
  if (price === null || price > 100000000) f.fail('price', f.t('Enter a price such as 40 or 40.50.'));
  return { name, duration, price };
}

async function servicesPage(c, salon, extra = {}) {
  const [services, upgrades] = await Promise.all([listServices(c.db, salon.id), listUpgrades(c.db, salon.id)]);
  return page(servicesView(c, { services, upgrades, flashCode: flashCode(c), banners: banners(c), ...extra }), extra.errors ? 400 : 200);
}

async function addService(c, salon) {
  const f = new FormReader(await readForm(c.request), c.t);
  const v = readService(f);
  const { n } = await c.db.prepare('SELECT COUNT(*) AS n FROM services WHERE salon_id = ?').bind(salon.id).first();
  if (n >= LIMIT.services) f.fail('name', c.t('You can have up to {n} services.', { n: LIMIT.services }));
  if (!f.ok) return servicesPage(c, salon, { values: { name: f.raw('name'), duration: f.raw('duration'), price: f.raw('price') }, errors: f.errors });
  const row = await c.db
    .prepare('INSERT INTO services (salon_id, name, duration_min, price_cents, created_at) VALUES (?, ?, ?, ?, ?) RETURNING id')
    .bind(salon.id, v.name, v.duration, v.price, c.now.toISOString())
    .first();
  await appendEvent(c.db, salon.id, 'service.created', { id: row.id, name: v.name, duration_min: v.duration, price_cents: v.price }, { at: () => c.now });
  return redirect('/app/services?ok=service_added');
}

async function updateService(c, salon) {
  const id = toId(c.params.id);
  const service = await getService(c.db, salon.id, id);
  if (!service) throw new HttpError(404, 'That service does not exist.');
  const f = new FormReader(await readForm(c.request), c.t);
  const action = f.raw('action');
  if (action === 'hide' || action === 'show') {
    const active = action === 'show' ? 1 : 0;
    await c.db.prepare('UPDATE services SET active = ? WHERE id = ? AND salon_id = ?').bind(active, id, salon.id).run();
    await appendEvent(c.db, salon.id, 'service.updated', { id, active }, { at: () => c.now });
    return redirect(`/app/services?ok=${active ? 'service_shown' : 'service_hidden'}`);
  }
  if (action !== 'save') throw new HttpError(400, 'Unknown action.');
  const v = readService(f);
  if (!f.ok) {
    return servicesPage(c, salon, { values: { name: f.raw('name'), duration: f.raw('duration'), price: f.raw('price') }, errors: f.errors, editId: id });
  }
  await c.db
    .prepare('UPDATE services SET name = ?, duration_min = ?, price_cents = ? WHERE id = ? AND salon_id = ?')
    .bind(v.name, v.duration, v.price, id, salon.id)
    .run();
  await appendEvent(
    c.db,
    salon.id,
    'service.updated',
    { id, name: v.name, duration_min: v.duration, price_cents: v.price, previous_price_cents: service.price_cents },
    { at: () => c.now },
  );
  return redirect('/app/services?ok=service_saved');
}

/* --------------------------------- upgrades -------------------------------- */

async function readUpgrade(c, salon, f) {
  const name = f.text('name', { label: 'Name', max: 80 });
  const minutes = f.int('minutes', { label: 'Extra minutes', min: 5, max: 240 });
  const scope = f.raw('service');
  let serviceId = null;
  if (scope !== 'all' && scope !== '') {
    let sid = null;
    try {
      sid = toId(scope);
    } catch {
      sid = null;
    }
    const s = sid && (await getService(c.db, salon.id, sid));
    if (!s) f.fail('service', c.t('Choose a service from the list.'));
    else serviceId = s.id;
  }
  return { name, minutes, serviceId };
}

async function upgradesPage(c, salon, extra = {}) {
  const [upgrades, services] = await Promise.all([listUpgrades(c.db, salon.id), listServices(c.db, salon.id)]);
  return page(upgradesView(c, { upgrades, services, flashCode: flashCode(c), banners: banners(c), ...extra }), extra.errors ? 400 : 200);
}

async function addUpgrade(c, salon) {
  const f = new FormReader(await readForm(c.request), c.t);
  const v = await readUpgrade(c, salon, f);
  const { n } = await c.db.prepare('SELECT COUNT(*) AS n FROM upgrades WHERE salon_id = ?').bind(salon.id).first();
  if (n >= LIMIT.upgrades) f.fail('name', c.t('You can have up to {n} upgrades.', { n: LIMIT.upgrades }));
  if (!f.ok) return upgradesPage(c, salon, { values: { name: f.raw('name'), minutes: f.raw('minutes'), service: f.raw('service') }, errors: f.errors });
  const row = await c.db
    .prepare('INSERT INTO upgrades (salon_id, service_id, name, added_min, created_at) VALUES (?, ?, ?, ?, ?) RETURNING id')
    .bind(salon.id, v.serviceId, v.name, v.minutes, c.now.toISOString())
    .first();
  await appendEvent(c.db, salon.id, 'upgrade.created', { id: row.id, name: v.name, added_min: v.minutes, service_id: v.serviceId }, { at: () => c.now });
  return redirect('/app/upgrades?ok=upgrade_added');
}

async function updateUpgrade(c, salon) {
  const id = toId(c.params.id);
  const existing = await c.db.prepare('SELECT id FROM upgrades WHERE id = ? AND salon_id = ?').bind(id, salon.id).first();
  if (!existing) throw new HttpError(404, 'That upgrade does not exist.');
  const f = new FormReader(await readForm(c.request), c.t);
  const action = f.raw('action');
  if (action === 'hide' || action === 'show') {
    const active = action === 'show' ? 1 : 0;
    await c.db.prepare('UPDATE upgrades SET active = ? WHERE id = ? AND salon_id = ?').bind(active, id, salon.id).run();
    await appendEvent(c.db, salon.id, 'upgrade.updated', { id, active }, { at: () => c.now });
    return redirect(`/app/upgrades?ok=${active ? 'upgrade_shown' : 'upgrade_hidden'}`);
  }
  if (action !== 'save') throw new HttpError(400, 'Unknown action.');
  const v = await readUpgrade(c, salon, f);
  if (!f.ok) {
    return upgradesPage(c, salon, { values: { name: f.raw('name'), minutes: f.raw('minutes'), service: f.raw('service') }, errors: f.errors, editId: id });
  }
  await c.db
    .prepare('UPDATE upgrades SET name = ?, added_min = ?, service_id = ? WHERE id = ? AND salon_id = ?')
    .bind(v.name, v.minutes, v.serviceId, id, salon.id)
    .run();
  await appendEvent(c.db, salon.id, 'upgrade.updated', { id, name: v.name, added_min: v.minutes, service_id: v.serviceId }, { at: () => c.now });
  return redirect('/app/upgrades?ok=upgrade_saved');
}

/* ---------------------------------- setup ---------------------------------- */

async function setupPage(c) {
  const template = templateById(c.url.searchParams.get('template'));
  if (!template) return page(setupChooserView(c, { banners: banners(c) }));
  return page(setupFormView(c, { template, banners: banners(c) }));
}

function readHours(c, f, form) {
  const days = [...new Set(form.getAll('day'))];
  if (!days.length) f.fail('day', c.t('Choose at least one day.'));
  if (days.some((d) => !/^[1-7]$/.test(d))) f.fail('day', c.t('Choose days from the list.'));
  const start = parseTime(f.raw('start'));
  const end = parseTime(f.raw('end'));
  if (start === null || start >= 1440) f.fail('start', c.t('Enter a start time such as 13:00.'));
  if (end === null) f.fail('end', c.t('Enter an end time such as 16:00.'));
  if (start !== null && end !== null && end - start < 30) f.fail('end', c.t('Quiet hours must last at least 30 minutes.'));
  const capacity = f.int('capacity', { label: 'Free chairs', min: 1, max: 50 });
  return { days, start, end, capacity };
}

async function applySetup(c, salon) {
  const form = await readForm(c.request);
  const f = new FormReader(form, c.t);
  const template = templateById(f.raw('template'));
  if (!template) throw new HttpError(400, 'Unknown salon type.');
  const services = template.services.map((_, i) => ({
    on: f.checkbox(`s${i}_on`),
    name: f.raw(`s${i}_name`).trim().replace(/\s+/g, ' '),
    minutes: f.raw(`s${i}_minutes`).trim(),
    price: f.raw(`s${i}_price`).trim(),
  }));
  const upgrades = template.upgrades.map((_, i) => ({
    on: f.checkbox(`u${i}_on`),
    name: f.raw(`u${i}_name`).trim().replace(/\s+/g, ' '),
    minutes: f.raw(`u${i}_minutes`).trim(),
  }));
  const chosenServices = [];
  services.forEach((s, i) => {
    if (!s.on) return;
    const minutes = Number(s.minutes);
    const price = parseMoney(s.price);
    if (!s.name || s.name.length > 80 || !Number.isInteger(minutes) || minutes < 5 || minutes > 600 || price === null || price > 100000000) {
      f.fail(`s${i}`, c.t('Check the name, minutes and price of this service.'));
    } else chosenServices.push({ name: s.name, minutes, price });
  });
  const chosenUpgrades = [];
  upgrades.forEach((u, i) => {
    if (!u.on) return;
    const minutes = Number(u.minutes);
    if (!u.name || u.name.length > 80 || !Number.isInteger(minutes) || minutes < 5 || minutes > 240) {
      f.fail(`u${i}`, c.t('Check the name and minutes of this upgrade.'));
    } else chosenUpgrades.push({ name: u.name, minutes });
  });
  if (!services.some((s) => s.on)) f.fail('services', c.t('Choose at least one service.'));
  const hours = readHours(c, f, form);
  const counts = await setupCounts(c.db, salon.id);
  if (counts.services + chosenServices.length > LIMIT.services) f.fail('services', c.t('You can have up to {n} services.', { n: LIMIT.services }));
  if (!f.ok) {
    const values = { services, upgrades, days: hours.days, start: f.raw('start'), end: f.raw('end'), capacity: f.raw('capacity') };
    return page(setupFormView(c, { template, values, errors: f.errors, banners: banners(c) }), 400);
  }
  const stamp = c.now.toISOString();
  const weekdays = hours.days.map(Number).sort();
  await writeWithEvent(
    c.db,
    salon.id,
    'setup.applied',
    { template: template.id, services: chosenServices.length, upgrades: chosenUpgrades.length, weekdays, start_min: hours.start, end_min: hours.end, capacity: hours.capacity },
    () => [
      ...chosenServices.map((s) =>
        c.db.prepare('INSERT INTO services (salon_id, name, duration_min, price_cents, created_at) VALUES (?, ?, ?, ?, ?)').bind(salon.id, s.name, s.minutes, s.price, stamp),
      ),
      ...chosenUpgrades.map((u) =>
        c.db.prepare('INSERT INTO upgrades (salon_id, service_id, name, added_min, created_at) VALUES (?, NULL, ?, ?, ?)').bind(salon.id, u.name, u.minutes, stamp),
      ),
      ...weekdays.map((d) =>
        c.db
          .prepare('INSERT INTO windows (salon_id, weekday, start_min, end_min, capacity, created_at) VALUES (?, ?, ?, ?, ?, ?)')
          .bind(salon.id, d, hours.start, hours.end, hours.capacity, stamp),
      ),
    ],
    { at: () => c.now },
  );
  return redirect('/app?ok=setup_done');
}

/* ------------------------------- quiet hours ------------------------------- */

async function hoursPage(c, salon, extra = {}) {
  const windows = await listWindows(c.db, salon.id);
  return page(hoursView(c, { windows, flashCode: flashCode(c), banners: banners(c), ...extra }), extra.errors ? 400 : 200);
}

async function addHours(c, salon) {
  const form = await readForm(c.request);
  const f = new FormReader(form, c.t);
  const hours = readHours(c, f, form);
  const values = { days: hours.days, start: f.raw('start'), end: f.raw('end'), capacity: f.raw('capacity') };
  const { n } = await c.db.prepare('SELECT COUNT(*) AS n FROM windows WHERE salon_id = ?').bind(salon.id).first();
  if (n + hours.days.length > LIMIT.windows) f.fail('day', c.t('You can have up to {n} quiet-hour entries.', { n: LIMIT.windows }));
  if (!f.ok) return hoursPage(c, salon, { values, errors: f.errors });
  const stamp = c.now.toISOString();
  const weekdays = hours.days.map(Number).sort();
  await writeWithEvent(
    c.db,
    salon.id,
    'window.created',
    { weekdays, start_min: hours.start, end_min: hours.end, capacity: hours.capacity },
    () =>
      weekdays.map((d) =>
        c.db
          .prepare('INSERT INTO windows (salon_id, weekday, start_min, end_min, capacity, created_at) VALUES (?, ?, ?, ?, ?, ?)')
          .bind(salon.id, d, hours.start, hours.end, hours.capacity, stamp),
      ),
    { at: () => c.now },
  );
  return redirect('/app/hours?ok=hours_added');
}

async function deleteHours(c, salon) {
  const id = toId(c.params.id);
  const w = await c.db.prepare('SELECT id, weekday, start_min, end_min, capacity FROM windows WHERE id = ? AND salon_id = ?').bind(id, salon.id).first();
  if (!w) return redirect('/app/hours?ok=hours_removed');
  await writeWithEvent(
    c.db,
    salon.id,
    'window.deleted',
    { id, weekday: w.weekday, start_min: w.start_min, end_min: w.end_min, capacity: w.capacity },
    () => [c.db.prepare('DELETE FROM windows WHERE id = ? AND salon_id = ?').bind(id, salon.id)],
    { at: () => c.now },
  );
  return redirect('/app/hours?ok=hours_removed');
}

/* ---------------------------------- share ---------------------------------- */

async function sharePage(c, salon) {
  return page(shareView(c, { publicUrl: publicUrl(c, salon), banners: banners(c) }));
}

async function poster(c, salon) {
  return page(posterView(c, { publicUrl: publicUrl(c, salon) }));
}

async function qrCode(c, salon) {
  const svg = qrSvg(publicUrl(c, salon), { title: salon.name });
  return new Response(svg, { headers: { 'content-type': 'image/svg+xml; charset=utf-8', 'cache-control': 'private, max-age=300' } });
}

/* --------------------------------- settings -------------------------------- */

async function settingsPage(c, salon, extra = {}) {
  const status = extra.errors || extra.pwErrors || extra.delErrors ? 400 : 200;
  return page(
    settingsView(c, {
      flashCode: flashCode(c),
      publicBase: c.url.origin,
      calendarUrl: salon.calendar_token ? `${c.url.origin}/cal/${salon.calendar_token}.ics` : null,
      mailOn: Boolean(c.mail.provider),
      banners: banners(c),
      ...extra,
    }),
    status,
  );
}

async function saveSettings(c, salon) {
  const form = await readForm(c.request);
  const f = new FormReader(form, c.t);
  const values = {
    name: f.raw('name'),
    slug: f.raw('slug').trim().toLowerCase(),
    address: f.raw('address'),
    phone: f.raw('phone'),
    timezone: f.raw('timezone'),
    currency: f.raw('currency'),
    locale: f.raw('locale'),
    uplift: f.raw('uplift'),
    lead: f.raw('lead'),
  };
  const name = f.text('name', { label: 'Salon name', min: 2, max: 80 });
  const address = f.text('address', { label: 'Address', max: 160, optional: true });
  const phone = f.text('phone', { label: 'Phone', max: 40, optional: true });
  if (phone && !/^\+?[\d\s().\-/]{5,}$/.test(phone)) f.fail('phone', c.t('Enter a phone number such as +44 20 7946 0000.'));
  const slug = values.slug;
  if (!isValidSlug(slug)) f.fail('slug', c.t('Use 2 to 40 lowercase letters, numbers or dashes, starting and ending with a letter or number.'));
  if (!isValidTimeZone(values.timezone)) f.fail('timezone', c.t('Choose your time zone.'));
  f.oneOf('currency', CURRENCIES, { message: 'Choose a valid currency.' });
  const locale = values.locale ? f.oneOf('locale', LOCALES, { message: 'Choose a language from the list.' }) : salon.locale;
  const uplift = f.int('uplift', { label: 'Minimum extra time', min: MIN_UPLIFT_PCT, max: 200 });
  const lead = f.oneOf('lead', NOTICE_MINUTES, { message: 'Choose a notice period from the list.' });
  if (f.ok && slug !== salon.slug) {
    const taken = await c.db.prepare('SELECT id FROM salons WHERE slug = ? AND id <> ?').bind(slug, salon.id).first();
    if (taken) f.fail('slug', c.t('That address is already taken. Try another one.'));
  }
  if (values.timezone !== salon.timezone) {
    const { n } = await c.db.prepare("SELECT COUNT(*) AS n FROM requests WHERE salon_id = ? AND kind = 'offer' AND status IN ('pending','confirmed') AND outcome IS NULL AND slot_date >= ?").bind(salon.id,localNow(salon.timezone,c.now).date).first();
    if (n) f.fail('timezone',c.t('Handle future appointments before changing the time zone.'));
  }
  if (!f.ok) return settingsPage(c, salon, { values, errors: f.errors });
  try {
    await writeWithEvent(
      c.db,
      salon.id,
      'settings.updated',
      { slug, timezone: values.timezone, currency: values.currency, locale, min_uplift_pct: uplift, lead_min: Number(lead) },
      () => [
        c.db
          .prepare(
            'UPDATE salons SET name = ?, slug = ?, address = ?, phone = ?, timezone = ?, currency = ?, locale = ?, min_uplift_pct = ?, lead_min = ? WHERE id = ?',
          )
          .bind(name, slug, address || null, phone || null, values.timezone, values.currency, locale, uplift, Number(lead), salon.id),
      ],
      { at: () => c.now },
    );
  } catch (err) {
    if (/UNIQUE constraint failed: salons\.slug/.test(String(err && err.message))) {
      f.fail('slug', c.t('That address is already taken. Try another one.'));
      return settingsPage(c, salon, { values, errors: f.errors });
    }
    throw err;
  }
  return redirect('/app/settings?ok=settings_saved');
}

async function saveAccount(c) {
  const form = await readForm(c.request);
  const locale = form.get('locale');
  const notify = form.get('notify') === 'on' ? 1 : 0;
  await c.db
    .prepare('UPDATE users SET locale = ?, notify_email = ? WHERE id = ?')
    .bind(isLocale(locale) ? locale : c.user.locale, notify, c.user.id)
    .run();
  return redirect('/app/settings?ok=settings_saved');
}

async function newCalendarToken(c, salon) {
  await c.db.prepare('UPDATE salons SET calendar_token = ? WHERE id = ?').bind(randomToken(24), salon.id).run();
  return redirect(salon.calendar_token ? '/app/settings?ok=calendar_new' : '/app/settings?ok=settings_saved');
}

async function userRow(c) {
  return c.db.prepare('SELECT id, email, pass_hash, pass_salt, pass_iter, pass_peppered FROM users WHERE id = ?').bind(c.user.id).first();
}

async function changePassword(c, salon) {
  const f = new FormReader(await readForm(c.request), c.t);
  const current = f.raw('current');
  const user = await userRow(c);
  if (!await hit(c.db, `password:${user.id}`, 10, 3600, nowSec(c))) throw new HttpError(429, 'Too many attempts. Please try again in an hour.');
  if (salon.is_demo) f.fail('current', c.t('The demo account has no password to change.'));
  else if (!current || !(await verifyPassword(current, user, c.config.authPepper))) f.fail('current', c.t('That is not your current password.'));
  const password = f.password('password', { label: 'New password' });
  if (!f.ok) return settingsPage(c, salon, { pwErrors: f.errors });
  const pw = await createPasswordRecord(password, c.config.pbkdf2Iterations, c.config.authPepper);
  if (!await replacePassword(c.db, user, pw)) throw new HttpError(409, 'That is not your current password.');
  const cookie = await startSession(c.db, user.id, { secure: c.secure, now: c.now });
  return redirect('/app/settings?ok=password_saved', { cookies: [cookie] });
}

async function deleteAccount(c, salon) {
  const f = new FormReader(await readForm(c.request), c.t);
  const user = await userRow(c);
  const password = f.raw('password');
  if (!await hit(c.db, `delete:${user.id}`, 5, 3600, nowSec(c))) throw new HttpError(429, 'Too many attempts. Please try again in an hour.');
  if (hasAccess(salon, c.billing, c.now) && salon.billing_subscription_id) throw new HttpError(409, 'End your paid subscription before deleting the account.');
  if (!salon.is_demo && (!password || !(await verifyPassword(password, user, c.config.authPepper)))) {
    f.fail('password', c.t('That is not your password.'));
    return settingsPage(c, salon, { delErrors: f.errors });
  }
  await c.db.prepare('DELETE FROM salons WHERE id = ?').bind(salon.id).run();
  const cookie = serializeCookie(cookieName('sid', c.secure), '', { maxAge: 0, secure: c.secure });
  return redirect(`/login?ok=deleted&lang=${c.locale}`, { cookies: [cookie] });
}

async function exportCsv(c, salon) {
  const t = c.t;
  const rows = await requestsWhere(c.db, salon.id, '1 = 1', [], { order: 'created_at, id', limit: 100000 });
  const header = [
    t('Reference'), t('Type'), t('Status'), t('Service'), t('Upgrades'), t('Date'), t('Start'), t('End'),
    t('Minutes'), t('Price'), t('Standard price'), t('Currency'), t('Client'), t('Contact'), t('Note'), t('Language'), t('Received'), t('Answered'),
  ];
  const data = rows.map((r) => [
    r.ref,
    r.kind,
    r.outcome || r.status,
    r.service_name,
    parseUpgrades(r.upgrades_json).map((u) => u.name).join(' + '),
    r.slot_date || '',
    r.start_min === null ? '' : fmtTime(r.start_min),
    r.end_min === null ? '' : fmtTime(r.end_min),
    r.total_min,
    (r.price_cents / 100).toFixed(2),
    (r.standard_price_cents / 100).toFixed(2),
    r.currency,
    r.client_name || '',
    r.client_contact || '',
    r.note || '',
    r.locale,
    r.created_at,
    r.decided_at || '',
  ]);
  return new Response(toCsv(header, data), {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="requests-${salon.slug}-${localNow(salon.timezone, c.now).date}.csv"`,
    },
  });
}

/* ------------------------------ plan and billing ----------------------------- */

async function plan(c, salon) {
  const { results } = await c.db.prepare('SELECT tier FROM interest WHERE salon_id = ?').bind(salon.id).all();
  return page(planView(c, { interest: results.map((r) => r.tier), flashCode: flashCode(c), banners: banners(c), billing: c.billing }));
}

async function registerInterest(c, salon) {
  const f = new FormReader(await readForm(c.request), c.t);
  const tier = f.oneOf('tier', ['relay', 'nexus']);
  if (!f.ok) throw new HttpError(400, 'Unknown level.');
  await c.db.prepare('INSERT OR IGNORE INTO interest (salon_id, tier, created_at) VALUES (?, ?, ?)').bind(salon.id, tier, c.now.toISOString()).run();
  return redirect('/app/plan?ok=interest');
}

async function checkout(c, salon) {
  if (!c.billing.enabled || salon.is_demo) throw new HttpError(404, 'There is nothing at this address.');
  return redirect(checkoutLink(c.billing, salon.id, c.user.email));
}

async function audit(c, salon) {
  const [chain, { results }] = await Promise.all([
    verifyChain(c.db, salon.id),
    c.db.prepare('SELECT id, type, payload, created_at FROM events WHERE salon_id = ? ORDER BY id DESC LIMIT 100').bind(salon.id).all(),
  ]);
  return page(auditView(c, { chain, events: results, banners: banners(c) }));
}

export function registerApp(r) {
  r.get('/app', authed(dashboard));
  r.post('/app/requests/:id/confirm', authed((c, s) => decide(c, s, 'confirm')));
  r.post('/app/requests/:id/decline', authed((c, s) => decide(c, s, 'decline')));
  r.post('/app/requests/:id/close', authed((c, s) => decide(c, s, 'close')));
  r.get('/app/services', authed((c, s) => servicesPage(c, s)));
  r.post('/app/services', authed(addService));
  r.post('/app/services/:id', authed(updateService));
  r.get('/app/upgrades', authed((c, s) => upgradesPage(c, s)));
  r.post('/app/upgrades', authed(addUpgrade));
  r.post('/app/upgrades/:id', authed(updateUpgrade));
  r.get('/app/setup', authed((c) => setupPage(c)));
  r.post('/app/setup', authed(applySetup));
  r.get('/app/hours', authed((c, s) => hoursPage(c, s)));
  r.post('/app/hours', authed(addHours));
  r.post('/app/hours/:id/delete', authed(deleteHours));
  r.get('/app/share', authed(sharePage));
  r.get('/app/poster', authed(poster));
  r.get('/app/qr.svg', authed(qrCode));
  r.get('/app/settings', authed((c, s) => settingsPage(c, s)));
  r.post('/app/settings', authed(saveSettings));
  r.post('/app/settings/account', authed((c) => saveAccount(c)));
  r.post('/app/settings/calendar', authed(newCalendarToken));
  r.post('/app/settings/password', authed(changePassword));
  r.post('/app/settings/delete', authed(deleteAccount));
  r.get('/app/export/requests.csv', authed(exportCsv));
  r.get('/app/plan', authed(plan));
  r.post('/app/plan/interest', authed(registerInterest));
  r.post('/app/billing/checkout', authed(checkout));
  r.get('/app/audit', authed(audit));
}
