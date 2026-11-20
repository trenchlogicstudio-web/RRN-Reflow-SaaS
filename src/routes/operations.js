// Copyright (c) 2026 Miloš Petrović (Trench Logic Studio) · SPDX-License-Identifier: MIT
import { html } from '../html.js';
import { HttpError, readForm, redirect } from '../http.js';
import { appPage, publicPage, notice, formErrors } from '../views/layout.js';
import { FormReader } from '../validate.js';
import { localNow, addDays, parseTime, localToUtc } from '../time.js';
import { requestById, requestsWhere, parseUpgrades, getService, salonById, requestByToken } from '../repo.js';
import { requireUser, page, toId, nowSec } from './util.js';
import { writeWithEvent } from '../events.js';
import { availabilityGuard, canClientCancel } from '../availability.js';
import { recordOutcome } from '../lifecycle.js';
import { offersFor, deliverSoon } from './public.js';
import { findQuotedOffer, quotedKey } from '../quote.js';
import { hasAccess } from '../billing.js';
import { notifyNewRequest } from '../notify.js';
import { randomToken } from '../crypto.js';
import { expireForSalon } from '../maintenance.js';
import { hit, limiterKey } from '../ratelimit.js';

export function protectedRoute(handler, ownerOnly = false) {
  return async (c) => {
    const { user, response } = await requireUser(c);
    if (response) return response;
    c.user = user;
    c.useLocale(user.locale);
    if (ownerOnly && user.role !== 'owner') throw new HttpError(403, 'Only the owner can change these settings.');
    return handler(c, user.salon);
  };
}

function outcomeLabel(t, r) {
  if (r.outcome === 'completed') return t('Completed');
  if (r.outcome === 'no_show') return t('No-show');
  if (r.outcome === 'canceled') return t('Canceled');
  return r.status === 'confirmed' ? t('Confirmed') : r.status === 'pending' ? t('Waiting for you') : t('Closed');
}

async function appointments(c, salon) {
  await expireForSalon(c.db, salon, c.now);
  const t = c.t;
  const today = localNow(salon.timezone, c.now).date;
  const query = String(c.url.searchParams.get('q') || '').trim().slice(0, 80);
  const filter = ['all', 'pending', 'confirmed', 'completed', 'no_show', 'canceled'].includes(c.url.searchParams.get('filter')) ? c.url.searchParams.get('filter') : 'all';
  const conditions = ["kind = 'offer'"];
  const params = [];
  if (filter !== 'all') { conditions.push(['pending', 'confirmed'].includes(filter) ? 'status = ? AND outcome IS NULL' : 'outcome = ?'); params.push(filter); }
  if (query) { conditions.push("(client_name LIKE ? ESCAPE '\\' OR client_contact LIKE ? ESCAPE '\\' OR ref LIKE ? ESCAPE '\\')"); const escaped = '%' + query.replace(/[\\%_]/g, '\\$&') + '%'; params.push(escaped, escaped, escaped); }
  const offset = Math.max(0, Math.min(100000, Number.parseInt(c.url.searchParams.get('offset'), 10) || 0));
  const rows = await requestsWhere(c.db, salon.id, conditions.join(' AND '), params, { order: 'slot_date DESC, start_min DESC, id DESC', limit: 51, offset });
  const labels = [['all', t('All')], ['pending', t('Waiting for you')], ['confirmed', t('Confirmed')], ['completed', t('Completed')], ['no_show', t('No-show')], ['canceled', t('Canceled')]];
  const next = new URLSearchParams({ q: query, filter, offset: String(offset + 50) });
  return page(appPage(c, { title: t('Appointments'), current: '/app/appointments', body: html`
    <div class="page-head"><h1>${t('Appointments')}</h1><a class="btn btn-outline" href="/app/availability">${t('Block time')}</a></div>
    ${c.url.searchParams.has('ok') ? notice('ok', t('Settings saved.')) : ''}
    <form class="panel row row-3" method="get"><div class="field"><label for="q">${t('Search')}</label><input id="q" name="q" value="${query}" maxlength="80" type="search"></div>
    <div class="field"><label for="filter">${t('Status')}</label><select id="filter" name="filter">${labels.map(([value,label]) => html`<option value="${value}"${value === filter ? html` selected` : ''}>${label}</option>`)}</select></div>
    <div class="field"><button class="btn btn-primary" type="submit">${t('Search')}</button></div></form>
    ${!rows.length ? html`<p class="empty">${t('No appointments found.')}</p>` : html`<ul class="requests">${rows.slice(0,50).map((r) => html`<li class="request">
      <div class="request-top"><strong>${t.date(r.slot_date)} · ${t.timeRange(r.start_min, r.end_min)}</strong><span class="badge">${outcomeLabel(t, r)}</span></div>
      <p>${r.service_name} · ${t.money(r.price_cents, r.currency)}</p><p>${r.client_name || t('Details erased')} · ${r.client_contact || ''}</p><p class="small muted">${r.ref}</p>
      ${!r.outcome && r.status === 'confirmed' ? html`<div class="actions">
        ${localToUtc(r.slot_date, r.end_min, salon.timezone) <= c.now ? html`<form method="post" action="/app/appointments/${r.id}/completed"><button class="btn btn-confirm">${t('Mark completed')}</button></form><form method="post" action="/app/appointments/${r.id}/no_show"><button class="btn btn-outline">${t('No-show')}</button></form>` : ''}
        ${r.slot_date >= today ? html`<form method="post" action="/app/appointments/${r.id}/canceled" data-confirm="${t('Cancel this appointment?')}"><button class="btn btn-outline">${t('Cancel appointment')}</button></form>` : ''}
      </div>` : ''}
    </li>`)}</ul>`}
    ${offset > 0 ? html`<a class="btn btn-outline" href="/app/appointments?${new URLSearchParams({ q: query, filter, offset: String(Math.max(0, offset - 50)) })}">${t('Previous')}</a>` : ''}
    ${rows.length > 50 ? html`<a class="btn btn-outline" href="/app/appointments?${next}">${t('Next')}</a>` : ''}
  ` }));
}

