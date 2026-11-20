// Copyright (c) 2026 Miloš Petrović (Trench Logic Studio) · SPDX-License-Identifier: MIT
// Operator page. Disabled (404) unless ADMIN_KEY is configured.

import { HttpError, readForm, redirect } from '../http.js';
import { timingSafeEqual } from '../crypto.js';
import { hit, limiterKey } from '../ratelimit.js';
import { startAdminSession, isAdmin, endAdminSession, createResetToken } from '../auth.js';
import { dailyMaintenance } from '../maintenance.js';
import { funnel } from '../stats.js';
import { toCsv } from '../csv.js';
import { addDays } from '../time.js';
import { adminLoginView, adminView } from '../views/admin.js';
import { page, toId, nowSec } from './util.js';

function enabled(c) {
  if (!c.config.adminKey) throw new HttpError(404, 'This page does not exist.');
  c.useLocale('en');
}

async function salonRows(c) {
  const { results } = await c.db
    .prepare(
      `SELECT s.id, s.slug, s.name, s.currency, s.created_at, s.locale, s.billing_status,
         (SELECT COUNT(*) FROM services WHERE salon_id = s.id AND active = 1) AS services,
         (SELECT COUNT(*) FROM upgrades WHERE salon_id = s.id AND active = 1) AS upgrades,
         (SELECT COUNT(*) FROM windows WHERE salon_id = s.id) AS windows,
         (SELECT COUNT(*) FROM requests WHERE salon_id = s.id AND kind = 'offer') AS offers,
         (SELECT COUNT(*) FROM requests WHERE salon_id = s.id AND kind = 'offer' AND status = 'confirmed') AS confirmed,
         (SELECT COALESCE(SUM(price_cents), 0) FROM requests WHERE salon_id = s.id AND kind = 'offer' AND outcome = 'completed') AS revenue_cents,
         (SELECT MAX(created_at) FROM requests WHERE salon_id = s.id) AS last_request
       FROM salons s WHERE s.is_demo = 0 ORDER BY s.created_at DESC, s.id DESC LIMIT 1000`,
    )
    .all();
  return results;
}

async function overview(c, resetLink = null) {
  await dailyMaintenance(c.db, c.now, { env: c.env, mail: c.mail, fetchImpl: c.fetch, productName: c.config.productName });
  const salons = await salonRows(c);
  const { results: users } = await c.db.prepare('SELECT u.id, u.salon_id, u.email FROM users u JOIN salons s ON s.id = u.salon_id WHERE s.is_demo = 0 ORDER BY u.id').all();
  const { results: interest } = await c.db
    .prepare('SELECT i.tier, i.created_at, s.name AS salon_name FROM interest i JOIN salons s ON s.id = i.salon_id ORDER BY i.created_at DESC')
    .all();
  const bySalon = new Map();
  for (const u of users) {
    if (!bySalon.has(u.salon_id)) bySalon.set(u.salon_id, []);
    bySalon.get(u.salon_id).push(u);
  }
  const rows = salons.map((s) => ({ ...s, users: bySalon.get(s.id) || [] }));
  const totals = {
    salons: rows.length,
    ready: rows.filter((s) => s.services > 0 && s.upgrades > 0 && s.windows > 0).length,
    offers: rows.reduce((a, s) => a + Number(s.offers), 0),
    confirmed: rows.reduce((a, s) => a + Number(s.confirmed), 0),
  };
  const counts = {};
  for (const s of rows) counts[s.billing_status] = (counts[s.billing_status] || 0) + 1;
  const billing = {
    enabled: c.billing.enabled,
    provider: c.billing.provider,
    counts,
    mrrCents: c.billing.monthlyCents * (counts.active || 0),
    currency: /^[A-Z]{3}$/.test(c.env.BILLING_CURRENCY || '') ? c.env.BILLING_CURRENCY : 'EUR',
  };
  const monthAgo = new Date(c.now.getTime() - 30 * 86400000).toISOString();
  const box = await c.db
    .prepare(
      `SELECT SUM(status = 'sent' AND created_at >= ?) AS sent, SUM(status = 'pending') AS pending, SUM(status = 'failed' AND created_at >= ?) AS failed,
         (SELECT last_error FROM outbox WHERE last_error IS NOT NULL ORDER BY id DESC LIMIT 1) AS last_error
       FROM outbox`,
    )
    .bind(monthAgo, monthAgo)
    .first();
  const outbox = { provider: c.mail.provider, sent: Number(box?.sent || 0), pending: Number(box?.pending || 0), failed: Number(box?.failed || 0), lastError: box?.last_error || '' };
  const { results: errors } = await c.db.prepare('SELECT at, method, path, message FROM error_log ORDER BY id DESC LIMIT 20').all();
  const f = await funnel(c.db, null, addDays(c.now.toISOString().slice(0, 10), -30));
  return page(adminView(c, { totals, salons: rows, interest, funnel: f, billing, outbox, errors, resetLink }), 200, { 'x-robots-tag': 'noindex' });
}

