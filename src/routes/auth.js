// Copyright (c) 2026 Miloš Petrović (Trench Logic Studio) · SPDX-License-Identifier: MIT
// Sign-up, log-in, log-out and password reset.

import { HttpError, readForm, redirect, safeNext } from '../http.js';
import { FormReader, slugify } from '../validate.js';
import { CURRENCIES } from '../money.js';
import { isValidTimeZone } from '../time.js';
import { isLocale, tk } from '../i18n/index.js';
import { appendEvent } from '../events.js';
import { hit, check, clear, limiterKey } from '../ratelimit.js';
import { createPasswordRecord, authenticate, startSession, endSession, endAllSessions, findResetToken, createResetToken } from '../auth.js';
import { issueAccountToken } from '../account-tokens.js';
import { initialBilling } from '../billing.js';
import { notifyPasswordReset } from '../notify.js';
import { signupView, loginView, forgotView, resetView } from '../views/auth.js';
import { deliverSoon } from './public.js';
import { page, nowSec } from './util.js';
import { randomToken } from '../crypto.js';

function formLocale(c, form) {
  const lang = form.get('lang');
  if (isLocale(lang)) {
    c.useLocale(lang);
    c.langParam = lang;
  }
}

async function signupForm(c) {
  if (await c.getUser()) return redirect('/app');
  return page(signupView(c));
}