async function outcome(c, salon) {
  const request = await requestById(c.db, salon.id, toId(c.params.id));
  if (!request) throw new HttpError(404, 'That request does not exist.');
  if (!(await recordOutcome(c, salon, request, c.params.outcome))) throw new HttpError(409, 'That action does not apply to this request.');
  deliverSoon(c);
  return redirect('/app/appointments?ok=saved');
}

async function availability(c, salon, errors = {}) {
  const t = c.t;
  const today = localNow(salon.timezone, c.now).date;
  const { results: blocks } = await c.db.prepare('SELECT * FROM time_blocks WHERE salon_id = ? AND slot_date >= ? ORDER BY slot_date, start_min LIMIT 200').bind(salon.id, today).all();
  return page(appPage(c, { title: t('Availability'), current: '/app/availability', body: html`
    <h1>${t('Availability')}</h1><p class="lead">${t('Block holidays, breaks and appointments from your other booking system.')}</p>
    ${c.url.searchParams.has('ok') ? notice('ok', t('Settings saved.')) : ''}
    <section class="panel"><h2>${t('Block time')}</h2>${formErrors(c, errors)}<form method="post" action="/app/availability">
      <div class="row row-3"><div class="field"><label for="date">${t('Date')}</label><input id="date" name="date" type="date" min="${today}" max="${addDays(today,365)}" value="${today}" required></div>
      <div class="field"><label for="start">${t('From')}</label><input id="start" name="start" type="time" value="09:00" required></div><div class="field"><label for="end">${t('Until')}</label><input id="end" name="end" type="time" value="18:00" required></div></div>
      <div class="row row-2"><div class="field"><label for="capacity">${t('Chairs')}</label><input id="capacity" name="capacity" type="number" min="1" max="50" value="1" required></div>
      <div class="field"><label for="reason">${t('Note')} ${t('(optional)')}</label><input id="reason" name="reason" maxlength="80"></div></div>
      <label class="check"><input type="checkbox" name="all" value="on"> ${t('Close the whole day')}</label><button class="btn btn-primary">${t('Block time')}</button>
    </form></section>
    ${blocks.length ? html`<section class="table-wrap" tabindex="0" aria-label="${t('Availability')}"><table class="list"><thead><tr><th>${t('Date')}</th><th>${t('Hours')}</th><th>${t('Chairs')}</th><th>${t('Note')}</th><th>${t('Remove')}</th></tr></thead><tbody>${blocks.map((b) => html`<tr><td>${t.date(b.slot_date)}</td><td>${t.timeRange(b.start_min,b.end_min)}</td><td>${b.capacity}</td><td>${b.reason}</td><td><form method="post" action="/app/availability/${b.id}/delete"><button class="btn btn-link">${t('Remove')}</button></form></td></tr>`)}</tbody></table></section>` : html`<p class="empty">${t('No blocked times.')}</p>`}
  ` }), Object.keys(errors).length ? 400 : 200);
}