async function adminHome(c) {
  enabled(c);
  if (!(await isAdmin(c.db, c.request, { secure: c.secure, now: c.now }))) return page(adminLoginView(c));
  return overview(c);
}

async function adminLogin(c) {
  enabled(c);
  if (!(await hit(c.db, await limiterKey('admin-ip', c.ip), 10, 3600, nowSec(c)))) {
    return page(adminLoginView(c, { error: 'Too many attempts. Try again in an hour.' }), 429);
  }
  const form = await readForm(c.request);
  const key = String(form.get('key') || '');
  if (!timingSafeEqual(key, c.config.adminKey)) return page(adminLoginView(c, { error: 'That key is not correct.' }), 401);
  const cookie = await startAdminSession(c.db, { secure: c.secure, now: c.now });
  return redirect('/admin', { cookies: [cookie] });
}

async function adminLogout(c) {
  enabled(c);
  const cookie = await endAdminSession(c.db, c.request, { secure: c.secure });
  return redirect('/', { cookies: [cookie] });
}

async function adminReset(c) {
  enabled(c);
  if (!(await isAdmin(c.db, c.request, { secure: c.secure, now: c.now }))) return redirect('/admin');
  const id = toId(c.params.id);
  const user = await c.db.prepare('SELECT id, email FROM users WHERE id = ?').bind(id).first();
  if (!user) throw new HttpError(404, 'That user does not exist.');
  const token = await createResetToken(c.db, user.id, c.now);
  return overview(c, { email: user.email, url: `${c.url.origin}/reset/${token}` });
}

async function adminCsv(c) {
  enabled(c);
  if (!(await isAdmin(c.db, c.request, { secure: c.secure, now: c.now }))) return redirect('/admin');
  const rows = await salonRows(c);
  const header = ['id', 'name', 'slug', 'joined', 'language', 'plan', 'services', 'upgrades', 'quiet_windows', 'requests', 'confirmed', 'revenue', 'currency', 'last_request'];
  const data = rows.map((s) => [
    s.id, s.name, s.slug, s.created_at.slice(0, 10), s.locale, s.billing_status, s.services, s.upgrades, s.windows,
    s.offers, s.confirmed, (s.revenue_cents / 100).toFixed(2), s.currency, s.last_request ? s.last_request.slice(0, 10) : '',
  ]);
  return new Response(toCsv(header, data), {
    headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="salons-${c.now.toISOString().slice(0, 10)}.csv"` },
  });
}

export function registerAdmin(r) {
  r.get('/admin', adminHome);
  r.post('/admin/login', adminLogin);
  r.post('/admin/logout', adminLogout);
  r.post('/admin/users/:id/reset', adminReset);
  r.get('/admin/salons.csv', adminCsv);
}
