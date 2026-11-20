// Copyright (c) 2026 Miloš Petrović (Trench Logic Studio) · SPDX-License-Identifier: MIT
// HTTP helpers: responses, errors, cookies, forms and the security headers
// every response carries.

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function htmlResponse(body, { status = 200, headers = {} } = {}) {
  return new Response(String(body), {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8', ...headers },
  });
}

export function textResponse(body, { status = 200, headers = {} } = {}) {
  return new Response(String(body), {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8', ...headers },
  });
}

export function jsonResponse(data, { status = 200, headers = {} } = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  });
}

/** 303 See Other: the browser follows with a GET, so a refresh never re-posts a form. */
export function redirect(location, { status = 303, cookies = [] } = {}) {
  const headers = new Headers({ location });
  for (const c of cookies) headers.append('set-cookie', c);
  return new Response(null, { status, headers });
}

/** Only same-site relative paths are accepted as redirect targets. */
export function safeNext(value, fallback = '/app') {
  if (typeof value !== 'string') return fallback;
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return fallback;
  if (/[\x00-\x20\x7f\\]/.test(value) || /%(?:0[0-9a-f]|1[0-9a-f]|20|5c|7f)/i.test(value)) return fallback;
  try { if (new URL(value, 'https://internal.invalid').origin !== 'https://internal.invalid') return fallback; } catch { return fallback; }
  return value;
}

/* ---------------------------------- forms --------------------------------- */

const MAX_FORM_BYTES = 32 * 1024;

export async function readForm(request) {
  const type = (request.headers.get('content-type') || '').toLowerCase();
  if (!type.startsWith('application/x-www-form-urlencoded')) {
    throw new HttpError(415, 'This form could not be read. Please reload the page and try again.');
  }
  const declared = Number(request.headers.get('content-length') || 0);
  if (declared > MAX_FORM_BYTES) throw new HttpError(413, 'That form is too large.');
  return new URLSearchParams(await readLimited(request, MAX_FORM_BYTES));
}

/** Reads a request body but stops as soon as it passes `max` bytes. */
export async function readLimited(request, max) {
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      try {
        await reader.cancel();
      } catch {
        /* already closed */
      }
      throw new HttpError(413, 'That form is too large.');
    }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    all.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(all);
}

/* --------------------------------- cookies -------------------------------- */

export function parseCookies(header) {
  const out = new Map();
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 1) continue;
    const name = part.slice(0, i).trim();
    const value = part.slice(i + 1).trim();
    if (!out.has(name)) out.set(name, value);
  }
  return out;
}

export function serializeCookie(name, value, { maxAge, secure, path = '/', httpOnly = true, sameSite = 'Lax' } = {}) {
  let c = `${name}=${value}; Path=${path}; SameSite=${sameSite}`;
  if (httpOnly) c += '; HttpOnly';
  if (secure) c += '; Secure';
  if (maxAge !== undefined) c += `; Max-Age=${Math.max(0, Math.floor(maxAge))}`;
  return c;
}

/* ------------------------------ request guards ----------------------------- */

/**
 * Cross-site request forgery guard for every POST: the browser's Origin header
 * (or, failing that, the Referer) must name this site. Pages are served with
 * Referrer-Policy: same-origin, so same-site form posts always carry a real Origin.
 */
export function isSameOrigin(request) {
  const own = new URL(request.url).origin;
  const origin = request.headers.get('origin');
  if (origin) return origin === own;
  const referer = request.headers.get('referer');
  if (!referer) return false;
  try {
    return new URL(referer).origin === own;
  } catch {
    return false;
  }
}

/* ----------------------------- security headers ---------------------------- */

const CSP = [
  "default-src 'none'",
  "style-src 'self'",
  "script-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "manifest-src 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
].join('; ');

export function withSecurityHeaders(response, { secure = false, cache = 'no-store' } = {}) {
  const headers = new Headers(response.headers);
  headers.set('content-security-policy', CSP);
  headers.set('x-content-type-options', 'nosniff');
  headers.set('x-frame-options', 'DENY');
  headers.set('referrer-policy', 'same-origin');
  headers.set('cross-origin-opener-policy', 'same-origin');
  if (!headers.has('cross-origin-resource-policy')) headers.set('cross-origin-resource-policy', 'same-origin');
  headers.set('permissions-policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
  if (secure) headers.set('strict-transport-security', 'max-age=31536000');
  if (!headers.has('cache-control')) headers.set('cache-control', cache);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
