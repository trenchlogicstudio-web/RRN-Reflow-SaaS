// Copyright (c) 2026 Miloš Petrović (Trench Logic Studio) · SPDX-License-Identifier: MIT
// Cryptography on the Web Crypto API only, so it runs the same in Node and on
// Cloudflare Workers. No third-party code.

const enc = new TextEncoder();

export function bytesToB64url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64urlToBytes(str) {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Unguessable token for sessions, status links and reset links. */
export function randomToken(bytes = 24) {
  return bytesToB64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

const REF_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I

/** Short, readable reference a salon and a client can say over the phone: R-7F3KQ2. */
export function shortRef(length = 6) {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let s = '';
  for (const b of bytes) s += REF_ALPHABET[b % REF_ALPHABET.length];
  return `R-${s}`;
}

export async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Constant-time comparison of two strings. */
export function timingSafeEqual(a, b) {
  const x = enc.encode(String(a));
  const y = enc.encode(String(b));
  let diff = x.length ^ y.length;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

/** PBKDF2-SHA256. Salt is per user; the iteration count is stored with the hash. */
export async function hashPassword(password, { saltB64 = null, iterations = 100000, pepper = '' } = {}) {
  const salt = saltB64 ? b64urlToBytes(saltB64) : crypto.getRandomValues(new Uint8Array(16));
  let material = enc.encode(String(password).normalize('NFKC'));
  if (pepper) {
    const secret = await crypto.subtle.importKey('raw', enc.encode(pepper), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    material = new Uint8Array(await crypto.subtle.sign('HMAC', secret, material));
  }
  const key = await crypto.subtle.importKey('raw', material, 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
  return { hash: bytesToB64url(new Uint8Array(bits)), salt: bytesToB64url(salt), iterations };
}

export async function verifyPassword(password, user, pepper = '') {
  if (user.pass_peppered && !pepper) return false;
  const { hash } = await hashPassword(password, { saltB64: user.pass_salt, iterations: user.pass_iter, pepper: user.pass_peppered ? pepper : '' });
  return timingSafeEqual(hash, user.pass_hash);
}
