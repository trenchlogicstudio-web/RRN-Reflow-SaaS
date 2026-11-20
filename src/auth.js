// Copyright (c) 2026 Miloš Petrović (Trench Logic Studio) · SPDX-License-Identifier: MIT
// Accounts, sessions, operator sessions and password-reset links.
// Session tokens live only in the browser cookie; the database keeps their
// SHA-256 hash, so a database leak does not leak usable sessions.

import { randomToken, sha256Hex, hashPassword, verifyPassword } from './crypto.js';
import { parseCookies, serializeCookie } from './http.js';
import { SESSION_DAYS, ADMIN_SESSION_HOURS, RESET_LINK_HOURS } from './config.js';
import { epochSeconds } from './time.js';
import { SALON_COLUMNS } from './repo.js';

export function cookieName(kind, secure) {
  return secure ? `__Host-rrn_${kind}` : `rrn_${kind}`;
}

function readToken(request, kind, secure) {
  const token = parseCookies(request.headers.get('cookie')).get(cookieName(kind, secure));
  return token && /^[A-Za-z0-9_-]{20,100}$/.test(token) ? token : null;
}

/* --------------------------------- salons --------------------------------- */

export async function createPasswordRecord(password, iterations, pepper = '') {
  const { hash, salt } = await hashPassword(password, { iterations, pepper });
  return { pass_hash: hash, pass_salt: salt, pass_iter: iterations, pass_peppered: pepper ? 1 : 0 };
}

/** Replace a verified password once; concurrent changes cannot overwrite it. */
export async function replacePassword(db, user, rec) {
  const result = await db.batch([
    db.prepare('UPDATE users SET pass_hash = ?, pass_salt = ?, pass_iter = ?, pass_peppered = ? WHERE id = ? AND pass_hash = ?')
      .bind(rec.pass_hash, rec.pass_salt, rec.pass_iter, rec.pass_peppered, user.id, user.pass_hash),
    db.prepare('DELETE FROM password_resets WHERE user_id = ? AND EXISTS (SELECT 1 FROM users WHERE id = ? AND pass_hash = ?)')
      .bind(user.id, user.id, rec.pass_hash),
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND EXISTS (SELECT 1 FROM users WHERE id = ? AND pass_hash = ?)')
      .bind(user.id, user.id, rec.pass_hash),
  ]);
  return result[0].meta.changes === 1;
}

/** Email + password → user row, or null. Unknown emails cost the same time as wrong passwords. */
export async function authenticate(db, email, password, iterations, pepper = '') {
  const user = await db
    .prepare('SELECT id, salon_id, email, pass_hash, pass_salt, pass_iter, pass_peppered FROM users WHERE email = ?')
    .bind(email)
    .first();
  if (!user) {
    await hashPassword(password, { iterations, pepper });
    return null;
  }
  if (!(await verifyPassword(password, user, pepper))) return null;
  if (user.pass_iter < iterations || (pepper && !user.pass_peppered)) {
    const rec = await createPasswordRecord(password, Math.max(user.pass_iter, iterations), pepper);
    const upgraded = await db
      .prepare('UPDATE users SET pass_hash = ?, pass_salt = ?, pass_iter = ?, pass_peppered = ? WHERE id = ? AND pass_hash = ?')
      .bind(rec.pass_hash, rec.pass_salt, rec.pass_iter, rec.pass_peppered, user.id, user.pass_hash)
      .run();
    if (!upgraded.meta.changes) return null;
  } else if (!await db.prepare('SELECT 1 FROM users WHERE id = ? AND pass_hash = ?').bind(user.id, user.pass_hash).first()) {
    return null;
  }
  return user;
}

export async function startSession(db, userId, { secure, now }) {
  const token = randomToken(32);
  const expires = epochSeconds(now) + SESSION_DAYS * 86400;
  await db
    .prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
    .bind(await sha256Hex(token), userId, expires)
    .run();
  return serializeCookie(cookieName('sid', secure), token, { maxAge: SESSION_DAYS * 86400, secure });
}

export async function currentUser(db, request, { secure, now }) {
  const token = readToken(request, 'sid', secure);
  if (!token) return null;
  const row = await db
    .prepare(
      `SELECT u.id AS user_id, u.email, u.locale AS user_locale, u.notify_email, u.role, u.email_verified_at, ${SALON_COLUMNS.split(',')
        .map((col) => `s.${col.trim()}`)
        .join(', ')}
         FROM sessions x
         JOIN users u ON u.id = x.user_id
         JOIN salons s ON s.id = u.salon_id
        WHERE x.token_hash = ? AND x.expires_at > ?`,
    )
    .bind(await sha256Hex(token), epochSeconds(now))
    .first();
  if (!row) return null;
  const { user_id, email, user_locale, notify_email, role, email_verified_at, ...salon } = row;
  return { id: user_id, email, locale: user_locale, notify_email, role, email_verified_at, salon };
}

export async function endSession(db, request, { secure }) {
  const token = readToken(request, 'sid', secure);
  if (token) await db.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256Hex(token)).run();
  return serializeCookie(cookieName('sid', secure), '', { maxAge: 0, secure });
}

export async function endAllSessions(db, userId) {
  await db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(userId).run();
}

/* ------------------------------- reset links ------------------------------ */

export async function createResetToken(db, userId, now) {
  const token = randomToken(32);
  await db
    .prepare('INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
    .bind(await sha256Hex(token), userId, epochSeconds(now) + RESET_LINK_HOURS * 3600)
    .run();
  return token;
}

export async function findResetToken(db, token, now) {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(String(token))) return null;
  return db
    .prepare(
      `SELECT r.token_hash, r.user_id, u.email
         FROM password_resets r JOIN users u ON u.id = r.user_id
        WHERE r.token_hash = ? AND r.used_at IS NULL AND r.expires_at > ?`,
    )
    .bind(await sha256Hex(token), epochSeconds(now))
    .first();
}

/* ---------------------------- operator sessions --------------------------- */

export async function startAdminSession(db, { secure, now }) {
  const token = randomToken(32);
  await db
    .prepare('INSERT INTO admin_sessions (token_hash, expires_at) VALUES (?, ?)')
    .bind(await sha256Hex(token), epochSeconds(now) + ADMIN_SESSION_HOURS * 3600)
    .run();
  return serializeCookie(cookieName('aid', secure), token, { maxAge: ADMIN_SESSION_HOURS * 3600, secure, sameSite: 'Strict' });
}

export async function isAdmin(db, request, { secure, now }) {
  const token = readToken(request, 'aid', secure);
  if (!token) return false;
  const row = await db
    .prepare('SELECT 1 AS ok FROM admin_sessions WHERE token_hash = ? AND expires_at > ?')
    .bind(await sha256Hex(token), epochSeconds(now))
    .first();
  return Boolean(row);
}

export async function endAdminSession(db, request, { secure }) {
  const token = readToken(request, 'aid', secure);
  if (token) await db.prepare('DELETE FROM admin_sessions WHERE token_hash = ?').bind(await sha256Hex(token)).run();
  return serializeCookie(cookieName('aid', secure), '', { maxAge: 0, secure, sameSite: 'Strict' });
}
