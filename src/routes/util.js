// Copyright (c) 2026 Miloš Petrović (Trench Logic Studio) · SPDX-License-Identifier: MIT
import { HttpError, htmlResponse, redirect } from '../http.js';
import { epochSeconds } from '../time.js';

export function page(view, status = 200, headers = {}) {
  return htmlResponse(view, { status, headers });
}

/** Positive integer id from a route parameter or form field, else 404. */
export function toId(value) {
  const s = String(value ?? '');
  if (!/^[1-9]\d{0,15}$/.test(s)) throw new HttpError(404, 'That item does not exist.');
  const n = Number(s);
  if (!Number.isSafeInteger(n)) throw new HttpError(404, 'That item does not exist.');
  return n;
}

/** The logged-in salon owner, or a redirect to the login page. */
export async function requireUser(c) {
  const user = await c.getUser();
  if (user && c.config.requireEmailVerification && !user.email_verified_at && !user.salon.is_demo) return { response: redirect('/verify') };
  if (user) return { user };
  const next = c.request.method === 'GET' ? `${c.url.pathname}${c.url.search}` : '/app';
  return { response: redirect(`/login?next=${encodeURIComponent(next)}`) };
}

export function nowSec(c) {
  return epochSeconds(c.now);
}

export function flashCode(c) {
  const v = c.url.searchParams.get('ok') || '';
  return /^[a-z_]{1,32}$/.test(v) ? v : '';
}