export async function freeSlug(db, name, prefix = '') {
  const base = (prefix + slugify(name)).slice(0, 40).replace(/-+$/g, '');
  const { results } = await db
    .prepare("SELECT slug FROM salons WHERE slug = ? OR slug LIKE ? ESCAPE '\\'")
    .bind(base, `${base.replace(/[\\%_]/g, (m) => `\\${m}`)}-%`)
    .all();
  const taken = new Set(results.map((r) => r.slug));
  if (!taken.has(base)) return base;
  for (let i = 2; i < 100; i++) {
    const candidate = `${base.slice(0, 36)}-${i}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base.slice(0, 30)}-${randomToken(6).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 6) || 'x'}`;
}

async function signup(c) {
  const form = await readForm(c.request);
  formLocale(c, form);
  const f = new FormReader(form, c.t);
  const values = {
    salon: f.raw('salon'),
    email: f.raw('email'),
    timezone: f.raw('timezone'),
    currency: f.raw('currency'),
    terms: f.checkbox('terms'),
  };
  if (!(await hit(c.db, await limiterKey('signup-ip', c.ip), 5, 3600, nowSec(c)))) {
    return page(signupView(c, { values, message: c.t('Too many sign-ups from here in the last hour. Please try again later.') }), 429);
  }
  const salonName = f.text('salon', { label: 'Salon name', min: 2, max: 80 });
  const email = f.email('email');
  const password = f.password('password');
  const timezone = f.raw('timezone');
  if (!isValidTimeZone(timezone)) f.fail('timezone', c.t('Choose your time zone.'));
  const currency = f.oneOf('currency', CURRENCIES, { message: 'Choose a valid currency.' });
  if (!values.terms) f.fail('terms', c.billing.enabled ? c.t('Please accept the terms of use to continue.') : c.t('Please accept the beta terms to continue.'));
  if (f.ok) {
    const existing = await c.db.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
    if (existing) f.fail('email', c.t('An account with this email already exists. Log in instead.'));
  }
  if (!f.ok) return page(signupView(c, { values, errors: f.errors }), 400);

  const pw = await createPasswordRecord(password, c.config.pbkdf2Iterations, c.config.authPepper);
  const stamp = c.now.toISOString();
  const bill = initialBilling(c.billing, c.now);
  let userId = null;
  let salonId = null;
  for (let attempt = 0; attempt < 4 && userId === null; attempt++) {
    const slug = await freeSlug(c.db, salonName);
    try {
      const results = await c.db.batch([
        c.db
          .prepare(
            'INSERT INTO salons (slug, name, timezone, currency, created_at, locale, billing_status, trial_ends_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id',
          )
          .bind(slug, salonName, timezone, currency, stamp, c.locale, bill.status, bill.trialEndsAt),
        c.db
          .prepare(
            'INSERT INTO users (salon_id, email, pass_hash, pass_salt, pass_iter, created_at, locale, pass_peppered) VALUES ((SELECT id FROM salons WHERE slug = ?), ?, ?, ?, ?, ?, ?, ?) RETURNING id, salon_id',
          )
          .bind(slug, email, pw.pass_hash, pw.pass_salt, pw.pass_iter, stamp, c.locale, pw.pass_peppered),
      ]);
      userId = results[1].results[0].id;
      salonId = results[1].results[0].salon_id;
      await appendEvent(c.db, salonId, 'salon.created', { slug, timezone, currency }, { at: () => c.now });
    } catch (err) {
      const msg = String(err && err.message);
      if (/UNIQUE constraint failed: users\.email/.test(msg)) {
        f.fail('email', c.t('An account with this email already exists. Log in instead.'));
        return page(signupView(c, { values, errors: f.errors }), 400);
      }
      if (!/UNIQUE constraint failed: salons\.slug/.test(msg)) throw err;
    }
  }
  if (userId === null) throw new HttpError(500, 'Could not create the account. Please try again.');
  if (c.config.requireEmailVerification && c.mail.provider) {
    await issueAccountToken(c, { id: userId, salon_id: salonId, email, locale: c.locale }, 'verify');
    deliverSoon(c);
  }
  const cookie = await startSession(c.db, userId, { secure: c.secure, now: c.now });
  return redirect(c.config.requireEmailVerification ? '/verify' : '/app?ok=welcome', { cookies: [cookie] });
}

const LOGIN_OK = {
  reset: tk('Password saved. Log in with your new password.'),
  deleted: tk('Your account and all of its data have been deleted.'),
};

async function loginForm(c) {
  if (await c.getUser()) return redirect('/app');
  const ok = LOGIN_OK[c.url.searchParams.get('ok')] ? c.t(LOGIN_OK[c.url.searchParams.get('ok')]) : '';
  const next = safeNext(c.url.searchParams.get('next'), '');
  return page(loginView(c, { ok, next }));
}

async function login(c) {
  const form = await readForm(c.request);
  formLocale(c, form);
  const f = new FormReader(form, c.t);
  const email = String(form.get('email') || '').trim().toLowerCase().slice(0, 254);
  const password = String(form.get('password') || '').slice(0, 200);
  const next = safeNext(form.get('next'), '/app');
  const values = { email };
  const sec = nowSec(c);
  const keyEmail = await limiterKey('login-email', email);
  const keyIp = await limiterKey('login-ip', c.ip);
  const ipAllowed = await hit(c.db, keyIp, 30, 900, sec);
  const emailAllowed = await hit(c.db, keyEmail, 8, 900, sec);
  if (!ipAllowed || !emailAllowed) {
    return page(loginView(c, { values, next, message: c.t('Too many attempts. Wait 15 minutes, then try again.') }), 429);
  }
  if (!email || !password) {
    if (!email) f.fail('email', c.t('Enter your email.'));
    if (!password) f.fail('password', c.t('Enter your password.'));
    return page(loginView(c, { values, next, errors: f.errors }), 400);
  }
  const user = await authenticate(c.db, email, password, c.config.pbkdf2Iterations, c.config.authPepper);
  if (!user) {
    return page(loginView(c, { values, next, message: c.t('Email or password is incorrect.') }), 400);
  }
  await clear(c.db, keyEmail);
  const cookie = await startSession(c.db, user.id, { secure: c.secure, now: c.now });
  return redirect(next, { cookies: [cookie] });
}

async function logout(c) {
  const cookie = await endSession(c.db, c.request, { secure: c.secure });
  return redirect('/', { cookies: [cookie] });
}

async function forgotForm(c) {
  return page(forgotView(c));
}

/** Always the same answer, whether or not the address has an account. */
async function forgot(c) {
  const form = await readForm(c.request);
  formLocale(c, form);
  const f = new FormReader(form, c.t);
  if (!c.mail.provider) return page(forgotView(c));
  const email = f.email('email');
  if (!f.ok) return page(forgotView(c, { errors: f.errors, values: { email: f.raw('email') } }), 400);
  const sec = nowSec(c);
  const okIp = await hit(c.db, await limiterKey('forgot-ip', c.ip), 5, 3600, sec);
  const okEmail = await hit(c.db, await limiterKey('forgot-email', email), 3, 3600, sec);
  if (okIp && okEmail) {
    const user = await c.db.prepare('SELECT id, salon_id, email, locale FROM users WHERE email = ?').bind(email).first();
    if (user) {
      const token = await createResetToken(c.db, user.id, c.now);
      await notifyPasswordReset({ db: c.db, mail: c.mail, now: c.now, productName: c.config.productName }, user, `${c.url.origin}/reset/${token}`);
      deliverSoon(c);
    }
  }
  return page(forgotView(c, { sent: true }));
}

async function resetForm(c) {
  const row = await findResetToken(c.db, c.params.token, c.now);
  if (!row) return page(resetView(c, { invalidLink: true }), 410);
  return page(resetView(c, { token: c.params.token, email: row.email }));
}

async function reset(c) {
  if (!(await hit(c.db, await limiterKey('reset-ip', c.ip), 20, 3600, nowSec(c)))) {
    throw new HttpError(429, 'Too many attempts. Please try again in an hour.');
  }
  const form = await readForm(c.request);
  formLocale(c, form);
  const row = await findResetToken(c.db, c.params.token, c.now);
  if (!row) return page(resetView(c, { invalidLink: true }), 410);
  const f = new FormReader(form, c.t);
  const password = f.password('password', { label: 'New password' });
  if (!f.ok) return page(resetView(c, { token: c.params.token, email: row.email, errors: f.errors }), 400);
  const pw = await createPasswordRecord(password, c.config.pbkdf2Iterations, c.config.authPepper);
  const result = await c.db.batch([
    c.db.prepare(`UPDATE users SET pass_hash = ?, pass_salt = ?, pass_iter = ?, pass_peppered = ? WHERE id = ?
      AND EXISTS (SELECT 1 FROM password_resets WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?)`)
      .bind(pw.pass_hash, pw.pass_salt, pw.pass_iter, pw.pass_peppered, row.user_id, row.token_hash, nowSec(c)),
    c.db.prepare('UPDATE password_resets SET used_at = ? WHERE token_hash = ? AND used_at IS NULL AND changes() = 1').bind(nowSec(c), row.token_hash),
    c.db.prepare('DELETE FROM sessions WHERE user_id = ? AND EXISTS (SELECT 1 FROM users WHERE id = ? AND pass_hash = ?)').bind(row.user_id, row.user_id, pw.pass_hash),
    c.db.prepare('DELETE FROM password_resets WHERE user_id = ? AND EXISTS (SELECT 1 FROM users WHERE id = ? AND pass_hash = ?)').bind(row.user_id, row.user_id, pw.pass_hash),
  ]);
  if (result[0].meta.changes !== 1) return page(resetView(c, { invalidLink: true }), 410);
  return redirect(`/login?ok=reset${c.langParam ? `&lang=${c.langParam}` : ''}`);
}

export function registerAuth(r) {
  r.get('/signup', signupForm);
  r.post('/signup', signup);
  r.get('/login', loginForm);
  r.post('/login', login);
  r.post('/logout', logout);
  r.get('/forgot', forgotForm);
  r.post('/forgot', forgot);
  r.get('/reset/:token', resetForm);
  r.post('/reset/:token', reset);
}