async function blockTime(c, salon) {
  const f = new FormReader(await readForm(c.request), c.t);
  const date = f.raw('date');
  const today = localNow(salon.timezone, c.now).date;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0,10) !== date || date < today || date > addDays(today,365)) f.fail('date', c.t('Choose a valid option.'));
  const all = f.checkbox('all');
  const start = all ? 0 : parseTime(f.raw('start'));
  const end = all ? 1440 : parseTime(f.raw('end'));
  if (start === null || end === null || end <= start || start >= 1440) f.fail('start', c.t('Choose a valid option.'));
  const capacity = all ? 50 : f.int('capacity', { label: 'Chairs', min: 1, max: 50 });
  const reason = f.text('reason', { label: 'Note', optional: true, max: 80 });
  if (!f.ok) return availability(c, salon, f.errors);
  await expireForSalon(c.db, salon, c.now);
  const result = await writeWithEvent(c.db, salon.id, 'availability.blocked', { date, start, end, capacity }, () => [
    c.db.prepare(`INSERT INTO time_blocks (salon_id, slot_date, start_min, end_min, capacity, reason, created_at)
      SELECT ?, ?, ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM requests WHERE salon_id = ? AND slot_date = ?
        AND kind = 'offer' AND status IN ('pending', 'confirmed') AND start_min < ? AND end_min > ?)
        AND (SELECT COUNT(*) FROM time_blocks WHERE salon_id = ?) < 1000`)
      .bind(salon.id, date, start, end, capacity, reason, c.now.toISOString(), salon.id, date, end, start, salon.id),
  ], { condition: 'changes() = 1', at: () => c.now });
  if (!result[0].meta.changes) return availability(c, salon, { date: c.t('This block overlaps a reservation. Handle the reservation first.') });
  return redirect('/app/availability?ok=saved');
}

async function removeBlock(c, salon) {
  await writeWithEvent(c.db, salon.id, 'availability.unblocked', { id: toId(c.params.id) }, () => [c.db.prepare('DELETE FROM time_blocks WHERE id = ? AND salon_id = ?').bind(toId(c.params.id), salon.id)], { condition: 'changes() = 1', at: () => c.now });
  return redirect('/app/availability?ok=saved');
}

async function clientRequest(c) {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(c.params.token || '')) throw new HttpError(404, 'This request link is not valid.');
  let r = await requestByToken(c.db, c.params.token);
  if (!r) throw new HttpError(404, 'This request link is not valid.');
  const salon = await salonById(c.db, r.salon_id);
  await expireForSalon(c.db, salon, c.now);
  r = await requestByToken(c.db, c.params.token);
  c.useLocale(c.langParam || r.locale);
  if (!canClientCancel(r, salon, c.now)) throw new HttpError(409, 'Please contact the salon to change this appointment.');
  if (c.request.method === 'POST' && !await hit(c.db, await limiterKey('manage-request', c.ip), 30, 3600, nowSec(c))) throw new HttpError(429, 'Too many attempts. Please try again in an hour.');
  return { r, salon };
}

async function cancel(c) {
  const { r, salon } = await clientRequest(c);
  if (!await recordOutcome(c, salon, r, 'canceled', 'client')) throw new HttpError(409, 'That request was already answered.');
  deliverSoon(c);
  return redirect(`/r/${r.token}`);
}

