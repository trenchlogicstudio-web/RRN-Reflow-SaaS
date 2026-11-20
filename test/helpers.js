// Copyright (c) 2026 Miloš Petrović (Trench Logic Studio) · SPDX-License-Identifier: MIT
// Test harness: the real app on an in-memory database, a clock the tests can
// move, and a tiny cookie-keeping browser.

import { createApp } from '../src/app.js';
import { createD1 } from '../src/db/node-d1.js';

export const ORIGIN = 'http://localhost:8787';

export function makeApp({ env = {}, start = '2026-11-02T08:00:00Z', fetchImpl } = {}) {
  const db = createD1(':memory:');
  let now = new Date(start);
  const app = createApp({ db, env: { PBKDF2_ITERATIONS: '10000', ...env }, clock: () => now, fetchImpl });
  return {
    app,
    db,
    setNow(value) {
      now = new Date(value);
    },
    advance(ms) {
      now = new Date(now.getTime() + ms);
    },
    get now() {
      return now;
    },
  };
}

/** Email captured instead of sent: makeApp({ env: mailEnv() }) and read env.MAIL_SINK. */
export function mailEnv(extra = {}) {
  return { MAIL_PROVIDER: 'memory', MAIL_SINK: [], MAIL_FROM: 'Reflow <requests@reflow.example>', ...extra };
}

export const BROWSER_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

export class Browser {
  constructor(app, { origin = ORIGIN, ip = '203.0.113.10', userAgent = BROWSER_UA, language = 'en' } = {}) {
    this.app = app;
    this.origin = origin;
    this.ip = ip;
    this.userAgent = userAgent;
    this.language = language;
    this.cookies = new Map();
  }

  cookieHeader() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  remember(response) {
    for (const c of response.headers.getSetCookie()) {
      const [pair, ...attrs] = c.split(';');
      const i = pair.indexOf('=');
      const name = pair.slice(0, i).trim();
      const value = pair.slice(i + 1).trim();
      const expired = attrs.some((a) => /max-age=0/i.test(a.trim()));
      if (expired || !value) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }

  async send(method, path, { form = null, headers = {}, sameOrigin = true } = {}) {
    const h = new Headers(headers);
    if (this.cookies.size) h.set('cookie', this.cookieHeader());
    if (this.userAgent && !h.has('user-agent')) h.set('user-agent', this.userAgent);
    if (this.language && !h.has('accept-language')) h.set('accept-language', this.language);
    let body;
    if (form) {
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(form)) {
        if (Array.isArray(v)) v.forEach((x) => params.append(k, x));
        else if (v !== undefined && v !== null) params.append(k, String(v));
      }
      body = params.toString();
      h.set('content-type', 'application/x-www-form-urlencoded');
    }
    if (method === 'POST' && sameOrigin && !h.has('origin')) h.set('origin', this.origin);
    const res = await this.app.fetch(new Request(`${this.origin}${path}`, { method, headers: h, body }), { ip: this.ip });
    this.remember(res);
    const text = method === 'HEAD' ? '' : await res.text();
    return { status: res.status, headers: res.headers, location: res.headers.get('location'), text };
  }

  get(path, opts) {
    return this.send('GET', path, opts);
  }

  post(path, form, opts = {}) {
    return this.send('POST', path, { ...opts, form });
  }
}

/** Every value="…" of radio inputs named "offer" on a page. */
export function offerKeys(html) {
  return [...html.matchAll(/name="offer" value="([^"]+)"/g)].map((m) => m[1].replace(/&#39;/g, "'").replace(/&amp;/g, '&'));
}

export function requestIds(html, action = 'confirm') {
  return [...html.matchAll(new RegExp(`/app/requests/(\\d+)/${action}`, 'g'))].map((m) => Number(m[1]));
}

export const PASSWORD = 'correct horse battery';

/** Sign up and fully configure a salon; returns the logged-in browser and its slug. */
export async function setupSalon(t, { name = 'Studio Lumen', email = 'owner@lumen.test', timezone = 'Europe/Berlin', capacity = 1, windows = [['2', '13:00', '16:00']] } = {}) {
  const b = new Browser(t.app);
  const s = await b.post('/signup', { salon: name, email, password: PASSWORD, timezone, currency: 'EUR', terms: 'on' });
  if (s.status !== 303) throw new Error(`signup failed: ${s.status} ${s.text.slice(0, 500)}`);
  await b.post('/app/services', { name: 'Cut & finish', duration: '45', price: '40' });
  await b.post('/app/upgrades', { name: 'Deep conditioning', minutes: '15', service: 'all' });
  for (const [day, start, end] of windows) {
    await b.post('/app/hours', { day, start, end, capacity: String(capacity) });
  }
  const slug = (await t.db.prepare('SELECT slug FROM salons WHERE id = (SELECT salon_id FROM users WHERE email = ?)').bind(email).first()).slug;
  const service = await t.db.prepare('SELECT id FROM services WHERE salon_id = (SELECT salon_id FROM users WHERE email = ?)').bind(email).first();
  return { owner: b, slug, serviceId: service.id };
}

/** A client opens the offers page and sends a request for the n-th offer. */
export async function clientRequests(t, slug, serviceId, { index = 0, name = 'Nora Hale', contact = '+44 7700 900123', ip = '198.51.100.7' } = {}) {
  const client = new Browser(t.app, { ip });
  const page = await client.get(`/s/${slug}/offers?service=${serviceId}`);
  const keys = offerKeys(page.text);
  if (!keys[index]) throw new Error(`no offer at index ${index}: ${page.text.slice(0, 300)}`);
  const res = await client.post(`/s/${slug}/request`, { service: serviceId, offer: keys[index], name, contact, consent: 'on' });
  return { client, res, key: keys[index], token: res.location ? res.location.split('/r/')[1] : null };
}