async function reschedule(c) {
  const { r, salon } = await clientRequest(c);
  if (r.kind !== 'offer' || !hasAccess(salon, c.billing, c.now)) throw new HttpError(409, 'Please contact the salon to change this appointment.');
  const service = await getService(c.db, salon.id, r.service_id);
  if (!service?.active) throw new HttpError(409, 'Please contact the salon to change this appointment.');
  const result = await offersFor(c, salon, service, r.id);
  const t = c.t;
  if (c.request.method === 'GET') return page(publicPage(c, salon, { title: t('Change appointment'), body: html`
    <header class="salon-head"><p>${salon.name}</p><h1>${t('Change appointment')}</h1><p>${t('Your current appointment stays reserved until you choose a new time. The salon must confirm the change.')}</p></header>
    <form method="post" action="/r/${r.token}/reschedule"><fieldset class="offers"><legend>${t('Available upgraded times')}</legend>
    ${(result.offers || []).map((o) => html`<label class="offer"><input type="radio" name="offer" value="${quotedKey(o)}" required><span>${t.date(o.slot_date)} · ${t.timeRange(o.start_min,o.end_min)}<br>${o.service_name} · ${t.money(o.price_cents,salon.currency)}<br>${o.upgrades.map((u) => u.name).join(', ')}</span></label>`)}</fieldset>
    ${result.offers?.length ? html`<button class="btn btn-primary">${t('Change appointment')}</button>` : html`<p>${t('No appointments found.')}</p>`}</form><p><a href="/r/${r.token}">${t('See your request')}</a></p>` }));
  const form = await readForm(c.request);
  const offer = findQuotedOffer(result, form.get('offer'));
  if (!offer) throw new HttpError(409, 'That time was just taken or has changed. Here is what is free now.');
  const guard = availabilityGuard(salon.id, offer, c.now, r.id);
  const marker = randomToken(12);
  const updated = await writeWithEvent(c.db, salon.id, 'request.rescheduled', { ref: r.ref, date: offer.slot_date, start: offer.start_min }, () => [
    c.db.prepare(`UPDATE requests SET revision = revision + 1, slot_date = ?, start_min = ?, end_min = ?, capacity = ?, service_name = ?, base_min = ?, added_min = ?, total_min = ?,
      uplift_pct = ?, upgrades_json = ?, standard_price_cents = ?, price_cents = ?, currency = ?, status = 'pending', decision_ref = ?, decided_at = NULL, hold_expires_at = ?
      WHERE id = ? AND salon_id = ? AND revision = ? AND status IN ('pending','confirmed') AND outcome IS NULL AND (${guard.sql})
        AND EXISTS (SELECT 1 FROM services WHERE id = ? AND active = 1 AND price_cents = ? AND duration_min = ?)`)
      .bind(offer.slot_date,offer.start_min,offer.end_min,offer.capacity,service.name,offer.base_min,offer.added_min,offer.total_min,offer.uplift_pct,
        JSON.stringify(offer.upgrades),offer.standard_price_cents,offer.price_cents,salon.currency,marker,new Date(c.now.getTime()+salon.hold_hours*3600000).toISOString(),r.id,salon.id,r.revision,...guard.params,service.id,service.price_cents,service.duration_min),
  ], { condition: 'EXISTS (SELECT 1 FROM requests WHERE id = ? AND decision_ref = ?)', conditionParams: [r.id, marker], at: () => c.now });
  if (!updated[0].meta.changes) throw new HttpError(409, 'That action does not apply to this request.');
  await notifyNewRequest({ db: c.db, mail: c.mail, now: c.now, origin: c.url.origin }, salon, await requestById(c.db, salon.id, r.id));
  deliverSoon(c);
  return redirect(`/r/${r.token}`);
}

export function registerOperations(router) {
  router.post('/app/settings/policy', protectedRoute(async (c,salon) => {
    const f = new FormReader(await readForm(c.request),c.t);
    const notice = f.int('cancel_notice', { label: 'Cancellation notice (minutes)', min:0, max:10080 });
    const hours = f.int('hold_hours', { label: 'Request hold (hours)', min:1, max:168 });
    if(!f.ok)throw new HttpError(400,'Choose a valid option.');
    await writeWithEvent(c.db,salon.id,'policy.updated',{cancel_notice_min:notice,hold_hours:hours},()=>[c.db.prepare('UPDATE salons SET cancel_notice_min = ?, hold_hours = ? WHERE id = ?').bind(notice,hours,salon.id)],{at:()=>c.now});
    return redirect('/app/settings?ok=settings_saved');
  },true));
  router.get('/app/appointments', protectedRoute(appointments));
  router.post('/app/appointments/:id/:outcome', protectedRoute(outcome));
  router.get('/app/availability', protectedRoute(availability));
  router.post('/app/availability', protectedRoute(blockTime));
  router.post('/app/availability/:id/delete', protectedRoute(removeBlock));
  router.post('/r/:token/cancel', cancel);
  router.get('/r/:token/reschedule', reschedule);
  router.post('/r/:token/reschedule', reschedule);
}
