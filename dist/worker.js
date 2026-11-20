// RRN SaaS v0.3.2 (Reflow tier): single-file Cloudflare Worker, built from source by build.js (no dependencies). Do not edit by hand.
// Copyright (c) 2026 Miloš Petrović (Trench Logic Studio) · SPDX-License-Identifier: MIT

// src/config.js
const __m0 = (() => {
// Copyright (c) 2026 Miloš Petrović (Trench Logic Studio) · SPDX-License-Identifier: MIT
// Runtime configuration. Every value can be set as an environment variable
// (Cloudflare: Worker → Settings → Variables and Secrets). Nothing here is secret
// except authentication, email and billing keys: store those as secrets.

const VERSION = '0.3.2';
const RELEASE_NOTE = 'verified billing, safe booking lifecycle, team access and operational readiness';

const RETENTION_DAYS = 90; // client name and contact are erased this long after the appointment
const SESSION_DAYS = 30;
const ADMIN_SESSION_HOURS = 12;
const RESET_LINK_HOURS = 24;
const CONSENT_VERSION = 'c1';

function loadConfig(env = {}) {
  const iter = Number.parseInt(env.PBKDF2_ITERATIONS || '', 10);
  return {
    production: env.APP_ENV === 'production',
    publicOrigin: origin(env.PUBLIC_ORIGIN),
    authPepper: typeof env.AUTH_PEPPER === 'string' ? env.AUTH_PEPPER : '',
    requireEmailVerification: env.REQUIRE_EMAIL_VERIFICATION === 'on' || env.APP_ENV === 'production',
    version: VERSION,
    productName: clean(env.PRODUCT_NAME) || 'Reflow',
    operatorName: clean(env.OPERATOR_NAME) || '',
    contactEmail: clean(env.CONTACT_EMAIL) || '',
    // Legal notice / imprint (required for businesses in Germany and Austria, among others):
    // free text, lines separated by new lines or " | ". Shown at /legal and linked in the footer.
    legalNotice: lines(env.LEGAL_NOTICE),
    // The operator page stays switched off until a long random key is configured.
    adminKey: typeof env.ADMIN_KEY === 'string' && env.ADMIN_KEY.length >= 24 ? env.ADMIN_KEY : null,
    // "Try the live demo" creates a private sample salon for 24 hours. On unless DEMO_MODE=off.
    demoEnabled: env.DEMO_MODE !== 'off',
    // Workers currently caps a single PBKDF2 call at 100,000. Use Paid Workers
    // and a separately stored pepper; never silently reduce the work factor.
    pbkdf2Iterations: Number.isSafeInteger(iter) && iter >= 10000 && iter <= 100000 ? iter : 100000,
  };
}

function origin(value) {
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.origin : ''; }
  catch { return ''; }
}

function lines(v) {
  if (typeof v !== 'string') return [];
  return v
    .split(/\r?\n|\\n|\s\|\s/)
    .map((line) => line.trim().slice(0, 200))
    .filter(Boolean)
    .slice(0, 20);
}

function clean(v) {
  return typeof v === 'string' ? v.trim().slice(0, 120) : '';
}
return { VERSION, RELEASE_NOTE, RETENTION_DAYS, SESSION_DAYS, ADMIN_SESSION_HOURS, RESET_LINK_HOURS, CONSENT_VERSION, loadConfig };
})();

// src/crypto.js
const __m1 = (() => {
// Copyright (c) 2026 Miloš Petrović (Trench Logic Studio) · SPDX-License-Identifier: MIT
// Cryptography on the Web Crypto API only, so it runs the same in Node and on
// Cloudflare Workers. No third-party code.

const enc = new TextEncoder();

function bytesToB64url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlToBytes(str) {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Unguessable token for sessions, status links and reset links. */
function randomToken(bytes = 24) {
  return bytesToB64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

const REF_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I

/** Short, readable reference a salon and a client can say over the phone: R-7F3KQ2. */
function shortRef(length = 6) {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let s = '';
  for (const b of bytes) s += REF_ALPHABET[b % REF_ALPHABET.length];
  return `R-${s}`;
}

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Constant-time comparison of two strings. */
function timingSafeEqual(a, b) {
  const x = enc.encode(String(a));
  const y = enc.encode(String(b));
  let diff = x.length ^ y.length;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

/** PBKDF2-SHA256. Salt is per user; the iteration count is stored with the hash. */
async function hashPassword(password, { saltB64 = null, iterations = 100000, pepper = '' } = {}) {
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

async function verifyPassword(password, user, pepper = '') {
  if (user.pass_peppered && !pepper) return false;
  const { hash } = await hashPassword(password, { saltB64: user.pass_salt, iterations: user.pass_iter, pepper: user.pass_peppered ? pepper : '' });
  return timingSafeEqual(hash, user.pass_hash);
}
return { bytesToB64url, b64urlToBytes, randomToken, shortRef, sha256Hex, timingSafeEqual, hashPassword, verifyPassword };
})();

// src/billing.js
const __m2 = (() => {
// Copyright (c) 2026 Miloš Petrović (Trench Logic Studio) · SPDX-License-Identifier: MIT
// Subscriptions. Off by default (free beta). When switched on, each salon gets
// a trial, then subscribes through the provider's hosted checkout; the provider
// tells the app about every change through a signed webhook. No card data ever
// touches this app, and the Worker makes no outgoing calls to the provider.
//
// Providers:
//   lemonsqueezy  Merchant of Record: handles sales tax and VAT worldwide, and accepts
//                 sellers from many countries that Stripe does not serve.
//   stripe        For operators in Stripe-supported countries; uses a Payment Link.

const { timingSafeEqual } = __m1;

const enc = new TextEncoder();
const BILLING_STATUSES = ['beta', 'trialing', 'active', 'past_due', 'canceled', 'paused', 'expired'];

function intIn(value, min, max, fallback) {
  const n = Number.parseInt(String(value ?? ''), 10);
  return Number.isSafeInteger(n) && n >= min && n <= max ? n : fallback;
}

function httpsUrl(value) {
  try {
    const u = new URL(String(value || ''));
    return u.protocol === 'https:' ? u.toString() : '';
  } catch {
    return '';
  }
}

function billingConfig(env = {}) {
  const provider = ['lemonsqueezy', 'stripe'].includes(env.BILLING_PROVIDER) ? env.BILLING_PROVIDER : null;
  const checkoutUrl = httpsUrl(env.CHECKOUT_URL);
  const secret = typeof env.BILLING_WEBHOOK_SECRET === 'string' ? env.BILLING_WEBHOOK_SECRET : '';
  return {
    enabled: Boolean(provider && checkoutUrl && secret.length >= 8),
    provider,
    checkoutUrl,
    secret,
    portalUrl: httpsUrl(env.BILLING_PORTAL_URL),
    trialDays: intIn(env.TRIAL_DAYS, 0, 365, 30),
    priceLabel: typeof env.PRICE_LABEL === 'string' ? env.PRICE_LABEL.trim().slice(0, 60) : '',
    monthlyCents: intIn(env.PRICE_MONTHLY_CENTS, 0, 10000000, 0),
    apiKey: typeof env.BILLING_API_KEY === 'string' ? env.BILLING_API_KEY : '',
    priceId: String(env.BILLING_PRICE_ID || '').trim(),
    live: env.BILLING_MODE !== 'test',
    strict: env.APP_ENV === 'production',
    graceDays: intIn(env.BILLING_GRACE_DAYS, 0, 14, 3),
  };
}

/** May this salon take upgraded bookings right now? Without access its page falls back to the waitlist. */
function hasAccess(salon, cfg, now) {
  if (!cfg.enabled || salon.is_demo) return true;
  const t = now.getTime();
  switch (salon.billing_status) {
    case 'beta':
      return false;
    case 'trialing':
      return Boolean(salon.trial_ends_at) && t < Date.parse(salon.trial_ends_at);
    case 'active':
    case 'past_due':
      return salon.billing_period_end
        ? t < Date.parse(salon.billing_period_end) + cfg.graceDays * 86400000
        : !cfg.strict && salon.billing_status === 'active';
    case 'canceled':
      return Boolean(salon.billing_period_end) && t < Date.parse(salon.billing_period_end);
    default:
      return false;
  }
}

/** Status for a salon that signs up now. */
function initialBilling(cfg, now) {
  if (!cfg.enabled) return { status: 'beta', trialEndsAt: null };
  if (cfg.trialDays === 0) return { status: 'expired', trialEndsAt: null };
  return { status: 'trialing', trialEndsAt: new Date(now.getTime() + cfg.trialDays * 86400000).toISOString() };
}

/** Hosted checkout link that carries the salon id back in the webhook. */
function checkoutLink(cfg, salonId, email) {
  const u = new URL(cfg.checkoutUrl);
  if (cfg.provider === 'lemonsqueezy') {
    u.searchParams.set('checkout[custom][salon_id]', String(salonId));
    if (email) u.searchParams.set('checkout[email]', email);
  } else {
    u.searchParams.set('client_reference_id', `salon_${salonId}`);
    if (email) u.searchParams.set('prefilled_email', email);
  }
  return u.toString();
}

async function hmacHex(secret, message) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Lemon Squeezy: X-Signature = hex HMAC-SHA256 of the raw body. */
async function verifyLemonSqueezy(secret, rawBody, signature) {
  if (!signature || !/^[0-9a-f]{64}$/i.test(signature)) return false;
  return timingSafeEqual(await hmacHex(secret, rawBody), signature.toLowerCase());
}

/** Stripe: Stripe-Signature = t=<unix>,v1=<hex HMAC-SHA256 of "t.body">; 5-minute tolerance. */
async function verifyStripe(secret, rawBody, header, nowSec, tolerance = 300) {
  if (!header) return false;
  let t = null;
  const v1 = [];
  for (const part of header.split(',')) {
    const i = part.indexOf('=');
    if (i < 1) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k === 't') t = Number(v);
    else if (k === 'v1') v1.push(v.toLowerCase());
  }
  if (!Number.isSafeInteger(t) || !v1.length || Math.abs(nowSec - t) > tolerance) return false;
  const expected = await hmacHex(secret, `${t}.${rawBody}`);
  return v1.some((sig) => timingSafeEqual(expected, sig));
}

const LS_STATUS = { on_trial: 'trialing', active: 'active', paused: 'paused', past_due: 'past_due', unpaid: 'expired', cancelled: 'canceled', expired: 'expired' };
const STRIPE_STATUS = { trialing: 'trialing', active: 'active', past_due: 'past_due', incomplete: 'expired', unpaid: 'expired', canceled: 'expired', incomplete_expired: 'expired', paused: 'paused' };

const positiveId = (value) => /^[1-9]\d{0,14}$/.test(String(value || '')) ? Number(value) : null;

const iso = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const d = typeof value === 'number' ? new Date(value * 1000) : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

/**
 * Turn a verified webhook payload into an update:
 *   { eventId, salonId|null, subscriptionId|null, customerId|null, status|null, trialEndsAt, periodEnd }
 * or null when the event is not about a subscription.
 */
function parseWebhook(provider, payload) {
  if (provider === 'lemonsqueezy') {
    const name = payload?.meta?.event_name;
    const data = payload?.data;
    if (!name || !data || data.type !== 'subscriptions' || !name.startsWith('subscription_')) return null;
    const a = data.attributes || {};
    const salonId = positiveId(payload.meta.custom_data?.salon_id);
    return {
      eventId: `ls:${name}:${data.id}:${a.updated_at || ''}`,
      salonId: Number.isSafeInteger(salonId) ? salonId : null,
      subscriptionId: data.id ? String(data.id) : null,
      customerId: a.customer_id ? String(a.customer_id) : null,
      status: LS_STATUS[a.status] || null,
      trialEndsAt: iso(a.trial_ends_at),
      periodEnd: iso(a.status === 'cancelled' ? a.ends_at : a.renews_at || a.ends_at),
      eventAt: Date.parse(a.updated_at) || 0,
      priceIds: [String(a.variant_id || '')],
      live: typeof a.test_mode === 'boolean' ? !a.test_mode : null,
      terminal: a.status === 'expired',
    };
  }
  if (provider === 'stripe') {
    const type = payload?.type;
    const obj = payload?.data?.object;
    if (!type || !obj) return null;
    if (['checkout.session.completed', 'checkout.session.async_payment_succeeded', 'checkout.session.async_payment_failed'].includes(type)) {
      const m = /^salon_(\d+)$/.exec(obj.client_reference_id || '');
      if (!m || !obj.subscription) return null;
      return {
        eventId: `stripe:${payload.id}`,
        salonId: Number(m[1]),
        subscriptionId: String(obj.subscription),
        customerId: obj.customer ? String(obj.customer) : null,
        status: type === 'checkout.session.async_payment_failed' || obj.payment_status !== 'paid' ? 'expired' : 'active',
        trialEndsAt: null,
        periodEnd: null,
        eventAt: Number.isSafeInteger(payload.created) ? payload.created * 1000 : 0,
        priceIds: [],
        live: typeof payload.livemode === 'boolean' ? payload.livemode : null,
        checkout: true,
        terminal: false,
      };
    }
    if (!type.startsWith('customer.subscription.')) return null;
    let status = STRIPE_STATUS[obj.status] || null;
    if (type === 'customer.subscription.deleted') status = 'expired';
    else if (status === 'active' && obj.cancel_at_period_end) status = 'canceled';
    const periodEnd = obj.current_period_end ?? obj.items?.data?.[0]?.current_period_end;
    const metaSalon = positiveId(obj.metadata?.salon_id);
    return {
      eventId: `stripe:${payload.id}`,
      salonId: Number.isSafeInteger(metaSalon) ? metaSalon : null,
      subscriptionId: obj.id ? String(obj.id) : null,
      customerId: obj.customer ? String(obj.customer) : null,
      status,
      trialEndsAt: iso(obj.trial_end),
      periodEnd: iso(periodEnd),
      eventAt: Number.isSafeInteger(payload.created) ? payload.created * 1000 : 0,
      priceIds: (obj.items?.data || []).map((item) => typeof item.price === 'string' ? item.price : item.price?.id).filter(Boolean),
      live: typeof payload.livemode === 'boolean' ? payload.livemode : null,
      terminal: type === 'customer.subscription.deleted' || obj.status === 'canceled',
    };
  }
  return null;
}

/** Start a former beta account's trial from its first visit, including a public visit. */
async function ensureBillingTrial(db, salon, cfg, now) {
  if (!cfg.enabled || salon.is_demo || salon.billing_status !== 'beta') return salon;
  const bill = initialBilling(cfg, now);
  await db.prepare("UPDATE salons SET billing_status = ?, trial_ends_at = ? WHERE id = ? AND billing_status = 'beta'")
    .bind(bill.status, bill.trialEndsAt, salon.id).run();
  const fresh = await db.prepare('SELECT billing_status, trial_ends_at FROM salons WHERE id = ?').bind(salon.id).first();
  Object.assign(salon, fresh);
  return salon;
}
return { BILLING_STATUSES, billingConfig, hasAccess, initialBilling, checkoutLink, verifyLemonSqueezy, verifyStripe, parseWebhook, ensureBillingTrial };
})();

// src/mail.js
const __m3 = (() => {
// Copyright (c) 2026 Miloš Petrović (Trench Logic Studio) · SPDX-License-Identifier: MIT
// Email: messages go into an outbox table first and are delivered from there,
// so a slow or failing provider never breaks a request, and failed sends are
// retried with back-off. Off until a provider is configured.
//
// Providers:
//   resend      RESEND_API_KEY (works on the Workers Free plan; free tier 3,000/month)
//   cloudflare  an Email Service binding named EMAIL (Workers Paid; sender domain onboarded)
//   console     prints each email to the terminal instead of sending it (local testing only)

const { randomToken } = __m1;

const MAX_ATTEMPTS = 6;
const LEASE_MIN = 10;

function mailConfig(env = {}) {
  const from = typeof env.MAIL_FROM === 'string' ? env.MAIL_FROM.trim() : '';
  const address = /<([^<>\s]+@[^<>\s]+)>\s*$/.exec(from)?.[1] || (/^[^\s<>]+@[^\s<>]+$/.test(from) ? from : '');
  const hasBinding = Boolean(env.EMAIL && typeof env.EMAIL.send === 'function');
  const wanted = env.MAIL_PROVIDER || (env.RESEND_API_KEY ? 'resend' : hasBinding ? 'cloudflare' : '');
  let provider = null;
  if (wanted === 'resend' && env.RESEND_API_KEY) provider = 'resend';
  else if (wanted === 'cloudflare' && hasBinding) provider = 'cloudflare';
  else if (wanted === 'console') provider = 'console';
  else if (wanted === 'memory' && Array.isArray(env.MAIL_SINK)) provider = 'memory'; // tests only
  return { provider: address ? provider : null, fromAddress: address, resendKey: env.RESEND_API_KEY || '' };
}

/** "Studio Lumen via Reflow" <requests@example.com> — quotes and line breaks removed from the name. */
function fromHeader(displayName, address) {
  const name = String(displayName || '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/["\\<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
  return name ? `"${name}" <${address}>` : address;
}

async function enqueue(db, msg, now) {
  await db
    .prepare(
      `INSERT INTO outbox (salon_id, kind, to_addr, reply_to, subject, body_text, body_html, next_attempt_at, created_at, dedupe_key, request_id, request_revision)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(dedupe_key) DO NOTHING`,
    )
    .bind(msg.salonId ?? null, msg.kind, msg.to, msg.replyTo || null, msg.subject, msg.text, msg.html, now.toISOString(), now.toISOString(), msg.dedupeKey || randomToken(24), msg.requestId ?? null, msg.requestRevision ?? null)
    .run();
}

async function send(cfg, env, row, fromName, fetchImpl) {
  if (cfg.provider === 'resend') {
    const body = {
      from: fromHeader(fromName, cfg.fromAddress),
      to: [row.to_addr],
      subject: row.subject,
      html: row.body_html,
      text: row.body_text,
    };
    if (row.reply_to) body.reply_to = row.reply_to;
    const res = await fetchImpl('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${cfg.resendKey}`,
        'content-type': 'application/json',
        'idempotency-key': row.dedupe_key || `legacy-outbox-${row.id}-${row.created_at}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`Email provider returned HTTP ${res.status}`);
    return;
  }
  if (cfg.provider === 'cloudflare') {
    const message = { from: cfg.fromAddress, to: row.to_addr, subject: row.subject, html: row.body_html, text: row.body_text };
    if (row.reply_to) message.replyTo = row.reply_to;
    await env.EMAIL.send(message);
    return;
  }
  if (cfg.provider === 'console') {
    const head = [`From: ${fromHeader(fromName, cfg.fromAddress)}`, `To: ${row.to_addr}`, row.reply_to ? `Reply-To: ${row.reply_to}` : '', `Subject: ${row.subject}`];
    console.log(`\n----- email: ${row.kind} -----\n${head.filter(Boolean).join('\n')}\n\n${row.body_text}\n----- end -----`);
    return;
  }
  if (cfg.provider === 'memory') {
    env.MAIL_SINK.push({ to: row.to_addr, replyTo: row.reply_to, subject: row.subject, text: row.body_text, html: row.body_html, kind: row.kind });
    return;
  }
  throw new Error('No mail provider configured');
}

/** Deliver due messages. Each one is leased first, so two workers never send the same email. */
async function deliverDue(db, env, cfg, now, { limit = 10, fetchImpl = globalThis.fetch, productName = 'Reflow' } = {}) {
  if (!cfg.provider) return { sent: 0, failed: 0 };
  await db.prepare(`UPDATE outbox SET status = 'failed', last_error = 'Superseded by appointment change'
    WHERE status = 'pending' AND request_id IS NOT NULL AND NOT EXISTS
      (SELECT 1 FROM requests WHERE id = outbox.request_id AND revision = outbox.request_revision)`).run();
  const { results } = await db
    .prepare(
      `SELECT o.id, o.kind, o.to_addr, o.reply_to, o.subject, o.body_text, o.body_html, o.attempts, o.dedupe_key, o.created_at, s.name AS salon_name
         FROM outbox o LEFT JOIN salons s ON s.id = o.salon_id
        WHERE o.status = 'pending' AND o.next_attempt_at <= ?
        ORDER BY o.id LIMIT ${Math.max(1, Math.min(100, Number(limit) || 10))}`,
    )
    .bind(now.toISOString())
    .all();
  let sent = 0;
  let failed = 0;
  for (const row of results) {
    const lease = new Date(now.getTime() + LEASE_MIN * 60000).toISOString();
    const claim = await db
      .prepare("UPDATE outbox SET attempts = attempts + 1, next_attempt_at = ? WHERE id = ? AND status = 'pending' AND next_attempt_at <= ?")
      .bind(lease, row.id, now.toISOString())
      .run();
    if (claim.meta.changes !== 1) continue;
    const fromName = row.salon_name ? `${row.salon_name} via ${productName}` : productName;
    try {
      await send(cfg, env, row, fromName, fetchImpl);
      await db.prepare("UPDATE outbox SET status = 'sent', sent_at = ?, last_error = NULL WHERE id = ?").bind(now.toISOString(), row.id).run();
      sent++;
    } catch (err) {
      const attempts = row.attempts + 1;
      const giveUp = attempts >= MAX_ATTEMPTS;
      const retryAt = new Date(now.getTime() + 2 ** attempts * 60000).toISOString();
      await db
        .prepare('UPDATE outbox SET status = ?, next_attempt_at = ?, last_error = ? WHERE id = ?')
        .bind(giveUp ? 'failed' : 'pending', retryAt, String(err && err.message).slice(0, 300), row.id)
        .run();
      failed++;
    }
  }
  return { sent, failed };
}

/** Sent and failed messages carry personal data; they are removed after 30 days. */
async function pruneOutbox(db, now) {
  const cutoff = new Date(now.getTime() - 30 * 86400000).toISOString();
  await db.prepare('DELETE FROM outbox WHERE created_at < ?').bind(cutoff).run();
}
return { mailConfig, fromHeader, enqueue, deliverDue, pruneOutbox };
})();

// src/readiness.js
const __m4 = (() => {
// Copyright (c) 2026 Miloš Petrović (Trench Logic Studio) · SPDX-License-Identifier: MIT
const { loadConfig } = __m0;
const { billingConfig } = __m2;
const { mailConfig } = __m3;

/** Configuration checks, never secret values. Also used by npm run doctor. */
function readiness(env = {}) {
  const config = loadConfig(env), billing = billingConfig(env), mail = mailConfig(env);
  const checks = [
    { id: 'origin', ok: config.publicOrigin.startsWith('https://'), description: 'PUBLIC_ORIGIN is an HTTPS origin' },
    { id: 'admin', ok: (config.adminKey || '').length >= 32, description: 'ADMIN_KEY has at least 32 random characters' },
    { id: 'pepper', ok: config.authPepper.length >= 32, description: 'AUTH_PEPPER is a separate secret of at least 32 random characters' },
    { id: 'password_cost', ok: config.pbkdf2Iterations === 100000, description: 'Password work factor is set to the Workers maximum (100,000)' },
    { id: 'email', ok: ['resend','cloudflare'].includes(mail.provider), description: 'A real email provider and sender are configured' },
    { id: 'verification', ok: config.requireEmailVerification, description: 'Email ownership verification is required' },
    { id: 'operator', ok: Boolean(config.operatorName && config.contactEmail), description: 'Operator name and support contact are configured' },
  ];
  if (env.BILLING_PROVIDER || env.CHECKOUT_URL || env.BILLING_WEBHOOK_SECRET) {
    checks.push({ id: 'billing', ok: billing.enabled && billing.secret.length >= 24 && Boolean(billing.apiKey && billing.priceId), description: 'Billing has a checkout, signing secret, API key and allowed price/variant ID' });
    checks.push({ id: 'billing_mode', ok: !config.production || billing.live, description: 'Production billing uses live mode' });
  }
  return { ready: checks.every((check) => check.ok), production: config.production, checks };
}
return { readiness };
})();

// src/router.js
const __m5 = (() => {
// Copyright (c) 2026 Miloš Petrović (Trench Logic Studio) · SPDX-License-Identifier: MIT
// Minimal router: exact segments and ":param" segments, nothing else.

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

class Router {
  constructor() {
    this.routes = [];
  }

  add(method, pattern, handler) {
    const keys = [];
    const body = pattern
      .split('/')
      .map((seg) => {
        if (seg.startsWith(':')) {
          keys.push(seg.slice(1));
          return '([^/]+)';
        }
        return escapeRe(seg);
      })
      .join('/');
    const re = new RegExp(pattern === '/' ? '^/$' : `^${body}/?$`);
    this.routes.push({ method, re, keys, handler });
    return this;
  }

  get(pattern, handler) {
    return this.add('GET', pattern, handler);
  }

  post(pattern, handler) {
    return this.add('POST', pattern, handler);
  }

  /** → { handler, params } · { methodNotAllowed: true } · null */
  match(method, path) {
    let pathKnown = false;
    for (const r of this.routes) {
      const m = r.re.exec(path);
      if (!m) continue;
      pathKnown = true;
      if (r.method !== method) continue;
      const params = {};
      for (let i = 0; i < r.keys.length; i++) {
        try {
          params[r.keys[i]] = decodeURIComponent(m[i + 1]);
        } catch {
          return null;
        }
      }
      return { handler: r.handler, params };
    }
    return pathKnown ? { methodNotAllowed: true } : null;
  }
}
return { Router };
})();

// src/http.js
const __m6 = (() => {
// Copyright (c) 2026 Miloš Petrović (Trench Logic Studio) · SPDX-License-Identifier: MIT
// HTTP helpers: responses, errors, cookies, forms and the security headers
// every response carries.

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function htmlResponse(body, { status = 200, headers = {} } = {}) {
  return new Response(String(body), {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8', ...headers },
  });
}

function textResponse(body, { status = 200, headers = {} } = {}) {
  return new Response(String(body), {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8', ...headers },
  });
}

function jsonResponse(data, { status = 200, headers = {} } = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  });
}

/** 303 See Other: the browser follows with a GET, so a refresh never re-posts a form. */
function redirect(location, { status = 303, cookies = [] } = {}) {
  const headers = new Headers({ location });
  for (const c of cookies) headers.append('set-cookie', c);
  return new Response(null, { status, headers });
}

/** Only same-site relative paths are accepted as redirect targets. */
function safeNext(value, fallback = '/app') {
  if (typeof value !== 'string') return fallback;
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return fallback;
  if (/[\x00-\x20\x7f\\]/.test(value) || /%(?:0[0-9a-f]|1[0-9a-f]|20|5c|7f)/i.test(value)) return fallback;
  try { if (new URL(value, 'https://internal.invalid').origin !== 'https://internal.invalid') return fallback; } catch { return fallback; }
  return value;
}

/* ---------------------------------- forms --------------------------------- */

const MAX_FORM_BYTES = 32 * 1024;

async function readForm(request) {
  const type = (request.headers.get('content-type') || '').toLowerCase();
  if (!type.startsWith('application/x-www-form-urlencoded')) {
    throw new HttpError(415, 'This form could not be read. Please reload the page and try again.');
  }
  const declared = Number(request.headers.get('content-length') || 0);
  if (declared > MAX_FORM_BYTES) throw new HttpError(413, 'That form is too large.');
  return new URLSearchParams(await readLimited(request, MAX_FORM_BYTES));
}

/** Reads a request body but stops as soon as it passes `max` bytes. */
async function readLimited(request, max) {
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

function parseCookies(header) {
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

function serializeCookie(name, value, { maxAge, secure, path = '/', httpOnly = true, sameSite = 'Lax' } = {}) {
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
function isSameOrigin(request) {
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

function withSecurityHeaders(response, { secure = false, cache = 'no-store' } = {}) {
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
return { HttpError, htmlResponse, textResponse, jsonResponse, redirect, safeNext, readForm, readLimited, parseCookies, serializeCookie, isSameOrigin, withSecurityHeaders };
})();

// src/db/schema.js
const __m7 = (() => {
// Copyright (c) 2026 Miloš Petrović (Trench Logic Studio) · SPDX-License-Identifier: MIT
// Database schema. Applied automatically on the first request after deployment,
// so a fresh Cloudflare D1 database needs no manual setup.
//
// The Reflow invariants live here too, as CHECK constraints on `requests`:
// even a hand-written INSERT cannot store a discounted or under-upgraded offer.
//
// SCHEMA_SQL is version 1 exactly as first shipped; later changes are MIGRATIONS,
// so a fresh database and an upgraded one go through the same steps.

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS salons (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  timezone TEXT NOT NULL,
  currency TEXT NOT NULL,
  plan TEXT NOT NULL DEFAULT 'reflow' CHECK (plan IN ('reflow', 'relay', 'nexus')),
  min_uplift_pct INTEGER NOT NULL DEFAULT 30 CHECK (min_uplift_pct BETWEEN 30 AND 200),
  lead_min INTEGER NOT NULL DEFAULT 120 CHECK (lead_min BETWEEN 0 AND 10080),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  salon_id INTEGER NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
  email TEXT NOT NULL UNIQUE,
  pass_hash TEXT NOT NULL,
  pass_salt TEXT NOT NULL,
  pass_iter INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_users_salon ON users(salon_id);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS services (
  id INTEGER PRIMARY KEY,
  salon_id INTEGER NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  duration_min INTEGER NOT NULL CHECK (duration_min BETWEEN 5 AND 600),
  price_cents INTEGER NOT NULL CHECK (price_cents BETWEEN 0 AND 100000000),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_services_salon ON services(salon_id);

CREATE TABLE IF NOT EXISTS upgrades (
  id INTEGER PRIMARY KEY,
  salon_id INTEGER NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
  service_id INTEGER REFERENCES services(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  added_min INTEGER NOT NULL CHECK (added_min BETWEEN 5 AND 240),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_upgrades_salon ON upgrades(salon_id);

CREATE TABLE IF NOT EXISTS windows (
  id INTEGER PRIMARY KEY,
  salon_id INTEGER NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
  weekday INTEGER NOT NULL CHECK (weekday BETWEEN 1 AND 7),
  start_min INTEGER NOT NULL CHECK (start_min BETWEEN 0 AND 1439),
  end_min INTEGER NOT NULL CHECK (end_min BETWEEN 1 AND 1440),
  capacity INTEGER NOT NULL CHECK (capacity BETWEEN 1 AND 50),
  created_at TEXT NOT NULL,
  CHECK (end_min - start_min >= 30)
);

CREATE INDEX IF NOT EXISTS idx_windows_salon ON windows(salon_id);

CREATE TABLE IF NOT EXISTS requests (
  id INTEGER PRIMARY KEY,
  salon_id INTEGER NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  ref TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('offer', 'waitlist')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'declined', 'expired', 'closed')),
  service_id INTEGER REFERENCES services(id) ON DELETE SET NULL,
  service_name TEXT NOT NULL,
  base_min INTEGER NOT NULL CHECK (base_min > 0),
  added_min INTEGER NOT NULL DEFAULT 0 CHECK (added_min >= 0),
  total_min INTEGER NOT NULL,
  uplift_pct INTEGER NOT NULL,
  upgrades_json TEXT NOT NULL DEFAULT '[]',
  standard_price_cents INTEGER NOT NULL CHECK (standard_price_cents >= 0),
  price_cents INTEGER NOT NULL,
  currency TEXT NOT NULL,
  slot_date TEXT,
  start_min INTEGER,
  end_min INTEGER,
  capacity INTEGER,
  client_name TEXT,
  client_contact TEXT,
  note TEXT,
  consent_at TEXT,
  consent_version TEXT,
  decision_ref TEXT,
  created_at TEXT NOT NULL,
  decided_at TEXT,
  erased_at TEXT,
  CHECK (price_cents = standard_price_cents),
  CHECK (total_min = base_min + added_min),
  CHECK (kind = 'waitlist' OR (uplift_pct >= 30 AND added_min * 100 >= base_min * uplift_pct)),
  CHECK (kind = 'waitlist' OR (slot_date IS NOT NULL AND start_min IS NOT NULL AND end_min IS NOT NULL AND capacity IS NOT NULL AND end_min = start_min + total_min AND capacity >= 1)),
  CHECK (status <> 'confirmed' OR kind = 'offer'),
  CHECK (status <> 'closed' OR kind = 'waitlist')
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_requests_ref ON requests(salon_id, ref);

CREATE INDEX IF NOT EXISTS idx_requests_salon_status ON requests(salon_id, status);

CREATE INDEX IF NOT EXISTS idx_requests_salon_slot ON requests(salon_id, slot_date);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY,
  salon_id INTEGER NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL,
  prev_hash TEXT NOT NULL,
  hash TEXT NOT NULL,
  UNIQUE (salon_id, prev_hash)
);

CREATE TABLE IF NOT EXISTS interest (
  salon_id INTEGER NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
  tier TEXT NOT NULL CHECK (tier IN ('relay', 'nexus')),
  created_at TEXT NOT NULL,
  PRIMARY KEY (salon_id, tier)
);

CREATE TABLE IF NOT EXISTS password_resets (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);

CREATE TABLE IF NOT EXISTS admin_sessions (
  token_hash TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  window_start INTEGER NOT NULL
);

INSERT OR IGNORE INTO meta (key, value) VALUES ('schema_version', '1');
`;

// Migrations bring an existing database up to the current schema, in order.
// Each runs once, atomically, and records its number in meta.schema_version.
const MIGRATIONS = {
  2: `
ALTER TABLE salons ADD COLUMN locale TEXT NOT NULL DEFAULT 'en';
ALTER TABLE salons ADD COLUMN address TEXT;
ALTER TABLE salons ADD COLUMN phone TEXT;
ALTER TABLE salons ADD COLUMN calendar_token TEXT;
ALTER TABLE salons ADD COLUMN is_demo INTEGER NOT NULL DEFAULT 0;
ALTER TABLE salons ADD COLUMN demo_expires_at TEXT;
ALTER TABLE salons ADD COLUMN billing_status TEXT NOT NULL DEFAULT 'beta';
ALTER TABLE salons ADD COLUMN trial_ends_at TEXT;
ALTER TABLE salons ADD COLUMN billing_provider TEXT;
ALTER TABLE salons ADD COLUMN billing_customer_id TEXT;
ALTER TABLE salons ADD COLUMN billing_subscription_id TEXT;
ALTER TABLE salons ADD COLUMN billing_portal_url TEXT;
ALTER TABLE salons ADD COLUMN billing_period_end TEXT;
ALTER TABLE users ADD COLUMN locale TEXT NOT NULL DEFAULT 'en';
ALTER TABLE users ADD COLUMN notify_email INTEGER NOT NULL DEFAULT 1;
ALTER TABLE requests ADD COLUMN locale TEXT NOT NULL DEFAULT 'en';
CREATE UNIQUE INDEX IF NOT EXISTS idx_salons_calendar ON salons(calendar_token);
CREATE INDEX IF NOT EXISTS idx_salons_demo ON salons(is_demo, demo_expires_at);
CREATE INDEX IF NOT EXISTS idx_salons_subscription ON salons(billing_subscription_id);
CREATE TABLE IF NOT EXISTS outbox (
  id INTEGER PRIMARY KEY,
  salon_id INTEGER REFERENCES salons(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  to_addr TEXT NOT NULL,
  reply_to TEXT,
  subject TEXT NOT NULL,
  body_text TEXT NOT NULL,
  body_html TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL,
  last_error TEXT,
  created_at TEXT NOT NULL,
  sent_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_outbox_due ON outbox(status, next_attempt_at);
CREATE TABLE IF NOT EXISTS stats_daily (
  salon_id INTEGER NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  metric TEXT NOT NULL,
  n INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (salon_id, day, metric)
);
CREATE TABLE IF NOT EXISTS webhook_events (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  received_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS error_log (
  id INTEGER PRIMARY KEY,
  at TEXT NOT NULL,
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  message TEXT NOT NULL
);
`,
  3: `
ALTER TABLE salons ADD COLUMN billing_event_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE salons ADD COLUMN billing_event_rank INTEGER NOT NULL DEFAULT 0;
ALTER TABLE salons ADD COLUMN cancel_notice_min INTEGER NOT NULL DEFAULT 120;
ALTER TABLE salons ADD COLUMN hold_hours INTEGER NOT NULL DEFAULT 24;
ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'owner' CHECK (role IN ('owner', 'staff'));
ALTER TABLE users ADD COLUMN email_verified_at TEXT;
ALTER TABLE users ADD COLUMN pass_peppered INTEGER NOT NULL DEFAULT 0;
ALTER TABLE requests ADD COLUMN outcome TEXT CHECK (outcome IN ('completed', 'no_show', 'canceled'));
ALTER TABLE requests ADD COLUMN outcome_at TEXT;
ALTER TABLE requests ADD COLUMN canceled_by TEXT;
ALTER TABLE requests ADD COLUMN hold_expires_at TEXT;
ALTER TABLE requests ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE outbox ADD COLUMN dedupe_key TEXT;
ALTER TABLE outbox ADD COLUMN request_id INTEGER REFERENCES requests(id) ON DELETE CASCADE;
ALTER TABLE outbox ADD COLUMN request_revision INTEGER;
CREATE UNIQUE INDEX IF NOT EXISTS idx_outbox_dedupe ON outbox(dedupe_key);
CREATE TABLE IF NOT EXISTS billing_subscriptions (
  provider TEXT NOT NULL,
  subscription_id TEXT NOT NULL,
  salon_id INTEGER NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
  event_at INTEGER NOT NULL DEFAULT 0,
  event_rank INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  PRIMARY KEY (provider, subscription_id)
);
CREATE TABLE IF NOT EXISTS time_blocks (
  id INTEGER PRIMARY KEY,
  salon_id INTEGER NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
  slot_date TEXT NOT NULL,
  start_min INTEGER NOT NULL CHECK (start_min BETWEEN 0 AND 1439),
  end_min INTEGER NOT NULL CHECK (end_min BETWEEN 1 AND 1440 AND end_min > start_min),
  capacity INTEGER NOT NULL CHECK (capacity BETWEEN 1 AND 50),
  reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_time_blocks_slot ON time_blocks(salon_id, slot_date);
CREATE TABLE IF NOT EXISTS account_tokens (
  token_hash TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('verify', 'invite')),
  salon_id INTEGER NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_account_tokens_user ON account_tokens(user_id, kind);
`,
};

const SCHEMA_VERSION = Math.max(1, ...Object.keys(MIGRATIONS).map(Number));

function schemaStatements(sql = SCHEMA_SQL) {
  return sql
    .split(/;\s*(?:\r?\n|$)/)
    .map((s) => s.trim())
    .filter(Boolean);
}

const ready = new WeakSet();

async function currentVersion(db) {
  try {
    const row = await db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").first();
    return row ? Number(row.value) : 0;
  } catch {
    return 0; // no meta table yet: a fresh database
  }
}

async function ensureSchema(db) {
  if (ready.has(db)) return;
  let version = await currentVersion(db);
  if (version < 1) {
    await db.batch(schemaStatements().map((s) => db.prepare(s)));
    version = 1;
  }
  for (let next = version + 1; next <= SCHEMA_VERSION; next++) {
    const statements = schemaStatements(MIGRATIONS[next]).map((s) => db.prepare(s));
    statements.push(db.prepare("UPDATE meta SET value = ? WHERE key = 'schema_version'").bind(String(next)));
    try {
      await db.batch(statements);
    } catch (err) {
      // Another worker may have migrated at the same moment; that is fine if the version moved on.
      if ((await currentVersion(db)) < next) throw err;
    }
  }
  ready.add(db);
}
return { SCHEMA_SQL, MIGRATIONS, SCHEMA_VERSION, schemaStatements, ensureSchema };
})();

// engines/reflow/engine.js
const __m8 = (() => {
// Copyright (c) 2026 Miloš Petrović (Trench Logic Studio) · SPDX-License-Identifier: MIT
/*!
 * Reflow engine · v0.1.0 · RRN SaaS
 *
 * Turns "fully booked" into an upgraded booking in a quiet hour,
 * at exactly the standard price.
 *
 * Pure and deterministic: no I/O, no clock, no randomness, zero dependencies.
 * The same file runs unchanged in Node, in browsers and on Cloudflare Workers,
 * so it can be lifted out of the SaaS and licensed on its own.
 *
 * Invariants (each one is also enforced by a CHECK constraint in the database):
 *   I1  An offer's price is exactly the service's standard price. Never a discount.
 *   I2  An offer adds at least MIN_UPLIFT_PCT (30%) of the base service time.
 *   I3  An offer sits inside a quiet-hour window the salon declared, within its capacity.
 */

const ENGINE = Object.freeze({ name: 'reflow', version: '0.1.0' });

const MIN_UPLIFT_PCT = 30;

const DISCOUNT_VIOLATION = 'INVARIANT VIOLATION: non-standard price forbidden';

const STATUS = Object.freeze({
  UPGRADE_REDIRECT: 'upgrade_redirect',
  WAITLIST_ONLY: 'waitlist_only',
});

const REASON = Object.freeze({
  SERVICE_UNAVAILABLE: 'service_unavailable',
  NO_UPGRADE_BUNDLE: 'no_upgrade_bundle',
  NO_QUIET_HOURS: 'no_quiet_hours',
  NO_FREE_SLOT: 'no_free_slot',
});

const DEFAULTS = Object.freeze({
  leadMin: 120, // earliest offer: this many minutes after "now"
  horizonDays: 14, // look this many days ahead, today included
  maxOffers: 3, // at most this many offers, one per day
  gridMin: 30, // candidate start times step from the window start
});

const MAX_POOL = 12; // upgrades considered per service (2^12 subsets at most)
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/* ------------------------------------------------------------------ */
/* Calendar helpers (wall-clock dates, no time zones involved)         */
/* ------------------------------------------------------------------ */

function dateToUTC(date) {
  const m = DATE_RE.exec(String(date));
  if (!m) throw new TypeError(`Reflow engine: invalid date "${date}"`);
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** 'YYYY-MM-DD' + n days → 'YYYY-MM-DD' */
function addDays(date, n) {
  return new Date(dateToUTC(date) + n * 86400000).toISOString().slice(0, 10);
}

/** ISO weekday of a 'YYYY-MM-DD' date: 1 = Monday … 7 = Sunday */
function isoWeekday(date) {
  const wd = new Date(dateToUTC(date)).getUTCDay();
  return wd === 0 ? 7 : wd;
}

function isInt(v) {
  return Number.isSafeInteger(v);
}

/* ------------------------------------------------------------------ */
/* Invariants                                                          */
/* ------------------------------------------------------------------ */

/** The salon's uplift setting, never below the canon minimum. */
function effectiveUpliftPct(pct) {
  const n = Math.floor(Number(pct));
  return Number.isFinite(n) && n > MIN_UPLIFT_PCT ? n : MIN_UPLIFT_PCT;
}

/** Smallest number of extra minutes that satisfies the uplift rule. */
function requiredAddedMin(baseMin, pct) {
  return Math.ceil((baseMin * effectiveUpliftPct(pct)) / 100);
}

/** I1: the offer price must equal the standard price, exactly. */
function assertNoDiscount(offer, service) {
  const std = service ? service.price_cents : undefined;
  if (
    !isInt(std) ||
    std < 0 ||
    !offer ||
    offer.price_cents !== std ||
    offer.standard_price_cents !== std
  ) {
    throw new Error(DISCOUNT_VIOLATION);
  }
}

/** I2: the offer must add at least the required share of service time. */
function assertMinUplift(offer) {
  if (!offer || !isInt(offer.base_min) || offer.base_min <= 0 || !isInt(offer.added_min) || offer.added_min < 0) {
    throw new Error('INVARIANT VIOLATION: offer duration missing');
  }
  if (offer.total_min !== offer.base_min + offer.added_min) {
    throw new Error('INVARIANT VIOLATION: offer duration mismatch');
  }
  const required = isInt(offer.uplift_pct) ? offer.uplift_pct : MIN_UPLIFT_PCT;
  if (required < MIN_UPLIFT_PCT || offer.added_min * 100 < offer.base_min * required) {
    const actual = (offer.added_min * 100) / offer.base_min;
    throw new Error(
      `INVARIANT VIOLATION: uplift ${actual.toFixed(1)}% < required ${Math.max(required, MIN_UPLIFT_PCT)}%`,
    );
  }
}

/** Both invariants that can be checked on a single offer. */
function assertOffer(offer, service) {
  assertNoDiscount(offer, service);
  assertMinUplift(offer);
}

/* ------------------------------------------------------------------ */
/* Upgrade bundle                                                      */
/* ------------------------------------------------------------------ */

function compareIds(a, b) {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return a.length - b.length;
}

function applies(upgrade, service) {
  return (
    upgrade &&
    upgrade.active !== 0 &&
    isInt(upgrade.id) &&
    isInt(upgrade.added_min) &&
    upgrade.added_min > 0 &&
    (upgrade.service_id == null || upgrade.service_id === service.id)
  );
}

/**
 * The smallest set of salon-defined upgrades that reaches the uplift minimum.
 * Smallest = fewest extra minutes; ties → fewer items; ties → lowest ids.
 * Returns null when no combination reaches the minimum.
 */
function selectBundle(service, upgrades, upliftPct = MIN_UPLIFT_PCT) {
  if (!service || !isInt(service.duration_min) || service.duration_min <= 0) return null;
  const need = requiredAddedMin(service.duration_min, upliftPct);
  const pool = (upgrades || [])
    .filter((u) => applies(u, service))
    .sort((a, b) => a.added_min - b.added_min || a.id - b.id)
    .slice(0, MAX_POOL);

  let best = null;
  for (let mask = 1; mask < 1 << pool.length; mask++) {
    let sum = 0;
    const items = [];
    for (let i = 0; i < pool.length; i++) {
      if (mask & (1 << i)) {
        sum += pool[i].added_min;
        items.push(pool[i]);
      }
    }
    if (sum < need) continue;
    const ids = items.map((u) => u.id).sort((a, b) => a - b);
    if (
      !best ||
      sum < best.added_min ||
      (sum === best.added_min &&
        (items.length < best.items.length ||
          (items.length === best.items.length && compareIds(ids, best.ids) < 0)))
    ) {
      best = { added_min: sum, items, ids };
    }
  }
  if (!best) return null;
  const items = best.items
    .slice()
    .sort((a, b) => a.id - b.id)
    .map((u) => ({ id: u.id, name: String(u.name), added_min: u.added_min }));
  return { items, added_min: best.added_min, required_min: need };
}

/* ------------------------------------------------------------------ */
/* Offers                                                              */
/* ------------------------------------------------------------------ */

function isValidWindow(w) {
  return (
    w &&
    isInt(w.weekday) &&
    w.weekday >= 1 &&
    w.weekday <= 7 &&
    isInt(w.start_min) &&
    isInt(w.end_min) &&
    w.start_min >= 0 &&
    w.end_min <= 1440 &&
    w.end_min > w.start_min &&
    isInt(w.capacity) &&
    w.capacity >= 1
  );
}

function assertNow(now) {
  if (!now || !DATE_RE.test(String(now.date)) || !isInt(now.min) || now.min < 0 || now.min > 1439) {
    throw new TypeError('Reflow engine: "now" must be { date: "YYYY-MM-DD", min: 0..1439 } in salon local time');
  }
}

function overlapCount(busy, date, start, end) {
  let n = 0;
  for (const b of busy) {
    if (b.slot_date === date && b.start_min < end && b.end_min > start) n += Number.isSafeInteger(b.units) && b.units > 0 ? b.units : 1;
  }
  return n;
}

/** Stable identifier of one offer: date, start minute and the upgrade ids. */
function offerKey(date, startMin, upgradeIds) {
  return `${date}@${startMin}#${upgradeIds.length ? upgradeIds.join('.') : '0'}`;
}

function makeOffer(service, bundle, pct, date, weekday, start, capacity) {
  const offer = {
    key: offerKey(date, start, bundle.items.map((u) => u.id)),
    service_id: service.id,
    service_name: String(service.name),
    base_min: service.duration_min,
    added_min: bundle.added_min,
    total_min: service.duration_min + bundle.added_min,
    uplift_pct: pct,
    upgrades: bundle.items,
    slot_date: date,
    weekday,
    start_min: start,
    end_min: start + service.duration_min + bundle.added_min,
    capacity,
    standard_price_cents: service.price_cents,
    price_cents: service.price_cents,
  };
  assertOffer(offer, service);
  return offer;
}

/**
 * Compute up to `maxOffers` upgraded offers for one service.
 *
 * input.service   { id, name, duration_min, price_cents, active }
 * input.upgrades  [{ id, name, added_min, active, service_id|null }]
 * input.windows   [{ id, weekday 1..7, start_min, end_min, capacity }]   quiet hours, salon local time
 * input.busy      [{ slot_date, start_min, end_min }]                     requests already holding time
 * input.now       { date: 'YYYY-MM-DD', min }                              salon local time
 *
 * Returns { status, reason, required_added_min, bundle, offers }.
 */
function computeOffers(input) {
  const {
    service,
    upgrades = [],
    windows = [],
    busy = [],
    now,
    upliftPct = MIN_UPLIFT_PCT,
    leadMin = DEFAULTS.leadMin,
    horizonDays = DEFAULTS.horizonDays,
    maxOffers = DEFAULTS.maxOffers,
    gridMin = DEFAULTS.gridMin,
  } = input || {};
  assertNow(now);

  const pct = effectiveUpliftPct(upliftPct);
  const waitlist = (reason, extra = {}) => ({
    status: STATUS.WAITLIST_ONLY,
    reason,
    required_added_min: null,
    bundle: null,
    offers: [],
    ...extra,
  });

  if (!service || service.active === 0 || !isInt(service.duration_min) || service.duration_min <= 0) {
    return waitlist(REASON.SERVICE_UNAVAILABLE);
  }
  const required = requiredAddedMin(service.duration_min, pct);
  const bundle = selectBundle(service, upgrades, pct);
  if (!bundle) return waitlist(REASON.NO_UPGRADE_BUNDLE, { required_added_min: required });

  const usable = (windows || []).filter(isValidWindow);
  if (!usable.length) return waitlist(REASON.NO_QUIET_HOURS, { required_added_min: required, bundle });

  const total = service.duration_min + bundle.added_min;
  const step = isInt(gridMin) && gridMin > 0 ? gridMin : DEFAULTS.gridMin;
  const earliest = now.min + Math.max(0, isInt(leadMin) ? leadMin : DEFAULTS.leadMin);
  const offers = [];

  for (let d = 0; d < horizonDays && offers.length < maxOffers; d++) {
    const date = addDays(now.date, d);
    const weekday = isoWeekday(date);
    let best = null;
    for (const w of usable) {
      if (w.weekday !== weekday) continue;
      for (let t = w.start_min; t + total <= w.end_min; t += step) {
        if (best && t >= best.start) break;
        if (d * 1440 + t < earliest) continue;
        if (overlapCount(busy, date, t, t + total) < w.capacity) {
          best = { start: t, capacity: w.capacity };
          break;
        }
      }
    }
    if (best) offers.push(makeOffer(service, bundle, pct, date, weekday, best.start, best.capacity));
  }

  if (!offers.length) return waitlist(REASON.NO_FREE_SLOT, { required_added_min: required, bundle });
  return { status: STATUS.UPGRADE_REDIRECT, reason: null, required_added_min: required, bundle, offers };
}

/** The offer with this key in a computeOffers() result, or null. */
function findOffer(result, key) {
  if (!result || !Array.isArray(result.offers)) return null;
  return result.offers.find((o) => o.key === key) || null;
}

/* ------------------------------------------------------------------ */
/* Self-test: the forbidden path must be refused                       */
/* ------------------------------------------------------------------ */

function selfTest() {
  const checks = [];
  const check = (name, pass) => checks.push({ name, pass: Boolean(pass) });

  const service = { id: 1, name: 'Cut & finish', duration_min: 45, price_cents: 4000, active: 1 };
  const upgrades = [
    { id: 1, name: 'Scalp massage', added_min: 10, active: 1, service_id: null },
    { id: 2, name: 'Deep conditioning', added_min: 15, active: 1, service_id: null },
  ];
  const windows = [{ id: 1, weekday: 2, start_min: 780, end_min: 960, capacity: 1 }];
  const now = { date: '2026-01-05', min: 540 }; // a Monday, 09:00

  const r = computeOffers({ service, upgrades, windows, busy: [], now });
  check('offer produced', r.status === STATUS.UPGRADE_REDIRECT && r.offers.length > 0);
  check('price equals standard price', r.offers.every((o) => o.price_cents === 4000 && o.standard_price_cents === 4000));
  check('uplift at least 30%', r.offers.every((o) => o.added_min * 100 >= o.base_min * MIN_UPLIFT_PCT));

  let refused = false;
  try {
    assertNoDiscount({ ...r.offers[0], price_cents: 3600 }, service);
  } catch (e) {
    refused = e.message === DISCOUNT_VIOLATION;
  }
  check('forbidden path refused: discount', refused);

  let refusedUplift = false;
  try {
    assertMinUplift({ base_min: 45, added_min: 0, total_min: 45, uplift_pct: 30 });
  } catch (e) {
    refusedUplift = e.message.startsWith('INVARIANT VIOLATION: uplift');
  }
  check('forbidden path refused: no uplift', refusedUplift);

  const full = computeOffers({
    service,
    upgrades,
    windows,
    busy: Array.from({ length: 14 }, (_, i) => ({ slot_date: addDays(now.date, i), start_min: 0, end_min: 1440 })),
    now,
  });
  check('full calendar falls back to waitlist', full.status === STATUS.WAITLIST_ONLY && full.reason === REASON.NO_FREE_SLOT);

  return { engine: ENGINE.name, version: ENGINE.version, ok: checks.every((c) => c.pass), checks };
}
return { ENGINE, MIN_UPLIFT_PCT, DISCOUNT_VIOLATION, STATUS, REASON, DEFAULTS, addDays, isoWeekday, effectiveUpliftPct, requiredAddedMin, assertNoDiscount, assertMinUplift, assertOffer, selectBundle, offerKey, computeOffers, findOffer, selfTest };
})();

// src/time.js
const __m9 = (() => {
// Copyright (c) 2026 Miloš Petrović (Trench Logic Studio) · SPDX-License-Identifier: MIT
// Wall-clock time in the salon's own time zone. The engine works on local dates
// and minutes only, so daylight-saving changes never shift an offered slot.

const { addDays, isoWeekday } = __m8;



const formatters = new Map();

function formatterFor(timeZone) {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

/** Current local date and minute of day in a time zone: { date: 'YYYY-MM-DD', min }. */
function localNow(timeZone, at = new Date()) {
  const parts = {};
  for (const p of formatterFor(timeZone).formatToParts(at)) parts[p.type] = p.value;
  const hour = Number(parts.hour) % 24;
  return { date: `${parts.year}-${parts.month}-${parts.day}`, min: hour * 60 + Number(parts.minute) };
}

function isValidTimeZone(tz) {
  if (typeof tz !== 'string' || !tz || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function timeZones() {
  try {
    return Intl.supportedValuesOf('timeZone');
  } catch {
    return ['UTC', 'Europe/London', 'Europe/Berlin', 'Europe/Paris', 'America/New_York'];
  }
}

/** 810 → '13:30' */
function fmtTime(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** '13:30' → 810 · '24:00' → 1440 · anything else → null */
function parseTime(value) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(value || '').trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (min > 59) return null;
  if (h === 24 && min === 0) return 1440;
  if (h > 23) return null;
  return h * 60 + min;
}

function epochSeconds(at = new Date()) {
  return Math.floor(at.getTime() / 1000);
}

/** Minutes the time zone is ahead of UTC at a given instant. */
function offsetMinutes(timeZone, at) {
  const { date, min } = localNow(timeZone, at);
  const [y, m, d] = date.split('-').map(Number);
  const wallAsUtc = Date.UTC(y, m - 1, d, Math.floor(min / 60), min % 60);
  return Math.round((wallAsUtc - Math.floor(at.getTime() / 60000) * 60000) / 60000);
}

/** Salon wall-clock time ('YYYY-MM-DD', minutes) → the real instant, correct across daylight-saving changes. */
function localToUtc(date, min, timeZone) {
  const [y, m, d] = date.split('-').map(Number);
  const wall = Date.UTC(y, m - 1, d, Math.floor(min / 60), min % 60);
  let instant = wall - offsetMinutes(timeZone, new Date(wall)) * 60000;
  instant = wall - offsetMinutes(timeZone, new Date(instant)) * 60000;
  return new Date(instant);
}
return { localNow, isValidTimeZone, timeZones, fmtTime, parseTime, epochSeconds, localToUtc, addDays, isoWeekday };
})();

// src/repo.js
const __m10 = (() => {
// Copyright (c) 2026 Miloš Petrović (Trench Logic Studio) · SPDX-License-Identifier: MIT
// Data access. Every query that touches salon data is scoped by salon_id.

const SALON_COLUMNS = `id, slug, name, timezone, currency, plan, min_uplift_pct, lead_min, created_at, locale, address, phone,
  calendar_token, is_demo, demo_expires_at, billing_status, trial_ends_at, billing_provider, billing_customer_id,
  billing_subscription_id, billing_portal_url, billing_period_end, billing_event_at, billing_event_rank, cancel_notice_min, hold_hours`;

async function salonBySlug(db, slug) {
  return db.prepare(`SELECT ${SALON_COLUMNS} FROM salons WHERE slug = ?`).bind(slug).first();
}

async function salonById(db, id) {
  return db.prepare(`SELECT ${SALON_COLUMNS} FROM salons WHERE id = ?`).bind(id).first();
}

async function listServices(db, salonId, { activeOnly = false } = {}) {
  const sql = `SELECT id, name, duration_min, price_cents, active FROM services
                WHERE salon_id = ? ${activeOnly ? 'AND active = 1' : ''}
                ORDER BY active DESC, name COLLATE NOCASE, id`;
  return (await db.prepare(sql).bind(salonId).all()).results;
}

async function getService(db, salonId, id) {
  return db
    .prepare('SELECT id, name, duration_min, price_cents, active FROM services WHERE salon_id = ? AND id = ?')
    .bind(salonId, id)
    .first();
}

async function listUpgrades(db, salonId) {
  return (
    await db
      .prepare(
        `SELECT u.id, u.name, u.added_min, u.active, u.service_id, s.name AS service_name
           FROM upgrades u LEFT JOIN services s ON s.id = u.service_id
          WHERE u.salon_id = ?
          ORDER BY u.active DESC, u.added_min, u.id`,
      )
      .bind(salonId)
      .all()
  ).results;
}

async function listWindows(db, salonId) {
  return (
    await db
      .prepare('SELECT id, weekday, start_min, end_min, capacity FROM windows WHERE salon_id = ? ORDER BY weekday, start_min, id')
      .bind(salonId)
      .all()
  ).results;
}

/** Offers that already hold time: pending ones count too, so two clients are not offered the last chair. */
async function busySlots(db, salonId, fromDate, toDate, excludeId = 0) {
  return (
    await db
      .prepare(
        `SELECT slot_date, start_min, end_min, 1 AS units FROM requests
          WHERE salon_id = ? AND kind = 'offer' AND status IN ('pending', 'confirmed')
            AND slot_date >= ? AND slot_date <= ? AND id <> ?
          UNION ALL SELECT slot_date, start_min, end_min, capacity AS units FROM time_blocks WHERE salon_id = ? AND slot_date >= ? AND slot_date <= ?`,
      )
      .bind(salonId, fromDate, toDate, excludeId, salonId, fromDate, toDate)
      .all()
  ).results;
}

async function setupCounts(db, salonId) {
  // Plain "?" placeholders only: Node 22.13's built-in SQLite cannot bind numbered ones (?1).
  return db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM services WHERE salon_id = ? AND active = 1) AS services,
         (SELECT COUNT(*) FROM upgrades WHERE salon_id = ? AND active = 1) AS upgrades,
         (SELECT COUNT(*) FROM windows WHERE salon_id = ?) AS windows`,
    )
    .bind(salonId, salonId, salonId)
    .first();
}

async function metrics(db, salonId) {
  const totals = await db
    .prepare(
      `SELECT
         SUM(kind = 'offer') AS offers,
         SUM(kind = 'offer' AND status = 'confirmed') AS confirmed,
         SUM(kind = 'offer' AND status = 'pending') AS pending,
         SUM(kind = 'waitlist') AS waitlist,
         SUM(CASE WHEN kind = 'offer' AND status = 'confirmed' THEN added_min ELSE 0 END) AS added_minutes,
         SUM(CASE WHEN kind = 'offer' AND status = 'confirmed' THEN total_min ELSE 0 END) AS quiet_minutes,
         SUM(CASE WHEN kind = 'offer' AND status = 'confirmed' THEN standard_price_cents - price_cents ELSE 0 END) AS discount_cents
       FROM requests WHERE salon_id = ?`,
    )
    .bind(salonId)
    .first();
  const revenue = (
    await db
      .prepare(
        `SELECT currency, SUM(price_cents) AS cents FROM requests
          WHERE salon_id = ? AND kind = 'offer' AND status = 'confirmed' AND (outcome IS NULL OR outcome = 'completed')
          GROUP BY currency ORDER BY cents DESC`,
      )
      .bind(salonId)
      .all()
  ).results;
  const completed = (await db.prepare("SELECT currency, SUM(price_cents) AS cents, COUNT(*) AS n FROM requests WHERE salon_id = ? AND outcome = 'completed' GROUP BY currency").bind(salonId).all()).results;
  const n = (v) => Number(v || 0);
  return {
    completed,
    offers: n(totals.offers),
    confirmed: n(totals.confirmed),
    pending: n(totals.pending),
    waitlist: n(totals.waitlist),
    added_minutes: n(totals.added_minutes),
    quiet_minutes: n(totals.quiet_minutes),
    discount_cents: n(totals.discount_cents),
    revenue: revenue.map((r) => ({ currency: r.currency, cents: n(r.cents) })),
  };
}

const REQUEST_COLUMNS = `id, salon_id, token, ref, kind, status, service_id, service_name, base_min, added_min, total_min,
  uplift_pct, upgrades_json, standard_price_cents, price_cents, currency, slot_date, start_min, end_min, capacity,
  client_name, client_contact, note, consent_at, created_at, decided_at, erased_at, locale, outcome, outcome_at, canceled_by, hold_expires_at, revision`;

async function requestsWhere(db, salonId, where, params = [], { order = 'id DESC', limit = 100, offset = 0 } = {}) {
  return (
    await db
      .prepare(`SELECT ${REQUEST_COLUMNS} FROM requests WHERE salon_id = ? AND ${where} ORDER BY ${order} LIMIT ${Math.max(1, Math.min(100000, Number(limit) || 100))} OFFSET ${Math.max(0, Math.min(100000, Number(offset) || 0))}`)
      .bind(salonId, ...params)
      .all()
  ).results;
}

async function requestById(db, salonId, id) {
  return db.prepare(`SELECT ${REQUEST_COLUMNS} FROM requests WHERE salon_id = ? AND id = ?`).bind(salonId, id).first();
}

async function requestByToken(db, token) {
  return db.prepare(`SELECT ${REQUEST_COLUMNS} FROM requests WHERE token = ?`).bind(token).first();
}

function parseUpgrades(json) {
  try {
    const list = JSON.parse(json);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}
return { SALON_COLUMNS, salonBySlug, salonById, listServices, getService, listUpgrades, listWindows, busySlots, setupCounts, metrics, requestsWhere, requestById, requestByToken, parseUpgrades };
})();

// src/auth.js
const __m11 = (() => {
// Copyright (c) 2026 Miloš Petrović (Trench Logic Studio) · SPDX-License-Identifier: MIT
// Accounts, sessions, operator sessions and password-reset links.
// Session tokens live only in the browser cookie; the database keeps their
// SHA-256 hash, so a database leak does not leak usable sessions.

const { randomToken, sha256Hex, hashPassword, verifyPassword } = __m1;
const { parseCookies, serializeCookie } = __m6;
const { SESSION_DAYS, ADMIN_SESSION_HOURS, RESET_LINK_HOURS } = __m0;
const { epochSeconds } = __m9;
const { SALON_COLUMNS } = __m10;

function cookieName(kind, secure) {
  return secure ? `__Host-rrn_${kind}` : `rrn_${kind}`;
}

function readToken(request, kind, secure) {
  const token = parseCookies(request.headers.get('cookie')).get(cookieName(kind, secure));
  return token && /^[A-Za-z0-9_-]{20,100}$/.test(token) ? token : null;
}

/* --------------------------------- salons --------------------------------- */

async function createPasswordRecord(password, iterations, pepper = '') {
  const { hash, salt } = await hashPassword(password, { iterations, pepper });
  return { pass_hash: hash, pass_salt: salt, pass_iter: iterations, pass_peppered: pepper ? 1 : 0 };
}

/** Replace a verified password once; concurrent changes cannot overwrite it. */
async function replacePassword(db, user, rec) {
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
async function authenticate(db, email, password, iterations, pepper = '') {
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

async function startSession(db, userId, { secure, now }) {
  const token = randomToken(32);
  const expires = epochSeconds(now) + SESSION_DAYS * 86400;
  await db
    .prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
    .bind(await sha256Hex(token), userId, expires)
    .run();
  return serializeCookie(cookieName('sid', secure), token, { maxAge: SESSION_DAYS * 86400, secure });
}

async function currentUser(db, request, { secure, now }) {
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

async function endSession(db, request, { secure }) {
  const token = readToken(request, 'sid', secure);
  if (token) await db.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256Hex(token)).run();
  return serializeCookie(cookieName('sid', secure), '', { maxAge: 0, secure });
}

async function endAllSessions(db, userId) {
  await db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(userId).run();
}

/* ------------------------------- reset links ------------------------------ */

async function createResetToken(db, userId, now) {
  const token = randomToken(32);
  await db
    .prepare('INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
    .bind(await sha256Hex(token), userId, epochSeconds(now) + RESET_LINK_HOURS * 3600)
    .run();
  return token;
}

async function findResetToken(db, token, now) {
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

async function startAdminSession(db, { secure, now }) {
  const token = randomToken(32);
  await db
    .prepare('INSERT INTO admin_sessions (token_hash, expires_at) VALUES (?, ?)')
    .bind(await sha256Hex(token), epochSeconds(now) + ADMIN_SESSION_HOURS * 3600)
    .run();
  return serializeCookie(cookieName('aid', secure), token, { maxAge: ADMIN_SESSION_HOURS * 3600, secure, sameSite: 'Strict' });
}

async function isAdmin(db, request, { secure, now }) {
  const token = readToken(request, 'aid', secure);
  if (!token) return false;
  const row = await db
    .prepare('SELECT 1 AS ok FROM admin_sessions WHERE token_hash = ? AND expires_at > ?')
    .bind(await sha256Hex(token), epochSeconds(now))
    .first();
  return Boolean(row);
}

async function endAdminSession(db, request, { secure }) {
  const token = readToken(request, 'aid', secure);
  if (token) await db.prepare('DELETE FROM admin_sessions WHERE token_hash = ?').bind(await sha256Hex(token)).run();
  return serializeCookie(cookieName('aid', secure), '', { maxAge: 0, secure, sameSite: 'Strict' });
}
return { cookieName, createPasswordRecord, replacePassword, authenticate, startSession, currentUser, endSession, endAllSessions, createResetToken, findResetToken, startAdminSession, isAdmin, endAdminSession };
})();

// src/i18n/de.js
const __m12 = (() => {
// Copyright (c) 2026 Miloš Petrović (Trench Logic Studio) · SPDX-License-Identifier: MIT
// Translations are checked for completeness and placeholder parity.
const __default = {
  "There is nothing at this address.": "Unter dieser Adresse gibt es nichts.",
  "That action is not available here.": "Diese Aktion ist hier nicht verfügbar.",
  "This form was sent from another website, so it was blocked. Open the page again and resend it.": "Dieses Formular wurde von einer anderen Website gesendet und deshalb blockiert. Öffnen Sie die Seite erneut und senden Sie es noch einmal.",
  "12 Example Street": "Musterstraße 12",
  "Any weekday after 17:00": "Werktags ab 17:00",
  "This form could not be read. Please reload the page and try again.": "Dieses Formular konnte nicht gelesen werden. Bitte laden Sie die Seite neu und versuchen Sie es noch einmal.",
  "That form is too large.": "Dieses Formular ist zu groß.",
  "Send request": "Anfrage senden",
  "{m} min": "{m} Min.",
  "{h} h {m} min": "{h} Std. {m} Min.",
  "{h} h": "{h} Std.",
  "{total} instead of {base}": "{total} statt {base}",
  "Price: {price}, the standard price": "Preis: {price}, der reguläre Preis",
  "Reference: {ref}": "Referenz: {ref}",
  "New request: {when}": "Neue Anfrage: {when}",
  "A client asked for an upgraded appointment through your request page.": "Über Ihre Anfrageseite wurde ein Termin mit Upgrade angefragt.",
  "Client: {contact}": "Kontakt: {contact}",
  "Confirm or decline": "Bestätigen oder ablehnen",
  "You receive these emails because notifications are on in Settings.": "Sie erhalten diese E-Mails, weil die Benachrichtigungen in den Einstellungen aktiviert sind.",
  "New waitlist request: {service}": "Neuer Eintrag auf der Warteliste: {service}",
  "A client joined your waitlist.": "Jemand hat sich auf Ihre Warteliste eingetragen.",
  "Note: “{note}”": "Notiz: „{note}“",
  "Open your dashboard": "Dashboard öffnen",
  "You receive this email because you sent a request to {salon}. Your details are deleted {days} days after the appointment.": "Sie erhalten diese E-Mail, weil Sie eine Anfrage an {salon} gesendet haben. Ihre Daten werden {days} Tage nach dem Termin gelöscht.",
  "Your request at {salon}": "Ihre Anfrage bei {salon}",
  "Request sent": "Anfrage gesendet",
  "{salon} has your request and will confirm it personally.": "{salon} hat Ihre Anfrage erhalten und bestätigt sie persönlich.",
  "See your request": "Ihre Anfrage ansehen",
  "You are on the waitlist at {salon}": "Sie stehen auf der Warteliste bei {salon}",
  "You are on the waitlist": "Sie stehen auf der Warteliste",
  "{salon} will contact you when a place opens.": "{salon} meldet sich bei Ihnen, sobald ein Platz frei wird.",
  "Address: {address}": "Adresse: {address}",
  "Phone: {phone}": "Telefon: {phone}",
  "Confirmed: {when} at {salon}": "Bestätigt: {when} bei {salon}",
  "Confirmed": "Bestätigt",
  "{salon} has confirmed your appointment.": "{salon} hat Ihren Termin bestätigt.",
  "Add to calendar": "Zum Kalender hinzufügen",
  "{salon} could not confirm your request": "{salon} konnte Ihre Anfrage nicht bestätigen",
  "Not available": "Nicht verfügbar",
  "{salon} could not confirm the time you chose. You are welcome to pick another one.": "{salon} konnte den gewählten Termin nicht bestätigen. Wählen Sie gern einen anderen.",
  "Choose another time": "Anderen Termin wählen",
  "Reset your password": "Passwort zurücksetzen",
  "Someone asked to reset the password for your account. If it was you, choose a new password with the link below. It works once, for {hours} hours.": "Jemand hat das Zurücksetzen des Passworts für Ihr Konto angefordert. Wenn Sie das waren, wählen Sie über den Link unten ein neues Passwort. Er funktioniert einmal und ist {hours} Stunden gültig.",
  "If it was not you, ignore this email: nothing changes.": "Wenn Sie das nicht waren, ignorieren Sie diese E-Mail: Es ändert sich nichts.",
  "Choose a new password": "Neues Passwort wählen",
  "One location": "Ein Standort",
  "When a client finds you fully booked, offer an upgraded appointment in a quieter hour, at exactly the same price.": "Wenn Sie ausgebucht sind, bieten Sie einen Termin mit Upgrade zu einer ruhigeren Zeit an, zum exakt gleichen Preis.",
  "Your own request page to share anywhere": "Eine eigene Anfrageseite, die Sie überall teilen können",
  "Upgrades you define, at least +30% more time": "Upgrades nach Ihrer Wahl, mindestens +30 % mehr Zeit",
  "Never a discount, enforced by the system": "Nie ein Rabatt, vom System garantiert",
  "You confirm every request yourself": "Sie bestätigen jede Anfrage selbst",
  "Free during beta": "Kostenlos während der Beta",
  "Several locations": "Mehrere Standorte",
  "When one location is full, route the client to your location or sister brand that has room, at the same price.": "Ist ein Standort voll, leiten Sie Kunden zu Ihrem Standort oder Ihrer Schwestermarke mit freien Plätzen weiter, zum gleichen Preis.",
  "Everything in Reflow": "Alles aus Reflow",
  "Overflow routed between your locations": "Überhang zwischen Ihren Standorten verteilt",
  "One view across all locations": "Ein Überblick über alle Standorte",
  "Opens with the first multi-location salon": "Startet mit dem ersten Salon mit mehreren Standorten",
  "Partner network": "Partnernetzwerk",
  "Share overflow with trusted partner businesses. Priority is earned through reliability, never bought.": "Teilen Sie Überhang mit vertrauenswürdigen Partnerbetrieben. Vorrang wird durch Zuverlässigkeit verdient, nie gekauft.",
  "Everything in Relay": "Alles aus Relay",
  "Overflow shared with partner businesses": "Überhang mit Partnerbetrieben geteilt",
  "Trust-based priority": "Vorrang auf Vertrauensbasis",
  "Later": "Später",
  "This page does not exist.": "Diese Seite gibt es nicht.",
  "That user does not exist.": "Diesen Benutzer gibt es nicht.",
  "Create your own account": "Erstellen Sie ein eigenes Konto",
  "See your plan": "Ihren Tarif ansehen",
  "Enter a price such as 40 or 40.50.": "Geben Sie einen Preis wie 40 oder 40,50 ein.",
  "You can have up to {n} services.": "Sie können bis zu {n} Leistungen anlegen.",
  "Choose a service from the list.": "Wählen Sie eine Leistung aus der Liste.",
  "You can have up to {n} upgrades.": "Sie können bis zu {n} Upgrades anlegen.",
  "Choose at least one day.": "Wählen Sie mindestens einen Tag.",
  "Choose days from the list.": "Wählen Sie Tage aus der Liste.",
  "Enter a start time such as 13:00.": "Geben Sie eine Anfangszeit wie 13:00 ein.",
  "Enter an end time such as 16:00.": "Geben Sie eine Endzeit wie 16:00 ein.",
  "Quiet hours must last at least 30 minutes.": "Ruhige Zeiten müssen mindestens 30 Minuten dauern.",
  "Check the name, minutes and price of this service.": "Prüfen Sie Name, Minuten und Preis dieser Leistung.",
  "Check the name and minutes of this upgrade.": "Prüfen Sie Name und Minuten dieses Upgrades.",
  "Choose at least one service.": "Wählen Sie mindestens eine Leistung.",
  "You can have up to {n} quiet-hour entries.": "Sie können bis zu {n} Einträge für ruhige Zeiten anlegen.",
  "Enter a phone number such as +44 20 7946 0000.": "Geben Sie eine Telefonnummer wie +49 30 1234567 ein.",
  "Use 2 to 40 lowercase letters, numbers or dashes, starting and ending with a letter or number.": "Verwenden Sie 2 bis 40 Kleinbuchstaben, Ziffern oder Bindestriche, mit einem Buchstaben oder einer Ziffer am Anfang und am Ende.",
  "Choose your time zone.": "Wählen Sie Ihre Zeitzone.",
  "That address is already taken. Try another one.": "Diese Adresse ist bereits vergeben. Versuchen Sie eine andere.",
  "The demo account has no password to change.": "Das Demokonto hat kein Passwort, das sich ändern ließe.",
  "That is not your current password.": "Das ist nicht Ihr aktuelles Passwort.",
  "That is not your password.": "Das ist nicht Ihr Passwort.",
  "Reference": "Referenz",
  "Type": "Art",
  "Status": "Status",
  "Service": "Leistung",
  "Upgrades": "Upgrades",
  "Date": "Datum",
  "Start": "Beginn",
  "End": "Ende",
  "Minutes": "Minuten",
  "Price": "Preis",
  "Standard price": "Regulärer Preis",
  "Currency": "Währung",
  "Client": "Kunde",
  "Contact": "Kontakt",
  "Note": "Notiz",
  "Language": "Sprache",
  "Received": "Eingegangen",
  "Answered": "Beantwortet",
  "This is a demo salon: it and its sample data are deleted within 24 hours. {signup} to keep a salon of your own.": "Dies ist ein Demo-Salon: Er und seine Beispieldaten werden innerhalb von 24 Stunden gelöscht. {signup}, um einen eigenen Salon zu behalten.",
  "Your request page shows only the waitlist until you subscribe. {plan}": "Ihre Anfrageseite zeigt nur die Warteliste, bis Sie ein Abonnement abschließen. {plan}",
  "Your free trial ends on {date}. {plan}": "Ihre kostenlose Testphase endet am {date}. {plan}",
  "Name": "Name",
  "Length": "Dauer",
  "Extra minutes": "Zusätzliche Minuten",
  "Free chairs": "Freie Plätze",
  "Salon name": "Name des Salons",
  "Address": "Adresse",
  "Phone": "Telefon",
  "Minimum extra time": "Minimale Zusatzzeit",
  "New password": "Neues Passwort",
  "Choose a valid currency.": "Wählen Sie eine gültige Währung.",
  "Choose a language from the list.": "Wählen Sie eine Sprache aus der Liste.",
  "Choose a notice period from the list.": "Wählen Sie eine Vorlaufzeit aus der Liste.",
  "That request does not exist.": "Diese Anfrage gibt es nicht.",
  "That action does not apply to this request.": "Diese Aktion passt nicht zu dieser Anfrage.",
  "That service does not exist.": "Diese Leistung gibt es nicht.",
  "Unknown action.": "Unbekannte Aktion.",
  "That upgrade does not exist.": "Dieses Upgrade gibt es nicht.",
  "Unknown salon type.": "Unbekannter Salontyp.",
  "Unknown level.": "Unbekannte Stufe.",
  "Too many sign-ups from here in the last hour. Please try again later.": "Zu viele Registrierungen von hier in der letzten Stunde. Bitte versuchen Sie es später noch einmal.",
  "Please accept the terms of use to continue.": "Bitte akzeptieren Sie die Nutzungsbedingungen, um fortzufahren.",
  "Please accept the beta terms to continue.": "Bitte akzeptieren Sie die Beta-Bedingungen, um fortzufahren.",
  "An account with this email already exists. Log in instead.": "Mit dieser E-Mail-Adresse gibt es bereits ein Konto. Melden Sie sich stattdessen an.",
  "Too many attempts. Wait 15 minutes, then try again.": "Zu viele Versuche. Warten Sie 15 Minuten und versuchen Sie es dann erneut.",
  "Enter your email.": "Geben Sie Ihre E-Mail-Adresse ein.",
  "Enter your password.": "Geben Sie Ihr Passwort ein.",
  "Email or password is incorrect.": "E-Mail-Adresse oder Passwort ist falsch.",
  "Password saved. Log in with your new password.": "Passwort gespeichert. Melden Sie sich mit Ihrem neuen Passwort an.",
  "Your account and all of its data have been deleted.": "Ihr Konto und alle zugehörigen Daten wurden gelöscht.",
  "Could not create the account. Please try again.": "Das Konto konnte nicht erstellt werden. Bitte versuchen Sie es noch einmal.",
  "Too many attempts. Please try again in an hour.": "Zu viele Versuche. Bitte versuchen Sie es in einer Stunde noch einmal.",
  "Too many demos were started from here. Please try again in an hour.": "Von hier wurden zu viele Demos gestartet. Bitte versuchen Sie es in einer Stunde noch einmal.",
  "The demo is very busy right now. Please try again in a few minutes.": "Die Demo ist gerade stark ausgelastet. Bitte versuchen Sie es in ein paar Minuten noch einmal.",
  "Enter a phone number or an email address.": "Geben Sie eine Telefonnummer oder eine E-Mail-Adresse ein.",
  "Please agree, so the salon can contact you about this request.": "Bitte stimmen Sie zu, damit der Salon Sie zu dieser Anfrage kontaktieren kann.",
  "Choose one of the times.": "Wählen Sie einen der Termine.",
  "That time was just taken or has changed. Here is what is free now.": "Dieser Termin wurde gerade vergeben oder hat sich geändert. Das ist jetzt frei.",
  "Your name": "Ihr Name",
  "Phone or email": "Telefon oder E-Mail",
  "Your note": "Ihre Notiz",
  "There is no salon at this address. Check the link you were given.": "Unter dieser Adresse gibt es keinen Salon. Prüfen Sie den Link, den Sie erhalten haben.",
  "Too many requests were sent from here. Please try again in an hour, or contact the salon directly.": "Von hier wurden zu viele Anfragen gesendet. Bitte versuchen Sie es in einer Stunde noch einmal oder wenden Sie sich direkt an den Salon.",
  "This request could not be sent. Please contact the salon directly.": "Diese Anfrage konnte nicht gesendet werden. Bitte wenden Sie sich direkt an den Salon.",
  "This request link is not valid.": "Dieser Anfrage-Link ist ungültig.",
  "This appointment is not confirmed yet.": "Dieser Termin ist noch nicht bestätigt.",
  "That item does not exist.": "Diesen Eintrag gibt es nicht.",
  "Hair salon": "Friseursalon",
  "Cut & finish": "Schneiden & Föhnen",
  "Blow-dry & style": "Föhnen & Styling",
  "Colour refresh": "Farbauffrischung",
  "Highlights": "Strähnchen",
  "Deep conditioning treatment": "Intensiv-Pflegekur",
  "Scalp massage": "Kopfhautmassage",
  "Gloss treatment": "Glossing",
  "Extended styling": "Erweitertes Styling",
  "Barbershop": "Barbershop",
  "Haircut": "Haarschnitt",
  "Beard trim": "Bartschnitt",
  "Haircut & beard": "Haarschnitt & Bart",
  "Hot towel shave": "Nassrasur mit heißem Tuch",
  "Hot towel treatment": "Behandlung mit heißem Tuch",
  "Beard oil treatment": "Bartöl-Pflege",
  "Face mask": "Gesichtsmaske",
  "Nail studio": "Nagelstudio",
  "Gel manicure": "Gel-Maniküre",
  "Classic manicure": "Klassische Maniküre",
  "Pedicure": "Pediküre",
  "Gel pedicure": "Gel-Pediküre",
  "Hand massage": "Handmassage",
  "Paraffin treatment": "Paraffinbad",
  "Cuticle care": "Nagelhautpflege",
  "Nail art accent": "Nail-Art-Akzent",
  "Beauty & spa": "Kosmetik & Spa",
  "Classic facial": "Klassische Gesichtsbehandlung",
  "Relaxing massage": "Entspannungsmassage",
  "Brow & lash tint": "Augenbrauen & Wimpern färben",
  "Waxing": "Waxing",
  "Eye treatment": "Augenpflege",
  "Extended massage": "Verlängerte Massage",
  "{label} is required.": "Bitte füllen Sie „{label}“ aus.",
  "{label} is too short.": "„{label}“ ist zu kurz.",
  "{label} must be at most {max} characters.": "„{label}“ darf höchstens {max} Zeichen lang sein.",
  "{label} must be a whole number.": "„{label}“ muss eine ganze Zahl sein.",
  "{label} must be between {min} and {max}.": "„{label}“ muss zwischen {min} und {max} liegen.",
  "{label} must be a multiple of {step}.": "„{label}“ muss ein Vielfaches von {step} sein.",
  "Email": "E-Mail",
  "Enter a valid email address.": "Geben Sie eine gültige E-Mail-Adresse ein.",
  "{label} must be at least 10 characters.": "„{label}“ muss mindestens 10 Zeichen lang sein.",
  "{label} is too long.": "„{label}“ ist zu lang.",
  "Password": "Passwort",
  "Choose a valid option.": "Wählen Sie eine gültige Option.",
  "Start your free trial": "Kostenlos testen",
  "Start your free beta": "Kostenlose Beta starten",
  "Set-up takes a few minutes: pick your salon type, enter your prices, and you have a page to share.": "Die Einrichtung dauert nur wenige Minuten: Salontyp wählen, Preise eingeben, und Sie haben eine Seite zum Teilen.",
  "At least 10 characters.": "Mindestens 10 Zeichen.",
  "Time zone": "Zeitzone",
  "terms of use": "Nutzungsbedingungen",
  "beta terms": "Beta-Bedingungen",
  "privacy notice": "Datenschutzhinweise",
  "Create account": "Konto erstellen",
  "Already have an account?": "Sie haben schon ein Konto?",
  "Log in": "Anmelden",
  "Forgot your password?": "Passwort vergessen?",
  "New here?": "Neu hier?",
  "Contact the operator of this service for a reset link.": "Wenden Sie sich für einen Link zum Zurücksetzen an den Betreiber dieses Dienstes.",
  "If an account exists for that address, a reset link is on its way. It works once, for {hours} hours.": "Wenn es für diese Adresse ein Konto gibt, ist ein Link zum Zurücksetzen unterwegs. Er funktioniert einmal und ist {hours} Stunden gültig.",
  "Enter the email you signed up with. We will send you a link to choose a new password.": "Geben Sie die E-Mail-Adresse ein, mit der Sie sich registriert haben. Wir senden Ihnen einen Link, mit dem Sie ein neues Passwort wählen.",
  "Send reset link": "Link senden",
  "Back to log in": "Zurück zur Anmeldung",
  "This link has expired": "Dieser Link ist abgelaufen",
  "Reset links work once and for {hours} hours. Ask for a new one.": "Links zum Zurücksetzen funktionieren einmal und sind {hours} Stunden gültig. Fordern Sie einen neuen an.",
  "Ask for a new link": "Neuen Link anfordern",
  "For {email}. You will be logged out everywhere else.": "Für {email}. Auf allen anderen Geräten werden Sie abgemeldet.",
  "Save new password": "Neues Passwort speichern",
  "I accept the {terms} and the {privacy}.": "Ich akzeptiere die {terms} und die {privacy}.",
  "Email us from the address you signed up with, and we will send you a reset link: {email}": "Schreiben Sie uns von der Adresse, mit der Sie sich registriert haben, und wir senden Ihnen einen Link zum Zurücksetzen: {email}",
  "Hidden from clients.": "Für Kunden ausgeblendet.",
  "Not offered yet: needs upgrades worth at least {n} extra minutes.": "Noch nicht angeboten: Es fehlen Upgrades mit mindestens {n} zusätzlichen Minuten.",
  "Add upgrades": "Upgrades hinzufügen",
  "Offered as {what}: {total} instead of {base}.": "Angeboten als {what}: {total} statt {base}.",
  "Length in minutes": "Dauer in Minuten",
  "Price ({currency})": "Preis ({currency})",
  "Services": "Leistungen",
  "What clients can request. The price here is the price clients pay, always.": "Was Kunden anfragen können. Der Preis hier ist immer der Preis, den Kunden zahlen.",
  "Set up from a template": "Mit einer Vorlage einrichten",
  "Add a service": "Leistung hinzufügen",
  "Add service": "Leistung hinzufügen",
  "Your services": "Ihre Leistungen",
  "Edit": "Bearbeiten",
  "Save changes": "Änderungen speichern",
  "Hide from clients": "Für Kunden ausblenden",
  "Show to clients": "Für Kunden einblenden",
  "No services yet. Start from a template, or add the ones clients most often find fully booked.": "Noch keine Leistungen. Beginnen Sie mit einer Vorlage oder fügen Sie die Leistungen hinzu, bei denen Sie am häufigsten ausgebucht sind.",
  "Can be added to": "Kombinierbar mit",
  "All services": "Allen Leistungen",
  "Extra care you can give when a chair is free: a scalp massage, a treatment, a longer finish. Each offer combines the fewest upgrades needed to add at least {pct}% more time.": "Zusätzliche Pflege, die Sie geben können, wenn ein Platz frei ist: eine Kopfhautmassage, eine Pflegekur, ein längeres Finish. Jedes Angebot kombiniert so wenige Upgrades wie nötig, um mindestens {pct} % mehr Zeit zu erreichen.",
  "Add an upgrade": "Upgrade hinzufügen",
  "Add upgrade": "Upgrade hinzufügen",
  "Your upgrades": "Ihre Upgrades",
  "Only with {service}": "Nur mit {service}",
  "a removed service": "einer entfernten Leistung",
  "With any service": "Mit jeder Leistung",
  "switched off": "ausgeschaltet",
  "Switch off": "Ausschalten",
  "Switch on": "Einschalten",
  "No upgrades yet. Without them no offer can be made, because every offer must add real extra time.": "Noch keine Upgrades. Ohne sie entsteht kein Angebot, denn jedes Angebot muss echte zusätzliche Zeit bieten.",
  "Set up your request page": "Anfrageseite einrichten",
  "Pick the closest salon type. You will see its usual services and upgrades, enter your own prices, and can change everything later.": "Wählen Sie den passendsten Salontyp. Sie sehen die üblichen Leistungen und Upgrades, geben Ihre eigenen Preise ein und können später alles ändern.",
  "Or add services one by one": "Oder Leistungen einzeln hinzufügen",
  "Untick what you do not offer, adjust names and minutes, and enter your prices. Clients always pay exactly these prices.": "Entfernen Sie das Häkchen bei allem, was Sie nicht anbieten, passen Sie Namen und Minuten an und geben Sie Ihre Preise ein. Kunden zahlen immer genau diese Preise.",
  "Offer": "Anbieten",
  "Extra care added to an offer so that it lasts at least {pct}% longer.": "Zusätzliche Pflege, die ein Angebot um mindestens {pct} % verlängert.",
  "Quiet hours": "Ruhige Zeiten",
  "When do you usually have a free chair? You can add more times later.": "Wann haben Sie meistens einen freien Platz? Weitere Zeiten können Sie später hinzufügen.",
  "Days": "Tage",
  "From": "Von",
  "Until": "Bis",
  "Create my request page": "Meine Anfrageseite erstellen",
  "Text message": "SMS",
  "Details erased": "Daten gelöscht",
  "Hi {name}, your appointment at {salon} is confirmed: {date} at {time}. {what} ({length}) for {price}, your usual price. Reference {ref}.": "Hallo {name}, Ihr Termin bei {salon} ist bestätigt: {date} um {time}. {what} ({length}) für {price}, Ihren üblichen Preis. Referenz {ref}.",
  "Hi {name}, this is {salon}. A place has opened up for {service}:": "Hallo {name}, hier ist {salon}. Für {service} ist ein Platz frei geworden:",
  "Waitlist": "Warteliste",
  "Waiting for you": "Wartet auf Sie",
  "standard price": "regulärer Preis",
  "Reference {ref}": "Referenz {ref}",
  "Confirm": "Bestätigen",
  "Decline": "Ablehnen",
  "Message for the client": "Nachricht an den Kunden",
  "Copy message": "Nachricht kopieren",
  "Reference {ref}, received {date}": "Referenz {ref}, eingegangen am {date}",
  "Mark as contacted": "Als kontaktiert markieren",
  "Visits to your page": "Besuche Ihrer Seite",
  "Saw upgraded times": "Termine mit Upgrade gesehen",
  "Sent a request": "Anfrage gesendet",
  "Last 30 days": "Letzte 30 Tage",
  "{pct}% of the step before": "{pct} % des vorherigen Schritts",
  "Joined the waitlist: {n}. Times no upgraded slot was free: {m}.": "Auf die Warteliste eingetragen: {n}. Kein Termin mit Upgrade frei: {m}.",
  "Add the services clients book": "Leistungen hinzufügen, die Kunden buchen",
  "Pick your salon type and enter your prices": "Salontyp wählen und Preise eingeben",
  "Add upgrades that add extra time": "Upgrades hinzufügen, die Zeit verlängern",
  "Mark the hours that are usually quiet": "Meist ruhige Zeiten markieren",
  "Share your link and put up the QR code": "Link teilen und QR-Code aufstellen",
  "Requests": "Anfragen",
  "Your request page:": "Ihre Anfrageseite:",
  "Get your request page ready": "Anfrageseite vorbereiten",
  "Results so far": "Bisherige Ergebnisse",
  "Requests received": "Erhaltene Anfragen",
  "Discount given": "Gewährter Rabatt",
  "No requests waiting.": "Keine offenen Anfragen.",
  "Share your link where clients find you fully booked.": "Teilen Sie Ihren Link dort, wo Kunden sehen, dass Sie ausgebucht sind.",
  "Finish the steps above, then share your link.": "Erledigen Sie die Schritte oben und teilen Sie dann Ihren Link.",
  "Coming up": "Demnächst",
  "Confirmed appointments from your request page appear here and in your calendar feed (see Settings).": "Bestätigte Termine von Ihrer Anfrageseite erscheinen hier und in Ihrem Kalender-Abo (siehe Einstellungen).",
  "Recently answered": "Zuletzt beantwortet",
  "When": "Wann",
  "Client names and contact details are erased {days} days after each appointment. The numbers above keep counting.": "Namen und Kontaktdaten der Kunden werden {days} Tage nach jedem Termin gelöscht. Die Zahlen oben zählen weiter.",
  "Your appointment at {salon}": "Ihr Termin bei {salon}",
  "Confirmed. The client’s page now shows it as confirmed.": "Bestätigt. Die Seite des Kunden zeigt den Termin jetzt als bestätigt.",
  "Declined. The client’s page now offers them another time.": "Abgelehnt. Die Seite des Kunden bietet jetzt einen anderen Termin an.",
  "Marked as contacted.": "Als kontaktiert markiert.",
  "That time is already at capacity. Add free chairs in Quiet hours to confirm it, or decline it.": "Dieser Termin ist bereits voll belegt. Fügen Sie unter „Ruhige Zeiten“ freie Plätze hinzu, um ihn zu bestätigen, oder lehnen Sie ihn ab.",
  "That request was already answered.": "Diese Anfrage wurde bereits beantwortet.",
  "Service added.": "Leistung hinzugefügt.",
  "Service saved.": "Leistung gespeichert.",
  "Service hidden from clients.": "Leistung für Kunden ausgeblendet.",
  "Service is visible to clients again.": "Die Leistung ist für Kunden wieder sichtbar.",
  "Upgrade added.": "Upgrade hinzugefügt.",
  "Upgrade saved.": "Upgrade gespeichert.",
  "Upgrade switched off.": "Upgrade ausgeschaltet.",
  "Upgrade switched on.": "Upgrade eingeschaltet.",
  "Quiet hours added.": "Ruhige Zeiten hinzugefügt.",
  "Quiet hours removed.": "Ruhige Zeiten entfernt.",
  "Settings saved.": "Einstellungen gespeichert.",
  "Password changed. Other devices have been logged out.": "Passwort geändert. Andere Geräte wurden abgemeldet.",
  "Noted. You will hear from us when it opens.": "Notiert. Wir melden uns, sobald es losgeht.",
  "Your account is ready. A few short steps and your request page is live.": "Ihr Konto ist bereit. Noch ein paar kurze Schritte, und Ihre Anfrageseite ist online.",
  "Your services, upgrades and quiet hours are set up. Your request page is live.": "Ihre Leistungen, Upgrades und ruhigen Zeiten sind eingerichtet. Ihre Anfrageseite ist online.",
  "New calendar address created. The old one no longer works.": "Neue Kalenderadresse erstellt. Die alte funktioniert nicht mehr.",
  "Thank you! Your subscription becomes active as soon as the payment provider confirms it.": "Vielen Dank! Ihr Abonnement wird aktiv, sobald der Zahlungsanbieter es bestätigt.",
  "Welcome to the demo. Everything here is sample data you can change freely.": "Willkommen in der Demo. Alles hier sind Beispieldaten, die Sie frei ändern können.",
  "Declined": "Abgelehnt",
  "Expired": "Abgelaufen",
  "Contacted": "Kontaktiert",
  "Request": "Anfrage",
  "Weekly view of your quiet hours": "Wochenansicht Ihrer ruhigen Zeiten",
  "The times you usually have free chairs. Offers are placed only inside these hours, and never more at once than the chairs you list.": "Die Zeiten, in denen Sie meist freie Plätze haben. Angebote liegen nur in diesen Zeiten und nie mehr gleichzeitig, als Sie Plätze angeben.",
  "Add quiet hours": "Ruhige Zeiten hinzufügen",
  "Your quiet hours": "Ihre ruhigen Zeiten",
  "Day": "Tag",
  "Hours": "Uhrzeit",
  "Chairs": "Plätze",
  "Remove": "Entfernen",
  "No quiet hours yet. Start with the afternoons that are usually slow.": "Noch keine ruhigen Zeiten. Beginnen Sie mit den Nachmittagen, an denen meist wenig los ist.",
  "{n} chair": "{n} Platz",
  "{n} chairs": "{n} Plätze",
  "Start free beta": "Kostenlos in die Beta",
  "Try the live demo": "Live-Demo ausprobieren",
  "Turn “fully booked” into a booked client.": "Machen Sie aus „ausgebucht“ eine Buchung.",
  "When a client can’t get the time they wanted, {product} offers them a longer, upgraded appointment in your quiet hours, at your normal price. Your slow afternoons fill up and you never discount.": "Wenn Kunden ihre Wunschzeit nicht bekommen, bietet {product} ihnen einen längeren Termin mit Upgrade in Ihren ruhigen Zeiten an, zu Ihrem normalen Preis. Ihre ruhigen Nachmittage füllen sich, und Sie geben nie Rabatt.",
  "See how it works": "So funktioniert es",
  "Example: Saturday is fully booked when the client wanted 11:00. {product} offers Tuesday 13:30 instead: cut and finish plus deep conditioning, 60 minutes instead of 45, for the same {price}.": "Beispiel: Samstag ist ausgebucht, die Kundin wollte um 11:00 kommen. {product} bietet stattdessen Dienstag 13:30 an: Schneiden und Föhnen plus Intensiv-Pflegekur, 60 statt 45 Minuten, für dieselben {price}.",
  "Fully booked": "Ausgebucht",
  "Booked": "Gebucht",
  "Wanted, but taken": "Gewünscht, aber vergeben",
  "Free": "Frei",
  "same {price}": "gleicher Preis: {price}",
  "How it works": "So funktioniert es",
  "Share your link": "Link teilen",
  "Put it where clients find you full: the “fully booked” message on your booking page, your Instagram bio, your auto-reply, a QR code at the desk.": "Dort, wo Kunden sehen, dass Sie voll sind: in der „Ausgebucht“-Meldung Ihrer Buchungsseite, in Ihrer Instagram-Bio, in Ihrer automatischen Antwort, als QR-Code am Empfang.",
  "The client picks an upgrade": "Die Kundschaft wählt ein Upgrade",
  "They choose the service they wanted and see up to three upgraded times in your quiet hours, in their own language. No account, no app.": "Sie wählt die gewünschte Leistung und sieht bis zu drei Termine mit Upgrade in Ihren ruhigen Zeiten, in ihrer eigenen Sprache. Ohne Konto, ohne App.",
  "You confirm": "Sie bestätigen",
  "You get an email, confirm with one tap, and send the ready-made message by WhatsApp, text or email. Confirmed appointments appear in your calendar.": "Sie bekommen eine E-Mail, bestätigen mit einem Tippen und senden die fertige Nachricht per WhatsApp, SMS oder E-Mail. Bestätigte Termine erscheinen in Ihrem Kalender.",
  "Rules {product} never breaks": "Regeln, die {product} nie bricht",
  "Same price, every time": "Immer der gleiche Preis",
  "The client pays exactly your listed price. {product} cannot create a discount, and the database refuses one even if someone tries.": "Kunden zahlen genau Ihren Listenpreis. {product} kann keinen Rabatt erzeugen, und die Datenbank lehnt ihn ab, selbst wenn es jemand versucht.",
  "Noticeably more care": "Spürbar mehr Pflege",
  "Every offer adds at least 30% more time, using upgrades you choose: a scalp massage, a treatment, a longer finish.": "Jedes Angebot bringt mindestens 30 % mehr Zeit, mit Upgrades Ihrer Wahl: eine Kopfhautmassage, eine Pflegekur, ein längeres Finish.",
  "Only in hours you choose": "Nur zu Zeiten, die Sie wählen",
  "Offers land only in the quiet hours you set, and never more at once than you have free chairs.": "Angebote landen nur in den ruhigen Zeiten, die Sie festlegen, und nie mehr gleichzeitig, als Sie freie Plätze haben.",
  "You stay in charge": "Sie behalten die Kontrolle",
  "Nothing is booked until you confirm it. Client details are deleted {days} days after the appointment.": "Nichts ist gebucht, bevor Sie es bestätigen. Kundendaten werden {days} Tage nach dem Termin gelöscht.",
  "One account, three levels": "Ein Konto, drei Stufen",
  "Start with one location. The next levels switch on as your business grows.": "Starten Sie mit einem Standort. Die nächsten Stufen kommen hinzu, wenn Ihr Geschäft wächst.",
  "Coming": "Demnächst",
  "{product} turns “fully booked” into an upgraded booking in your quiet hours, at your normal price. Never a discount.": "{product} macht aus „ausgebucht“ eine Buchung mit Upgrade in Ihren ruhigen Zeiten, zu Ihrem normalen Preis. Nie mit Rabatt.",
  "Skip to content": "Zum Inhalt springen",
  "Privacy": "Datenschutz",
  "Terms": "Nutzungsbedingungen",
  "Dashboard": "Dashboard",
  "Start free": "Kostenlos starten",
  "Requests by {product}": "Anfragen über {product}",
  "Log out": "Abmelden",
  "Share": "Teilen",
  "Plan": "Tarif",
  "Settings": "Einstellungen",
  "Please correct the highlighted field.": "Bitte korrigieren Sie das markierte Feld.",
  "Please correct the {n} highlighted fields.": "Bitte korrigieren Sie die {n} markierten Felder.",
  "Fully booked when you wanted to come in? Choose your service and we will offer you a calmer time with extra care included, at the same price.": "Zu Ihrer Wunschzeit ausgebucht? Wählen Sie Ihre Leistung, und wir bieten Ihnen eine ruhigere Zeit mit zusätzlicher Pflege an, zum gleichen Preis.",
  "Prices are the salon’s standard prices. Upgraded appointments never cost more, or less.": "Die Preise sind die regulären Preise des Salons. Termine mit Upgrade kosten nie mehr und nie weniger.",
  "{salon} is not taking requests through this page yet.": "{salon} nimmt über diese Seite noch keine Anfragen an.",
  "Request an appointment": "Termin anfragen",
  "{salon} uses this to confirm your appointment. Please include the country code with a phone number, for example +44.": "{salon} nutzt dies, um Ihren Termin zu bestätigen. Bitte geben Sie bei einer Telefonnummer die Ländervorwahl an, zum Beispiel +49.",
  "Leave this field empty": "Dieses Feld leer lassen",
  "Privacy notice": "Datenschutzhinweise",
  "Pick your appointment": "Wählen Sie Ihren Termin",
  "{service} with extra time added, at the usual price of {price}.": "{service} mit zusätzlicher Zeit, zum üblichen Preis von {price}.",
  "Available upgraded times": "Verfügbare Termine mit Upgrade",
  "your usual price": "Ihr üblicher Preis",
  "Nothing is booked yet: {salon} confirms your request personally.": "Noch ist nichts gebucht: {salon} bestätigt Ihre Anfrage persönlich.",
  "Leave your details": "Hinterlassen Sie Ihre Daten",
  "No upgraded time is free right now": "Gerade ist kein Termin mit Upgrade frei",
  "{salon} is not offering upgraded times online at the moment. Leave your details for {service} and they will get back to you.": "{salon} bietet gerade online keine Termine mit Upgrade an. Hinterlassen Sie Ihre Daten für {service}, und der Salon meldet sich bei Ihnen.",
  "Leave your details for {service} and {salon} will get back to you when a place opens.": "Hinterlassen Sie Ihre Daten für {service}, und {salon} meldet sich, sobald ein Platz frei wird.",
  "When suits you?": "Wann passt es Ihnen?",
  "(optional)": "(optional)",
  "Join the waitlist": "Auf die Warteliste",
  "{salon} will confirm it personally. Keep this page: it shows the answer as soon as they reply.": "{salon} bestätigt sie persönlich. Behalten Sie diese Seite: Sie zeigt die Antwort, sobald sie da ist.",
  "See you on {date} at {time}.": "Bis {date} um {time}.",
  "{salon} could not confirm this time. You are welcome to choose another one.": "{salon} konnte diesen Termin nicht bestätigen. Wählen Sie gern einen anderen.",
  "This request was not confirmed before its time passed.": "Diese Anfrage wurde nicht rechtzeitig bestätigt.",
  "{salon} has picked up your request.": "{salon} hat Ihre Anfrage aufgenommen.",
  "This waitlist request has expired.": "Dieser Wartelisten-Eintrag ist abgelaufen.",
  "This waitlist request was closed.": "Dieser Wartelisten-Eintrag wurde geschlossen.",
  "Included": "Inklusive",
  "the standard price": "der reguläre Preis",
  "the operator of {product}": "den Betreiber von {product}",
  "What happens to your details when you use {product}.": "Was mit Ihren Daten geschieht, wenn Sie {product} nutzen.",
  "If you send a request to a salon": "Wenn Sie eine Anfrage an einen Salon senden",
  "The salon you write to decides what happens with your request; {product} only processes it on the salon’s behalf. We store your name, the phone number or email you give, the service and time you chose, the language you used, and the moment you agreed to be contacted.": "Der Salon, an den Sie schreiben, entscheidet, was mit Ihrer Anfrage geschieht; {product} verarbeitet sie nur in seinem Auftrag. Wir speichern Ihren Namen, die angegebene Telefonnummer oder E-Mail-Adresse, die gewählte Leistung und Zeit, die verwendete Sprache und den Zeitpunkt Ihrer Einwilligung in die Kontaktaufnahme.",
  "Your details are used only to answer that request, including emails about it if you gave an email address. They are deleted {days} days after the appointment date (or {days} days after a waitlist request). What remains is anonymous: the service, the time and the price, for the salon’s statistics.": "Ihre Daten werden nur zur Beantwortung dieser Anfrage verwendet, einschließlich E-Mails dazu, wenn Sie eine E-Mail-Adresse angegeben haben. Sie werden {days} Tage nach dem Termin gelöscht (oder {days} Tage nach einem Wartelisten-Eintrag). Was bleibt, ist anonym: Leistung, Zeit und Preis, für die Statistik des Salons.",
  "Pages for clients set no cookies and load nothing from other websites. Visits are counted per day without any personal data. There is no tracking and no advertising.": "Seiten für Kunden setzen keine Cookies und laden nichts von anderen Websites. Besuche werden pro Tag ohne personenbezogene Daten gezählt. Es gibt kein Tracking und keine Werbung.",
  "If you run a salon account": "Wenn Sie ein Salonkonto führen",
  "We store your email, a protected form of your password (never the password itself), your salon’s settings and the requests you receive. One cookie keeps you logged in. Email is sent through the provider this installation is configured with. Payments, if switched on, are handled entirely by the payment provider; this site never sees card details. You can delete your account and all of its data at any time from Settings.": "Wir speichern Ihre E-Mail-Adresse, eine geschützte Form Ihres Passworts (nie das Passwort selbst), die Einstellungen Ihres Salons und die Anfragen, die Sie erhalten. Ein Cookie hält Sie angemeldet. E-Mails werden über den Anbieter versendet, mit dem diese Installation eingerichtet ist. Zahlungen, sofern aktiviert, wickelt vollständig der Zahlungsanbieter ab; diese Website sieht nie Kartendaten. Sie können Ihr Konto und alle zugehörigen Daten jederzeit in den Einstellungen löschen.",
  "Your rights": "Ihre Rechte",
  "You can ask for a copy of your details, for corrections, or for deletion. For a request you sent to a salon, contact that salon directly; for anything else, contact {operator}.": "Sie können eine Kopie Ihrer Daten, ihre Berichtigung oder ihre Löschung verlangen. Zu einer Anfrage an einen Salon wenden Sie sich direkt an diesen Salon, in allen anderen Fällen an {operator}.",
  "Terms of use": "Nutzungsbedingungen",
  "Legal notice": "Impressum",
  "What you get": "Was Sie bekommen",
  "A free trial, then a monthly subscription you can cancel at any time. Prices are shown before you subscribe. Payments and invoices are handled by our payment provider.": "Eine kostenlose Testphase, danach ein monatliches Abonnement, das Sie jederzeit kündigen können. Die Preise sehen Sie vor dem Abschluss. Zahlungen und Rechnungen wickelt unser Zahlungsanbieter ab.",
  "Free use of the Reflow level while the beta runs. Features may change. If paid plans are introduced, you will be told in advance and nothing will be charged without your explicit agreement.": "Kostenlose Nutzung der Stufe Reflow, solange die Beta läuft. Funktionen können sich ändern. Falls kostenpflichtige Tarife eingeführt werden, erfahren Sie es vorher, und ohne Ihre ausdrückliche Zustimmung wird nichts berechnet.",
  "What we ask": "Worum wir bitten",
  "Use your request page only for your own business and only for real appointments. You are responsible for honouring the appointments you confirm and for treating your clients’ details with care.": "Nutzen Sie Ihre Anfrageseite nur für Ihr eigenes Geschäft und nur für echte Termine. Sie sind dafür verantwortlich, bestätigte Termine einzuhalten und die Daten Ihrer Kunden sorgfältig zu behandeln.",
  "No warranty": "Keine Gewährleistung",
  "The service is provided as is. Keep your own booking system as the record of your appointments.": "Der Dienst wird so bereitgestellt, wie er ist. Führen Sie Ihre Termine weiterhin in Ihrem eigenen Buchungssystem.",
  "Ending": "Beendigung",
  "You can delete your account at any time from Settings; your data is deleted with it.": "Sie können Ihr Konto jederzeit in den Einstellungen löschen; Ihre Daten werden dabei mitgelöscht.",
  "Go to the home page": "Zur Startseite",
  "Handled": "Erledigt",
  "Closed": "Geschlossen",
  "That did not work": "Das hat nicht geklappt",
  "Not allowed": "Nicht erlaubt",
  "Page not found": "Seite nicht gefunden",
  "Already changed": "Bereits geändert",
  "Too large": "Zu groß",
  "Form not readable": "Formular nicht lesbar",
  "Too many attempts": "Zu viele Versuche",
  "Something went wrong": "Etwas ist schiefgelaufen",
  "{salon} may contact me about this request. My details are deleted {days} days after the appointment. {privacy}": "{salon} darf mich zu dieser Anfrage kontaktieren. Meine Daten werden {days} Tage nach dem Termin gelöscht. {privacy}",
  "You can ask for a copy of your details, for corrections, or for deletion. For a request you sent to a salon, contact that salon directly; for anything else, contact {operator} at {email}.": "Sie können eine Kopie Ihrer Daten, ihre Berichtigung oder ihre Löschung verlangen. Zu einer Anfrage an einen Salon wenden Sie sich direkt an diesen Salon, in allen anderen Fällen an {operator} unter {email}.",
  "Logged in as {email}": "Angemeldet als {email}",
  "Salon": "Salon",
  "Shown to clients on their confirmation.": "Wird Kunden mit ihrer Bestätigung angezeigt.",
  "Page address": "Seitenadresse",
  "Lowercase letters, numbers and dashes. Links you already shared stop working if you change it.": "Kleinbuchstaben, Ziffern und Bindestriche. Bereits geteilte Links funktionieren nach einer Änderung nicht mehr.",
  "Language of your request page": "Sprache Ihrer Anfrageseite",
  "Clients can switch to another language on the page.": "Kunden können auf der Seite die Sprache wechseln.",
  "Minimum extra time (%)": "Minimale Zusatzzeit (%)",
  "At least {pct}%. Raise it if you want offers to feel even more generous.": "Mindestens {pct} %. Erhöhen Sie den Wert, wenn Angebote noch großzügiger wirken sollen.",
  "Minimum notice": "Mindestvorlauf",
  "How soon an offered time can start, so you have time to confirm.": "Wie früh ein angebotener Termin beginnen darf, damit Sie Zeit zum Bestätigen haben.",
  "Save settings": "Einstellungen speichern",
  "You": "Ihr Konto",
  "Language of your dashboard and emails": "Sprache Ihres Dashboards und Ihrer E-Mails",
  "Email notifications": "E-Mail-Benachrichtigungen",
  "Email me when a client sends a request": "Mir eine E-Mail senden, wenn eine Anfrage eingeht",
  "Email sending is not set up on this installation yet, so no emails go out for now.": "Der E-Mail-Versand ist auf dieser Installation noch nicht eingerichtet, daher werden vorerst keine E-Mails verschickt.",
  "Save": "Speichern",
  "Calendar": "Kalender",
  "Subscribe to this address in Google Calendar, Apple Calendar or Outlook, and every appointment you confirm appears there by itself. Keep the address private: it shows your clients’ names.": "Abonnieren Sie diese Adresse in Google Kalender, Apple Kalender oder Outlook, dann erscheint jeder bestätigte Termin dort automatisch. Halten Sie die Adresse privat: Sie zeigt die Namen Ihrer Kunden.",
  "Copy address": "Adresse kopieren",
  "Create a new address (the old one stops working)": "Neue Adresse erstellen (die alte funktioniert dann nicht mehr)",
  "Create calendar address": "Kalenderadresse erstellen",
  "Export": "Export",
  "All requests as a spreadsheet file (CSV), for your records or another tool.": "Alle Anfragen als Tabellendatei (CSV), für Ihre Unterlagen oder ein anderes Programm.",
  "Download requests (CSV)": "Anfragen herunterladen (CSV)",
  "Current password": "Aktuelles Passwort",
  "Change password": "Passwort ändern",
  "Audit log": "Änderungsprotokoll",
  "Every offer, confirmation and price change is recorded in a tamper-evident log.": "Jedes Angebot, jede Bestätigung und jede Preisänderung wird in einem fälschungssicheren Protokoll festgehalten.",
  "Check the audit log": "Protokoll prüfen",
  "Delete account": "Konto löschen",
  "Deletes your salon, services, requests and client details permanently. This cannot be undone.": "Löscht Ihren Salon, Ihre Leistungen, Anfragen und Kundendaten endgültig. Das lässt sich nicht rückgängig machen.",
  "Your password": "Ihr Passwort",
  "Delete account and all data": "Konto und alle Daten löschen",
  "One account, three levels.": "Ein Konto, drei Stufen.",
  "Subscription": "Abonnement",
  "Subscribe: {price}": "Abonnieren: {price}",
  "Subscribe": "Abonnieren",
  "Manage subscription and invoices": "Abonnement und Rechnungen verwalten",
  "You are on Reflow, free during the beta.": "Sie nutzen Reflow, kostenlos während der Beta.",
  "Your plan": "Ihr Tarif",
  "On the list": "Vorgemerkt",
  "We will tell you when it opens": "Wir sagen Bescheid, sobald es losgeht",
  "Tell me when {plan} opens": "Bescheid geben, wenn {plan} startet",
  "Page address {slug}, {timezone}, {currency}": "Seitenadresse {slug}, {timezone}, {currency}",
  "at least {pct}% extra time": "mindestens {pct} % Zusatzzeit",
  "Service {id} shown to clients": "Leistung {id} für Kunden eingeblendet",
  "Service {id} hidden from clients": "Leistung {id} für Kunden ausgeblendet",
  "was {price}": "vorher {price}",
  "Upgrade {id} switched on": "Upgrade {id} eingeschaltet",
  "Upgrade {id} switched off": "Upgrade {id} ausgeschaltet",
  "Each entry carries the fingerprint of the one before it, so a changed or deleted entry breaks the chain.": "Jeder Eintrag trägt den Fingerabdruck des vorherigen, sodass ein geänderter oder gelöschter Eintrag die Kette unterbricht.",
  "Chain broken at entry {id}. An entry was changed or removed outside the app.": "Kette bei Eintrag {id} unterbrochen. Ein Eintrag wurde außerhalb der App geändert oder entfernt.",
  "Latest fingerprint:": "Letzter Fingerabdruck:",
  "Free trial until {date}.": "Kostenlose Testphase bis {date}.",
  "Your subscription is active.": "Ihr Abonnement ist aktiv.",
  "Your last payment did not go through. Please update your payment method to keep your request page running.": "Ihre letzte Zahlung ist nicht durchgegangen. Bitte aktualisieren Sie Ihre Zahlungsmethode, damit Ihre Anfrageseite weiterläuft.",
  "Your subscription is cancelled. Upgraded offers keep running until {date}.": "Ihr Abonnement ist gekündigt. Angebote mit Upgrade laufen noch bis {date}.",
  "Your subscription is paused. Clients can join your waitlist, but see no upgraded times.": "Ihr Abonnement ist pausiert. Kunden können sich auf Ihre Warteliste setzen, sehen aber keine Termine mit Upgrade.",
  "Your subscription is not active. Clients can join your waitlist, but see no upgraded times.": "Ihr Abonnement ist nicht aktiv. Kunden können sich auf Ihre Warteliste setzen, sehen aber keine Termine mit Upgrade.",
  "Account created": "Konto erstellt",
  "Settings changed": "Einstellungen geändert",
  "Service added": "Leistung hinzugefügt",
  "Service changed": "Leistung geändert",
  "Upgrade added": "Upgrade hinzugefügt",
  "Upgrade changed": "Upgrade geändert",
  "Quiet hours added": "Ruhige Zeiten hinzugefügt",
  "Quiet hours removed": "Ruhige Zeiten entfernt",
  "Offer requested": "Angebot angefragt",
  "Waitlist request": "Wartelisten-Eintrag",
  "Request confirmed": "Anfrage bestätigt",
  "Request declined": "Anfrage abgelehnt",
  "Waitlist request handled": "Wartelisten-Eintrag erledigt",
  "Subscription changed": "Abonnement geändert",
  "Free beta": "Kostenlose Beta",
  "Free trial": "Kostenlose Testphase",
  "{days}-day free trial": "{days} Tage kostenlos testen",
  "Monthly subscription": "Monatsabonnement",
  "Active": "Aktiv",
  "Payment overdue": "Zahlung überfällig",
  "Cancelled": "Gekündigt",
  "Paused": "Pausiert",
  "Ended": "Beendet",
  "{n} service": "{n} Leistung",
  "{n} services": "{n} Leistungen",
  "{n} upgrade": "{n} Upgrade",
  "{n} upgrades": "{n} Upgrades",
  "Chain intact: {n} entry checked, none changed.": "Kette intakt: {n} Eintrag geprüft, keiner geändert.",
  "Chain intact: {n} entries checked, none changed.": "Kette intakt: {n} Einträge geprüft, keiner geändert.",
  "Booking page, “fully booked” message": "Buchungsseite, Meldung „ausgebucht“",
  "Fully booked at the time you wanted? Get a longer, upgraded appointment at the same price: {url}": "Zu Ihrer Wunschzeit ausgebucht? Sichern Sie sich einen längeren Termin mit Upgrade zum gleichen Preis: {url}",
  "Instagram or Facebook bio": "Instagram- oder Facebook-Bio",
  "Fully booked? Upgraded appointments, same price: {url}": "Ausgebucht? Termine mit Upgrade, gleicher Preis: {url}",
  "Auto-reply for messages": "Automatische Antwort auf Nachrichten",
  "Thanks for your message! If we’re fully booked when you’d like to come, {salon} can offer you a calmer time with extra care included, at the same price. Pick one here: {url}": "Danke für Ihre Nachricht! Wenn wir zu Ihrer Wunschzeit ausgebucht sind, kann {salon} Ihnen eine ruhigere Zeit mit zusätzlicher Pflege anbieten, zum gleichen Preis. Hier auswählen: {url}",
  "Fully booked? See upgraded times": "Ausgebucht? Termine mit Upgrade ansehen",
  "Put your link wherever clients find you fully booked. Texts below are in the language of your request page: {language}.": "Platzieren Sie Ihren Link überall dort, wo Kunden sehen, dass Sie ausgebucht sind. Die Texte unten sind in der Sprache Ihrer Anfrageseite: {language}.",
  "Your link": "Ihr Link",
  "Copy link": "Link kopieren",
  "Open page": "Seite öffnen",
  "Texts to copy": "Texte zum Kopieren",
  "Copy text": "Text kopieren",
  "QR code for the desk and the window": "QR-Code für Empfang und Schaufenster",
  "QR code that opens your request page": "QR-Code, der Ihre Anfrageseite öffnet",
  "Print the poster for your reception desk or window, or put the QR code on your price list.": "Drucken Sie das Plakat für Empfang oder Schaufenster aus, oder setzen Sie den QR-Code auf Ihre Preisliste.",
  "Open printable poster": "Druckbares Plakat öffnen",
  "Download QR code": "QR-Code herunterladen",
  "Button for your website": "Button für Ihre Website",
  "Paste this code into your website where clients see that you are fully booked.": "Fügen Sie diesen Code dort in Ihre Website ein, wo Kunden sehen, dass Sie ausgebucht sind.",
  "Copy code": "Code kopieren",
  "Fully booked?": "Ausgebucht?",
  "Scan for a longer, upgraded appointment in a calmer hour, at the same price.": "Scannen Sie den Code für einen längeren Termin mit Upgrade zu einer ruhigeren Zeit, zum gleichen Preis.",
  "Print poster": "Plakat drucken",
  "Back": "Zurück",
  "Appointment canceled": "Termin abgesagt",
  "Join the salon team": "Dem Salonteam beitreten",
  "Verify your email": "E-Mail-Adresse bestätigen",
  "This private link expires in 24 hours. If you did not request it, ignore this email.": "Dieser private Link läuft nach 24 Stunden ab. Falls Sie ihn nicht angefordert haben, ignorieren Sie diese E-Mail.",
  "Appointment reminder": "Terminerinnerung",
  "Handle future appointments before changing the time zone.": "Bearbeiten Sie künftige Termine, bevor Sie die Zeitzone ändern.",
  "Only the owner can change these settings.": "Nur der Inhaber kann diese Einstellungen ändern.",
  "End your paid subscription before deleting the account.": "Beenden Sie Ihr kostenpflichtiges Abonnement, bevor Sie das Konto löschen.",
  "Completed": "Abgeschlossen",
  "No-show": "Nicht erschienen",
  "Canceled": "Abgesagt",
  "All": "Alle",
  "Appointments": "Termine",
  "Block time": "Zeit sperren",
  "Search": "Suchen",
  "No appointments found.": "Keine Termine gefunden.",
  "Mark completed": "Als abgeschlossen markieren",
  "Cancel this appointment?": "Diesen Termin absagen?",
  "Cancel appointment": "Termin absagen",
  "Previous": "Zurück",
  "Next": "Weiter",
  "Availability": "Verfügbarkeit",
  "Block holidays, breaks and appointments from your other booking system.": "Sperren Sie Urlaub, Pausen und Termine aus Ihrem anderen Buchungssystem.",
  "Close the whole day": "Den ganzen Tag schließen",
  "No blocked times.": "Keine gesperrten Zeiten.",
  "This block overlaps a reservation. Handle the reservation first.": "Diese Sperre überschneidet sich mit einer Reservierung. Bearbeiten Sie zuerst die Reservierung.",
  "Change appointment": "Termin ändern",
  "Your current appointment stays reserved until you choose a new time. The salon must confirm the change.": "Ihr aktueller Termin bleibt reserviert, bis Sie eine neue Zeit wählen. Der Salon muss die Änderung bestätigen.",
  "Cancellation notice (minutes)": "Stornierungsfrist (Minuten)",
  "Request hold (hours)": "Reservierungsdauer der Anfrage (Stunden)",
  "Please contact the salon to change this appointment.": "Bitte kontaktieren Sie den Salon, um diesen Termin zu ändern.",
  "Team": "Team",
  "Staff can manage appointments and blocked times. Billing, exports and business settings stay with the owner.": "Mitarbeiter können Termine und gesperrte Zeiten verwalten. Abrechnung, Exporte und Betriebseinstellungen bleiben beim Inhaber.",
  "Invitation ready. Send this private link to your colleague.": "Einladung bereit. Senden Sie diesen privaten Link an Ihren Kollegen.",
  "Invitation link": "Einladungslink",
  "Invite a colleague": "Kollegen einladen",
  "Owner": "Inhaber",
  "Staff": "Mitarbeiter",
  "Remove this colleague?": "Diesen Kollegen entfernen?",
  "Pending invitations": "Offene Einladungen",
  "Check your inbox and confirm your email before opening your dashboard.": "Prüfen Sie Ihren Posteingang und bestätigen Sie Ihre E-Mail-Adresse, bevor Sie das Dashboard öffnen.",
  "Check your inbox.": "Prüfen Sie Ihren Posteingang.",
  "Resend email": "E-Mail erneut senden",
  "My account": "Mein Konto",
  "This action is not available in the demo.": "Diese Aktion ist in der Demo nicht verfügbar.",
  "This email is already registered or the team is full.": "Diese E-Mail-Adresse ist bereits registriert oder das Team ist voll.",
  "Booked value": "Buchungswert",
  "Booked value is not collected revenue. Mark completed services in Appointments.": "Der Buchungswert ist kein vereinnahmter Umsatz. Markieren Sie abgeschlossene Leistungen unter Termine.",
  "Completed service value": "Wert abgeschlossener Leistungen",
  "Request hold: {hours} hours. Changes and cancellations close {minutes} minutes before the appointment.": "Reservierungsdauer: {hours} Stunden. Änderungen und Absagen sind bis {minutes} Minuten vor dem Termin möglich.",
  "Booking policy": "Buchungsregeln",
  "Unanswered requests release their reserved time when the hold expires.": "Unbeantwortete Anfragen geben ihre reservierte Zeit nach Ablauf der Reservierungsdauer frei."
};
return { default: __default };
})();

// src/i18n/fr.js
const __m13 = (() => {
// Copyright (c) 2026 Miloš Petrović (Trench Logic Studio) · SPDX-License-Identifier: MIT
// Translations are checked for completeness and placeholder parity.
const __default = {
  "There is nothing at this address.": "Il n’y a rien à cette adresse.",
  "That action is not available here.": "Cette action n’est pas disponible ici.",
  "This form was sent from another website, so it was blocked. Open the page again and resend it.": "Ce formulaire a été envoyé depuis un autre site et a donc été bloqué. Rouvrez la page et renvoyez-le.",
  "12 Example Street": "12 rue de l’Exemple",
  "Any weekday after 17:00": "En semaine, après 17:00",
  "This form could not be read. Please reload the page and try again.": "Ce formulaire n’a pas pu être lu. Rechargez la page et réessayez.",
  "That form is too large.": "Ce formulaire est trop volumineux.",
  "Send request": "Envoyer la demande",
  "{m} min": "{m} min",
  "{h} h {m} min": "{h} h {m} min",
  "{h} h": "{h} h",
  "{total} instead of {base}": "{total} au lieu de {base}",
  "Price: {price}, the standard price": "Prix : {price}, le prix habituel",
  "Reference: {ref}": "Référence : {ref}",
  "New request: {when}": "Nouvelle demande : {when}",
  "A client asked for an upgraded appointment through your request page.": "Un client a demandé un rendez-vous enrichi via votre page de demande.",
  "Client: {contact}": "Client : {contact}",
  "Confirm or decline": "Confirmer ou refuser",
  "You receive these emails because notifications are on in Settings.": "Vous recevez ces e-mails car les notifications sont activées dans les paramètres.",
  "New waitlist request: {service}": "Nouvelle inscription sur liste d’attente : {service}",
  "A client joined your waitlist.": "Un client s’est inscrit sur votre liste d’attente.",
  "Note: “{note}”": "Note : « {note} »",
  "Open your dashboard": "Ouvrir le tableau de bord",
  "You receive this email because you sent a request to {salon}. Your details are deleted {days} days after the appointment.": "Vous recevez cet e-mail car vous avez envoyé une demande à {salon}. Vos données sont supprimées {days} jours après le rendez-vous.",
  "Your request at {salon}": "Votre demande chez {salon}",
  "Request sent": "Demande envoyée",
  "{salon} has your request and will confirm it personally.": "{salon} a bien reçu votre demande et la confirmera personnellement.",
  "See your request": "Voir votre demande",
  "You are on the waitlist at {salon}": "Vous êtes sur la liste d’attente de {salon}",
  "You are on the waitlist": "Vous êtes sur la liste d’attente",
  "{salon} will contact you when a place opens.": "{salon} vous contactera dès qu’une place se libère.",
  "Address: {address}": "Adresse : {address}",
  "Phone: {phone}": "Téléphone : {phone}",
  "Confirmed: {when} at {salon}": "Confirmé : {when} chez {salon}",
  "Confirmed": "Confirmé",
  "{salon} has confirmed your appointment.": "{salon} a confirmé votre rendez-vous.",
  "Add to calendar": "Ajouter au calendrier",
  "{salon} could not confirm your request": "{salon} n’a pas pu confirmer votre demande",
  "Not available": "Indisponible",
  "{salon} could not confirm the time you chose. You are welcome to pick another one.": "{salon} n’a pas pu confirmer l’horaire choisi. N’hésitez pas à en choisir un autre.",
  "Choose another time": "Choisir un autre horaire",
  "Reset your password": "Réinitialiser votre mot de passe",
  "Someone asked to reset the password for your account. If it was you, choose a new password with the link below. It works once, for {hours} hours.": "Quelqu’un a demandé à réinitialiser le mot de passe de votre compte. Si c’était vous, choisissez un nouveau mot de passe avec le lien ci-dessous. Il fonctionne une seule fois, pendant {hours} heures.",
  "If it was not you, ignore this email: nothing changes.": "Si ce n’était pas vous, ignorez cet e-mail : rien ne change.",
  "Choose a new password": "Choisir un nouveau mot de passe",
  "One location": "Un établissement",
  "When a client finds you fully booked, offer an upgraded appointment in a quieter hour, at exactly the same price.": "Quand un client vous trouve complet, proposez-lui un rendez-vous enrichi à une heure plus calme, exactement au même prix.",
  "Your own request page to share anywhere": "Votre propre page de demande, à partager partout",
  "Upgrades you define, at least +30% more time": "Des extras que vous définissez, au moins +30 % de temps en plus",
  "Never a discount, enforced by the system": "Jamais de remise, garanti par le système",
  "You confirm every request yourself": "Vous confirmez vous-même chaque demande",
  "Free during beta": "Gratuit pendant la bêta",
  "Several locations": "Plusieurs établissements",
  "When one location is full, route the client to your location or sister brand that has room, at the same price.": "Quand un établissement est complet, orientez le client vers celui de vos établissements ou de vos marques sœurs qui a de la place, au même prix.",
  "Everything in Reflow": "Tout Reflow",
  "Overflow routed between your locations": "Demandes en surplus réparties entre vos établissements",
  "One view across all locations": "Une vue unique sur tous les établissements",
  "Opens with the first multi-location salon": "Ouvre avec le premier salon multi-établissements",
  "Partner network": "Réseau de partenaires",
  "Share overflow with trusted partner businesses. Priority is earned through reliability, never bought.": "Partagez le surplus avec des partenaires de confiance. La priorité se gagne par la fiabilité, elle ne s’achète jamais.",
  "Everything in Relay": "Tout Relay",
  "Overflow shared with partner businesses": "Surplus partagé avec des partenaires",
  "Trust-based priority": "Priorité fondée sur la confiance",
  "Later": "Plus tard",
  "This page does not exist.": "Cette page n’existe pas.",
  "That user does not exist.": "Cet utilisateur n’existe pas.",
  "Create your own account": "Créez votre propre compte",
  "See your plan": "Voir votre formule",
  "Enter a price such as 40 or 40.50.": "Saisissez un prix comme 40 ou 40,50.",
  "You can have up to {n} services.": "Vous pouvez avoir jusqu’à {n} prestations.",
  "Choose a service from the list.": "Choisissez une prestation dans la liste.",
  "You can have up to {n} upgrades.": "Vous pouvez avoir jusqu’à {n} extras.",
  "Choose at least one day.": "Choisissez au moins un jour.",
  "Choose days from the list.": "Choisissez des jours dans la liste.",
  "Enter a start time such as 13:00.": "Saisissez une heure de début comme 13:00.",
  "Enter an end time such as 16:00.": "Saisissez une heure de fin comme 16:00.",
  "Quiet hours must last at least 30 minutes.": "Les heures creuses doivent durer au moins 30 minutes.",
  "Check the name, minutes and price of this service.": "Vérifiez le nom, la durée et le prix de cette prestation.",
  "Check the name and minutes of this upgrade.": "Vérifiez le nom et la durée de cet extra.",
  "Choose at least one service.": "Choisissez au moins une prestation.",
  "You can have up to {n} quiet-hour entries.": "Vous pouvez avoir jusqu’à {n} plages d’heures creuses.",
  "Enter a phone number such as +44 20 7946 0000.": "Saisissez un numéro de téléphone comme +33 1 23 45 67 89.",
  "Use 2 to 40 lowercase letters, numbers or dashes, starting and ending with a letter or number.": "Utilisez 2 à 40 lettres minuscules, chiffres ou tirets, en commençant et en finissant par une lettre ou un chiffre.",
  "Choose your time zone.": "Choisissez votre fuseau horaire.",
  "That address is already taken. Try another one.": "Cette adresse est déjà prise. Essayez-en une autre.",
  "The demo account has no password to change.": "Le compte de démonstration n’a pas de mot de passe à modifier.",
  "That is not your current password.": "Ce n’est pas votre mot de passe actuel.",
  "That is not your password.": "Ce n’est pas votre mot de passe.",
  "Reference": "Référence",
  "Type": "Type",
  "Status": "Statut",
  "Service": "Prestation",
  "Upgrades": "Extras",
  "Date": "Date",
  "Start": "Début",
  "End": "Fin",
  "Minutes": "Minutes",
  "Price": "Prix",
  "Standard price": "Prix habituel",
  "Currency": "Devise",
  "Client": "Client",
  "Contact": "Contact",
  "Note": "Note",
  "Language": "Langue",
  "Received": "Reçue",
  "Answered": "Traitée",
  "This is a demo salon: it and its sample data are deleted within 24 hours. {signup} to keep a salon of your own.": "Ceci est un salon de démonstration : il est supprimé avec ses données d’exemple sous 24 heures. {signup} pour garder votre propre salon.",
  "Your request page shows only the waitlist until you subscribe. {plan}": "Votre page de demande n’affiche que la liste d’attente tant que vous n’êtes pas abonné. {plan}",
  "Your free trial ends on {date}. {plan}": "Votre essai gratuit se termine le {date}. {plan}",
  "Name": "Nom",
  "Length": "Durée",
  "Extra minutes": "Minutes en plus",
  "Free chairs": "Places libres",
  "Salon name": "Nom du salon",
  "Address": "Adresse",
  "Phone": "Téléphone",
  "Minimum extra time": "Temps supplémentaire minimum",
  "New password": "Nouveau mot de passe",
  "Choose a valid currency.": "Choisissez une devise valide.",
  "Choose a language from the list.": "Choisissez une langue dans la liste.",
  "Choose a notice period from the list.": "Choisissez un délai dans la liste.",
  "That request does not exist.": "Cette demande n’existe pas.",
  "That action does not apply to this request.": "Cette action ne s’applique pas à cette demande.",
  "That service does not exist.": "Cette prestation n’existe pas.",
  "Unknown action.": "Action inconnue.",
  "That upgrade does not exist.": "Cet extra n’existe pas.",
  "Unknown salon type.": "Type de salon inconnu.",
  "Unknown level.": "Niveau inconnu.",
  "Too many sign-ups from here in the last hour. Please try again later.": "Trop d’inscriptions depuis cet endroit au cours de la dernière heure. Réessayez plus tard.",
  "Please accept the terms of use to continue.": "Veuillez accepter les conditions d’utilisation pour continuer.",
  "Please accept the beta terms to continue.": "Veuillez accepter les conditions de la bêta pour continuer.",
  "An account with this email already exists. Log in instead.": "Un compte existe déjà avec cet e-mail. Connectez-vous plutôt.",
  "Too many attempts. Wait 15 minutes, then try again.": "Trop de tentatives. Attendez 15 minutes, puis réessayez.",
  "Enter your email.": "Saisissez votre e-mail.",
  "Enter your password.": "Saisissez votre mot de passe.",
  "Email or password is incorrect.": "E-mail ou mot de passe incorrect.",
  "Password saved. Log in with your new password.": "Mot de passe enregistré. Connectez-vous avec votre nouveau mot de passe.",
  "Your account and all of its data have been deleted.": "Votre compte et toutes ses données ont été supprimés.",
  "Could not create the account. Please try again.": "Impossible de créer le compte. Veuillez réessayer.",
  "Too many attempts. Please try again in an hour.": "Trop de tentatives. Réessayez dans une heure.",
  "Too many demos were started from here. Please try again in an hour.": "Trop de démonstrations ont été lancées depuis cet endroit. Réessayez dans une heure.",
  "The demo is very busy right now. Please try again in a few minutes.": "La démonstration est très sollicitée en ce moment. Réessayez dans quelques minutes.",
  "Enter a phone number or an email address.": "Saisissez un numéro de téléphone ou une adresse e-mail.",
  "Please agree, so the salon can contact you about this request.": "Veuillez donner votre accord pour que le salon puisse vous contacter au sujet de cette demande.",
  "Choose one of the times.": "Choisissez l’un des créneaux.",
  "That time was just taken or has changed. Here is what is free now.": "Ce créneau vient d’être pris ou a changé. Voici ce qui est libre maintenant.",
  "Your name": "Votre nom",
  "Phone or email": "Téléphone ou e-mail",
  "Your note": "Votre note",
  "There is no salon at this address. Check the link you were given.": "Il n’y a pas de salon à cette adresse. Vérifiez le lien qui vous a été donné.",
  "Too many requests were sent from here. Please try again in an hour, or contact the salon directly.": "Trop de demandes ont été envoyées depuis cet endroit. Réessayez dans une heure ou contactez directement le salon.",
  "This request could not be sent. Please contact the salon directly.": "Cette demande n’a pas pu être envoyée. Veuillez contacter directement le salon.",
  "This request link is not valid.": "Ce lien de demande n’est pas valide.",
  "This appointment is not confirmed yet.": "Ce rendez-vous n’est pas encore confirmé.",
  "That item does not exist.": "Cet élément n’existe pas.",
  "Hair salon": "Salon de coiffure",
  "Cut & finish": "Coupe & brushing",
  "Blow-dry & style": "Brushing & coiffage",
  "Colour refresh": "Rafraîchissement couleur",
  "Highlights": "Mèches",
  "Deep conditioning treatment": "Soin profond",
  "Scalp massage": "Massage du cuir chevelu",
  "Gloss treatment": "Soin gloss",
  "Extended styling": "Coiffage prolongé",
  "Barbershop": "Barbier",
  "Haircut": "Coupe",
  "Beard trim": "Taille de barbe",
  "Haircut & beard": "Coupe & barbe",
  "Hot towel shave": "Rasage à la serviette chaude",
  "Hot towel treatment": "Soin serviette chaude",
  "Beard oil treatment": "Soin à l’huile à barbe",
  "Face mask": "Masque visage",
  "Nail studio": "Onglerie",
  "Gel manicure": "Manucure gel",
  "Classic manicure": "Manucure classique",
  "Pedicure": "Pédicure",
  "Gel pedicure": "Pédicure gel",
  "Hand massage": "Massage des mains",
  "Paraffin treatment": "Soin à la paraffine",
  "Cuticle care": "Soin des cuticules",
  "Nail art accent": "Touche de nail art",
  "Beauty & spa": "Institut & spa",
  "Classic facial": "Soin du visage classique",
  "Relaxing massage": "Massage relaxant",
  "Brow & lash tint": "Teinture sourcils & cils",
  "Waxing": "Épilation à la cire",
  "Eye treatment": "Soin contour des yeux",
  "Extended massage": "Massage prolongé",
  "{label} is required.": "Le champ « {label} » est obligatoire.",
  "{label} is too short.": "Le champ « {label} » est trop court.",
  "{label} must be at most {max} characters.": "Le champ « {label} » ne doit pas dépasser {max} caractères.",
  "{label} must be a whole number.": "Le champ « {label} » doit être un nombre entier.",
  "{label} must be between {min} and {max}.": "Le champ « {label} » doit être compris entre {min} et {max}.",
  "{label} must be a multiple of {step}.": "Le champ « {label} » doit être un multiple de {step}.",
  "Email": "E-mail",
  "Enter a valid email address.": "Saisissez une adresse e-mail valide.",
  "{label} must be at least 10 characters.": "Le champ « {label} » doit comporter au moins 10 caractères.",
  "{label} is too long.": "Le champ « {label} » est trop long.",
  "Password": "Mot de passe",
  "Choose a valid option.": "Choisissez une option valide.",
  "Start your free trial": "Commencer l’essai gratuit",
  "Start your free beta": "Commencer la bêta gratuite",
  "Set-up takes a few minutes: pick your salon type, enter your prices, and you have a page to share.": "La mise en place prend quelques minutes : choisissez votre type de salon, saisissez vos prix, et vous avez une page à partager.",
  "At least 10 characters.": "Au moins 10 caractères.",
  "Time zone": "Fuseau horaire",
  "terms of use": "conditions d’utilisation",
  "beta terms": "conditions de la bêta",
  "privacy notice": "politique de confidentialité",
  "Create account": "Créer le compte",
  "Already have an account?": "Vous avez déjà un compte ?",
  "Log in": "Se connecter",
  "Forgot your password?": "Mot de passe oublié ?",
  "New here?": "Nouveau ici ?",
  "Contact the operator of this service for a reset link.": "Contactez l’exploitant de ce service pour obtenir un lien de réinitialisation.",
  "If an account exists for that address, a reset link is on its way. It works once, for {hours} hours.": "Si un compte existe pour cette adresse, un lien de réinitialisation est en route. Il fonctionne une seule fois, pendant {hours} heures.",
  "Enter the email you signed up with. We will send you a link to choose a new password.": "Saisissez l’e-mail utilisé à l’inscription. Nous vous enverrons un lien pour choisir un nouveau mot de passe.",
  "Send reset link": "Envoyer le lien",
  "Back to log in": "Retour à la connexion",
  "This link has expired": "Ce lien a expiré",
  "Reset links work once and for {hours} hours. Ask for a new one.": "Les liens de réinitialisation fonctionnent une seule fois, pendant {hours} heures. Demandez-en un nouveau.",
  "Ask for a new link": "Demander un nouveau lien",
  "For {email}. You will be logged out everywhere else.": "Pour {email}. Vous serez déconnecté partout ailleurs.",
  "Save new password": "Enregistrer le nouveau mot de passe",
  "I accept the {terms} and the {privacy}.": "J’accepte les {terms} et la {privacy}.",
  "Email us from the address you signed up with, and we will send you a reset link: {email}": "Écrivez-nous depuis l’adresse utilisée à l’inscription, et nous vous enverrons un lien de réinitialisation : {email}",
  "Hidden from clients.": "Masquée pour les clients.",
  "Not offered yet: needs upgrades worth at least {n} extra minutes.": "Pas encore proposée : il faut des extras d’au moins {n} minutes au total.",
  "Add upgrades": "Ajouter des extras",
  "Offered as {what}: {total} instead of {base}.": "Proposée en {what} : {total} au lieu de {base}.",
  "Length in minutes": "Durée en minutes",
  "Price ({currency})": "Prix ({currency})",
  "Services": "Prestations",
  "What clients can request. The price here is the price clients pay, always.": "Ce que vos clients peuvent demander. Le prix indiqué ici est toujours celui que paient vos clients.",
  "Set up from a template": "Configurer à partir d’un modèle",
  "Add a service": "Ajouter une prestation",
  "Add service": "Ajouter la prestation",
  "Your services": "Vos prestations",
  "Edit": "Modifier",
  "Save changes": "Enregistrer",
  "Hide from clients": "Masquer pour les clients",
  "Show to clients": "Afficher pour les clients",
  "No services yet. Start from a template, or add the ones clients most often find fully booked.": "Aucune prestation pour l’instant. Partez d’un modèle ou ajoutez celles pour lesquelles vous êtes le plus souvent complet.",
  "Can be added to": "Peut s’ajouter à",
  "All services": "Toutes les prestations",
  "Extra care you can give when a chair is free: a scalp massage, a treatment, a longer finish. Each offer combines the fewest upgrades needed to add at least {pct}% more time.": "Un soin en plus que vous pouvez offrir quand une place est libre : un massage du cuir chevelu, un soin, un coiffage plus long. Chaque offre combine le moins d’extras possible pour ajouter au moins {pct} % de temps.",
  "Add an upgrade": "Ajouter un extra",
  "Add upgrade": "Ajouter l’extra",
  "Your upgrades": "Vos extras",
  "Only with {service}": "Uniquement avec {service}",
  "a removed service": "une prestation supprimée",
  "With any service": "Avec toutes les prestations",
  "switched off": "désactivé",
  "Switch off": "Désactiver",
  "Switch on": "Activer",
  "No upgrades yet. Without them no offer can be made, because every offer must add real extra time.": "Aucun extra pour l’instant. Sans eux, aucune offre n’est possible, car chaque offre doit ajouter du vrai temps en plus.",
  "Set up your request page": "Configurer votre page de demande",
  "Pick the closest salon type. You will see its usual services and upgrades, enter your own prices, and can change everything later.": "Choisissez le type de salon le plus proche. Vous verrez ses prestations et extras habituels, saisirez vos propres prix et pourrez tout modifier plus tard.",
  "Or add services one by one": "Ou ajoutez les prestations une par une",
  "Untick what you do not offer, adjust names and minutes, and enter your prices. Clients always pay exactly these prices.": "Décochez ce que vous ne proposez pas, ajustez les noms et les durées, puis saisissez vos prix. Vos clients paient toujours exactement ces prix.",
  "Offer": "Proposer",
  "Extra care added to an offer so that it lasts at least {pct}% longer.": "Un soin ajouté à une offre pour qu’elle dure au moins {pct} % de plus.",
  "Quiet hours": "Heures creuses",
  "When do you usually have a free chair? You can add more times later.": "Quand avez-vous habituellement une place libre ? Vous pourrez ajouter d’autres horaires plus tard.",
  "Days": "Jours",
  "From": "De",
  "Until": "À",
  "Create my request page": "Créer ma page de demande",
  "Text message": "SMS",
  "Details erased": "Données effacées",
  "Hi {name}, your appointment at {salon} is confirmed: {date} at {time}. {what} ({length}) for {price}, your usual price. Reference {ref}.": "Bonjour {name}, votre rendez-vous chez {salon} est confirmé : {date} à {time}. {what} ({length}) pour {price}, votre prix habituel. Référence {ref}.",
  "Hi {name}, this is {salon}. A place has opened up for {service}:": "Bonjour {name}, ici {salon}. Une place s’est libérée pour {service} :",
  "Waitlist": "Liste d’attente",
  "Waiting for you": "En attente de votre réponse",
  "standard price": "prix habituel",
  "Reference {ref}": "Référence {ref}",
  "Confirm": "Confirmer",
  "Decline": "Refuser",
  "Message for the client": "Message pour le client",
  "Copy message": "Copier le message",
  "Reference {ref}, received {date}": "Référence {ref}, reçue le {date}",
  "Mark as contacted": "Marquer comme contacté",
  "Visits to your page": "Visites de votre page",
  "Saw upgraded times": "Ont vu des créneaux enrichis",
  "Sent a request": "Ont envoyé une demande",
  "Last 30 days": "30 derniers jours",
  "{pct}% of the step before": "{pct} % de l’étape précédente",
  "Joined the waitlist: {n}. Times no upgraded slot was free: {m}.": "Inscriptions sur liste d’attente : {n}. Aucun créneau enrichi libre : {m} fois.",
  "Add the services clients book": "Ajoutez les prestations que vos clients réservent",
  "Pick your salon type and enter your prices": "Choisissez votre type de salon et saisissez vos prix",
  "Add upgrades that add extra time": "Ajoutez des extras qui allongent le rendez-vous",
  "Mark the hours that are usually quiet": "Indiquez vos heures habituellement creuses",
  "Share your link and put up the QR code": "Partagez votre lien et affichez le QR code",
  "Requests": "Demandes",
  "Your request page:": "Votre page de demande :",
  "Get your request page ready": "Préparez votre page de demande",
  "Results so far": "Résultats à ce jour",
  "Requests received": "Demandes reçues",
  "Discount given": "Remises accordées",
  "No requests waiting.": "Aucune demande en attente.",
  "Share your link where clients find you fully booked.": "Partagez votre lien là où vos clients voient que vous êtes complet.",
  "Finish the steps above, then share your link.": "Terminez les étapes ci-dessus, puis partagez votre lien.",
  "Coming up": "À venir",
  "Confirmed appointments from your request page appear here and in your calendar feed (see Settings).": "Les rendez-vous confirmés depuis votre page de demande apparaissent ici et dans votre flux de calendrier (voir Paramètres).",
  "Recently answered": "Traitées récemment",
  "When": "Quand",
  "Client names and contact details are erased {days} days after each appointment. The numbers above keep counting.": "Les noms et coordonnées des clients sont effacés {days} jours après chaque rendez-vous. Les chiffres ci-dessus continuent de compter.",
  "Your appointment at {salon}": "Votre rendez-vous chez {salon}",
  "Confirmed. The client’s page now shows it as confirmed.": "Confirmé. La page du client l’affiche désormais comme confirmé.",
  "Declined. The client’s page now offers them another time.": "Refusé. La page du client lui propose désormais un autre horaire.",
  "Marked as contacted.": "Marqué comme contacté.",
  "That time is already at capacity. Add free chairs in Quiet hours to confirm it, or decline it.": "Ce créneau est déjà complet. Ajoutez des places libres dans Heures creuses pour le confirmer, ou refusez-le.",
  "That request was already answered.": "Cette demande a déjà été traitée.",
  "Service added.": "Prestation ajoutée.",
  "Service saved.": "Prestation enregistrée.",
  "Service hidden from clients.": "Prestation masquée pour les clients.",
  "Service is visible to clients again.": "La prestation est de nouveau visible pour les clients.",
  "Upgrade added.": "Extra ajouté.",
  "Upgrade saved.": "Extra enregistré.",
  "Upgrade switched off.": "Extra désactivé.",
  "Upgrade switched on.": "Extra activé.",
  "Quiet hours added.": "Heures creuses ajoutées.",
  "Quiet hours removed.": "Heures creuses supprimées.",
  "Settings saved.": "Paramètres enregistrés.",
  "Password changed. Other devices have been logged out.": "Mot de passe modifié. Les autres appareils ont été déconnectés.",
  "Noted. You will hear from us when it opens.": "C’est noté. Nous vous préviendrons à l’ouverture.",
  "Your account is ready. A few short steps and your request page is live.": "Votre compte est prêt. Encore quelques étapes rapides et votre page de demande est en ligne.",
  "Your services, upgrades and quiet hours are set up. Your request page is live.": "Vos prestations, extras et heures creuses sont configurés. Votre page de demande est en ligne.",
  "New calendar address created. The old one no longer works.": "Nouvelle adresse de calendrier créée. L’ancienne ne fonctionne plus.",
  "Thank you! Your subscription becomes active as soon as the payment provider confirms it.": "Merci ! Votre abonnement sera actif dès que le prestataire de paiement l’aura confirmé.",
  "Welcome to the demo. Everything here is sample data you can change freely.": "Bienvenue dans la démonstration. Tout ici est fictif et vous pouvez le modifier librement.",
  "Declined": "Refusé",
  "Expired": "Expiré",
  "Contacted": "Contacté",
  "Request": "Demande",
  "Weekly view of your quiet hours": "Vue hebdomadaire de vos heures creuses",
  "The times you usually have free chairs. Offers are placed only inside these hours, and never more at once than the chairs you list.": "Les horaires où vous avez habituellement des places libres. Les offres ne sont placées que dans ces horaires, et jamais plus à la fois que le nombre de places indiqué.",
  "Add quiet hours": "Ajouter des heures creuses",
  "Your quiet hours": "Vos heures creuses",
  "Day": "Jour",
  "Hours": "Horaires",
  "Chairs": "Places",
  "Remove": "Supprimer",
  "No quiet hours yet. Start with the afternoons that are usually slow.": "Aucune heure creuse pour l’instant. Commencez par les après-midi habituellement calmes.",
  "{n} chair": "{n} place",
  "{n} chairs": "{n} places",
  "Start free beta": "Commencer la bêta gratuite",
  "Try the live demo": "Essayer la démo",
  "Turn “fully booked” into a booked client.": "Transformez « complet » en client réservé.",
  "When a client can’t get the time they wanted, {product} offers them a longer, upgraded appointment in your quiet hours, at your normal price. Your slow afternoons fill up and you never discount.": "Quand un client n’obtient pas l’horaire souhaité, {product} lui propose un rendez-vous plus long et enrichi pendant vos heures creuses, à votre prix normal. Vos après-midi calmes se remplissent, sans jamais brader vos prix.",
  "See how it works": "Voir comment ça marche",
  "Example: Saturday is fully booked when the client wanted 11:00. {product} offers Tuesday 13:30 instead: cut and finish plus deep conditioning, 60 minutes instead of 45, for the same {price}.": "Exemple : samedi est complet alors que la cliente voulait 11:00. {product} propose mardi 13:30 à la place : coupe et brushing plus soin profond, 60 minutes au lieu de 45, pour les mêmes {price}.",
  "Fully booked": "Complet",
  "Booked": "Réservé",
  "Wanted, but taken": "Souhaité, mais pris",
  "Free": "Libre",
  "same {price}": "même prix : {price}",
  "How it works": "Comment ça marche",
  "Share your link": "Partagez votre lien",
  "Put it where clients find you full: the “fully booked” message on your booking page, your Instagram bio, your auto-reply, a QR code at the desk.": "Là où vos clients vous trouvent complet : le message « complet » de votre page de réservation, votre bio Instagram, votre réponse automatique, un QR code à l’accueil.",
  "The client picks an upgrade": "Le client choisit un rendez-vous enrichi",
  "They choose the service they wanted and see up to three upgraded times in your quiet hours, in their own language. No account, no app.": "Il choisit la prestation souhaitée et voit jusqu’à trois créneaux enrichis pendant vos heures creuses, dans sa propre langue. Sans compte, sans appli.",
  "You confirm": "Vous confirmez",
  "You get an email, confirm with one tap, and send the ready-made message by WhatsApp, text or email. Confirmed appointments appear in your calendar.": "Vous recevez un e-mail, confirmez d’un geste et envoyez le message tout prêt par WhatsApp, SMS ou e-mail. Les rendez-vous confirmés apparaissent dans votre calendrier.",
  "Rules {product} never breaks": "Les règles que {product} ne transgresse jamais",
  "Same price, every time": "Toujours le même prix",
  "The client pays exactly your listed price. {product} cannot create a discount, and the database refuses one even if someone tries.": "Le client paie exactement votre prix affiché. {product} ne peut pas créer de remise, et la base de données la refuse même si quelqu’un essaie.",
  "Noticeably more care": "Nettement plus de soin",
  "Every offer adds at least 30% more time, using upgrades you choose: a scalp massage, a treatment, a longer finish.": "Chaque offre ajoute au moins 30 % de temps, avec des extras que vous choisissez : un massage du cuir chevelu, un soin, un coiffage plus long.",
  "Only in hours you choose": "Uniquement aux heures que vous choisissez",
  "Offers land only in the quiet hours you set, and never more at once than you have free chairs.": "Les offres ne tombent que dans les heures creuses que vous définissez, et jamais plus à la fois que vous n’avez de places libres.",
  "You stay in charge": "Vous gardez la main",
  "Nothing is booked until you confirm it. Client details are deleted {days} days after the appointment.": "Rien n’est réservé tant que vous ne l’avez pas confirmé. Les données des clients sont supprimées {days} jours après le rendez-vous.",
  "One account, three levels": "Un compte, trois niveaux",
  "Start with one location. The next levels switch on as your business grows.": "Commencez avec un établissement. Les niveaux suivants s’activent à mesure que votre activité grandit.",
  "Coming": "Bientôt",
  "{product} turns “fully booked” into an upgraded booking in your quiet hours, at your normal price. Never a discount.": "{product} transforme « complet » en réservation enrichie pendant vos heures creuses, à votre prix normal. Jamais de remise.",
  "Skip to content": "Aller au contenu",
  "Privacy": "Confidentialité",
  "Terms": "Conditions",
  "Dashboard": "Tableau de bord",
  "Start free": "Commencer gratuitement",
  "Requests by {product}": "Demandes via {product}",
  "Log out": "Se déconnecter",
  "Share": "Partager",
  "Plan": "Formule",
  "Settings": "Paramètres",
  "Please correct the highlighted field.": "Veuillez corriger le champ signalé.",
  "Please correct the {n} highlighted fields.": "Veuillez corriger les {n} champs signalés.",
  "Fully booked when you wanted to come in? Choose your service and we will offer you a calmer time with extra care included, at the same price.": "C’est complet à l’horaire souhaité ? Choisissez votre prestation et nous vous proposerons un moment plus calme, avec un soin en plus, au même prix.",
  "Prices are the salon’s standard prices. Upgraded appointments never cost more, or less.": "Les prix sont les prix habituels du salon. Un rendez-vous enrichi ne coûte jamais plus, ni moins.",
  "{salon} is not taking requests through this page yet.": "{salon} ne prend pas encore de demandes via cette page.",
  "Request an appointment": "Demander un rendez-vous",
  "{salon} uses this to confirm your appointment. Please include the country code with a phone number, for example +44.": "{salon} s’en sert pour confirmer votre rendez-vous. Pour un numéro de téléphone, indiquez l’indicatif du pays, par exemple +33.",
  "Leave this field empty": "Laissez ce champ vide",
  "Privacy notice": "Politique de confidentialité",
  "Pick your appointment": "Choisissez votre rendez-vous",
  "{service} with extra time added, at the usual price of {price}.": "{service} avec du temps en plus, au prix habituel de {price}.",
  "Available upgraded times": "Créneaux enrichis disponibles",
  "your usual price": "votre prix habituel",
  "Nothing is booked yet: {salon} confirms your request personally.": "Rien n’est encore réservé : {salon} confirme votre demande personnellement.",
  "Leave your details": "Laissez vos coordonnées",
  "No upgraded time is free right now": "Aucun créneau enrichi n’est libre pour le moment",
  "{salon} is not offering upgraded times online at the moment. Leave your details for {service} and they will get back to you.": "{salon} ne propose pas de créneaux enrichis en ligne pour le moment. Laissez vos coordonnées pour {service} et le salon reviendra vers vous.",
  "Leave your details for {service} and {salon} will get back to you when a place opens.": "Laissez vos coordonnées pour {service} et {salon} reviendra vers vous dès qu’une place se libère.",
  "When suits you?": "Quand cela vous arrange-t-il ?",
  "(optional)": "(facultatif)",
  "Join the waitlist": "M’inscrire sur la liste d’attente",
  "{salon} will confirm it personally. Keep this page: it shows the answer as soon as they reply.": "{salon} la confirmera personnellement. Gardez cette page : elle affiche la réponse dès qu’elle arrive.",
  "See you on {date} at {time}.": "Rendez-vous le {date} à {time}.",
  "{salon} could not confirm this time. You are welcome to choose another one.": "{salon} n’a pas pu confirmer cet horaire. N’hésitez pas à en choisir un autre.",
  "This request was not confirmed before its time passed.": "Cette demande n’a pas été confirmée à temps.",
  "{salon} has picked up your request.": "{salon} a pris en charge votre demande.",
  "This waitlist request has expired.": "Cette inscription sur liste d’attente a expiré.",
  "This waitlist request was closed.": "Cette inscription sur liste d’attente a été clôturée.",
  "Included": "Inclus",
  "the standard price": "le prix habituel",
  "the operator of {product}": "l’exploitant de {product}",
  "What happens to your details when you use {product}.": "Ce que deviennent vos données lorsque vous utilisez {product}.",
  "If you send a request to a salon": "Si vous envoyez une demande à un salon",
  "The salon you write to decides what happens with your request; {product} only processes it on the salon’s behalf. We store your name, the phone number or email you give, the service and time you chose, the language you used, and the moment you agreed to be contacted.": "Le salon auquel vous écrivez décide de la suite donnée à votre demande ; {product} ne la traite que pour le compte du salon. Nous conservons votre nom, le numéro de téléphone ou l’e-mail indiqué, la prestation et l’horaire choisis, la langue utilisée et le moment où vous avez accepté d’être contacté.",
  "Your details are used only to answer that request, including emails about it if you gave an email address. They are deleted {days} days after the appointment date (or {days} days after a waitlist request). What remains is anonymous: the service, the time and the price, for the salon’s statistics.": "Vos données servent uniquement à répondre à cette demande, y compris par e-mail si vous avez indiqué une adresse e-mail. Elles sont supprimées {days} jours après la date du rendez-vous (ou {days} jours après une inscription sur liste d’attente). Ce qui reste est anonyme : la prestation, l’horaire et le prix, pour les statistiques du salon.",
  "Pages for clients set no cookies and load nothing from other websites. Visits are counted per day without any personal data. There is no tracking and no advertising.": "Les pages destinées aux clients ne déposent aucun cookie et ne chargent rien depuis d’autres sites. Les visites sont comptées par jour, sans aucune donnée personnelle. Il n’y a ni pistage ni publicité.",
  "If you run a salon account": "Si vous gérez un compte salon",
  "We store your email, a protected form of your password (never the password itself), your salon’s settings and the requests you receive. One cookie keeps you logged in. Email is sent through the provider this installation is configured with. Payments, if switched on, are handled entirely by the payment provider; this site never sees card details. You can delete your account and all of its data at any time from Settings.": "Nous conservons votre e-mail, une forme protégée de votre mot de passe (jamais le mot de passe lui-même), les paramètres de votre salon et les demandes que vous recevez. Un cookie vous garde connecté. Les e-mails sont envoyés par le prestataire configuré pour cette installation. Les paiements, s’ils sont activés, sont entièrement gérés par le prestataire de paiement ; ce site ne voit jamais les données de carte. Vous pouvez supprimer votre compte et toutes ses données à tout moment depuis les paramètres.",
  "Your rights": "Vos droits",
  "You can ask for a copy of your details, for corrections, or for deletion. For a request you sent to a salon, contact that salon directly; for anything else, contact {operator}.": "Vous pouvez demander une copie de vos données, leur rectification ou leur suppression. Pour une demande envoyée à un salon, contactez directement ce salon ; pour tout le reste, contactez {operator}.",
  "Terms of use": "Conditions d’utilisation",
  "Legal notice": "Mentions légales",
  "What you get": "Ce que vous obtenez",
  "A free trial, then a monthly subscription you can cancel at any time. Prices are shown before you subscribe. Payments and invoices are handled by our payment provider.": "Un essai gratuit, puis un abonnement mensuel résiliable à tout moment. Les prix sont affichés avant la souscription. Les paiements et factures sont gérés par notre prestataire de paiement.",
  "Free use of the Reflow level while the beta runs. Features may change. If paid plans are introduced, you will be told in advance and nothing will be charged without your explicit agreement.": "Utilisation gratuite du niveau Reflow pendant toute la durée de la bêta. Les fonctionnalités peuvent évoluer. Si des formules payantes sont introduites, vous en serez informé à l’avance et rien ne sera facturé sans votre accord explicite.",
  "What we ask": "Ce que nous vous demandons",
  "Use your request page only for your own business and only for real appointments. You are responsible for honouring the appointments you confirm and for treating your clients’ details with care.": "Utilisez votre page de demande uniquement pour votre propre activité et pour de vrais rendez-vous. Vous êtes responsable du respect des rendez-vous que vous confirmez et du soin apporté aux données de vos clients.",
  "No warranty": "Absence de garantie",
  "The service is provided as is. Keep your own booking system as the record of your appointments.": "Le service est fourni en l’état. Conservez votre propre système de réservation comme référence pour vos rendez-vous.",
  "Ending": "Résiliation",
  "You can delete your account at any time from Settings; your data is deleted with it.": "Vous pouvez supprimer votre compte à tout moment depuis les paramètres ; vos données sont supprimées avec lui.",
  "Go to the home page": "Aller à l’accueil",
  "Handled": "Pris en charge",
  "Closed": "Clôturé",
  "That did not work": "Cela n’a pas fonctionné",
  "Not allowed": "Non autorisé",
  "Page not found": "Page introuvable",
  "Already changed": "Déjà modifié",
  "Too large": "Trop volumineux",
  "Form not readable": "Formulaire illisible",
  "Too many attempts": "Trop de tentatives",
  "Something went wrong": "Une erreur s’est produite",
  "{salon} may contact me about this request. My details are deleted {days} days after the appointment. {privacy}": "{salon} peut me contacter au sujet de cette demande. Mes données sont supprimées {days} jours après le rendez-vous. {privacy}",
  "You can ask for a copy of your details, for corrections, or for deletion. For a request you sent to a salon, contact that salon directly; for anything else, contact {operator} at {email}.": "Vous pouvez demander une copie de vos données, leur rectification ou leur suppression. Pour une demande envoyée à un salon, contactez directement ce salon ; pour tout le reste, contactez {operator} à l’adresse {email}.",
  "Logged in as {email}": "Connecté en tant que {email}",
  "Salon": "Salon",
  "Shown to clients on their confirmation.": "Affiché aux clients sur leur confirmation.",
  "Page address": "Adresse de la page",
  "Lowercase letters, numbers and dashes. Links you already shared stop working if you change it.": "Lettres minuscules, chiffres et tirets. Si vous la modifiez, les liens déjà partagés ne fonctionneront plus.",
  "Language of your request page": "Langue de votre page de demande",
  "Clients can switch to another language on the page.": "Les clients peuvent changer de langue sur la page.",
  "Minimum extra time (%)": "Temps supplémentaire minimum (%)",
  "At least {pct}%. Raise it if you want offers to feel even more generous.": "Au moins {pct} %. Augmentez-le si vous voulez des offres encore plus généreuses.",
  "Minimum notice": "Délai minimum",
  "How soon an offered time can start, so you have time to confirm.": "Délai minimum avant le début d’un créneau proposé, pour vous laisser le temps de confirmer.",
  "Save settings": "Enregistrer les paramètres",
  "You": "Votre compte",
  "Language of your dashboard and emails": "Langue de votre tableau de bord et de vos e-mails",
  "Email notifications": "Notifications par e-mail",
  "Email me when a client sends a request": "M’envoyer un e-mail quand un client envoie une demande",
  "Email sending is not set up on this installation yet, so no emails go out for now.": "L’envoi d’e-mails n’est pas encore configuré sur cette installation : aucun e-mail n’est envoyé pour l’instant.",
  "Save": "Enregistrer",
  "Calendar": "Calendrier",
  "Subscribe to this address in Google Calendar, Apple Calendar or Outlook, and every appointment you confirm appears there by itself. Keep the address private: it shows your clients’ names.": "Abonnez-vous à cette adresse dans Google Agenda, Apple Calendrier ou Outlook : chaque rendez-vous confirmé y apparaîtra automatiquement. Gardez cette adresse privée : elle affiche le nom de vos clients.",
  "Copy address": "Copier l’adresse",
  "Create a new address (the old one stops working)": "Créer une nouvelle adresse (l’ancienne cessera de fonctionner)",
  "Create calendar address": "Créer l’adresse du calendrier",
  "Export": "Exporter",
  "All requests as a spreadsheet file (CSV), for your records or another tool.": "Toutes les demandes dans un fichier tableur (CSV), pour vos archives ou un autre outil.",
  "Download requests (CSV)": "Télécharger les demandes (CSV)",
  "Current password": "Mot de passe actuel",
  "Change password": "Changer le mot de passe",
  "Audit log": "Journal d’audit",
  "Every offer, confirmation and price change is recorded in a tamper-evident log.": "Chaque offre, confirmation et modification de prix est consignée dans un journal infalsifiable.",
  "Check the audit log": "Vérifier le journal d’audit",
  "Delete account": "Supprimer le compte",
  "Deletes your salon, services, requests and client details permanently. This cannot be undone.": "Supprime définitivement votre salon, vos prestations, vos demandes et les données de vos clients. Cette action est irréversible.",
  "Your password": "Votre mot de passe",
  "Delete account and all data": "Supprimer le compte et toutes les données",
  "One account, three levels.": "Un compte, trois niveaux.",
  "Subscription": "Abonnement",
  "Subscribe: {price}": "S’abonner : {price}",
  "Subscribe": "S’abonner",
  "Manage subscription and invoices": "Gérer l’abonnement et les factures",
  "You are on Reflow, free during the beta.": "Vous utilisez Reflow, gratuit pendant la bêta.",
  "Your plan": "Votre formule",
  "On the list": "Inscrit",
  "We will tell you when it opens": "Nous vous préviendrons à l’ouverture",
  "Tell me when {plan} opens": "Me prévenir à l’ouverture de {plan}",
  "Page address {slug}, {timezone}, {currency}": "Adresse de la page {slug}, {timezone}, {currency}",
  "at least {pct}% extra time": "au moins {pct} % de temps en plus",
  "Service {id} shown to clients": "Prestation {id} affichée pour les clients",
  "Service {id} hidden from clients": "Prestation {id} masquée pour les clients",
  "was {price}": "auparavant {price}",
  "Upgrade {id} switched on": "Extra {id} activé",
  "Upgrade {id} switched off": "Extra {id} désactivé",
  "Each entry carries the fingerprint of the one before it, so a changed or deleted entry breaks the chain.": "Chaque entrée porte l’empreinte de la précédente : une entrée modifiée ou supprimée rompt la chaîne.",
  "Chain broken at entry {id}. An entry was changed or removed outside the app.": "Chaîne rompue à l’entrée {id}. Une entrée a été modifiée ou supprimée en dehors de l’application.",
  "Latest fingerprint:": "Dernière empreinte :",
  "Free trial until {date}.": "Essai gratuit jusqu’au {date}.",
  "Your subscription is active.": "Votre abonnement est actif.",
  "Your last payment did not go through. Please update your payment method to keep your request page running.": "Votre dernier paiement n’a pas abouti. Mettez à jour votre moyen de paiement pour que votre page de demande reste active.",
  "Your subscription is cancelled. Upgraded offers keep running until {date}.": "Votre abonnement est résilié. Les offres enrichies restent actives jusqu’au {date}.",
  "Your subscription is paused. Clients can join your waitlist, but see no upgraded times.": "Votre abonnement est en pause. Vos clients peuvent s’inscrire sur votre liste d’attente, mais ne voient aucun créneau enrichi.",
  "Your subscription is not active. Clients can join your waitlist, but see no upgraded times.": "Votre abonnement n’est pas actif. Vos clients peuvent s’inscrire sur votre liste d’attente, mais ne voient aucun créneau enrichi.",
  "Account created": "Compte créé",
  "Settings changed": "Paramètres modifiés",
  "Service added": "Prestation ajoutée",
  "Service changed": "Prestation modifiée",
  "Upgrade added": "Extra ajouté",
  "Upgrade changed": "Extra modifié",
  "Quiet hours added": "Heures creuses ajoutées",
  "Quiet hours removed": "Heures creuses supprimées",
  "Offer requested": "Offre demandée",
  "Waitlist request": "Inscription sur liste d’attente",
  "Request confirmed": "Demande confirmée",
  "Request declined": "Demande refusée",
  "Waitlist request handled": "Inscription sur liste d’attente traitée",
  "Subscription changed": "Abonnement modifié",
  "Free beta": "Bêta gratuite",
  "Free trial": "Essai gratuit",
  "{days}-day free trial": "Essai gratuit de {days} jours",
  "Monthly subscription": "Abonnement mensuel",
  "Active": "Actif",
  "Payment overdue": "Paiement en retard",
  "Cancelled": "Résilié",
  "Paused": "En pause",
  "Ended": "Terminé",
  "{n} service": "{n} prestation",
  "{n} services": "{n} prestations",
  "{n} upgrade": "{n} extra",
  "{n} upgrades": "{n} extras",
  "Chain intact: {n} entry checked, none changed.": "Chaîne intacte : {n} entrée vérifiée, aucune modifiée.",
  "Chain intact: {n} entries checked, none changed.": "Chaîne intacte : {n} entrées vérifiées, aucune modifiée.",
  "Booking page, “fully booked” message": "Page de réservation, message « complet »",
  "Fully booked at the time you wanted? Get a longer, upgraded appointment at the same price: {url}": "Complet à l’horaire souhaité ? Obtenez un rendez-vous plus long et enrichi, au même prix : {url}",
  "Instagram or Facebook bio": "Bio Instagram ou Facebook",
  "Fully booked? Upgraded appointments, same price: {url}": "Complet ? Rendez-vous enrichis, même prix : {url}",
  "Auto-reply for messages": "Réponse automatique aux messages",
  "Thanks for your message! If we’re fully booked when you’d like to come, {salon} can offer you a calmer time with extra care included, at the same price. Pick one here: {url}": "Merci pour votre message ! Si nous sommes complets au moment où vous souhaitez venir, {salon} peut vous proposer un moment plus calme avec un soin en plus, au même prix. Choisissez ici : {url}",
  "Fully booked? See upgraded times": "Complet ? Voir les créneaux enrichis",
  "Put your link wherever clients find you fully booked. Texts below are in the language of your request page: {language}.": "Placez votre lien partout où vos clients voient que vous êtes complet. Les textes ci-dessous sont dans la langue de votre page de demande : {language}.",
  "Your link": "Votre lien",
  "Copy link": "Copier le lien",
  "Open page": "Ouvrir la page",
  "Texts to copy": "Textes à copier",
  "Copy text": "Copier le texte",
  "QR code for the desk and the window": "QR code pour l’accueil et la vitrine",
  "QR code that opens your request page": "QR code qui ouvre votre page de demande",
  "Print the poster for your reception desk or window, or put the QR code on your price list.": "Imprimez l’affiche pour votre accueil ou votre vitrine, ou ajoutez le QR code à votre grille tarifaire.",
  "Open printable poster": "Ouvrir l’affiche à imprimer",
  "Download QR code": "Télécharger le QR code",
  "Button for your website": "Bouton pour votre site web",
  "Paste this code into your website where clients see that you are fully booked.": "Collez ce code sur votre site, là où vos clients voient que vous êtes complet.",
  "Copy code": "Copier le code",
  "Fully booked?": "Complet ?",
  "Scan for a longer, upgraded appointment in a calmer hour, at the same price.": "Scannez pour un rendez-vous plus long et enrichi, à une heure plus calme, au même prix.",
  "Print poster": "Imprimer l’affiche",
  "Back": "Retour",
  "Appointment canceled": "Rendez-vous annulé",
  "Join the salon team": "Rejoindre l’équipe du salon",
  "Verify your email": "Vérifier votre adresse e-mail",
  "This private link expires in 24 hours. If you did not request it, ignore this email.": "Ce lien privé expire dans 24 heures. Si vous ne l’avez pas demandé, ignorez cet e-mail.",
  "Appointment reminder": "Rappel de rendez-vous",
  "Handle future appointments before changing the time zone.": "Traitez les rendez-vous à venir avant de changer de fuseau horaire.",
  "Only the owner can change these settings.": "Seul le propriétaire peut modifier ces paramètres.",
  "End your paid subscription before deleting the account.": "Mettez fin à votre abonnement payant avant de supprimer le compte.",
  "Completed": "Terminé",
  "No-show": "Absent",
  "Canceled": "Annulé",
  "All": "Tous",
  "Appointments": "Rendez-vous",
  "Block time": "Bloquer un créneau",
  "Search": "Rechercher",
  "No appointments found.": "Aucun rendez-vous trouvé.",
  "Mark completed": "Marquer comme terminé",
  "Cancel this appointment?": "Annuler ce rendez-vous ?",
  "Cancel appointment": "Annuler le rendez-vous",
  "Previous": "Précédent",
  "Next": "Suivant",
  "Availability": "Disponibilités",
  "Block holidays, breaks and appointments from your other booking system.": "Bloquez les congés, pauses et rendez-vous de votre autre système de réservation.",
  "Close the whole day": "Fermer toute la journée",
  "No blocked times.": "Aucun créneau bloqué.",
  "This block overlaps a reservation. Handle the reservation first.": "Ce blocage chevauche une réservation. Traitez d’abord la réservation.",
  "Change appointment": "Modifier le rendez-vous",
  "Your current appointment stays reserved until you choose a new time. The salon must confirm the change.": "Votre rendez-vous actuel reste réservé jusqu’au choix d’un nouvel horaire. Le salon doit confirmer la modification.",
  "Cancellation notice (minutes)": "Délai d’annulation (minutes)",
  "Request hold (hours)": "Durée de maintien de la demande (heures)",
  "Please contact the salon to change this appointment.": "Veuillez contacter le salon pour modifier ce rendez-vous.",
  "Team": "Équipe",
  "Staff can manage appointments and blocked times. Billing, exports and business settings stay with the owner.": "Le personnel peut gérer les rendez-vous et les créneaux bloqués. La facturation, les exports et les paramètres du salon restent réservés au propriétaire.",
  "Invitation ready. Send this private link to your colleague.": "Invitation prête. Envoyez ce lien privé à votre collègue.",
  "Invitation link": "Lien d’invitation",
  "Invite a colleague": "Inviter un collègue",
  "Owner": "Propriétaire",
  "Staff": "Personnel",
  "Remove this colleague?": "Retirer ce collègue ?",
  "Pending invitations": "Invitations en attente",
  "Check your inbox and confirm your email before opening your dashboard.": "Consultez votre boîte de réception et confirmez votre adresse e-mail avant d’ouvrir le tableau de bord.",
  "Check your inbox.": "Consultez votre boîte de réception.",
  "Resend email": "Renvoyer l’e-mail",
  "My account": "Mon compte",
  "This action is not available in the demo.": "Cette action n’est pas disponible dans la démo.",
  "This email is already registered or the team is full.": "Cette adresse e-mail est déjà inscrite ou l’équipe est complète.",
  "Booked value": "Valeur réservée",
  "Booked value is not collected revenue. Mark completed services in Appointments.": "La valeur réservée ne correspond pas aux recettes encaissées. Marquez les prestations terminées dans Rendez-vous.",
  "Completed service value": "Valeur des prestations terminées",
  "Request hold: {hours} hours. Changes and cancellations close {minutes} minutes before the appointment.": "Maintien de la demande : {hours} heures. Les modifications et annulations ferment {minutes} minutes avant le rendez-vous.",
  "Booking policy": "Conditions de réservation",
  "Unanswered requests release their reserved time when the hold expires.": "Les demandes sans réponse libèrent leur créneau à l’expiration du délai de maintien."
};
return { default: __default };
})();

// src/i18n/es.js
const __m14 = (() => {
// Copyright (c) 2026 Miloš Petrović (Trench Logic Studio) · SPDX-License-Identifier: MIT
// Translations are checked for completeness and placeholder parity.
const __default = {
  "There is nothing at this address.": "No hay nada en esta dirección.",
  "That action is not available here.": "Esta acción no está disponible aquí.",
  "This form was sent from another website, so it was blocked. Open the page again and resend it.": "Este formulario se envió desde otra web, así que se ha bloqueado. Vuelve a abrir la página y envíalo de nuevo.",
  "12 Example Street": "Calle Ejemplo 12",
  "Any weekday after 17:00": "Entre semana, después de las 17:00",
  "This form could not be read. Please reload the page and try again.": "No se ha podido leer este formulario. Recarga la página y vuelve a intentarlo.",
  "That form is too large.": "Este formulario es demasiado grande.",
  "Send request": "Enviar solicitud",
  "{m} min": "{m} min",
  "{h} h {m} min": "{h} h {m} min",
  "{h} h": "{h} h",
  "{total} instead of {base}": "{total} en lugar de {base}",
  "Price: {price}, the standard price": "Precio: {price}, el precio habitual",
  "Reference: {ref}": "Referencia: {ref}",
  "New request: {when}": "Nueva solicitud: {when}",
  "A client asked for an upgraded appointment through your request page.": "Un cliente ha pedido una cita mejorada a través de tu página de solicitudes.",
  "Client: {contact}": "Cliente: {contact}",
  "Confirm or decline": "Confirmar o rechazar",
  "You receive these emails because notifications are on in Settings.": "Recibes estos correos porque tienes las notificaciones activadas en Ajustes.",
  "New waitlist request: {service}": "Nueva solicitud en lista de espera: {service}",
  "A client joined your waitlist.": "Un cliente se ha apuntado a tu lista de espera.",
  "Note: “{note}”": "Nota: «{note}»",
  "Open your dashboard": "Abrir tu panel",
  "You receive this email because you sent a request to {salon}. Your details are deleted {days} days after the appointment.": "Recibes este correo porque enviaste una solicitud a {salon}. Tus datos se eliminan {days} días después de la cita.",
  "Your request at {salon}": "Tu solicitud en {salon}",
  "Request sent": "Solicitud enviada",
  "{salon} has your request and will confirm it personally.": "{salon} ha recibido tu solicitud y la confirmará personalmente.",
  "See your request": "Ver tu solicitud",
  "You are on the waitlist at {salon}": "Estás en la lista de espera de {salon}",
  "You are on the waitlist": "Estás en la lista de espera",
  "{salon} will contact you when a place opens.": "{salon} se pondrá en contacto contigo cuando quede un hueco.",
  "Address: {address}": "Dirección: {address}",
  "Phone: {phone}": "Teléfono: {phone}",
  "Confirmed: {when} at {salon}": "Confirmada: {when} en {salon}",
  "Confirmed": "Confirmada",
  "{salon} has confirmed your appointment.": "{salon} ha confirmado tu cita.",
  "Add to calendar": "Añadir al calendario",
  "{salon} could not confirm your request": "{salon} no ha podido confirmar tu solicitud",
  "Not available": "No disponible",
  "{salon} could not confirm the time you chose. You are welcome to pick another one.": "{salon} no ha podido confirmar la hora que elegiste. Puedes elegir otra cuando quieras.",
  "Choose another time": "Elegir otra hora",
  "Reset your password": "Restablece tu contraseña",
  "Someone asked to reset the password for your account. If it was you, choose a new password with the link below. It works once, for {hours} hours.": "Alguien ha pedido restablecer la contraseña de tu cuenta. Si has sido tú, elige una contraseña nueva con el enlace de abajo. Funciona una sola vez, durante {hours} horas.",
  "If it was not you, ignore this email: nothing changes.": "Si no has sido tú, ignora este correo: no cambia nada.",
  "Choose a new password": "Elegir una contraseña nueva",
  "One location": "Un local",
  "When a client finds you fully booked, offer an upgraded appointment in a quieter hour, at exactly the same price.": "Cuando un cliente te encuentra completo, ofrécele una cita mejorada en una hora más tranquila, exactamente al mismo precio.",
  "Your own request page to share anywhere": "Tu propia página de solicitudes para compartir donde quieras",
  "Upgrades you define, at least +30% more time": "Extras que tú defines, al menos +30 % de tiempo",
  "Never a discount, enforced by the system": "Nunca un descuento, garantizado por el sistema",
  "You confirm every request yourself": "Tú confirmas cada solicitud",
  "Free during beta": "Gratis durante la beta",
  "Several locations": "Varios locales",
  "When one location is full, route the client to your location or sister brand that has room, at the same price.": "Cuando un local está completo, deriva al cliente al local o a la marca hermana que tenga hueco, al mismo precio.",
  "Everything in Reflow": "Todo lo de Reflow",
  "Overflow routed between your locations": "Exceso de demanda repartido entre tus locales",
  "One view across all locations": "Una sola vista de todos los locales",
  "Opens with the first multi-location salon": "Llegará con el primer salón con varios locales",
  "Partner network": "Red de socios",
  "Share overflow with trusted partner businesses. Priority is earned through reliability, never bought.": "Comparte el exceso de demanda con negocios de confianza. La prioridad se gana con fiabilidad, nunca se compra.",
  "Everything in Relay": "Todo lo de Relay",
  "Overflow shared with partner businesses": "Exceso de demanda compartido con negocios asociados",
  "Trust-based priority": "Prioridad basada en la confianza",
  "Later": "Más adelante",
  "This page does not exist.": "Esta página no existe.",
  "That user does not exist.": "Ese usuario no existe.",
  "Create your own account": "Crea tu propia cuenta",
  "See your plan": "Ver tu plan",
  "Enter a price such as 40 or 40.50.": "Introduce un precio como 40 o 40,50.",
  "You can have up to {n} services.": "Puedes tener hasta {n} servicios.",
  "Choose a service from the list.": "Elige un servicio de la lista.",
  "You can have up to {n} upgrades.": "Puedes tener hasta {n} extras.",
  "Choose at least one day.": "Elige al menos un día.",
  "Choose days from the list.": "Elige días de la lista.",
  "Enter a start time such as 13:00.": "Introduce una hora de inicio como 13:00.",
  "Enter an end time such as 16:00.": "Introduce una hora de fin como 16:00.",
  "Quiet hours must last at least 30 minutes.": "Las horas tranquilas deben durar al menos 30 minutos.",
  "Check the name, minutes and price of this service.": "Revisa el nombre, los minutos y el precio de este servicio.",
  "Check the name and minutes of this upgrade.": "Revisa el nombre y los minutos de este extra.",
  "Choose at least one service.": "Elige al menos un servicio.",
  "You can have up to {n} quiet-hour entries.": "Puedes tener hasta {n} franjas de horas tranquilas.",
  "Enter a phone number such as +44 20 7946 0000.": "Introduce un teléfono como +34 912 345 678.",
  "Use 2 to 40 lowercase letters, numbers or dashes, starting and ending with a letter or number.": "Usa de 2 a 40 letras minúsculas, números o guiones, empezando y terminando por una letra o un número.",
  "Choose your time zone.": "Elige tu zona horaria.",
  "That address is already taken. Try another one.": "Esa dirección ya está en uso. Prueba con otra.",
  "The demo account has no password to change.": "La cuenta de demostración no tiene contraseña que cambiar.",
  "That is not your current password.": "Esa no es tu contraseña actual.",
  "That is not your password.": "Esa no es tu contraseña.",
  "Reference": "Referencia",
  "Type": "Tipo",
  "Status": "Estado",
  "Service": "Servicio",
  "Upgrades": "Extras",
  "Date": "Fecha",
  "Start": "Inicio",
  "End": "Fin",
  "Minutes": "Minutos",
  "Price": "Precio",
  "Standard price": "Precio habitual",
  "Currency": "Moneda",
  "Client": "Cliente",
  "Contact": "Contacto",
  "Note": "Nota",
  "Language": "Idioma",
  "Received": "Recibida",
  "Answered": "Respondida",
  "This is a demo salon: it and its sample data are deleted within 24 hours. {signup} to keep a salon of your own.": "Este es un salón de demostración: se elimina junto con sus datos de ejemplo en 24 horas. {signup} para tener tu propio salón.",
  "Your request page shows only the waitlist until you subscribe. {plan}": "Tu página de solicitudes solo muestra la lista de espera hasta que te suscribas. {plan}",
  "Your free trial ends on {date}. {plan}": "Tu prueba gratuita termina el {date}. {plan}",
  "Name": "Nombre",
  "Length": "Duración",
  "Extra minutes": "Minutos extra",
  "Free chairs": "Plazas libres",
  "Salon name": "Nombre del salón",
  "Address": "Dirección",
  "Phone": "Teléfono",
  "Minimum extra time": "Tiempo extra mínimo",
  "New password": "Contraseña nueva",
  "Choose a valid currency.": "Elige una moneda válida.",
  "Choose a language from the list.": "Elige un idioma de la lista.",
  "Choose a notice period from the list.": "Elige una antelación de la lista.",
  "That request does not exist.": "Esa solicitud no existe.",
  "That action does not apply to this request.": "Esa acción no se aplica a esta solicitud.",
  "That service does not exist.": "Ese servicio no existe.",
  "Unknown action.": "Acción desconocida.",
  "That upgrade does not exist.": "Ese extra no existe.",
  "Unknown salon type.": "Tipo de salón desconocido.",
  "Unknown level.": "Nivel desconocido.",
  "Too many sign-ups from here in the last hour. Please try again later.": "Demasiados registros desde aquí en la última hora. Vuelve a intentarlo más tarde.",
  "Please accept the terms of use to continue.": "Acepta las condiciones de uso para continuar.",
  "Please accept the beta terms to continue.": "Acepta las condiciones de la beta para continuar.",
  "An account with this email already exists. Log in instead.": "Ya existe una cuenta con este correo. Inicia sesión.",
  "Too many attempts. Wait 15 minutes, then try again.": "Demasiados intentos. Espera 15 minutos y vuelve a intentarlo.",
  "Enter your email.": "Introduce tu correo.",
  "Enter your password.": "Introduce tu contraseña.",
  "Email or password is incorrect.": "El correo o la contraseña no son correctos.",
  "Password saved. Log in with your new password.": "Contraseña guardada. Inicia sesión con tu nueva contraseña.",
  "Your account and all of its data have been deleted.": "Tu cuenta y todos sus datos se han eliminado.",
  "Could not create the account. Please try again.": "No se ha podido crear la cuenta. Vuelve a intentarlo.",
  "Too many attempts. Please try again in an hour.": "Demasiados intentos. Vuelve a intentarlo dentro de una hora.",
  "Too many demos were started from here. Please try again in an hour.": "Se han iniciado demasiadas demos desde aquí. Vuelve a intentarlo dentro de una hora.",
  "The demo is very busy right now. Please try again in a few minutes.": "La demo está muy solicitada ahora mismo. Vuelve a intentarlo en unos minutos.",
  "Enter a phone number or an email address.": "Introduce un teléfono o un correo electrónico.",
  "Please agree, so the salon can contact you about this request.": "Da tu consentimiento para que el salón pueda contactarte sobre esta solicitud.",
  "Choose one of the times.": "Elige una de las horas.",
  "That time was just taken or has changed. Here is what is free now.": "Esa hora se acaba de ocupar o ha cambiado. Esto es lo que está libre ahora.",
  "Your name": "Tu nombre",
  "Phone or email": "Teléfono o correo",
  "Your note": "Tu nota",
  "There is no salon at this address. Check the link you were given.": "No hay ningún salón en esta dirección. Revisa el enlace que te dieron.",
  "Too many requests were sent from here. Please try again in an hour, or contact the salon directly.": "Se han enviado demasiadas solicitudes desde aquí. Vuelve a intentarlo dentro de una hora o contacta directamente con el salón.",
  "This request could not be sent. Please contact the salon directly.": "No se ha podido enviar esta solicitud. Contacta directamente con el salón.",
  "This request link is not valid.": "Este enlace de solicitud no es válido.",
  "This appointment is not confirmed yet.": "Esta cita aún no está confirmada.",
  "That item does not exist.": "Ese elemento no existe.",
  "Hair salon": "Peluquería",
  "Cut & finish": "Corte y peinado",
  "Blow-dry & style": "Secado y peinado",
  "Colour refresh": "Retoque de color",
  "Highlights": "Mechas",
  "Deep conditioning treatment": "Tratamiento de hidratación profunda",
  "Scalp massage": "Masaje capilar",
  "Gloss treatment": "Baño de brillo",
  "Extended styling": "Peinado más elaborado",
  "Barbershop": "Barbería",
  "Haircut": "Corte de pelo",
  "Beard trim": "Arreglo de barba",
  "Haircut & beard": "Corte y barba",
  "Hot towel shave": "Afeitado con toalla caliente",
  "Hot towel treatment": "Toalla caliente",
  "Beard oil treatment": "Tratamiento con aceite para barba",
  "Face mask": "Mascarilla facial",
  "Nail studio": "Estudio de uñas",
  "Gel manicure": "Manicura de gel",
  "Classic manicure": "Manicura clásica",
  "Pedicure": "Pedicura",
  "Gel pedicure": "Pedicura de gel",
  "Hand massage": "Masaje de manos",
  "Paraffin treatment": "Tratamiento de parafina",
  "Cuticle care": "Cuidado de cutículas",
  "Nail art accent": "Detalle de nail art",
  "Beauty & spa": "Estética y spa",
  "Classic facial": "Limpieza facial clásica",
  "Relaxing massage": "Masaje relajante",
  "Brow & lash tint": "Tinte de cejas y pestañas",
  "Waxing": "Depilación con cera",
  "Eye treatment": "Tratamiento de contorno de ojos",
  "Extended massage": "Masaje prolongado",
  "{label} is required.": "El campo «{label}» es obligatorio.",
  "{label} is too short.": "El campo «{label}» es demasiado corto.",
  "{label} must be at most {max} characters.": "El campo «{label}» no puede superar los {max} caracteres.",
  "{label} must be a whole number.": "El campo «{label}» debe ser un número entero.",
  "{label} must be between {min} and {max}.": "El campo «{label}» debe estar entre {min} y {max}.",
  "{label} must be a multiple of {step}.": "El campo «{label}» debe ser múltiplo de {step}.",
  "Email": "Correo electrónico",
  "Enter a valid email address.": "Introduce un correo electrónico válido.",
  "{label} must be at least 10 characters.": "El campo «{label}» debe tener al menos 10 caracteres.",
  "{label} is too long.": "El campo «{label}» es demasiado largo.",
  "Password": "Contraseña",
  "Choose a valid option.": "Elige una opción válida.",
  "Start your free trial": "Empieza tu prueba gratuita",
  "Start your free beta": "Empieza tu beta gratuita",
  "Set-up takes a few minutes: pick your salon type, enter your prices, and you have a page to share.": "La configuración lleva unos minutos: elige tu tipo de salón, introduce tus precios y tendrás una página para compartir.",
  "At least 10 characters.": "Al menos 10 caracteres.",
  "Time zone": "Zona horaria",
  "terms of use": "condiciones de uso",
  "beta terms": "condiciones de la beta",
  "privacy notice": "aviso de privacidad",
  "Create account": "Crear cuenta",
  "Already have an account?": "¿Ya tienes cuenta?",
  "Log in": "Iniciar sesión",
  "Forgot your password?": "¿Has olvidado tu contraseña?",
  "New here?": "¿Eres nuevo?",
  "Contact the operator of this service for a reset link.": "Contacta con el responsable de este servicio para recibir un enlace de restablecimiento.",
  "If an account exists for that address, a reset link is on its way. It works once, for {hours} hours.": "Si existe una cuenta con esa dirección, te llegará un enlace de restablecimiento. Funciona una sola vez, durante {hours} horas.",
  "Enter the email you signed up with. We will send you a link to choose a new password.": "Introduce el correo con el que te registraste. Te enviaremos un enlace para elegir una contraseña nueva.",
  "Send reset link": "Enviar enlace",
  "Back to log in": "Volver a iniciar sesión",
  "This link has expired": "Este enlace ha caducado",
  "Reset links work once and for {hours} hours. Ask for a new one.": "Los enlaces de restablecimiento funcionan una sola vez y durante {hours} horas. Pide uno nuevo.",
  "Ask for a new link": "Pedir un enlace nuevo",
  "For {email}. You will be logged out everywhere else.": "Para {email}. Se cerrará tu sesión en todos los demás dispositivos.",
  "Save new password": "Guardar contraseña nueva",
  "I accept the {terms} and the {privacy}.": "Acepto las {terms} y el {privacy}.",
  "Email us from the address you signed up with, and we will send you a reset link: {email}": "Escríbenos desde la dirección con la que te registraste y te enviaremos un enlace de restablecimiento: {email}",
  "Hidden from clients.": "Oculto para los clientes.",
  "Not offered yet: needs upgrades worth at least {n} extra minutes.": "Aún no se ofrece: necesita extras de al menos {n} minutos en total.",
  "Add upgrades": "Añadir extras",
  "Offered as {what}: {total} instead of {base}.": "Se ofrece como {what}: {total} en lugar de {base}.",
  "Length in minutes": "Duración en minutos",
  "Price ({currency})": "Precio ({currency})",
  "Services": "Servicios",
  "What clients can request. The price here is the price clients pay, always.": "Lo que tus clientes pueden pedir. El precio de aquí es siempre el que pagan tus clientes.",
  "Set up from a template": "Configurar con una plantilla",
  "Add a service": "Añadir un servicio",
  "Add service": "Añadir servicio",
  "Your services": "Tus servicios",
  "Edit": "Editar",
  "Save changes": "Guardar cambios",
  "Hide from clients": "Ocultar a los clientes",
  "Show to clients": "Mostrar a los clientes",
  "No services yet. Start from a template, or add the ones clients most often find fully booked.": "Aún no hay servicios. Empieza con una plantilla o añade aquellos para los que más a menudo estás completo.",
  "Can be added to": "Se puede añadir a",
  "All services": "Todos los servicios",
  "Extra care you can give when a chair is free: a scalp massage, a treatment, a longer finish. Each offer combines the fewest upgrades needed to add at least {pct}% more time.": "Cuidados extra que puedes dar cuando hay una plaza libre: un masaje capilar, un tratamiento, un peinado más largo. Cada oferta combina los menos extras posibles para añadir al menos un {pct} % más de tiempo.",
  "Add an upgrade": "Añadir un extra",
  "Add upgrade": "Añadir extra",
  "Your upgrades": "Tus extras",
  "Only with {service}": "Solo con {service}",
  "a removed service": "un servicio eliminado",
  "With any service": "Con cualquier servicio",
  "switched off": "desactivado",
  "Switch off": "Desactivar",
  "Switch on": "Activar",
  "No upgrades yet. Without them no offer can be made, because every offer must add real extra time.": "Aún no hay extras. Sin ellos no se puede hacer ninguna oferta, porque cada oferta debe añadir tiempo extra real.",
  "Set up your request page": "Configura tu página de solicitudes",
  "Pick the closest salon type. You will see its usual services and upgrades, enter your own prices, and can change everything later.": "Elige el tipo de salón que más se parezca al tuyo. Verás sus servicios y extras habituales, introducirás tus propios precios y podrás cambiarlo todo más adelante.",
  "Or add services one by one": "O añade los servicios uno a uno",
  "Untick what you do not offer, adjust names and minutes, and enter your prices. Clients always pay exactly these prices.": "Desmarca lo que no ofreces, ajusta nombres y minutos e introduce tus precios. Tus clientes pagan siempre exactamente estos precios.",
  "Offer": "Ofrecer",
  "Extra care added to an offer so that it lasts at least {pct}% longer.": "Cuidados extra que se añaden a una oferta para que dure al menos un {pct} % más.",
  "Quiet hours": "Horas tranquilas",
  "When do you usually have a free chair? You can add more times later.": "¿Cuándo sueles tener una plaza libre? Puedes añadir más horas después.",
  "Days": "Días",
  "From": "Desde",
  "Until": "Hasta",
  "Create my request page": "Crear mi página de solicitudes",
  "Text message": "SMS",
  "Details erased": "Datos eliminados",
  "Hi {name}, your appointment at {salon} is confirmed: {date} at {time}. {what} ({length}) for {price}, your usual price. Reference {ref}.": "Hola, {name}. Tu cita en {salon} está confirmada: {date} a las {time}. {what} ({length}) por {price}, tu precio habitual. Referencia {ref}.",
  "Hi {name}, this is {salon}. A place has opened up for {service}:": "Hola, {name}. Te escribimos de {salon}. Ha quedado un hueco para {service}:",
  "Waitlist": "Lista de espera",
  "Waiting for you": "Pendiente de ti",
  "standard price": "precio habitual",
  "Reference {ref}": "Referencia {ref}",
  "Confirm": "Confirmar",
  "Decline": "Rechazar",
  "Message for the client": "Mensaje para el cliente",
  "Copy message": "Copiar mensaje",
  "Reference {ref}, received {date}": "Referencia {ref}, recibida el {date}",
  "Mark as contacted": "Marcar como contactado",
  "Visits to your page": "Visitas a tu página",
  "Saw upgraded times": "Vieron horarios mejorados",
  "Sent a request": "Enviaron una solicitud",
  "Last 30 days": "Últimos 30 días",
  "{pct}% of the step before": "{pct} % del paso anterior",
  "Joined the waitlist: {n}. Times no upgraded slot was free: {m}.": "Se apuntaron a la lista de espera: {n}. Veces sin ningún horario mejorado libre: {m}.",
  "Add the services clients book": "Añade los servicios que reservan tus clientes",
  "Pick your salon type and enter your prices": "Elige tu tipo de salón e introduce tus precios",
  "Add upgrades that add extra time": "Añade extras que alarguen la cita",
  "Mark the hours that are usually quiet": "Marca las horas que suelen estar tranquilas",
  "Share your link and put up the QR code": "Comparte tu enlace y pon el código QR a la vista",
  "Requests": "Solicitudes",
  "Your request page:": "Tu página de solicitudes:",
  "Get your request page ready": "Prepara tu página de solicitudes",
  "Results so far": "Resultados hasta ahora",
  "Requests received": "Solicitudes recibidas",
  "Discount given": "Descuentos aplicados",
  "No requests waiting.": "No hay solicitudes pendientes.",
  "Share your link where clients find you fully booked.": "Comparte tu enlace donde tus clientes ven que estás completo.",
  "Finish the steps above, then share your link.": "Completa los pasos de arriba y luego comparte tu enlace.",
  "Coming up": "Próximas citas",
  "Confirmed appointments from your request page appear here and in your calendar feed (see Settings).": "Las citas confirmadas desde tu página de solicitudes aparecen aquí y en tu calendario suscrito (ver Ajustes).",
  "Recently answered": "Respondidas recientemente",
  "When": "Cuándo",
  "Client names and contact details are erased {days} days after each appointment. The numbers above keep counting.": "Los nombres y datos de contacto de los clientes se eliminan {days} días después de cada cita. Las cifras de arriba siguen contando.",
  "Your appointment at {salon}": "Tu cita en {salon}",
  "Confirmed. The client’s page now shows it as confirmed.": "Confirmada. La página del cliente ya la muestra como confirmada.",
  "Declined. The client’s page now offers them another time.": "Rechazada. La página del cliente ahora le ofrece otra hora.",
  "Marked as contacted.": "Marcada como contactada.",
  "That time is already at capacity. Add free chairs in Quiet hours to confirm it, or decline it.": "Esa hora ya está completa. Añade plazas libres en Horas tranquilas para confirmarla, o recházala.",
  "That request was already answered.": "Esa solicitud ya se había respondido.",
  "Service added.": "Servicio añadido.",
  "Service saved.": "Servicio guardado.",
  "Service hidden from clients.": "Servicio oculto para los clientes.",
  "Service is visible to clients again.": "El servicio vuelve a estar visible para los clientes.",
  "Upgrade added.": "Extra añadido.",
  "Upgrade saved.": "Extra guardado.",
  "Upgrade switched off.": "Extra desactivado.",
  "Upgrade switched on.": "Extra activado.",
  "Quiet hours added.": "Horas tranquilas añadidas.",
  "Quiet hours removed.": "Horas tranquilas eliminadas.",
  "Settings saved.": "Ajustes guardados.",
  "Password changed. Other devices have been logged out.": "Contraseña cambiada. Se ha cerrado la sesión en los demás dispositivos.",
  "Noted. You will hear from us when it opens.": "Anotado. Te avisaremos cuando esté disponible.",
  "Your account is ready. A few short steps and your request page is live.": "Tu cuenta está lista. Unos pocos pasos y tu página de solicitudes estará en marcha.",
  "Your services, upgrades and quiet hours are set up. Your request page is live.": "Tus servicios, extras y horas tranquilas están configurados. Tu página de solicitudes ya está en marcha.",
  "New calendar address created. The old one no longer works.": "Nueva dirección de calendario creada. La anterior ya no funciona.",
  "Thank you! Your subscription becomes active as soon as the payment provider confirms it.": "¡Gracias! Tu suscripción se activará en cuanto el proveedor de pagos la confirme.",
  "Welcome to the demo. Everything here is sample data you can change freely.": "Te damos la bienvenida a la demo. Todo lo que ves son datos de ejemplo que puedes cambiar libremente.",
  "Declined": "Rechazada",
  "Expired": "Caducada",
  "Contacted": "Contactada",
  "Request": "Solicitud",
  "Weekly view of your quiet hours": "Vista semanal de tus horas tranquilas",
  "The times you usually have free chairs. Offers are placed only inside these hours, and never more at once than the chairs you list.": "Las horas en las que sueles tener plazas libres. Las ofertas solo se colocan dentro de estas horas y nunca más a la vez que las plazas que indiques.",
  "Add quiet hours": "Añadir horas tranquilas",
  "Your quiet hours": "Tus horas tranquilas",
  "Day": "Día",
  "Hours": "Horario",
  "Chairs": "Plazas",
  "Remove": "Eliminar",
  "No quiet hours yet. Start with the afternoons that are usually slow.": "Aún no hay horas tranquilas. Empieza por las tardes que suelen estar flojas.",
  "{n} chair": "{n} plaza",
  "{n} chairs": "{n} plazas",
  "Start free beta": "Empieza la beta gratis",
  "Try the live demo": "Prueba la demo en vivo",
  "Turn “fully booked” into a booked client.": "Convierte el «completo» en un cliente con cita.",
  "When a client can’t get the time they wanted, {product} offers them a longer, upgraded appointment in your quiet hours, at your normal price. Your slow afternoons fill up and you never discount.": "Cuando un cliente no consigue la hora que quería, {product} le ofrece una cita más larga y mejorada en tus horas tranquilas, a tu precio normal. Tus tardes flojas se llenan y nunca haces descuentos.",
  "See how it works": "Mira cómo funciona",
  "Example: Saturday is fully booked when the client wanted 11:00. {product} offers Tuesday 13:30 instead: cut and finish plus deep conditioning, 60 minutes instead of 45, for the same {price}.": "Ejemplo: el sábado está completo y la clienta quería venir a las 11:00. {product} le ofrece el martes a las 13:30: corte y peinado con tratamiento de hidratación profunda, 60 minutos en lugar de 45, por los mismos {price}.",
  "Fully booked": "Completo",
  "Booked": "Reservado",
  "Wanted, but taken": "Deseado, pero ocupado",
  "Free": "Libre",
  "same {price}": "mismo precio: {price}",
  "How it works": "Cómo funciona",
  "Share your link": "Comparte tu enlace",
  "Put it where clients find you full: the “fully booked” message on your booking page, your Instagram bio, your auto-reply, a QR code at the desk.": "Ponlo donde tus clientes ven que estás completo: el mensaje de «completo» de tu página de reservas, tu bio de Instagram, tu respuesta automática, un código QR en el mostrador.",
  "The client picks an upgrade": "El cliente elige una cita mejorada",
  "They choose the service they wanted and see up to three upgraded times in your quiet hours, in their own language. No account, no app.": "Elige el servicio que quería y ve hasta tres horarios mejorados en tus horas tranquilas, en su propio idioma. Sin cuenta y sin app.",
  "You confirm": "Tú confirmas",
  "You get an email, confirm with one tap, and send the ready-made message by WhatsApp, text or email. Confirmed appointments appear in your calendar.": "Recibes un correo, confirmas con un toque y envías el mensaje ya preparado por WhatsApp, SMS o correo. Las citas confirmadas aparecen en tu calendario.",
  "Rules {product} never breaks": "Reglas que {product} nunca rompe",
  "Same price, every time": "Siempre el mismo precio",
  "The client pays exactly your listed price. {product} cannot create a discount, and the database refuses one even if someone tries.": "El cliente paga exactamente tu precio de tarifa. {product} no puede crear descuentos, y la base de datos los rechaza aunque alguien lo intente.",
  "Noticeably more care": "Notablemente más cuidado",
  "Every offer adds at least 30% more time, using upgrades you choose: a scalp massage, a treatment, a longer finish.": "Cada oferta añade al menos un 30 % más de tiempo, con extras que tú eliges: un masaje capilar, un tratamiento, un peinado más largo.",
  "Only in hours you choose": "Solo en las horas que elijas",
  "Offers land only in the quiet hours you set, and never more at once than you have free chairs.": "Las ofertas solo caen en las horas tranquilas que tú marques, y nunca más a la vez que las plazas libres que tengas.",
  "You stay in charge": "Tú tienes el control",
  "Nothing is booked until you confirm it. Client details are deleted {days} days after the appointment.": "No se reserva nada hasta que lo confirmas. Los datos de los clientes se eliminan {days} días después de la cita.",
  "One account, three levels": "Una cuenta, tres niveles",
  "Start with one location. The next levels switch on as your business grows.": "Empieza con un local. Los siguientes niveles se activan a medida que crece tu negocio.",
  "Coming": "Próximamente",
  "{product} turns “fully booked” into an upgraded booking in your quiet hours, at your normal price. Never a discount.": "{product} convierte el «completo» en una reserva mejorada en tus horas tranquilas, a tu precio normal. Nunca con descuento.",
  "Skip to content": "Saltar al contenido",
  "Privacy": "Privacidad",
  "Terms": "Condiciones",
  "Dashboard": "Panel",
  "Start free": "Empieza gratis",
  "Requests by {product}": "Solicitudes con {product}",
  "Log out": "Cerrar sesión",
  "Share": "Compartir",
  "Plan": "Plan",
  "Settings": "Ajustes",
  "Please correct the highlighted field.": "Corrige el campo marcado.",
  "Please correct the {n} highlighted fields.": "Corrige los {n} campos marcados.",
  "Fully booked when you wanted to come in? Choose your service and we will offer you a calmer time with extra care included, at the same price.": "¿Completo a la hora que querías? Elige tu servicio y te ofreceremos un momento más tranquilo con cuidados extra incluidos, al mismo precio.",
  "Prices are the salon’s standard prices. Upgraded appointments never cost more, or less.": "Los precios son los precios habituales del salón. Las citas mejoradas nunca cuestan más, ni menos.",
  "{salon} is not taking requests through this page yet.": "{salon} todavía no acepta solicitudes a través de esta página.",
  "Request an appointment": "Pedir una cita",
  "{salon} uses this to confirm your appointment. Please include the country code with a phone number, for example +44.": "{salon} lo usa para confirmar tu cita. Si das un teléfono, incluye el prefijo del país, por ejemplo +34.",
  "Leave this field empty": "Deja este campo vacío",
  "Privacy notice": "Aviso de privacidad",
  "Pick your appointment": "Elige tu cita",
  "{service} with extra time added, at the usual price of {price}.": "{service} con tiempo extra añadido, al precio habitual de {price}.",
  "Available upgraded times": "Horarios mejorados disponibles",
  "your usual price": "tu precio habitual",
  "Nothing is booked yet: {salon} confirms your request personally.": "Aún no hay nada reservado: {salon} confirma tu solicitud personalmente.",
  "Leave your details": "Deja tus datos",
  "No upgraded time is free right now": "Ahora mismo no hay ningún horario mejorado libre",
  "{salon} is not offering upgraded times online at the moment. Leave your details for {service} and they will get back to you.": "{salon} no ofrece horarios mejorados en línea en este momento. Deja tus datos para {service} y te responderán.",
  "Leave your details for {service} and {salon} will get back to you when a place opens.": "Deja tus datos para {service} y {salon} te avisará cuando quede un hueco.",
  "When suits you?": "¿Cuándo te viene bien?",
  "(optional)": "(opcional)",
  "Join the waitlist": "Apuntarme a la lista de espera",
  "{salon} will confirm it personally. Keep this page: it shows the answer as soon as they reply.": "{salon} la confirmará personalmente. Guarda esta página: mostrará la respuesta en cuanto contesten.",
  "See you on {date} at {time}.": "Te esperamos el {date} a las {time}.",
  "{salon} could not confirm this time. You are welcome to choose another one.": "{salon} no ha podido confirmar esta hora. Puedes elegir otra cuando quieras.",
  "This request was not confirmed before its time passed.": "Esta solicitud no se confirmó antes de su hora.",
  "{salon} has picked up your request.": "{salon} ha atendido tu solicitud.",
  "This waitlist request has expired.": "Esta solicitud de lista de espera ha caducado.",
  "This waitlist request was closed.": "Esta solicitud de lista de espera se ha cerrado.",
  "Included": "Incluido",
  "the standard price": "el precio habitual",
  "the operator of {product}": "el responsable de {product}",
  "What happens to your details when you use {product}.": "Qué pasa con tus datos cuando usas {product}.",
  "If you send a request to a salon": "Si envías una solicitud a un salón",
  "The salon you write to decides what happens with your request; {product} only processes it on the salon’s behalf. We store your name, the phone number or email you give, the service and time you chose, the language you used, and the moment you agreed to be contacted.": "El salón al que escribes decide qué pasa con tu solicitud; {product} solo la trata en nombre del salón. Guardamos tu nombre, el teléfono o correo que indiques, el servicio y la hora que elegiste, el idioma que usaste y el momento en que aceptaste que te contactaran.",
  "Your details are used only to answer that request, including emails about it if you gave an email address. They are deleted {days} days after the appointment date (or {days} days after a waitlist request). What remains is anonymous: the service, the time and the price, for the salon’s statistics.": "Tus datos solo se usan para responder a esa solicitud, incluidos los correos sobre ella si diste un correo electrónico. Se eliminan {days} días después de la fecha de la cita (o {days} días después de una solicitud de lista de espera). Lo que queda es anónimo: el servicio, la hora y el precio, para las estadísticas del salón.",
  "Pages for clients set no cookies and load nothing from other websites. Visits are counted per day without any personal data. There is no tracking and no advertising.": "Las páginas para clientes no usan cookies ni cargan nada de otras webs. Las visitas se cuentan por día sin ningún dato personal. No hay seguimiento ni publicidad.",
  "If you run a salon account": "Si gestionas una cuenta de salón",
  "We store your email, a protected form of your password (never the password itself), your salon’s settings and the requests you receive. One cookie keeps you logged in. Email is sent through the provider this installation is configured with. Payments, if switched on, are handled entirely by the payment provider; this site never sees card details. You can delete your account and all of its data at any time from Settings.": "Guardamos tu correo, una forma protegida de tu contraseña (nunca la contraseña en sí), los ajustes de tu salón y las solicitudes que recibes. Una cookie mantiene tu sesión iniciada. Los correos se envían a través del proveedor configurado en esta instalación. Los pagos, si están activados, los gestiona por completo el proveedor de pagos; este sitio nunca ve los datos de tarjeta. Puedes eliminar tu cuenta y todos sus datos en cualquier momento desde Ajustes.",
  "Your rights": "Tus derechos",
  "You can ask for a copy of your details, for corrections, or for deletion. For a request you sent to a salon, contact that salon directly; for anything else, contact {operator}.": "Puedes pedir una copia de tus datos, su corrección o su eliminación. Para una solicitud que enviaste a un salón, contacta directamente con ese salón; para todo lo demás, contacta con {operator}.",
  "Terms of use": "Condiciones de uso",
  "Legal notice": "Aviso legal",
  "What you get": "Qué obtienes",
  "A free trial, then a monthly subscription you can cancel at any time. Prices are shown before you subscribe. Payments and invoices are handled by our payment provider.": "Una prueba gratuita y después una suscripción mensual que puedes cancelar en cualquier momento. Los precios se muestran antes de suscribirte. Los pagos y las facturas los gestiona nuestro proveedor de pagos.",
  "Free use of the Reflow level while the beta runs. Features may change. If paid plans are introduced, you will be told in advance and nothing will be charged without your explicit agreement.": "Uso gratuito del nivel Reflow mientras dure la beta. Las funciones pueden cambiar. Si se introducen planes de pago, se te avisará con antelación y no se cobrará nada sin tu consentimiento expreso.",
  "What we ask": "Qué te pedimos",
  "Use your request page only for your own business and only for real appointments. You are responsible for honouring the appointments you confirm and for treating your clients’ details with care.": "Usa tu página de solicitudes solo para tu propio negocio y solo para citas reales. Eres responsable de cumplir las citas que confirmas y de tratar con cuidado los datos de tus clientes.",
  "No warranty": "Sin garantía",
  "The service is provided as is. Keep your own booking system as the record of your appointments.": "El servicio se ofrece tal cual. Mantén tu propio sistema de reservas como registro de tus citas.",
  "Ending": "Baja",
  "You can delete your account at any time from Settings; your data is deleted with it.": "Puedes eliminar tu cuenta en cualquier momento desde Ajustes; tus datos se eliminan con ella.",
  "Go to the home page": "Ir a la página de inicio",
  "Handled": "Atendida",
  "Closed": "Cerrada",
  "That did not work": "No ha funcionado",
  "Not allowed": "No permitido",
  "Page not found": "Página no encontrada",
  "Already changed": "Ya ha cambiado",
  "Too large": "Demasiado grande",
  "Form not readable": "Formulario ilegible",
  "Too many attempts": "Demasiados intentos",
  "Something went wrong": "Algo ha salido mal",
  "{salon} may contact me about this request. My details are deleted {days} days after the appointment. {privacy}": "{salon} puede contactarme sobre esta solicitud. Mis datos se eliminan {days} días después de la cita. {privacy}",
  "You can ask for a copy of your details, for corrections, or for deletion. For a request you sent to a salon, contact that salon directly; for anything else, contact {operator} at {email}.": "Puedes pedir una copia de tus datos, su corrección o su eliminación. Para una solicitud que enviaste a un salón, contacta directamente con ese salón; para todo lo demás, contacta con {operator} en {email}.",
  "Logged in as {email}": "Sesión iniciada como {email}",
  "Salon": "Salón",
  "Shown to clients on their confirmation.": "Se muestra a los clientes en su confirmación.",
  "Page address": "Dirección de la página",
  "Lowercase letters, numbers and dashes. Links you already shared stop working if you change it.": "Letras minúsculas, números y guiones. Si la cambias, los enlaces que ya compartiste dejarán de funcionar.",
  "Language of your request page": "Idioma de tu página de solicitudes",
  "Clients can switch to another language on the page.": "Los clientes pueden cambiar de idioma en la página.",
  "Minimum extra time (%)": "Tiempo extra mínimo (%)",
  "At least {pct}%. Raise it if you want offers to feel even more generous.": "Al menos un {pct} %. Súbelo si quieres que las ofertas resulten aún más generosas.",
  "Minimum notice": "Antelación mínima",
  "How soon an offered time can start, so you have time to confirm.": "Con cuánta antelación como mínimo puede empezar una hora ofrecida, para que tengas tiempo de confirmarla.",
  "Save settings": "Guardar ajustes",
  "You": "Tu cuenta",
  "Language of your dashboard and emails": "Idioma de tu panel y de tus correos",
  "Email notifications": "Notificaciones por correo",
  "Email me when a client sends a request": "Enviarme un correo cuando un cliente envíe una solicitud",
  "Email sending is not set up on this installation yet, so no emails go out for now.": "El envío de correos aún no está configurado en esta instalación, así que por ahora no se envía ninguno.",
  "Save": "Guardar",
  "Calendar": "Calendario",
  "Subscribe to this address in Google Calendar, Apple Calendar or Outlook, and every appointment you confirm appears there by itself. Keep the address private: it shows your clients’ names.": "Suscríbete a esta dirección en Google Calendar, Apple Calendar u Outlook y cada cita que confirmes aparecerá allí automáticamente. Mantén la dirección en privado: muestra los nombres de tus clientes.",
  "Copy address": "Copiar dirección",
  "Create a new address (the old one stops working)": "Crear una dirección nueva (la anterior dejará de funcionar)",
  "Create calendar address": "Crear dirección de calendario",
  "Export": "Exportar",
  "All requests as a spreadsheet file (CSV), for your records or another tool.": "Todas las solicitudes en un archivo de hoja de cálculo (CSV), para tus registros u otra herramienta.",
  "Download requests (CSV)": "Descargar solicitudes (CSV)",
  "Current password": "Contraseña actual",
  "Change password": "Cambiar contraseña",
  "Audit log": "Registro de auditoría",
  "Every offer, confirmation and price change is recorded in a tamper-evident log.": "Cada oferta, confirmación y cambio de precio queda anotado en un registro a prueba de manipulaciones.",
  "Check the audit log": "Revisar el registro de auditoría",
  "Delete account": "Eliminar cuenta",
  "Deletes your salon, services, requests and client details permanently. This cannot be undone.": "Elimina para siempre tu salón, servicios, solicitudes y datos de clientes. No se puede deshacer.",
  "Your password": "Tu contraseña",
  "Delete account and all data": "Eliminar la cuenta y todos los datos",
  "One account, three levels.": "Una cuenta, tres niveles.",
  "Subscription": "Suscripción",
  "Subscribe: {price}": "Suscribirme: {price}",
  "Subscribe": "Suscribirme",
  "Manage subscription and invoices": "Gestionar suscripción y facturas",
  "You are on Reflow, free during the beta.": "Estás en Reflow, gratis durante la beta.",
  "Your plan": "Tu plan",
  "On the list": "Apuntado",
  "We will tell you when it opens": "Te avisaremos cuando esté disponible",
  "Tell me when {plan} opens": "Avísame cuando {plan} esté disponible",
  "Page address {slug}, {timezone}, {currency}": "Dirección de la página {slug}, {timezone}, {currency}",
  "at least {pct}% extra time": "al menos un {pct} % de tiempo extra",
  "Service {id} shown to clients": "Servicio {id} visible para los clientes",
  "Service {id} hidden from clients": "Servicio {id} oculto para los clientes",
  "was {price}": "antes {price}",
  "Upgrade {id} switched on": "Extra {id} activado",
  "Upgrade {id} switched off": "Extra {id} desactivado",
  "Each entry carries the fingerprint of the one before it, so a changed or deleted entry breaks the chain.": "Cada entrada lleva la huella de la anterior, así que una entrada modificada o eliminada rompe la cadena.",
  "Chain broken at entry {id}. An entry was changed or removed outside the app.": "Cadena rota en la entrada {id}. Una entrada se modificó o eliminó fuera de la aplicación.",
  "Latest fingerprint:": "Última huella:",
  "Free trial until {date}.": "Prueba gratuita hasta el {date}.",
  "Your subscription is active.": "Tu suscripción está activa.",
  "Your last payment did not go through. Please update your payment method to keep your request page running.": "Tu último pago no se ha completado. Actualiza tu método de pago para que tu página de solicitudes siga funcionando.",
  "Your subscription is cancelled. Upgraded offers keep running until {date}.": "Tu suscripción está cancelada. Las ofertas mejoradas siguen activas hasta el {date}.",
  "Your subscription is paused. Clients can join your waitlist, but see no upgraded times.": "Tu suscripción está en pausa. Los clientes pueden apuntarse a tu lista de espera, pero no ven horarios mejorados.",
  "Your subscription is not active. Clients can join your waitlist, but see no upgraded times.": "Tu suscripción no está activa. Los clientes pueden apuntarse a tu lista de espera, pero no ven horarios mejorados.",
  "Account created": "Cuenta creada",
  "Settings changed": "Ajustes cambiados",
  "Service added": "Servicio añadido",
  "Service changed": "Servicio cambiado",
  "Upgrade added": "Extra añadido",
  "Upgrade changed": "Extra cambiado",
  "Quiet hours added": "Horas tranquilas añadidas",
  "Quiet hours removed": "Horas tranquilas eliminadas",
  "Offer requested": "Oferta solicitada",
  "Waitlist request": "Solicitud de lista de espera",
  "Request confirmed": "Solicitud confirmada",
  "Request declined": "Solicitud rechazada",
  "Waitlist request handled": "Solicitud de lista de espera atendida",
  "Subscription changed": "Suscripción cambiada",
  "Free beta": "Beta gratuita",
  "Free trial": "Prueba gratuita",
  "{days}-day free trial": "Prueba gratuita de {days} días",
  "Monthly subscription": "Suscripción mensual",
  "Active": "Activa",
  "Payment overdue": "Pago pendiente",
  "Cancelled": "Cancelada",
  "Paused": "En pausa",
  "Ended": "Finalizada",
  "{n} service": "{n} servicio",
  "{n} services": "{n} servicios",
  "{n} upgrade": "{n} extra",
  "{n} upgrades": "{n} extras",
  "Chain intact: {n} entry checked, none changed.": "Cadena intacta: {n} entrada comprobada, ninguna modificada.",
  "Chain intact: {n} entries checked, none changed.": "Cadena intacta: {n} entradas comprobadas, ninguna modificada.",
  "Booking page, “fully booked” message": "Página de reservas, mensaje de «completo»",
  "Fully booked at the time you wanted? Get a longer, upgraded appointment at the same price: {url}": "¿Completo a la hora que querías? Consigue una cita más larga y mejorada al mismo precio: {url}",
  "Instagram or Facebook bio": "Bio de Instagram o Facebook",
  "Fully booked? Upgraded appointments, same price: {url}": "¿Completo? Citas mejoradas, mismo precio: {url}",
  "Auto-reply for messages": "Respuesta automática a mensajes",
  "Thanks for your message! If we’re fully booked when you’d like to come, {salon} can offer you a calmer time with extra care included, at the same price. Pick one here: {url}": "¡Gracias por tu mensaje! Si estamos completos cuando quieres venir, {salon} puede ofrecerte un momento más tranquilo con cuidados extra incluidos, al mismo precio. Elige uno aquí: {url}",
  "Fully booked? See upgraded times": "¿Completo? Ver horarios mejorados",
  "Put your link wherever clients find you fully booked. Texts below are in the language of your request page: {language}.": "Pon tu enlace dondequiera que tus clientes vean que estás completo. Los textos de abajo están en el idioma de tu página de solicitudes: {language}.",
  "Your link": "Tu enlace",
  "Copy link": "Copiar enlace",
  "Open page": "Abrir página",
  "Texts to copy": "Textos para copiar",
  "Copy text": "Copiar texto",
  "QR code for the desk and the window": "Código QR para el mostrador y el escaparate",
  "QR code that opens your request page": "Código QR que abre tu página de solicitudes",
  "Print the poster for your reception desk or window, or put the QR code on your price list.": "Imprime el cartel para tu recepción o escaparate, o pon el código QR en tu lista de precios.",
  "Open printable poster": "Abrir cartel para imprimir",
  "Download QR code": "Descargar código QR",
  "Button for your website": "Botón para tu web",
  "Paste this code into your website where clients see that you are fully booked.": "Pega este código en tu web, donde tus clientes ven que estás completo.",
  "Copy code": "Copiar código",
  "Fully booked?": "¿Completo?",
  "Scan for a longer, upgraded appointment in a calmer hour, at the same price.": "Escanea para pedir una cita más larga y mejorada en una hora más tranquila, al mismo precio.",
  "Print poster": "Imprimir cartel",
  "Back": "Volver",
  "Appointment canceled": "Cita cancelada",
  "Join the salon team": "Unirse al equipo del salón",
  "Verify your email": "Verifica tu correo electrónico",
  "This private link expires in 24 hours. If you did not request it, ignore this email.": "Este enlace privado caduca en 24 horas. Si no lo solicitaste, ignora este correo.",
  "Appointment reminder": "Recordatorio de cita",
  "Handle future appointments before changing the time zone.": "Gestiona las próximas citas antes de cambiar la zona horaria.",
  "Only the owner can change these settings.": "Solo el propietario puede cambiar estos ajustes.",
  "End your paid subscription before deleting the account.": "Finaliza tu suscripción de pago antes de eliminar la cuenta.",
  "Completed": "Completada",
  "No-show": "No se presentó",
  "Canceled": "Cancelada",
  "All": "Todas",
  "Appointments": "Citas",
  "Block time": "Bloquear horario",
  "Search": "Buscar",
  "No appointments found.": "No se encontraron citas.",
  "Mark completed": "Marcar como completada",
  "Cancel this appointment?": "¿Cancelar esta cita?",
  "Cancel appointment": "Cancelar cita",
  "Previous": "Anterior",
  "Next": "Siguiente",
  "Availability": "Disponibilidad",
  "Block holidays, breaks and appointments from your other booking system.": "Bloquea vacaciones, descansos y citas de tu otro sistema de reservas.",
  "Close the whole day": "Cerrar todo el día",
  "No blocked times.": "No hay horarios bloqueados.",
  "This block overlaps a reservation. Handle the reservation first.": "Este bloqueo coincide con una reserva. Gestiona primero la reserva.",
  "Change appointment": "Cambiar cita",
  "Your current appointment stays reserved until you choose a new time. The salon must confirm the change.": "Tu cita actual sigue reservada hasta que elijas otro horario. El salón debe confirmar el cambio.",
  "Cancellation notice (minutes)": "Antelación para cancelar (minutos)",
  "Request hold (hours)": "Duración de la retención (horas)",
  "Please contact the salon to change this appointment.": "Contacta con el salón para cambiar esta cita.",
  "Team": "Equipo",
  "Staff can manage appointments and blocked times. Billing, exports and business settings stay with the owner.": "El personal puede gestionar citas y horarios bloqueados. La facturación, las exportaciones y los ajustes del negocio quedan a cargo del propietario.",
  "Invitation ready. Send this private link to your colleague.": "Invitación lista. Envía este enlace privado a tu colega.",
  "Invitation link": "Enlace de invitación",
  "Invite a colleague": "Invitar a un colega",
  "Owner": "Propietario",
  "Staff": "Personal",
  "Remove this colleague?": "¿Eliminar a este colega?",
  "Pending invitations": "Invitaciones pendientes",
  "Check your inbox and confirm your email before opening your dashboard.": "Revisa tu bandeja de entrada y confirma tu correo antes de abrir el panel.",
  "Check your inbox.": "Revisa tu bandeja de entrada.",
  "Resend email": "Reenviar correo",
  "My account": "Mi cuenta",
  "This action is not available in the demo.": "Esta acción no está disponible en la demo.",
  "This email is already registered or the team is full.": "Este correo ya está registrado o el equipo está completo.",
  "Booked value": "Valor reservado",
  "Booked value is not collected revenue. Mark completed services in Appointments.": "El valor reservado no equivale a ingresos cobrados. Marca los servicios completados en Citas.",
  "Completed service value": "Valor de servicios completados",
  "Request hold: {hours} hours. Changes and cancellations close {minutes} minutes before the appointment.": "Retención de la solicitud: {hours} horas. Los cambios y cancelaciones se cierran {minutes} minutos antes de la cita.",
  "Booking policy": "Política de reservas",
  "Unanswered requests release their reserved time when the hold expires.": "Las solicitudes sin respuesta liberan su horario cuando caduca la retención."
};
return { default: __default };
})();

// src/i18n/it.js
const __m15 = (() => {
// Copyright (c) 2026 Miloš Petrović (Trench Logic Studio) · SPDX-License-Identifier: MIT
// Translations are checked for completeness and placeholder parity.
const __default = {
  "There is nothing at this address.": "Non c’è niente a questo indirizzo.",
  "That action is not available here.": "Questa azione non è disponibile qui.",
  "This form was sent from another website, so it was blocked. Open the page again and resend it.": "Questo modulo è stato inviato da un altro sito ed è stato quindi bloccato. Riapri la pagina e invialo di nuovo.",
  "12 Example Street": "Via Esempio 12",
  "Any weekday after 17:00": "Nei giorni feriali dopo le 17:00",
  "This form could not be read. Please reload the page and try again.": "Non è stato possibile leggere questo modulo. Ricarica la pagina e riprova.",
  "That form is too large.": "Questo modulo è troppo grande.",
  "Send request": "Invia richiesta",
  "{m} min": "{m} min",
  "{h} h {m} min": "{h} h {m} min",
  "{h} h": "{h} h",
  "{total} instead of {base}": "{total} invece di {base}",
  "Price: {price}, the standard price": "Prezzo: {price}, il prezzo abituale",
  "Reference: {ref}": "Riferimento: {ref}",
  "New request: {when}": "Nuova richiesta: {when}",
  "A client asked for an upgraded appointment through your request page.": "Un cliente ha chiesto un appuntamento arricchito tramite la tua pagina delle richieste.",
  "Client: {contact}": "Cliente: {contact}",
  "Confirm or decline": "Conferma o rifiuta",
  "You receive these emails because notifications are on in Settings.": "Ricevi queste email perché le notifiche sono attive nelle Impostazioni.",
  "New waitlist request: {service}": "Nuova iscrizione alla lista d’attesa: {service}",
  "A client joined your waitlist.": "Un cliente si è iscritto alla tua lista d’attesa.",
  "Note: “{note}”": "Nota: «{note}»",
  "Open your dashboard": "Apri il pannello",
  "You receive this email because you sent a request to {salon}. Your details are deleted {days} days after the appointment.": "Ricevi questa email perché hai inviato una richiesta a {salon}. I tuoi dati vengono cancellati {days} giorni dopo l’appuntamento.",
  "Your request at {salon}": "La tua richiesta presso {salon}",
  "Request sent": "Richiesta inviata",
  "{salon} has your request and will confirm it personally.": "{salon} ha ricevuto la tua richiesta e la confermerà personalmente.",
  "See your request": "Vedi la tua richiesta",
  "You are on the waitlist at {salon}": "Sei in lista d’attesa presso {salon}",
  "You are on the waitlist": "Sei in lista d’attesa",
  "{salon} will contact you when a place opens.": "{salon} ti contatterà appena si libera un posto.",
  "Address: {address}": "Indirizzo: {address}",
  "Phone: {phone}": "Telefono: {phone}",
  "Confirmed: {when} at {salon}": "Confermato: {when} presso {salon}",
  "Confirmed": "Confermato",
  "{salon} has confirmed your appointment.": "{salon} ha confermato il tuo appuntamento.",
  "Add to calendar": "Aggiungi al calendario",
  "{salon} could not confirm your request": "{salon} non ha potuto confermare la tua richiesta",
  "Not available": "Non disponibile",
  "{salon} could not confirm the time you chose. You are welcome to pick another one.": "{salon} non ha potuto confermare l’orario scelto. Puoi sceglierne un altro quando vuoi.",
  "Choose another time": "Scegli un altro orario",
  "Reset your password": "Reimposta la password",
  "Someone asked to reset the password for your account. If it was you, choose a new password with the link below. It works once, for {hours} hours.": "Qualcuno ha chiesto di reimpostare la password del tuo account. Se sei stato tu, scegli una nuova password con il link qui sotto. Funziona una sola volta, per {hours} ore.",
  "If it was not you, ignore this email: nothing changes.": "Se non sei stato tu, ignora questa email: non cambia nulla.",
  "Choose a new password": "Scegli una nuova password",
  "One location": "Una sede",
  "When a client finds you fully booked, offer an upgraded appointment in a quieter hour, at exactly the same price.": "Quando un cliente ti trova al completo, offrigli un appuntamento arricchito in un orario più tranquillo, esattamente allo stesso prezzo.",
  "Your own request page to share anywhere": "La tua pagina delle richieste, da condividere ovunque",
  "Upgrades you define, at least +30% more time": "Extra definiti da te, almeno +30% di tempo",
  "Never a discount, enforced by the system": "Mai uno sconto, garantito dal sistema",
  "You confirm every request yourself": "Confermi tu ogni richiesta",
  "Free during beta": "Gratis durante la beta",
  "Several locations": "Più sedi",
  "When one location is full, route the client to your location or sister brand that has room, at the same price.": "Quando una sede è al completo, indirizza il cliente verso la tua sede o il marchio gemello che ha posto, allo stesso prezzo.",
  "Everything in Reflow": "Tutto ciò che offre Reflow",
  "Overflow routed between your locations": "Richieste in eccesso smistate tra le tue sedi",
  "One view across all locations": "Una vista unica su tutte le sedi",
  "Opens with the first multi-location salon": "Arriva con il primo salone con più sedi",
  "Partner network": "Rete di partner",
  "Share overflow with trusted partner businesses. Priority is earned through reliability, never bought.": "Condividi le richieste in eccesso con attività partner di fiducia. La priorità si guadagna con l’affidabilità, non si compra mai.",
  "Everything in Relay": "Tutto ciò che offre Relay",
  "Overflow shared with partner businesses": "Richieste in eccesso condivise con attività partner",
  "Trust-based priority": "Priorità basata sulla fiducia",
  "Later": "Più avanti",
  "This page does not exist.": "Questa pagina non esiste.",
  "That user does not exist.": "Questo utente non esiste.",
  "Create your own account": "Crea il tuo account",
  "See your plan": "Vedi il tuo piano",
  "Enter a price such as 40 or 40.50.": "Inserisci un prezzo come 40 o 40,50.",
  "You can have up to {n} services.": "Puoi avere fino a {n} servizi.",
  "Choose a service from the list.": "Scegli un servizio dall’elenco.",
  "You can have up to {n} upgrades.": "Puoi avere fino a {n} extra.",
  "Choose at least one day.": "Scegli almeno un giorno.",
  "Choose days from the list.": "Scegli i giorni dall’elenco.",
  "Enter a start time such as 13:00.": "Inserisci un orario di inizio come 13:00.",
  "Enter an end time such as 16:00.": "Inserisci un orario di fine come 16:00.",
  "Quiet hours must last at least 30 minutes.": "Gli orari tranquilli devono durare almeno 30 minuti.",
  "Check the name, minutes and price of this service.": "Controlla nome, minuti e prezzo di questo servizio.",
  "Check the name and minutes of this upgrade.": "Controlla nome e minuti di questo extra.",
  "Choose at least one service.": "Scegli almeno un servizio.",
  "You can have up to {n} quiet-hour entries.": "Puoi avere fino a {n} fasce di orari tranquilli.",
  "Enter a phone number such as +44 20 7946 0000.": "Inserisci un numero di telefono come +39 06 1234 5678.",
  "Use 2 to 40 lowercase letters, numbers or dashes, starting and ending with a letter or number.": "Usa da 2 a 40 lettere minuscole, numeri o trattini, iniziando e finendo con una lettera o un numero.",
  "Choose your time zone.": "Scegli il tuo fuso orario.",
  "That address is already taken. Try another one.": "Questo indirizzo è già in uso. Provane un altro.",
  "The demo account has no password to change.": "L’account demo non ha una password da cambiare.",
  "That is not your current password.": "Questa non è la tua password attuale.",
  "That is not your password.": "Questa non è la tua password.",
  "Reference": "Riferimento",
  "Type": "Tipo",
  "Status": "Stato",
  "Service": "Servizio",
  "Upgrades": "Extra",
  "Date": "Data",
  "Start": "Inizio",
  "End": "Fine",
  "Minutes": "Minuti",
  "Price": "Prezzo",
  "Standard price": "Prezzo abituale",
  "Currency": "Valuta",
  "Client": "Cliente",
  "Contact": "Contatto",
  "Note": "Nota",
  "Language": "Lingua",
  "Received": "Ricevuta",
  "Answered": "Gestita",
  "This is a demo salon: it and its sample data are deleted within 24 hours. {signup} to keep a salon of your own.": "Questo è un salone demo: verrà cancellato insieme ai dati di esempio entro 24 ore. {signup} per avere un salone tutto tuo.",
  "Your request page shows only the waitlist until you subscribe. {plan}": "La tua pagina delle richieste mostra solo la lista d’attesa finché non ti abboni. {plan}",
  "Your free trial ends on {date}. {plan}": "La tua prova gratuita termina il {date}. {plan}",
  "Name": "Nome",
  "Length": "Durata",
  "Extra minutes": "Minuti extra",
  "Free chairs": "Posti liberi",
  "Salon name": "Nome del salone",
  "Address": "Indirizzo",
  "Phone": "Telefono",
  "Minimum extra time": "Tempo extra minimo",
  "New password": "Nuova password",
  "Choose a valid currency.": "Scegli una valuta valida.",
  "Choose a language from the list.": "Scegli una lingua dall’elenco.",
  "Choose a notice period from the list.": "Scegli un preavviso dall’elenco.",
  "That request does not exist.": "Questa richiesta non esiste.",
  "That action does not apply to this request.": "Questa azione non si applica a questa richiesta.",
  "That service does not exist.": "Questo servizio non esiste.",
  "Unknown action.": "Azione sconosciuta.",
  "That upgrade does not exist.": "Questo extra non esiste.",
  "Unknown salon type.": "Tipo di salone sconosciuto.",
  "Unknown level.": "Livello sconosciuto.",
  "Too many sign-ups from here in the last hour. Please try again later.": "Troppe registrazioni da qui nell’ultima ora. Riprova più tardi.",
  "Please accept the terms of use to continue.": "Accetta i termini di utilizzo per continuare.",
  "Please accept the beta terms to continue.": "Accetta i termini della beta per continuare.",
  "An account with this email already exists. Log in instead.": "Esiste già un account con questa email. Accedi.",
  "Too many attempts. Wait 15 minutes, then try again.": "Troppi tentativi. Attendi 15 minuti e riprova.",
  "Enter your email.": "Inserisci la tua email.",
  "Enter your password.": "Inserisci la tua password.",
  "Email or password is incorrect.": "Email o password non corretta.",
  "Password saved. Log in with your new password.": "Password salvata. Accedi con la nuova password.",
  "Your account and all of its data have been deleted.": "Il tuo account e tutti i suoi dati sono stati cancellati.",
  "Could not create the account. Please try again.": "Impossibile creare l’account. Riprova.",
  "Too many attempts. Please try again in an hour.": "Troppi tentativi. Riprova tra un’ora.",
  "Too many demos were started from here. Please try again in an hour.": "Troppe demo avviate da qui. Riprova tra un’ora.",
  "The demo is very busy right now. Please try again in a few minutes.": "La demo è molto richiesta in questo momento. Riprova tra qualche minuto.",
  "Enter a phone number or an email address.": "Inserisci un numero di telefono o un indirizzo email.",
  "Please agree, so the salon can contact you about this request.": "Dai il tuo consenso, così il salone può contattarti per questa richiesta.",
  "Choose one of the times.": "Scegli uno degli orari.",
  "That time was just taken or has changed. Here is what is free now.": "Questo orario è appena stato preso o è cambiato. Ecco cosa è libero adesso.",
  "Your name": "Il tuo nome",
  "Phone or email": "Telefono o email",
  "Your note": "La tua nota",
  "There is no salon at this address. Check the link you were given.": "Non c’è nessun salone a questo indirizzo. Controlla il link che hai ricevuto.",
  "Too many requests were sent from here. Please try again in an hour, or contact the salon directly.": "Da qui sono state inviate troppe richieste. Riprova tra un’ora o contatta direttamente il salone.",
  "This request could not be sent. Please contact the salon directly.": "Non è stato possibile inviare questa richiesta. Contatta direttamente il salone.",
  "This request link is not valid.": "Questo link di richiesta non è valido.",
  "This appointment is not confirmed yet.": "Questo appuntamento non è ancora confermato.",
  "That item does not exist.": "Questo elemento non esiste.",
  "Hair salon": "Parrucchiere",
  "Cut & finish": "Taglio e piega",
  "Blow-dry & style": "Piega e styling",
  "Colour refresh": "Ravvivante colore",
  "Highlights": "Colpi di sole",
  "Deep conditioning treatment": "Trattamento ristrutturante",
  "Scalp massage": "Massaggio al cuoio capelluto",
  "Gloss treatment": "Trattamento gloss",
  "Extended styling": "Styling extra",
  "Barbershop": "Barbiere",
  "Haircut": "Taglio",
  "Beard trim": "Regolazione barba",
  "Haircut & beard": "Taglio e barba",
  "Hot towel shave": "Rasatura con panno caldo",
  "Hot towel treatment": "Panno caldo",
  "Beard oil treatment": "Trattamento olio da barba",
  "Face mask": "Maschera viso",
  "Nail studio": "Centro unghie",
  "Gel manicure": "Manicure gel",
  "Classic manicure": "Manicure classica",
  "Pedicure": "Pedicure",
  "Gel pedicure": "Pedicure gel",
  "Hand massage": "Massaggio mani",
  "Paraffin treatment": "Trattamento alla paraffina",
  "Cuticle care": "Cura delle cuticole",
  "Nail art accent": "Dettaglio nail art",
  "Beauty & spa": "Estetica e spa",
  "Classic facial": "Pulizia viso classica",
  "Relaxing massage": "Massaggio rilassante",
  "Brow & lash tint": "Tinta ciglia e sopracciglia",
  "Waxing": "Ceretta",
  "Eye treatment": "Trattamento contorno occhi",
  "Extended massage": "Massaggio prolungato",
  "{label} is required.": "Il campo «{label}» è obbligatorio.",
  "{label} is too short.": "Il campo «{label}» è troppo corto.",
  "{label} must be at most {max} characters.": "Il campo «{label}» può contenere al massimo {max} caratteri.",
  "{label} must be a whole number.": "Il campo «{label}» deve essere un numero intero.",
  "{label} must be between {min} and {max}.": "Il campo «{label}» deve essere compreso tra {min} e {max}.",
  "{label} must be a multiple of {step}.": "Il campo «{label}» deve essere un multiplo di {step}.",
  "Email": "Email",
  "Enter a valid email address.": "Inserisci un indirizzo email valido.",
  "{label} must be at least 10 characters.": "Il campo «{label}» deve contenere almeno 10 caratteri.",
  "{label} is too long.": "Il campo «{label}» è troppo lungo.",
  "Password": "Password",
  "Choose a valid option.": "Scegli un’opzione valida.",
  "Start your free trial": "Inizia la prova gratuita",
  "Start your free beta": "Inizia la beta gratuita",
  "Set-up takes a few minutes: pick your salon type, enter your prices, and you have a page to share.": "La configurazione richiede pochi minuti: scegli il tipo di salone, inserisci i tuoi prezzi e avrai una pagina da condividere.",
  "At least 10 characters.": "Almeno 10 caratteri.",
  "Time zone": "Fuso orario",
  "terms of use": "termini di utilizzo",
  "beta terms": "termini della beta",
  "privacy notice": "informativa sulla privacy",
  "Create account": "Crea account",
  "Already have an account?": "Hai già un account?",
  "Log in": "Accedi",
  "Forgot your password?": "Password dimenticata?",
  "New here?": "Sei nuovo?",
  "Contact the operator of this service for a reset link.": "Contatta il gestore di questo servizio per ricevere un link di reimpostazione.",
  "If an account exists for that address, a reset link is on its way. It works once, for {hours} hours.": "Se esiste un account per questo indirizzo, ti stiamo inviando un link di reimpostazione. Funziona una sola volta, per {hours} ore.",
  "Enter the email you signed up with. We will send you a link to choose a new password.": "Inserisci l’email con cui ti sei registrato. Ti invieremo un link per scegliere una nuova password.",
  "Send reset link": "Invia link",
  "Back to log in": "Torna all’accesso",
  "This link has expired": "Questo link è scaduto",
  "Reset links work once and for {hours} hours. Ask for a new one.": "I link di reimpostazione funzionano una sola volta e per {hours} ore. Richiedine uno nuovo.",
  "Ask for a new link": "Richiedi un nuovo link",
  "For {email}. You will be logged out everywhere else.": "Per {email}. Verrai disconnesso da tutti gli altri dispositivi.",
  "Save new password": "Salva la nuova password",
  "I accept the {terms} and the {privacy}.": "Accetto i {terms} e l’{privacy}.",
  "Email us from the address you signed up with, and we will send you a reset link: {email}": "Scrivici dall’indirizzo con cui ti sei registrato e ti invieremo un link di reimpostazione: {email}",
  "Hidden from clients.": "Nascosto ai clienti.",
  "Not offered yet: needs upgrades worth at least {n} extra minutes.": "Non ancora offerto: servono extra per almeno {n} minuti in più.",
  "Add upgrades": "Aggiungi extra",
  "Offered as {what}: {total} instead of {base}.": "Offerto come {what}: {total} invece di {base}.",
  "Length in minutes": "Durata in minuti",
  "Price ({currency})": "Prezzo ({currency})",
  "Services": "Servizi",
  "What clients can request. The price here is the price clients pay, always.": "Ciò che i clienti possono richiedere. Il prezzo indicato qui è sempre quello che pagano i clienti.",
  "Set up from a template": "Configura da un modello",
  "Add a service": "Aggiungi un servizio",
  "Add service": "Aggiungi servizio",
  "Your services": "I tuoi servizi",
  "Edit": "Modifica",
  "Save changes": "Salva modifiche",
  "Hide from clients": "Nascondi ai clienti",
  "Show to clients": "Mostra ai clienti",
  "No services yet. Start from a template, or add the ones clients most often find fully booked.": "Nessun servizio per ora. Parti da un modello o aggiungi quelli per cui sei più spesso al completo.",
  "Can be added to": "Si può aggiungere a",
  "All services": "Tutti i servizi",
  "Extra care you can give when a chair is free: a scalp massage, a treatment, a longer finish. Each offer combines the fewest upgrades needed to add at least {pct}% more time.": "Cure extra che puoi offrire quando c’è un posto libero: un massaggio al cuoio capelluto, un trattamento, una piega più lunga. Ogni offerta combina il minor numero di extra necessario per aggiungere almeno il {pct}% di tempo.",
  "Add an upgrade": "Aggiungi un extra",
  "Add upgrade": "Aggiungi extra",
  "Your upgrades": "I tuoi extra",
  "Only with {service}": "Solo con {service}",
  "a removed service": "un servizio rimosso",
  "With any service": "Con qualsiasi servizio",
  "switched off": "disattivato",
  "Switch off": "Disattiva",
  "Switch on": "Attiva",
  "No upgrades yet. Without them no offer can be made, because every offer must add real extra time.": "Nessun extra per ora. Senza extra non si può fare nessuna offerta, perché ogni offerta deve aggiungere tempo vero.",
  "Set up your request page": "Configura la tua pagina delle richieste",
  "Pick the closest salon type. You will see its usual services and upgrades, enter your own prices, and can change everything later.": "Scegli il tipo di salone più simile al tuo. Vedrai i servizi e gli extra tipici, inserirai i tuoi prezzi e potrai cambiare tutto in seguito.",
  "Or add services one by one": "Oppure aggiungi i servizi uno alla volta",
  "Untick what you do not offer, adjust names and minutes, and enter your prices. Clients always pay exactly these prices.": "Togli la spunta da ciò che non offri, adatta nomi e minuti e inserisci i tuoi prezzi. I clienti pagano sempre esattamente questi prezzi.",
  "Offer": "Offri",
  "Extra care added to an offer so that it lasts at least {pct}% longer.": "Cure extra aggiunte a un’offerta perché duri almeno il {pct}% in più.",
  "Quiet hours": "Orari tranquilli",
  "When do you usually have a free chair? You can add more times later.": "Quando hai di solito un posto libero? Potrai aggiungere altri orari in seguito.",
  "Days": "Giorni",
  "From": "Dalle",
  "Until": "Alle",
  "Create my request page": "Crea la mia pagina delle richieste",
  "Text message": "SMS",
  "Details erased": "Dati cancellati",
  "Hi {name}, your appointment at {salon} is confirmed: {date} at {time}. {what} ({length}) for {price}, your usual price. Reference {ref}.": "Ciao {name}, il tuo appuntamento presso {salon} è confermato: {date} alle {time}. {what} ({length}) a {price}, il tuo prezzo abituale. Riferimento {ref}.",
  "Hi {name}, this is {salon}. A place has opened up for {service}:": "Ciao {name}, ti scriviamo da {salon}. Si è liberato un posto per {service}:",
  "Waitlist": "Lista d’attesa",
  "Waiting for you": "Da gestire",
  "standard price": "prezzo abituale",
  "Reference {ref}": "Riferimento {ref}",
  "Confirm": "Conferma",
  "Decline": "Rifiuta",
  "Message for the client": "Messaggio per il cliente",
  "Copy message": "Copia messaggio",
  "Reference {ref}, received {date}": "Riferimento {ref}, ricevuta il {date}",
  "Mark as contacted": "Segna come contattato",
  "Visits to your page": "Visite alla tua pagina",
  "Saw upgraded times": "Hanno visto orari con extra",
  "Sent a request": "Hanno inviato una richiesta",
  "Last 30 days": "Ultimi 30 giorni",
  "{pct}% of the step before": "{pct}% del passaggio precedente",
  "Joined the waitlist: {n}. Times no upgraded slot was free: {m}.": "Iscritti alla lista d’attesa: {n}. Volte senza orari con extra liberi: {m}.",
  "Add the services clients book": "Aggiungi i servizi che i clienti prenotano",
  "Pick your salon type and enter your prices": "Scegli il tipo di salone e inserisci i tuoi prezzi",
  "Add upgrades that add extra time": "Aggiungi extra che allungano l’appuntamento",
  "Mark the hours that are usually quiet": "Segna gli orari di solito tranquilli",
  "Share your link and put up the QR code": "Condividi il tuo link ed esponi il codice QR",
  "Requests": "Richieste",
  "Your request page:": "La tua pagina delle richieste:",
  "Get your request page ready": "Prepara la tua pagina delle richieste",
  "Results so far": "Risultati finora",
  "Requests received": "Richieste ricevute",
  "Discount given": "Sconti concessi",
  "No requests waiting.": "Nessuna richiesta in attesa.",
  "Share your link where clients find you fully booked.": "Condividi il tuo link dove i clienti vedono che sei al completo.",
  "Finish the steps above, then share your link.": "Completa i passaggi qui sopra, poi condividi il tuo link.",
  "Coming up": "In arrivo",
  "Confirmed appointments from your request page appear here and in your calendar feed (see Settings).": "Gli appuntamenti confermati dalla tua pagina delle richieste compaiono qui e nel tuo calendario in abbonamento (vedi Impostazioni).",
  "Recently answered": "Gestite di recente",
  "When": "Quando",
  "Client names and contact details are erased {days} days after each appointment. The numbers above keep counting.": "Nomi e contatti dei clienti vengono cancellati {days} giorni dopo ogni appuntamento. I numeri qui sopra continuano a contare.",
  "Your appointment at {salon}": "Il tuo appuntamento presso {salon}",
  "Confirmed. The client’s page now shows it as confirmed.": "Confermato. La pagina del cliente ora lo mostra come confermato.",
  "Declined. The client’s page now offers them another time.": "Rifiutato. La pagina del cliente ora gli propone un altro orario.",
  "Marked as contacted.": "Segnato come contattato.",
  "That time is already at capacity. Add free chairs in Quiet hours to confirm it, or decline it.": "Questo orario è già al completo. Aggiungi posti liberi in Orari tranquilli per confermarlo, oppure rifiutalo.",
  "That request was already answered.": "A questa richiesta è già stata data una risposta.",
  "Service added.": "Servizio aggiunto.",
  "Service saved.": "Servizio salvato.",
  "Service hidden from clients.": "Servizio nascosto ai clienti.",
  "Service is visible to clients again.": "Il servizio è di nuovo visibile ai clienti.",
  "Upgrade added.": "Extra aggiunto.",
  "Upgrade saved.": "Extra salvato.",
  "Upgrade switched off.": "Extra disattivato.",
  "Upgrade switched on.": "Extra attivato.",
  "Quiet hours added.": "Orari tranquilli aggiunti.",
  "Quiet hours removed.": "Orari tranquilli rimossi.",
  "Settings saved.": "Impostazioni salvate.",
  "Password changed. Other devices have been logged out.": "Password cambiata. Gli altri dispositivi sono stati disconnessi.",
  "Noted. You will hear from us when it opens.": "Fatto. Ti avviseremo quando sarà disponibile.",
  "Your account is ready. A few short steps and your request page is live.": "Il tuo account è pronto. Pochi passaggi e la tua pagina delle richieste è online.",
  "Your services, upgrades and quiet hours are set up. Your request page is live.": "Servizi, extra e orari tranquilli sono configurati. La tua pagina delle richieste è online.",
  "New calendar address created. The old one no longer works.": "Nuovo indirizzo del calendario creato. Quello vecchio non funziona più.",
  "Thank you! Your subscription becomes active as soon as the payment provider confirms it.": "Grazie! Il tuo abbonamento si attiverà appena il fornitore dei pagamenti lo confermerà.",
  "Welcome to the demo. Everything here is sample data you can change freely.": "Benvenuto nella demo. Qui sono tutti dati di esempio che puoi modificare liberamente.",
  "Declined": "Rifiutato",
  "Expired": "Scaduto",
  "Contacted": "Contattato",
  "Request": "Richiesta",
  "Weekly view of your quiet hours": "Vista settimanale dei tuoi orari tranquilli",
  "The times you usually have free chairs. Offers are placed only inside these hours, and never more at once than the chairs you list.": "Gli orari in cui di solito hai posti liberi. Le offerte vengono collocate solo in questi orari e mai più di quanti posti indichi.",
  "Add quiet hours": "Aggiungi orari tranquilli",
  "Your quiet hours": "I tuoi orari tranquilli",
  "Day": "Giorno",
  "Hours": "Orario",
  "Chairs": "Posti",
  "Remove": "Rimuovi",
  "No quiet hours yet. Start with the afternoons that are usually slow.": "Nessun orario tranquillo per ora. Inizia dai pomeriggi di solito più calmi.",
  "{n} chair": "{n} posto",
  "{n} chairs": "{n} posti",
  "Start free beta": "Inizia la beta gratis",
  "Try the live demo": "Prova la demo live",
  "Turn “fully booked” into a booked client.": "Trasforma «al completo» in un cliente prenotato.",
  "When a client can’t get the time they wanted, {product} offers them a longer, upgraded appointment in your quiet hours, at your normal price. Your slow afternoons fill up and you never discount.": "Quando un cliente non trova l’orario che voleva, {product} gli offre un appuntamento più lungo e arricchito nei tuoi orari tranquilli, al tuo prezzo normale. I pomeriggi lenti si riempiono e non fai mai sconti.",
  "See how it works": "Scopri come funziona",
  "Example: Saturday is fully booked when the client wanted 11:00. {product} offers Tuesday 13:30 instead: cut and finish plus deep conditioning, 60 minutes instead of 45, for the same {price}.": "Esempio: sabato è al completo e la cliente voleva le 11:00. {product} le offre invece martedì alle 13:30: taglio e piega con trattamento ristrutturante, 60 minuti invece di 45, agli stessi {price}.",
  "Fully booked": "Al completo",
  "Booked": "Prenotato",
  "Wanted, but taken": "Desiderato, ma occupato",
  "Free": "Libero",
  "same {price}": "stesso prezzo: {price}",
  "How it works": "Come funziona",
  "Share your link": "Condividi il tuo link",
  "Put it where clients find you full: the “fully booked” message on your booking page, your Instagram bio, your auto-reply, a QR code at the desk.": "Mettilo dove i clienti ti trovano al completo: il messaggio «al completo» della tua pagina di prenotazione, la bio di Instagram, la risposta automatica, un codice QR alla cassa.",
  "The client picks an upgrade": "Il cliente sceglie un appuntamento arricchito",
  "They choose the service they wanted and see up to three upgraded times in your quiet hours, in their own language. No account, no app.": "Sceglie il servizio che voleva e vede fino a tre orari con extra nei tuoi orari tranquilli, nella sua lingua. Senza account, senza app.",
  "You confirm": "Tu confermi",
  "You get an email, confirm with one tap, and send the ready-made message by WhatsApp, text or email. Confirmed appointments appear in your calendar.": "Ricevi un’email, confermi con un tocco e invii il messaggio già pronto via WhatsApp, SMS o email. Gli appuntamenti confermati compaiono nel tuo calendario.",
  "Rules {product} never breaks": "Le regole che {product} non infrange mai",
  "Same price, every time": "Sempre lo stesso prezzo",
  "The client pays exactly your listed price. {product} cannot create a discount, and the database refuses one even if someone tries.": "Il cliente paga esattamente il tuo prezzo di listino. {product} non può creare sconti, e il database li rifiuta anche se qualcuno ci prova.",
  "Noticeably more care": "Molta più cura",
  "Every offer adds at least 30% more time, using upgrades you choose: a scalp massage, a treatment, a longer finish.": "Ogni offerta aggiunge almeno il 30% di tempo, con extra scelti da te: un massaggio al cuoio capelluto, un trattamento, una piega più lunga.",
  "Only in hours you choose": "Solo negli orari che scegli tu",
  "Offers land only in the quiet hours you set, and never more at once than you have free chairs.": "Le offerte cadono solo negli orari tranquilli che imposti e mai più di quanti posti liberi hai.",
  "You stay in charge": "Decidi tu",
  "Nothing is booked until you confirm it. Client details are deleted {days} days after the appointment.": "Nulla è prenotato finché non lo confermi. I dati dei clienti vengono cancellati {days} giorni dopo l’appuntamento.",
  "One account, three levels": "Un account, tre livelli",
  "Start with one location. The next levels switch on as your business grows.": "Inizia con una sede. I livelli successivi si attivano man mano che la tua attività cresce.",
  "Coming": "In arrivo",
  "{product} turns “fully booked” into an upgraded booking in your quiet hours, at your normal price. Never a discount.": "{product} trasforma «al completo» in una prenotazione arricchita nei tuoi orari tranquilli, al tuo prezzo normale. Mai uno sconto.",
  "Skip to content": "Vai al contenuto",
  "Privacy": "Privacy",
  "Terms": "Termini",
  "Dashboard": "Pannello",
  "Start free": "Inizia gratis",
  "Requests by {product}": "Richieste tramite {product}",
  "Log out": "Esci",
  "Share": "Condividi",
  "Plan": "Piano",
  "Settings": "Impostazioni",
  "Please correct the highlighted field.": "Correggi il campo evidenziato.",
  "Please correct the {n} highlighted fields.": "Correggi i {n} campi evidenziati.",
  "Fully booked when you wanted to come in? Choose your service and we will offer you a calmer time with extra care included, at the same price.": "Al completo nell’orario che volevi? Scegli il tuo servizio e ti proporremo un momento più tranquillo con cure extra incluse, allo stesso prezzo.",
  "Prices are the salon’s standard prices. Upgraded appointments never cost more, or less.": "I prezzi sono quelli abituali del salone. Gli appuntamenti arricchiti non costano mai di più, né di meno.",
  "{salon} is not taking requests through this page yet.": "{salon} non accetta ancora richieste tramite questa pagina.",
  "Request an appointment": "Richiedi un appuntamento",
  "{salon} uses this to confirm your appointment. Please include the country code with a phone number, for example +44.": "{salon} lo usa per confermare il tuo appuntamento. Se indichi un numero di telefono, includi il prefisso internazionale, per esempio +39.",
  "Leave this field empty": "Lascia vuoto questo campo",
  "Privacy notice": "Informativa sulla privacy",
  "Pick your appointment": "Scegli il tuo appuntamento",
  "{service} with extra time added, at the usual price of {price}.": "{service} con tempo extra, al prezzo abituale di {price}.",
  "Available upgraded times": "Orari disponibili con extra",
  "your usual price": "il tuo prezzo abituale",
  "Nothing is booked yet: {salon} confirms your request personally.": "Non è ancora prenotato nulla: {salon} conferma personalmente la tua richiesta.",
  "Leave your details": "Lascia i tuoi dati",
  "No upgraded time is free right now": "Al momento non ci sono orari con extra liberi",
  "{salon} is not offering upgraded times online at the moment. Leave your details for {service} and they will get back to you.": "{salon} al momento non offre orari con extra online. Lascia i tuoi dati per {service} e ti ricontatteranno.",
  "Leave your details for {service} and {salon} will get back to you when a place opens.": "Lascia i tuoi dati per {service} e {salon} ti ricontatterà appena si libera un posto.",
  "When suits you?": "Quando ti farebbe comodo?",
  "(optional)": "(facoltativo)",
  "Join the waitlist": "Iscriviti alla lista d’attesa",
  "{salon} will confirm it personally. Keep this page: it shows the answer as soon as they reply.": "{salon} la confermerà personalmente. Tieni questa pagina: mostrerà la risposta appena arriva.",
  "See you on {date} at {time}.": "Ci vediamo {date} alle {time}.",
  "{salon} could not confirm this time. You are welcome to choose another one.": "{salon} non ha potuto confermare questo orario. Puoi sceglierne un altro quando vuoi.",
  "This request was not confirmed before its time passed.": "Questa richiesta non è stata confermata in tempo.",
  "{salon} has picked up your request.": "{salon} ha preso in carico la tua richiesta.",
  "This waitlist request has expired.": "Questa iscrizione alla lista d’attesa è scaduta.",
  "This waitlist request was closed.": "Questa iscrizione alla lista d’attesa è stata chiusa.",
  "Included": "Incluso",
  "the standard price": "il prezzo abituale",
  "the operator of {product}": "il gestore di {product}",
  "What happens to your details when you use {product}.": "Cosa succede ai tuoi dati quando usi {product}.",
  "If you send a request to a salon": "Se invii una richiesta a un salone",
  "The salon you write to decides what happens with your request; {product} only processes it on the salon’s behalf. We store your name, the phone number or email you give, the service and time you chose, the language you used, and the moment you agreed to be contacted.": "Il salone a cui scrivi decide cosa succede alla tua richiesta; {product} la tratta solo per conto del salone. Conserviamo il tuo nome, il numero di telefono o l’email che indichi, il servizio e l’orario scelti, la lingua usata e il momento in cui hai acconsentito a essere contattato.",
  "Your details are used only to answer that request, including emails about it if you gave an email address. They are deleted {days} days after the appointment date (or {days} days after a waitlist request). What remains is anonymous: the service, the time and the price, for the salon’s statistics.": "I tuoi dati vengono usati solo per rispondere a quella richiesta, comprese le email che la riguardano se hai indicato un indirizzo email. Vengono cancellati {days} giorni dopo la data dell’appuntamento (o {days} giorni dopo un’iscrizione alla lista d’attesa). Ciò che resta è anonimo: il servizio, l’orario e il prezzo, per le statistiche del salone.",
  "Pages for clients set no cookies and load nothing from other websites. Visits are counted per day without any personal data. There is no tracking and no advertising.": "Le pagine per i clienti non usano cookie e non caricano nulla da altri siti. Le visite vengono contate per giorno senza alcun dato personale. Nessun tracciamento e nessuna pubblicità.",
  "If you run a salon account": "Se gestisci un account salone",
  "We store your email, a protected form of your password (never the password itself), your salon’s settings and the requests you receive. One cookie keeps you logged in. Email is sent through the provider this installation is configured with. Payments, if switched on, are handled entirely by the payment provider; this site never sees card details. You can delete your account and all of its data at any time from Settings.": "Conserviamo la tua email, una forma protetta della tua password (mai la password stessa), le impostazioni del tuo salone e le richieste che ricevi. Un cookie ti mantiene connesso. Le email vengono inviate tramite il fornitore configurato per questa installazione. I pagamenti, se attivi, sono gestiti interamente dal fornitore dei pagamenti; questo sito non vede mai i dati delle carte. Puoi cancellare il tuo account e tutti i suoi dati in qualsiasi momento dalle Impostazioni.",
  "Your rights": "I tuoi diritti",
  "You can ask for a copy of your details, for corrections, or for deletion. For a request you sent to a salon, contact that salon directly; for anything else, contact {operator}.": "Puoi chiedere una copia dei tuoi dati, la loro rettifica o la loro cancellazione. Per una richiesta inviata a un salone, contatta direttamente quel salone; per tutto il resto, contatta {operator}.",
  "Terms of use": "Termini di utilizzo",
  "Legal notice": "Note legali",
  "What you get": "Cosa ottieni",
  "A free trial, then a monthly subscription you can cancel at any time. Prices are shown before you subscribe. Payments and invoices are handled by our payment provider.": "Una prova gratuita, poi un abbonamento mensile che puoi disdire in qualsiasi momento. I prezzi vengono mostrati prima dell’abbonamento. Pagamenti e fatture sono gestiti dal nostro fornitore dei pagamenti.",
  "Free use of the Reflow level while the beta runs. Features may change. If paid plans are introduced, you will be told in advance and nothing will be charged without your explicit agreement.": "Uso gratuito del livello Reflow per tutta la durata della beta. Le funzioni possono cambiare. Se verranno introdotti piani a pagamento, sarai avvisato in anticipo e nulla ti verrà addebitato senza il tuo consenso esplicito.",
  "What we ask": "Cosa ti chiediamo",
  "Use your request page only for your own business and only for real appointments. You are responsible for honouring the appointments you confirm and for treating your clients’ details with care.": "Usa la tua pagina delle richieste solo per la tua attività e solo per appuntamenti reali. Sei responsabile del rispetto degli appuntamenti che confermi e del trattamento accurato dei dati dei tuoi clienti.",
  "No warranty": "Nessuna garanzia",
  "The service is provided as is. Keep your own booking system as the record of your appointments.": "Il servizio è fornito così com’è. Continua a usare il tuo sistema di prenotazione come registro dei tuoi appuntamenti.",
  "Ending": "Recesso",
  "You can delete your account at any time from Settings; your data is deleted with it.": "Puoi cancellare il tuo account in qualsiasi momento dalle Impostazioni; i tuoi dati vengono cancellati insieme all’account.",
  "Go to the home page": "Vai alla home page",
  "Handled": "Gestita",
  "Closed": "Chiusa",
  "That did not work": "Non ha funzionato",
  "Not allowed": "Non consentito",
  "Page not found": "Pagina non trovata",
  "Already changed": "Già modificato",
  "Too large": "Troppo grande",
  "Form not readable": "Modulo illeggibile",
  "Too many attempts": "Troppi tentativi",
  "Something went wrong": "Qualcosa è andato storto",
  "{salon} may contact me about this request. My details are deleted {days} days after the appointment. {privacy}": "{salon} può contattarmi per questa richiesta. I miei dati vengono cancellati {days} giorni dopo l’appuntamento. {privacy}",
  "You can ask for a copy of your details, for corrections, or for deletion. For a request you sent to a salon, contact that salon directly; for anything else, contact {operator} at {email}.": "Puoi chiedere una copia dei tuoi dati, la loro rettifica o la loro cancellazione. Per una richiesta inviata a un salone, contatta direttamente quel salone; per tutto il resto, contatta {operator} all’indirizzo {email}.",
  "Logged in as {email}": "Accesso effettuato come {email}",
  "Salon": "Salone",
  "Shown to clients on their confirmation.": "Mostrato ai clienti nella loro conferma.",
  "Page address": "Indirizzo della pagina",
  "Lowercase letters, numbers and dashes. Links you already shared stop working if you change it.": "Lettere minuscole, numeri e trattini. Se lo cambi, i link già condivisi smettono di funzionare.",
  "Language of your request page": "Lingua della tua pagina delle richieste",
  "Clients can switch to another language on the page.": "I clienti possono passare a un’altra lingua sulla pagina.",
  "Minimum extra time (%)": "Tempo extra minimo (%)",
  "At least {pct}%. Raise it if you want offers to feel even more generous.": "Almeno il {pct}%. Aumentalo se vuoi che le offerte risultino ancora più generose.",
  "Minimum notice": "Preavviso minimo",
  "How soon an offered time can start, so you have time to confirm.": "Con quanto anticipo minimo può iniziare un orario offerto, così hai il tempo di confermarlo.",
  "Save settings": "Salva impostazioni",
  "You": "Il tuo account",
  "Language of your dashboard and emails": "Lingua del pannello e delle email",
  "Email notifications": "Notifiche email",
  "Email me when a client sends a request": "Inviami un’email quando un cliente invia una richiesta",
  "Email sending is not set up on this installation yet, so no emails go out for now.": "L’invio di email non è ancora configurato su questa installazione, quindi per ora non partono email.",
  "Save": "Salva",
  "Calendar": "Calendario",
  "Subscribe to this address in Google Calendar, Apple Calendar or Outlook, and every appointment you confirm appears there by itself. Keep the address private: it shows your clients’ names.": "Iscriviti a questo indirizzo in Google Calendar, Apple Calendario o Outlook e ogni appuntamento che confermi comparirà lì da solo. Tieni l’indirizzo riservato: mostra i nomi dei tuoi clienti.",
  "Copy address": "Copia indirizzo",
  "Create a new address (the old one stops working)": "Crea un nuovo indirizzo (quello vecchio smetterà di funzionare)",
  "Create calendar address": "Crea indirizzo del calendario",
  "Export": "Esporta",
  "All requests as a spreadsheet file (CSV), for your records or another tool.": "Tutte le richieste in un file di foglio di calcolo (CSV), per il tuo archivio o un altro strumento.",
  "Download requests (CSV)": "Scarica le richieste (CSV)",
  "Current password": "Password attuale",
  "Change password": "Cambia password",
  "Audit log": "Registro modifiche",
  "Every offer, confirmation and price change is recorded in a tamper-evident log.": "Ogni offerta, conferma e modifica di prezzo viene annotata in un registro a prova di manomissione.",
  "Check the audit log": "Verifica il registro",
  "Delete account": "Elimina account",
  "Deletes your salon, services, requests and client details permanently. This cannot be undone.": "Elimina definitivamente il tuo salone, i servizi, le richieste e i dati dei clienti. L’operazione non si può annullare.",
  "Your password": "La tua password",
  "Delete account and all data": "Elimina l’account e tutti i dati",
  "One account, three levels.": "Un account, tre livelli.",
  "Subscription": "Abbonamento",
  "Subscribe: {price}": "Abbonati: {price}",
  "Subscribe": "Abbonati",
  "Manage subscription and invoices": "Gestisci abbonamento e fatture",
  "You are on Reflow, free during the beta.": "Usi Reflow, gratis durante la beta.",
  "Your plan": "Il tuo piano",
  "On the list": "In lista",
  "We will tell you when it opens": "Ti avviseremo quando sarà disponibile",
  "Tell me when {plan} opens": "Avvisami quando {plan} sarà disponibile",
  "Page address {slug}, {timezone}, {currency}": "Indirizzo della pagina {slug}, {timezone}, {currency}",
  "at least {pct}% extra time": "almeno il {pct}% di tempo extra",
  "Service {id} shown to clients": "Servizio {id} visibile ai clienti",
  "Service {id} hidden from clients": "Servizio {id} nascosto ai clienti",
  "was {price}": "prima {price}",
  "Upgrade {id} switched on": "Extra {id} attivato",
  "Upgrade {id} switched off": "Extra {id} disattivato",
  "Each entry carries the fingerprint of the one before it, so a changed or deleted entry breaks the chain.": "Ogni voce contiene l’impronta di quella precedente, quindi una voce modificata o eliminata spezza la catena.",
  "Chain broken at entry {id}. An entry was changed or removed outside the app.": "Catena interrotta alla voce {id}. Una voce è stata modificata o rimossa al di fuori dell’app.",
  "Latest fingerprint:": "Ultima impronta:",
  "Free trial until {date}.": "Prova gratuita fino al {date}.",
  "Your subscription is active.": "Il tuo abbonamento è attivo.",
  "Your last payment did not go through. Please update your payment method to keep your request page running.": "Il tuo ultimo pagamento non è andato a buon fine. Aggiorna il metodo di pagamento per mantenere attiva la tua pagina delle richieste.",
  "Your subscription is cancelled. Upgraded offers keep running until {date}.": "Il tuo abbonamento è disdetto. Le offerte arricchite restano attive fino al {date}.",
  "Your subscription is paused. Clients can join your waitlist, but see no upgraded times.": "Il tuo abbonamento è in pausa. I clienti possono iscriversi alla tua lista d’attesa, ma non vedono orari con extra.",
  "Your subscription is not active. Clients can join your waitlist, but see no upgraded times.": "Il tuo abbonamento non è attivo. I clienti possono iscriversi alla tua lista d’attesa, ma non vedono orari con extra.",
  "Account created": "Account creato",
  "Settings changed": "Impostazioni modificate",
  "Service added": "Servizio aggiunto",
  "Service changed": "Servizio modificato",
  "Upgrade added": "Extra aggiunto",
  "Upgrade changed": "Extra modificato",
  "Quiet hours added": "Orari tranquilli aggiunti",
  "Quiet hours removed": "Orari tranquilli rimossi",
  "Offer requested": "Offerta richiesta",
  "Waitlist request": "Iscrizione alla lista d’attesa",
  "Request confirmed": "Richiesta confermata",
  "Request declined": "Richiesta rifiutata",
  "Waitlist request handled": "Iscrizione alla lista d’attesa gestita",
  "Subscription changed": "Abbonamento modificato",
  "Free beta": "Beta gratuita",
  "Free trial": "Prova gratuita",
  "{days}-day free trial": "Prova gratuita di {days} giorni",
  "Monthly subscription": "Abbonamento mensile",
  "Active": "Attivo",
  "Payment overdue": "Pagamento in ritardo",
  "Cancelled": "Disdetto",
  "Paused": "In pausa",
  "Ended": "Terminato",
  "{n} service": "{n} servizio",
  "{n} services": "{n} servizi",
  "{n} upgrade": "{n} extra",
  "{n} upgrades": "{n} extra",
  "Chain intact: {n} entry checked, none changed.": "Catena integra: {n} voce verificata, nessuna modificata.",
  "Chain intact: {n} entries checked, none changed.": "Catena integra: {n} voci verificate, nessuna modificata.",
  "Booking page, “fully booked” message": "Pagina di prenotazione, messaggio «al completo»",
  "Fully booked at the time you wanted? Get a longer, upgraded appointment at the same price: {url}": "Al completo nell’orario che volevi? Ottieni un appuntamento più lungo e arricchito allo stesso prezzo: {url}",
  "Instagram or Facebook bio": "Bio di Instagram o Facebook",
  "Fully booked? Upgraded appointments, same price: {url}": "Al completo? Appuntamenti arricchiti, stesso prezzo: {url}",
  "Auto-reply for messages": "Risposta automatica ai messaggi",
  "Thanks for your message! If we’re fully booked when you’d like to come, {salon} can offer you a calmer time with extra care included, at the same price. Pick one here: {url}": "Grazie per il tuo messaggio! Se siamo al completo quando vorresti venire, {salon} può offrirti un momento più tranquillo con cure extra incluse, allo stesso prezzo. Scegli qui: {url}",
  "Fully booked? See upgraded times": "Al completo? Vedi gli orari con extra",
  "Put your link wherever clients find you fully booked. Texts below are in the language of your request page: {language}.": "Metti il tuo link ovunque i clienti vedano che sei al completo. I testi qui sotto sono nella lingua della tua pagina delle richieste: {language}.",
  "Your link": "Il tuo link",
  "Copy link": "Copia link",
  "Open page": "Apri la pagina",
  "Texts to copy": "Testi da copiare",
  "Copy text": "Copia testo",
  "QR code for the desk and the window": "Codice QR per la cassa e la vetrina",
  "QR code that opens your request page": "Codice QR che apre la tua pagina delle richieste",
  "Print the poster for your reception desk or window, or put the QR code on your price list.": "Stampa il poster per la reception o la vetrina, oppure metti il codice QR sul tuo listino prezzi.",
  "Open printable poster": "Apri il poster da stampare",
  "Download QR code": "Scarica il codice QR",
  "Button for your website": "Pulsante per il tuo sito",
  "Paste this code into your website where clients see that you are fully booked.": "Incolla questo codice nel tuo sito, dove i clienti vedono che sei al completo.",
  "Copy code": "Copia codice",
  "Fully booked?": "Al completo?",
  "Scan for a longer, upgraded appointment in a calmer hour, at the same price.": "Inquadra il codice per un appuntamento più lungo e arricchito in un orario più tranquillo, allo stesso prezzo.",
  "Print poster": "Stampa poster",
  "Back": "Indietro",
  "Appointment canceled": "Appuntamento annullato",
  "Join the salon team": "Unisciti al team del salone",
  "Verify your email": "Verifica la tua email",
  "This private link expires in 24 hours. If you did not request it, ignore this email.": "Questo link privato scade tra 24 ore. Se non lo hai richiesto, ignora questa email.",
  "Appointment reminder": "Promemoria appuntamento",
  "Handle future appointments before changing the time zone.": "Gestisci gli appuntamenti futuri prima di cambiare fuso orario.",
  "Only the owner can change these settings.": "Solo il titolare può modificare queste impostazioni.",
  "End your paid subscription before deleting the account.": "Termina l’abbonamento a pagamento prima di eliminare l’account.",
  "Completed": "Completato",
  "No-show": "Non presentato",
  "Canceled": "Annullato",
  "All": "Tutti",
  "Appointments": "Appuntamenti",
  "Block time": "Blocca un orario",
  "Search": "Cerca",
  "No appointments found.": "Nessun appuntamento trovato.",
  "Mark completed": "Segna come completato",
  "Cancel this appointment?": "Annullare questo appuntamento?",
  "Cancel appointment": "Annulla appuntamento",
  "Previous": "Precedente",
  "Next": "Successivo",
  "Availability": "Disponibilità",
  "Block holidays, breaks and appointments from your other booking system.": "Blocca ferie, pause e appuntamenti del tuo altro sistema di prenotazione.",
  "Close the whole day": "Chiudi per l’intera giornata",
  "No blocked times.": "Nessun orario bloccato.",
  "This block overlaps a reservation. Handle the reservation first.": "Questo blocco si sovrappone a una prenotazione. Gestisci prima la prenotazione.",
  "Change appointment": "Modifica appuntamento",
  "Your current appointment stays reserved until you choose a new time. The salon must confirm the change.": "L’appuntamento attuale resta prenotato finché non scegli un nuovo orario. Il salone deve confermare la modifica.",
  "Cancellation notice (minutes)": "Preavviso di annullamento (minuti)",
  "Request hold (hours)": "Durata della riserva (ore)",
  "Please contact the salon to change this appointment.": "Contatta il salone per modificare questo appuntamento.",
  "Team": "Team",
  "Staff can manage appointments and blocked times. Billing, exports and business settings stay with the owner.": "Il personale può gestire appuntamenti e orari bloccati. Fatturazione, esportazioni e impostazioni aziendali restano al titolare.",
  "Invitation ready. Send this private link to your colleague.": "Invito pronto. Invia questo link privato al tuo collega.",
  "Invitation link": "Link d’invito",
  "Invite a colleague": "Invita un collega",
  "Owner": "Titolare",
  "Staff": "Personale",
  "Remove this colleague?": "Rimuovere questo collega?",
  "Pending invitations": "Inviti in sospeso",
  "Check your inbox and confirm your email before opening your dashboard.": "Controlla la posta e conferma la tua email prima di aprire la dashboard.",
  "Check your inbox.": "Controlla la posta in arrivo.",
  "Resend email": "Invia di nuovo l’email",
  "My account": "Il mio account",
  "This action is not available in the demo.": "Questa azione non è disponibile nella demo.",
  "This email is already registered or the team is full.": "Questa email è già registrata oppure il team è al completo.",
  "Booked value": "Valore prenotato",
  "Booked value is not collected revenue. Mark completed services in Appointments.": "Il valore prenotato non è un ricavo incassato. Segna i servizi completati in Appuntamenti.",
  "Completed service value": "Valore dei servizi completati",
  "Request hold: {hours} hours. Changes and cancellations close {minutes} minutes before the appointment.": "Riserva della richiesta: {hours} ore. Modifiche e annullamenti si chiudono {minutes} minuti prima dell’appuntamento.",
  "Booking policy": "Regole di prenotazione",
  "Unanswered requests release their reserved time when the hold expires.": "Le richieste senza risposta liberano l’orario riservato allo scadere della riserva."
};
return { default: __default };
})();

// src/i18n/pt.js
const __m16 = (() => {
// Copyright (c) 2026 Miloš Petrović (Trench Logic Studio) · SPDX-License-Identifier: MIT
// Translations are checked for completeness and placeholder parity.
const __default = {
  "There is nothing at this address.": "Não há nada neste endereço.",
  "That action is not available here.": "Esta ação não está disponível aqui.",
  "This form was sent from another website, so it was blocked. Open the page again and resend it.": "Este formulário foi enviado de outro site e por isso foi bloqueado. Abra a página de novo e envie outra vez.",
  "12 Example Street": "Rua Exemplo, 12",
  "Any weekday after 17:00": "Em dias úteis, depois das 17:00",
  "This form could not be read. Please reload the page and try again.": "Não foi possível ler este formulário. Recarregue a página e tente de novo.",
  "That form is too large.": "Este formulário é grande demais.",
  "Send request": "Enviar pedido",
  "{m} min": "{m} min",
  "{h} h {m} min": "{h} h {m} min",
  "{h} h": "{h} h",
  "{total} instead of {base}": "{total} em vez de {base}",
  "Price: {price}, the standard price": "Preço: {price}, o preço normal",
  "Reference: {ref}": "Referência: {ref}",
  "New request: {when}": "Novo pedido: {when}",
  "A client asked for an upgraded appointment through your request page.": "Um cliente pediu um horário com upgrade pela sua página de pedidos.",
  "Client: {contact}": "Cliente: {contact}",
  "Confirm or decline": "Confirmar ou recusar",
  "You receive these emails because notifications are on in Settings.": "Você recebe estes e-mails porque as notificações estão ativadas em Configurações.",
  "New waitlist request: {service}": "Novo pedido na lista de espera: {service}",
  "A client joined your waitlist.": "Um cliente entrou na sua lista de espera.",
  "Note: “{note}”": "Observação: “{note}”",
  "Open your dashboard": "Abrir seu painel",
  "You receive this email because you sent a request to {salon}. Your details are deleted {days} days after the appointment.": "Você recebe este e-mail porque enviou um pedido para {salon}. Seus dados são excluídos {days} dias após o atendimento.",
  "Your request at {salon}": "Seu pedido em {salon}",
  "Request sent": "Pedido enviado",
  "{salon} has your request and will confirm it personally.": "{salon} recebeu seu pedido e vai confirmá-lo pessoalmente.",
  "See your request": "Ver seu pedido",
  "You are on the waitlist at {salon}": "Você está na lista de espera de {salon}",
  "You are on the waitlist": "Você está na lista de espera",
  "{salon} will contact you when a place opens.": "{salon} vai entrar em contato quando abrir uma vaga.",
  "Address: {address}": "Endereço: {address}",
  "Phone: {phone}": "Telefone: {phone}",
  "Confirmed: {when} at {salon}": "Confirmado: {when} em {salon}",
  "Confirmed": "Confirmado",
  "{salon} has confirmed your appointment.": "{salon} confirmou seu horário.",
  "Add to calendar": "Adicionar à agenda",
  "{salon} could not confirm your request": "{salon} não conseguiu confirmar seu pedido",
  "Not available": "Indisponível",
  "{salon} could not confirm the time you chose. You are welcome to pick another one.": "{salon} não conseguiu confirmar o horário que você escolheu. Fique à vontade para escolher outro.",
  "Choose another time": "Escolher outro horário",
  "Reset your password": "Redefina sua senha",
  "Someone asked to reset the password for your account. If it was you, choose a new password with the link below. It works once, for {hours} hours.": "Alguém pediu para redefinir a senha da sua conta. Se foi você, escolha uma nova senha pelo link abaixo. Ele funciona uma única vez, por {hours} horas.",
  "If it was not you, ignore this email: nothing changes.": "Se não foi você, ignore este e-mail: nada muda.",
  "Choose a new password": "Escolher uma nova senha",
  "One location": "Uma unidade",
  "When a client finds you fully booked, offer an upgraded appointment in a quieter hour, at exactly the same price.": "Quando um cliente encontra sua agenda lotada, ofereça um horário com upgrade em um momento mais tranquilo, exatamente pelo mesmo preço.",
  "Your own request page to share anywhere": "Sua própria página de pedidos para compartilhar onde quiser",
  "Upgrades you define, at least +30% more time": "Upgrades definidos por você, com pelo menos +30% de tempo",
  "Never a discount, enforced by the system": "Nunca um desconto, garantido pelo sistema",
  "You confirm every request yourself": "Você mesmo confirma cada pedido",
  "Free during beta": "Grátis durante o beta",
  "Several locations": "Várias unidades",
  "When one location is full, route the client to your location or sister brand that has room, at the same price.": "Quando uma unidade lota, encaminhe o cliente para a sua unidade ou marca irmã que tiver vaga, pelo mesmo preço.",
  "Everything in Reflow": "Tudo do Reflow",
  "Overflow routed between your locations": "Excesso de demanda distribuído entre suas unidades",
  "One view across all locations": "Uma visão de todas as unidades",
  "Opens with the first multi-location salon": "Chega com o primeiro salão com várias unidades",
  "Partner network": "Rede de parceiros",
  "Share overflow with trusted partner businesses. Priority is earned through reliability, never bought.": "Compartilhe o excesso de demanda com parceiros de confiança. A prioridade se conquista com confiabilidade, nunca se compra.",
  "Everything in Relay": "Tudo do Relay",
  "Overflow shared with partner businesses": "Excesso de demanda compartilhado com parceiros",
  "Trust-based priority": "Prioridade baseada em confiança",
  "Later": "Mais adiante",
  "This page does not exist.": "Esta página não existe.",
  "That user does not exist.": "Este usuário não existe.",
  "Create your own account": "Crie sua própria conta",
  "See your plan": "Ver seu plano",
  "Enter a price such as 40 or 40.50.": "Informe um preço como 40 ou 40,50.",
  "You can have up to {n} services.": "Você pode ter até {n} serviços.",
  "Choose a service from the list.": "Escolha um serviço da lista.",
  "You can have up to {n} upgrades.": "Você pode ter até {n} upgrades.",
  "Choose at least one day.": "Escolha pelo menos um dia.",
  "Choose days from the list.": "Escolha os dias da lista.",
  "Enter a start time such as 13:00.": "Informe um horário de início como 13:00.",
  "Enter an end time such as 16:00.": "Informe um horário de término como 16:00.",
  "Quiet hours must last at least 30 minutes.": "Os horários tranquilos precisam durar pelo menos 30 minutos.",
  "Check the name, minutes and price of this service.": "Confira o nome, os minutos e o preço deste serviço.",
  "Check the name and minutes of this upgrade.": "Confira o nome e os minutos deste upgrade.",
  "Choose at least one service.": "Escolha pelo menos um serviço.",
  "You can have up to {n} quiet-hour entries.": "Você pode ter até {n} faixas de horários tranquilos.",
  "Enter a phone number such as +44 20 7946 0000.": "Informe um telefone como +55 11 91234-5678.",
  "Use 2 to 40 lowercase letters, numbers or dashes, starting and ending with a letter or number.": "Use de 2 a 40 letras minúsculas, números ou hífens, começando e terminando com uma letra ou um número.",
  "Choose your time zone.": "Escolha seu fuso horário.",
  "That address is already taken. Try another one.": "Esse endereço já está em uso. Tente outro.",
  "The demo account has no password to change.": "A conta de demonstração não tem senha para alterar.",
  "That is not your current password.": "Essa não é sua senha atual.",
  "That is not your password.": "Essa não é sua senha.",
  "Reference": "Referência",
  "Type": "Tipo",
  "Status": "Status",
  "Service": "Serviço",
  "Upgrades": "Upgrades",
  "Date": "Data",
  "Start": "Início",
  "End": "Término",
  "Minutes": "Minutos",
  "Price": "Preço",
  "Standard price": "Preço normal",
  "Currency": "Moeda",
  "Client": "Cliente",
  "Contact": "Contato",
  "Note": "Observação",
  "Language": "Idioma",
  "Received": "Recebido",
  "Answered": "Respondido",
  "This is a demo salon: it and its sample data are deleted within 24 hours. {signup} to keep a salon of your own.": "Este é um salão de demonstração: ele e seus dados de exemplo são excluídos em até 24 horas. {signup} para ter um salão só seu.",
  "Your request page shows only the waitlist until you subscribe. {plan}": "Sua página de pedidos mostra só a lista de espera até você assinar. {plan}",
  "Your free trial ends on {date}. {plan}": "Seu teste grátis termina em {date}. {plan}",
  "Name": "Nome",
  "Length": "Duração",
  "Extra minutes": "Minutos extras",
  "Free chairs": "Vagas livres",
  "Salon name": "Nome do salão",
  "Address": "Endereço",
  "Phone": "Telefone",
  "Minimum extra time": "Tempo extra mínimo",
  "New password": "Nova senha",
  "Choose a valid currency.": "Escolha uma moeda válida.",
  "Choose a language from the list.": "Escolha um idioma da lista.",
  "Choose a notice period from the list.": "Escolha uma antecedência da lista.",
  "That request does not exist.": "Este pedido não existe.",
  "That action does not apply to this request.": "Esta ação não se aplica a este pedido.",
  "That service does not exist.": "Este serviço não existe.",
  "Unknown action.": "Ação desconhecida.",
  "That upgrade does not exist.": "Este upgrade não existe.",
  "Unknown salon type.": "Tipo de salão desconhecido.",
  "Unknown level.": "Nível desconhecido.",
  "Too many sign-ups from here in the last hour. Please try again later.": "Muitos cadastros feitos daqui na última hora. Tente de novo mais tarde.",
  "Please accept the terms of use to continue.": "Aceite os termos de uso para continuar.",
  "Please accept the beta terms to continue.": "Aceite os termos do beta para continuar.",
  "An account with this email already exists. Log in instead.": "Já existe uma conta com este e-mail. Faça login.",
  "Too many attempts. Wait 15 minutes, then try again.": "Muitas tentativas. Aguarde 15 minutos e tente de novo.",
  "Enter your email.": "Informe seu e-mail.",
  "Enter your password.": "Informe sua senha.",
  "Email or password is incorrect.": "E-mail ou senha incorretos.",
  "Password saved. Log in with your new password.": "Senha salva. Entre com sua nova senha.",
  "Your account and all of its data have been deleted.": "Sua conta e todos os dados dela foram excluídos.",
  "Could not create the account. Please try again.": "Não foi possível criar a conta. Tente de novo.",
  "Too many attempts. Please try again in an hour.": "Muitas tentativas. Tente de novo daqui a uma hora.",
  "Too many demos were started from here. Please try again in an hour.": "Muitas demonstrações foram iniciadas daqui. Tente de novo daqui a uma hora.",
  "The demo is very busy right now. Please try again in a few minutes.": "A demonstração está muito movimentada agora. Tente de novo em alguns minutos.",
  "Enter a phone number or an email address.": "Informe um telefone ou um e-mail.",
  "Please agree, so the salon can contact you about this request.": "Dê seu consentimento para que o salão possa entrar em contato sobre este pedido.",
  "Choose one of the times.": "Escolha um dos horários.",
  "That time was just taken or has changed. Here is what is free now.": "Esse horário acabou de ser ocupado ou mudou. Veja o que está livre agora.",
  "Your name": "Seu nome",
  "Phone or email": "Telefone ou e-mail",
  "Your note": "Sua observação",
  "There is no salon at this address. Check the link you were given.": "Não há nenhum salão neste endereço. Confira o link que você recebeu.",
  "Too many requests were sent from here. Please try again in an hour, or contact the salon directly.": "Muitos pedidos foram enviados daqui. Tente de novo daqui a uma hora ou fale direto com o salão.",
  "This request could not be sent. Please contact the salon directly.": "Não foi possível enviar este pedido. Fale direto com o salão.",
  "This request link is not valid.": "Este link de pedido não é válido.",
  "This appointment is not confirmed yet.": "Este horário ainda não foi confirmado.",
  "That item does not exist.": "Este item não existe.",
  "Hair salon": "Salão de cabeleireiro",
  "Cut & finish": "Corte e finalização",
  "Blow-dry & style": "Escova e penteado",
  "Colour refresh": "Retoque de cor",
  "Highlights": "Luzes",
  "Deep conditioning treatment": "Hidratação profunda",
  "Scalp massage": "Massagem no couro cabeludo",
  "Gloss treatment": "Banho de brilho",
  "Extended styling": "Finalização caprichada",
  "Barbershop": "Barbearia",
  "Haircut": "Corte de cabelo",
  "Beard trim": "Barba",
  "Haircut & beard": "Cabelo e barba",
  "Hot towel shave": "Barba com toalha quente",
  "Hot towel treatment": "Toalha quente",
  "Beard oil treatment": "Hidratação com óleo de barba",
  "Face mask": "Máscara facial",
  "Nail studio": "Esmalteria",
  "Gel manicure": "Manicure em gel",
  "Classic manicure": "Manicure tradicional",
  "Pedicure": "Pedicure",
  "Gel pedicure": "Pedicure em gel",
  "Hand massage": "Massagem nas mãos",
  "Paraffin treatment": "Parafina",
  "Cuticle care": "Cuidado das cutículas",
  "Nail art accent": "Detalhe de nail art",
  "Beauty & spa": "Estética e spa",
  "Classic facial": "Limpeza de pele clássica",
  "Relaxing massage": "Massagem relaxante",
  "Brow & lash tint": "Tintura de sobrancelhas e cílios",
  "Waxing": "Depilação com cera",
  "Eye treatment": "Tratamento para a área dos olhos",
  "Extended massage": "Massagem estendida",
  "{label} is required.": "O campo “{label}” é obrigatório.",
  "{label} is too short.": "O campo “{label}” é curto demais.",
  "{label} must be at most {max} characters.": "O campo “{label}” pode ter no máximo {max} caracteres.",
  "{label} must be a whole number.": "O campo “{label}” precisa ser um número inteiro.",
  "{label} must be between {min} and {max}.": "O campo “{label}” precisa estar entre {min} e {max}.",
  "{label} must be a multiple of {step}.": "O campo “{label}” precisa ser múltiplo de {step}.",
  "Email": "E-mail",
  "Enter a valid email address.": "Informe um e-mail válido.",
  "{label} must be at least 10 characters.": "O campo “{label}” precisa ter pelo menos 10 caracteres.",
  "{label} is too long.": "O campo “{label}” é longo demais.",
  "Password": "Senha",
  "Choose a valid option.": "Escolha uma opção válida.",
  "Start your free trial": "Comece seu teste grátis",
  "Start your free beta": "Comece seu beta grátis",
  "Set-up takes a few minutes: pick your salon type, enter your prices, and you have a page to share.": "A configuração leva poucos minutos: escolha o tipo de salão, informe seus preços e pronto, você tem uma página para compartilhar.",
  "At least 10 characters.": "Pelo menos 10 caracteres.",
  "Time zone": "Fuso horário",
  "terms of use": "termos de uso",
  "beta terms": "termos do beta",
  "privacy notice": "aviso de privacidade",
  "Create account": "Criar conta",
  "Already have an account?": "Já tem uma conta?",
  "Log in": "Entrar",
  "Forgot your password?": "Esqueceu sua senha?",
  "New here?": "Primeira vez aqui?",
  "Contact the operator of this service for a reset link.": "Fale com o responsável por este serviço para receber um link de redefinição.",
  "If an account exists for that address, a reset link is on its way. It works once, for {hours} hours.": "Se existir uma conta com esse endereço, um link de redefinição está a caminho. Ele funciona uma única vez, por {hours} horas.",
  "Enter the email you signed up with. We will send you a link to choose a new password.": "Informe o e-mail que você usou no cadastro. Vamos enviar um link para você escolher uma nova senha.",
  "Send reset link": "Enviar link",
  "Back to log in": "Voltar para o login",
  "This link has expired": "Este link expirou",
  "Reset links work once and for {hours} hours. Ask for a new one.": "Os links de redefinição funcionam uma única vez, por {hours} horas. Peça um novo.",
  "Ask for a new link": "Pedir um novo link",
  "For {email}. You will be logged out everywhere else.": "Para {email}. Você vai sair de todos os outros dispositivos.",
  "Save new password": "Salvar nova senha",
  "I accept the {terms} and the {privacy}.": "Aceito os {terms} e o {privacy}.",
  "Email us from the address you signed up with, and we will send you a reset link: {email}": "Escreva para nós do endereço que você usou no cadastro e enviaremos um link de redefinição: {email}",
  "Hidden from clients.": "Oculto para os clientes.",
  "Not offered yet: needs upgrades worth at least {n} extra minutes.": "Ainda não é oferecido: precisa de upgrades que somem pelo menos {n} minutos.",
  "Add upgrades": "Adicionar upgrades",
  "Offered as {what}: {total} instead of {base}.": "Oferecido como {what}: {total} em vez de {base}.",
  "Length in minutes": "Duração em minutos",
  "Price ({currency})": "Preço ({currency})",
  "Services": "Serviços",
  "What clients can request. The price here is the price clients pay, always.": "O que os clientes podem pedir. O preço daqui é sempre o preço que os clientes pagam.",
  "Set up from a template": "Configurar com um modelo",
  "Add a service": "Adicionar um serviço",
  "Add service": "Adicionar serviço",
  "Your services": "Seus serviços",
  "Edit": "Editar",
  "Save changes": "Salvar alterações",
  "Hide from clients": "Ocultar dos clientes",
  "Show to clients": "Mostrar aos clientes",
  "No services yet. Start from a template, or add the ones clients most often find fully booked.": "Ainda não há serviços. Comece com um modelo ou adicione aqueles em que sua agenda mais costuma lotar.",
  "Can be added to": "Pode ser adicionado a",
  "All services": "Todos os serviços",
  "Extra care you can give when a chair is free: a scalp massage, a treatment, a longer finish. Each offer combines the fewest upgrades needed to add at least {pct}% more time.": "Cuidados extras que você pode oferecer quando há uma vaga livre: uma massagem no couro cabeludo, um tratamento, uma finalização mais longa. Cada oferta combina o menor número de upgrades necessário para somar pelo menos {pct}% a mais de tempo.",
  "Add an upgrade": "Adicionar um upgrade",
  "Add upgrade": "Adicionar upgrade",
  "Your upgrades": "Seus upgrades",
  "Only with {service}": "Só com {service}",
  "a removed service": "um serviço removido",
  "With any service": "Com qualquer serviço",
  "switched off": "desativado",
  "Switch off": "Desativar",
  "Switch on": "Ativar",
  "No upgrades yet. Without them no offer can be made, because every offer must add real extra time.": "Ainda não há upgrades. Sem eles nenhuma oferta é possível, porque toda oferta precisa somar tempo extra de verdade.",
  "Set up your request page": "Configure sua página de pedidos",
  "Pick the closest salon type. You will see its usual services and upgrades, enter your own prices, and can change everything later.": "Escolha o tipo de salão mais parecido com o seu. Você verá os serviços e upgrades mais comuns, informará seus próprios preços e poderá mudar tudo depois.",
  "Or add services one by one": "Ou adicione os serviços um por um",
  "Untick what you do not offer, adjust names and minutes, and enter your prices. Clients always pay exactly these prices.": "Desmarque o que você não oferece, ajuste nomes e minutos e informe seus preços. Os clientes sempre pagam exatamente esses preços.",
  "Offer": "Oferecer",
  "Extra care added to an offer so that it lasts at least {pct}% longer.": "Cuidados extras somados a uma oferta para que ela dure pelo menos {pct}% a mais.",
  "Quiet hours": "Horários tranquilos",
  "When do you usually have a free chair? You can add more times later.": "Quando você costuma ter uma vaga livre? Você pode adicionar mais horários depois.",
  "Days": "Dias",
  "From": "Das",
  "Until": "Até",
  "Create my request page": "Criar minha página de pedidos",
  "Text message": "SMS",
  "Details erased": "Dados apagados",
  "Hi {name}, your appointment at {salon} is confirmed: {date} at {time}. {what} ({length}) for {price}, your usual price. Reference {ref}.": "Oi, {name}! Seu horário em {salon} está confirmado: {date}, às {time}. {what} ({length}) por {price}, o seu preço de sempre. Referência {ref}.",
  "Hi {name}, this is {salon}. A place has opened up for {service}:": "Oi, {name}! Aqui é {salon}. Abriu uma vaga para {service}:",
  "Waitlist": "Lista de espera",
  "Waiting for you": "Aguardando você",
  "standard price": "preço normal",
  "Reference {ref}": "Referência {ref}",
  "Confirm": "Confirmar",
  "Decline": "Recusar",
  "Message for the client": "Mensagem para o cliente",
  "Copy message": "Copiar mensagem",
  "Reference {ref}, received {date}": "Referência {ref}, recebido em {date}",
  "Mark as contacted": "Marcar como contatado",
  "Visits to your page": "Visitas à sua página",
  "Saw upgraded times": "Viram horários com upgrade",
  "Sent a request": "Enviaram um pedido",
  "Last 30 days": "Últimos 30 dias",
  "{pct}% of the step before": "{pct}% da etapa anterior",
  "Joined the waitlist: {n}. Times no upgraded slot was free: {m}.": "Entraram na lista de espera: {n}. Vezes sem nenhum horário com upgrade livre: {m}.",
  "Add the services clients book": "Adicione os serviços que os clientes agendam",
  "Pick your salon type and enter your prices": "Escolha o tipo de salão e informe seus preços",
  "Add upgrades that add extra time": "Adicione upgrades que aumentem o tempo",
  "Mark the hours that are usually quiet": "Marque os horários que costumam ser tranquilos",
  "Share your link and put up the QR code": "Compartilhe seu link e deixe o QR code à vista",
  "Requests": "Pedidos",
  "Your request page:": "Sua página de pedidos:",
  "Get your request page ready": "Prepare sua página de pedidos",
  "Results so far": "Resultados até agora",
  "Requests received": "Pedidos recebidos",
  "Discount given": "Descontos concedidos",
  "No requests waiting.": "Nenhum pedido aguardando.",
  "Share your link where clients find you fully booked.": "Compartilhe seu link onde os clientes veem que sua agenda está lotada.",
  "Finish the steps above, then share your link.": "Conclua as etapas acima e depois compartilhe seu link.",
  "Coming up": "Próximos horários",
  "Confirmed appointments from your request page appear here and in your calendar feed (see Settings).": "Os horários confirmados pela sua página de pedidos aparecem aqui e na sua agenda assinada (veja Configurações).",
  "Recently answered": "Respondidos recentemente",
  "When": "Quando",
  "Client names and contact details are erased {days} days after each appointment. The numbers above keep counting.": "Os nomes e contatos dos clientes são apagados {days} dias após cada atendimento. Os números acima continuam contando.",
  "Your appointment at {salon}": "Seu horário em {salon}",
  "Confirmed. The client’s page now shows it as confirmed.": "Confirmado. A página do cliente já mostra o horário como confirmado.",
  "Declined. The client’s page now offers them another time.": "Recusado. A página do cliente agora oferece outro horário.",
  "Marked as contacted.": "Marcado como contatado.",
  "That time is already at capacity. Add free chairs in Quiet hours to confirm it, or decline it.": "Esse horário já está lotado. Adicione vagas livres em Horários tranquilos para confirmá-lo, ou recuse.",
  "That request was already answered.": "Esse pedido já foi respondido.",
  "Service added.": "Serviço adicionado.",
  "Service saved.": "Serviço salvo.",
  "Service hidden from clients.": "Serviço oculto para os clientes.",
  "Service is visible to clients again.": "O serviço está visível para os clientes de novo.",
  "Upgrade added.": "Upgrade adicionado.",
  "Upgrade saved.": "Upgrade salvo.",
  "Upgrade switched off.": "Upgrade desativado.",
  "Upgrade switched on.": "Upgrade ativado.",
  "Quiet hours added.": "Horários tranquilos adicionados.",
  "Quiet hours removed.": "Horários tranquilos removidos.",
  "Settings saved.": "Configurações salvas.",
  "Password changed. Other devices have been logged out.": "Senha alterada. Os outros dispositivos foram desconectados.",
  "Noted. You will hear from us when it opens.": "Anotado. Avisaremos quando estiver disponível.",
  "Your account is ready. A few short steps and your request page is live.": "Sua conta está pronta. Mais alguns passos rápidos e sua página de pedidos estará no ar.",
  "Your services, upgrades and quiet hours are set up. Your request page is live.": "Seus serviços, upgrades e horários tranquilos estão configurados. Sua página de pedidos está no ar.",
  "New calendar address created. The old one no longer works.": "Novo endereço de agenda criado. O antigo não funciona mais.",
  "Thank you! Your subscription becomes active as soon as the payment provider confirms it.": "Obrigado! Sua assinatura fica ativa assim que o provedor de pagamento confirmar.",
  "Welcome to the demo. Everything here is sample data you can change freely.": "Boas-vindas à demonstração. Tudo aqui são dados de exemplo que você pode mudar à vontade.",
  "Declined": "Recusado",
  "Expired": "Expirado",
  "Contacted": "Contatado",
  "Request": "Pedido",
  "Weekly view of your quiet hours": "Visão semanal dos seus horários tranquilos",
  "The times you usually have free chairs. Offers are placed only inside these hours, and never more at once than the chairs you list.": "Os horários em que você costuma ter vagas livres. As ofertas só entram nesses horários e nunca em número maior do que as vagas que você indicar.",
  "Add quiet hours": "Adicionar horários tranquilos",
  "Your quiet hours": "Seus horários tranquilos",
  "Day": "Dia",
  "Hours": "Horário",
  "Chairs": "Vagas",
  "Remove": "Remover",
  "No quiet hours yet. Start with the afternoons that are usually slow.": "Ainda não há horários tranquilos. Comece pelas tardes que costumam ser paradas.",
  "{n} chair": "{n} vaga",
  "{n} chairs": "{n} vagas",
  "Start free beta": "Comece o beta grátis",
  "Try the live demo": "Experimente a demonstração",
  "Turn “fully booked” into a booked client.": "Transforme “agenda lotada” em cliente agendado.",
  "When a client can’t get the time they wanted, {product} offers them a longer, upgraded appointment in your quiet hours, at your normal price. Your slow afternoons fill up and you never discount.": "Quando um cliente não consegue o horário que queria, o {product} oferece um atendimento mais longo, com upgrade, nos seus horários tranquilos, pelo seu preço normal. Suas tardes paradas se enchem e você nunca dá desconto.",
  "See how it works": "Veja como funciona",
  "Example: Saturday is fully booked when the client wanted 11:00. {product} offers Tuesday 13:30 instead: cut and finish plus deep conditioning, 60 minutes instead of 45, for the same {price}.": "Exemplo: o sábado está lotado e a cliente queria às 11:00. O {product} oferece terça às 13:30: corte e finalização com hidratação profunda, 60 minutos em vez de 45, pelos mesmos {price}.",
  "Fully booked": "Lotado",
  "Booked": "Reservado",
  "Wanted, but taken": "Desejado, mas ocupado",
  "Free": "Livre",
  "same {price}": "mesmo preço: {price}",
  "How it works": "Como funciona",
  "Share your link": "Compartilhe seu link",
  "Put it where clients find you full: the “fully booked” message on your booking page, your Instagram bio, your auto-reply, a QR code at the desk.": "Coloque onde os clientes veem que você está lotado: a mensagem de “agenda lotada” da sua página de agendamento, a bio do Instagram, a resposta automática, um QR code no balcão.",
  "The client picks an upgrade": "O cliente escolhe um upgrade",
  "They choose the service they wanted and see up to three upgraded times in your quiet hours, in their own language. No account, no app.": "Ele escolhe o serviço que queria e vê até três horários com upgrade nos seus horários tranquilos, no próprio idioma. Sem conta, sem aplicativo.",
  "You confirm": "Você confirma",
  "You get an email, confirm with one tap, and send the ready-made message by WhatsApp, text or email. Confirmed appointments appear in your calendar.": "Você recebe um e-mail, confirma com um toque e envia a mensagem pronta por WhatsApp, SMS ou e-mail. Os horários confirmados aparecem na sua agenda.",
  "Rules {product} never breaks": "Regras que o {product} nunca quebra",
  "Same price, every time": "Sempre o mesmo preço",
  "The client pays exactly your listed price. {product} cannot create a discount, and the database refuses one even if someone tries.": "O cliente paga exatamente o preço da sua tabela. O {product} não consegue criar descontos, e o banco de dados recusa qualquer um, mesmo que alguém tente.",
  "Noticeably more care": "Bem mais cuidado",
  "Every offer adds at least 30% more time, using upgrades you choose: a scalp massage, a treatment, a longer finish.": "Toda oferta soma pelo menos 30% a mais de tempo, com upgrades que você escolhe: uma massagem no couro cabeludo, um tratamento, uma finalização mais longa.",
  "Only in hours you choose": "Só nos horários que você escolher",
  "Offers land only in the quiet hours you set, and never more at once than you have free chairs.": "As ofertas só caem nos horários tranquilos que você definir, e nunca em número maior do que suas vagas livres.",
  "You stay in charge": "Você no controle",
  "Nothing is booked until you confirm it. Client details are deleted {days} days after the appointment.": "Nada é agendado até você confirmar. Os dados dos clientes são excluídos {days} dias após o atendimento.",
  "One account, three levels": "Uma conta, três níveis",
  "Start with one location. The next levels switch on as your business grows.": "Comece com uma unidade. Os próximos níveis são liberados conforme seu negócio cresce.",
  "Coming": "Em breve",
  "{product} turns “fully booked” into an upgraded booking in your quiet hours, at your normal price. Never a discount.": "O {product} transforma “agenda lotada” em agendamento com upgrade nos seus horários tranquilos, pelo seu preço normal. Nunca com desconto.",
  "Skip to content": "Pular para o conteúdo",
  "Privacy": "Privacidade",
  "Terms": "Termos",
  "Dashboard": "Painel",
  "Start free": "Comece grátis",
  "Requests by {product}": "Pedidos via {product}",
  "Log out": "Sair",
  "Share": "Compartilhar",
  "Plan": "Plano",
  "Settings": "Configurações",
  "Please correct the highlighted field.": "Corrija o campo destacado.",
  "Please correct the {n} highlighted fields.": "Corrija os {n} campos destacados.",
  "Fully booked when you wanted to come in? Choose your service and we will offer you a calmer time with extra care included, at the same price.": "Lotado no horário que você queria? Escolha seu serviço e ofereceremos um horário mais tranquilo, com cuidados extras incluídos, pelo mesmo preço.",
  "Prices are the salon’s standard prices. Upgraded appointments never cost more, or less.": "Os preços são os preços normais do salão. Horários com upgrade nunca custam mais, nem menos.",
  "{salon} is not taking requests through this page yet.": "{salon} ainda não recebe pedidos por esta página.",
  "Request an appointment": "Pedir um horário",
  "{salon} uses this to confirm your appointment. Please include the country code with a phone number, for example +44.": "{salon} usa isso para confirmar seu horário. Se informar um telefone, inclua o código do país, por exemplo +55.",
  "Leave this field empty": "Deixe este campo vazio",
  "Privacy notice": "Aviso de privacidade",
  "Pick your appointment": "Escolha seu horário",
  "{service} with extra time added, at the usual price of {price}.": "{service} com tempo extra, pelo preço normal de {price}.",
  "Available upgraded times": "Horários com upgrade disponíveis",
  "your usual price": "seu preço de sempre",
  "Nothing is booked yet: {salon} confirms your request personally.": "Nada está agendado ainda: {salon} confirma seu pedido pessoalmente.",
  "Leave your details": "Deixe seus dados",
  "No upgraded time is free right now": "Nenhum horário com upgrade livre no momento",
  "{salon} is not offering upgraded times online at the moment. Leave your details for {service} and they will get back to you.": "{salon} não está oferecendo horários com upgrade on-line no momento. Deixe seus dados para {service} e o salão vai retornar.",
  "Leave your details for {service} and {salon} will get back to you when a place opens.": "Deixe seus dados para {service} e {salon} vai retornar quando abrir uma vaga.",
  "When suits you?": "Qual horário é bom para você?",
  "(optional)": "(opcional)",
  "Join the waitlist": "Entrar na lista de espera",
  "{salon} will confirm it personally. Keep this page: it shows the answer as soon as they reply.": "{salon} vai confirmá-lo pessoalmente. Guarde esta página: ela mostra a resposta assim que chegar.",
  "See you on {date} at {time}.": "Até {date}, às {time}.",
  "{salon} could not confirm this time. You are welcome to choose another one.": "{salon} não conseguiu confirmar este horário. Fique à vontade para escolher outro.",
  "This request was not confirmed before its time passed.": "Este pedido não foi confirmado antes do horário.",
  "{salon} has picked up your request.": "{salon} já cuidou do seu pedido.",
  "This waitlist request has expired.": "Este pedido na lista de espera expirou.",
  "This waitlist request was closed.": "Este pedido na lista de espera foi encerrado.",
  "Included": "Incluído",
  "the standard price": "o preço normal",
  "the operator of {product}": "o responsável pelo {product}",
  "What happens to your details when you use {product}.": "O que acontece com seus dados quando você usa o {product}.",
  "If you send a request to a salon": "Se você enviar um pedido a um salão",
  "The salon you write to decides what happens with your request; {product} only processes it on the salon’s behalf. We store your name, the phone number or email you give, the service and time you chose, the language you used, and the moment you agreed to be contacted.": "O salão para quem você escreve decide o que acontece com seu pedido; o {product} só o processa em nome do salão. Guardamos seu nome, o telefone ou e-mail informado, o serviço e o horário escolhidos, o idioma usado e o momento em que você concordou em ser contatado.",
  "Your details are used only to answer that request, including emails about it if you gave an email address. They are deleted {days} days after the appointment date (or {days} days after a waitlist request). What remains is anonymous: the service, the time and the price, for the salon’s statistics.": "Seus dados são usados apenas para responder a esse pedido, inclusive por e-mail se você informou um endereço de e-mail. Eles são excluídos {days} dias após a data do atendimento (ou {days} dias após um pedido na lista de espera). O que fica é anônimo: o serviço, o horário e o preço, para as estatísticas do salão.",
  "Pages for clients set no cookies and load nothing from other websites. Visits are counted per day without any personal data. There is no tracking and no advertising.": "As páginas para clientes não usam cookies e não carregam nada de outros sites. As visitas são contadas por dia, sem nenhum dado pessoal. Não há rastreamento nem publicidade.",
  "If you run a salon account": "Se você tem uma conta de salão",
  "We store your email, a protected form of your password (never the password itself), your salon’s settings and the requests you receive. One cookie keeps you logged in. Email is sent through the provider this installation is configured with. Payments, if switched on, are handled entirely by the payment provider; this site never sees card details. You can delete your account and all of its data at any time from Settings.": "Guardamos seu e-mail, uma forma protegida da sua senha (nunca a senha em si), as configurações do seu salão e os pedidos que você recebe. Um cookie mantém você conectado. Os e-mails são enviados pelo provedor configurado nesta instalação. Os pagamentos, se ativados, são processados inteiramente pelo provedor de pagamento; este site nunca vê dados de cartão. Você pode excluir sua conta e todos os dados dela a qualquer momento em Configurações.",
  "Your rights": "Seus direitos",
  "You can ask for a copy of your details, for corrections, or for deletion. For a request you sent to a salon, contact that salon directly; for anything else, contact {operator}.": "Você pode pedir uma cópia dos seus dados, a correção ou a exclusão deles. Para um pedido enviado a um salão, fale direto com esse salão; para todo o resto, fale com {operator}.",
  "Terms of use": "Termos de uso",
  "Legal notice": "Informações legais",
  "What you get": "O que você recebe",
  "A free trial, then a monthly subscription you can cancel at any time. Prices are shown before you subscribe. Payments and invoices are handled by our payment provider.": "Um teste grátis e depois uma assinatura mensal que você pode cancelar quando quiser. Os preços aparecem antes de você assinar. Pagamentos e faturas ficam a cargo do nosso provedor de pagamento.",
  "Free use of the Reflow level while the beta runs. Features may change. If paid plans are introduced, you will be told in advance and nothing will be charged without your explicit agreement.": "Uso grátis do nível Reflow enquanto durar o beta. Os recursos podem mudar. Se planos pagos forem lançados, você será avisado com antecedência e nada será cobrado sem a sua concordância explícita.",
  "What we ask": "O que pedimos",
  "Use your request page only for your own business and only for real appointments. You are responsible for honouring the appointments you confirm and for treating your clients’ details with care.": "Use sua página de pedidos só para o seu próprio negócio e só para atendimentos reais. Você é responsável por cumprir os horários que confirma e por tratar os dados dos seus clientes com cuidado.",
  "No warranty": "Sem garantia",
  "The service is provided as is. Keep your own booking system as the record of your appointments.": "O serviço é fornecido como está. Mantenha seu próprio sistema de agendamento como registro dos seus horários.",
  "Ending": "Encerramento",
  "You can delete your account at any time from Settings; your data is deleted with it.": "Você pode excluir sua conta a qualquer momento em Configurações; seus dados são excluídos junto.",
  "Go to the home page": "Ir para a página inicial",
  "Handled": "Atendido",
  "Closed": "Encerrado",
  "That did not work": "Não deu certo",
  "Not allowed": "Não permitido",
  "Page not found": "Página não encontrada",
  "Already changed": "Já alterado",
  "Too large": "Grande demais",
  "Form not readable": "Formulário ilegível",
  "Too many attempts": "Tentativas demais",
  "Something went wrong": "Algo deu errado",
  "{salon} may contact me about this request. My details are deleted {days} days after the appointment. {privacy}": "{salon} pode entrar em contato comigo sobre este pedido. Meus dados são excluídos {days} dias após o atendimento. {privacy}",
  "You can ask for a copy of your details, for corrections, or for deletion. For a request you sent to a salon, contact that salon directly; for anything else, contact {operator} at {email}.": "Você pode pedir uma cópia dos seus dados, a correção ou a exclusão deles. Para um pedido enviado a um salão, fale direto com esse salão; para todo o resto, fale com {operator} pelo e-mail {email}.",
  "Logged in as {email}": "Conectado como {email}",
  "Salon": "Salão",
  "Shown to clients on their confirmation.": "Mostrado aos clientes na confirmação.",
  "Page address": "Endereço da página",
  "Lowercase letters, numbers and dashes. Links you already shared stop working if you change it.": "Letras minúsculas, números e hífens. Se você mudar, os links já compartilhados param de funcionar.",
  "Language of your request page": "Idioma da sua página de pedidos",
  "Clients can switch to another language on the page.": "Os clientes podem trocar de idioma na página.",
  "Minimum extra time (%)": "Tempo extra mínimo (%)",
  "At least {pct}%. Raise it if you want offers to feel even more generous.": "Pelo menos {pct}%. Aumente se quiser que as ofertas pareçam ainda mais generosas.",
  "Minimum notice": "Antecedência mínima",
  "How soon an offered time can start, so you have time to confirm.": "Com quanta antecedência mínima um horário oferecido pode começar, para você ter tempo de confirmar.",
  "Save settings": "Salvar configurações",
  "You": "Sua conta",
  "Language of your dashboard and emails": "Idioma do seu painel e dos seus e-mails",
  "Email notifications": "Notificações por e-mail",
  "Email me when a client sends a request": "Enviar um e-mail quando um cliente fizer um pedido",
  "Email sending is not set up on this installation yet, so no emails go out for now.": "O envio de e-mails ainda não está configurado nesta instalação, então por enquanto nenhum e-mail é enviado.",
  "Save": "Salvar",
  "Calendar": "Agenda",
  "Subscribe to this address in Google Calendar, Apple Calendar or Outlook, and every appointment you confirm appears there by itself. Keep the address private: it shows your clients’ names.": "Assine este endereço no Google Agenda, no Calendário da Apple ou no Outlook, e cada horário que você confirmar aparece lá automaticamente. Mantenha o endereço privado: ele mostra o nome dos seus clientes.",
  "Copy address": "Copiar endereço",
  "Create a new address (the old one stops working)": "Criar um novo endereço (o antigo para de funcionar)",
  "Create calendar address": "Criar endereço da agenda",
  "Export": "Exportar",
  "All requests as a spreadsheet file (CSV), for your records or another tool.": "Todos os pedidos em um arquivo de planilha (CSV), para seus registros ou outra ferramenta.",
  "Download requests (CSV)": "Baixar pedidos (CSV)",
  "Current password": "Senha atual",
  "Change password": "Alterar senha",
  "Audit log": "Registro de auditoria",
  "Every offer, confirmation and price change is recorded in a tamper-evident log.": "Cada oferta, confirmação e mudança de preço fica registrada em um registro à prova de adulteração.",
  "Check the audit log": "Verificar o registro de auditoria",
  "Delete account": "Excluir conta",
  "Deletes your salon, services, requests and client details permanently. This cannot be undone.": "Exclui para sempre seu salão, serviços, pedidos e dados de clientes. Não dá para desfazer.",
  "Your password": "Sua senha",
  "Delete account and all data": "Excluir conta e todos os dados",
  "One account, three levels.": "Uma conta, três níveis.",
  "Subscription": "Assinatura",
  "Subscribe: {price}": "Assinar: {price}",
  "Subscribe": "Assinar",
  "Manage subscription and invoices": "Gerenciar assinatura e faturas",
  "You are on Reflow, free during the beta.": "Você está no Reflow, grátis durante o beta.",
  "Your plan": "Seu plano",
  "On the list": "Na lista",
  "We will tell you when it opens": "Avisaremos quando estiver disponível",
  "Tell me when {plan} opens": "Avise-me quando o {plan} estiver disponível",
  "Page address {slug}, {timezone}, {currency}": "Endereço da página {slug}, {timezone}, {currency}",
  "at least {pct}% extra time": "pelo menos {pct}% de tempo extra",
  "Service {id} shown to clients": "Serviço {id} visível para os clientes",
  "Service {id} hidden from clients": "Serviço {id} oculto para os clientes",
  "was {price}": "antes {price}",
  "Upgrade {id} switched on": "Upgrade {id} ativado",
  "Upgrade {id} switched off": "Upgrade {id} desativado",
  "Each entry carries the fingerprint of the one before it, so a changed or deleted entry breaks the chain.": "Cada registro carrega a impressão digital do anterior, então um registro alterado ou excluído quebra a corrente.",
  "Chain broken at entry {id}. An entry was changed or removed outside the app.": "Corrente quebrada no registro {id}. Um registro foi alterado ou removido fora do aplicativo.",
  "Latest fingerprint:": "Impressão digital mais recente:",
  "Free trial until {date}.": "Teste grátis até {date}.",
  "Your subscription is active.": "Sua assinatura está ativa.",
  "Your last payment did not go through. Please update your payment method to keep your request page running.": "Seu último pagamento não foi aprovado. Atualize sua forma de pagamento para manter sua página de pedidos funcionando.",
  "Your subscription is cancelled. Upgraded offers keep running until {date}.": "Sua assinatura foi cancelada. As ofertas com upgrade continuam até {date}.",
  "Your subscription is paused. Clients can join your waitlist, but see no upgraded times.": "Sua assinatura está pausada. Os clientes podem entrar na sua lista de espera, mas não veem horários com upgrade.",
  "Your subscription is not active. Clients can join your waitlist, but see no upgraded times.": "Sua assinatura não está ativa. Os clientes podem entrar na sua lista de espera, mas não veem horários com upgrade.",
  "Account created": "Conta criada",
  "Settings changed": "Configurações alteradas",
  "Service added": "Serviço adicionado",
  "Service changed": "Serviço alterado",
  "Upgrade added": "Upgrade adicionado",
  "Upgrade changed": "Upgrade alterado",
  "Quiet hours added": "Horários tranquilos adicionados",
  "Quiet hours removed": "Horários tranquilos removidos",
  "Offer requested": "Oferta pedida",
  "Waitlist request": "Pedido na lista de espera",
  "Request confirmed": "Pedido confirmado",
  "Request declined": "Pedido recusado",
  "Waitlist request handled": "Pedido na lista de espera atendido",
  "Subscription changed": "Assinatura alterada",
  "Free beta": "Beta grátis",
  "Free trial": "Teste grátis",
  "{days}-day free trial": "Teste grátis de {days} dias",
  "Monthly subscription": "Assinatura mensal",
  "Active": "Ativa",
  "Payment overdue": "Pagamento em atraso",
  "Cancelled": "Cancelada",
  "Paused": "Pausada",
  "Ended": "Encerrada",
  "{n} service": "{n} serviço",
  "{n} services": "{n} serviços",
  "{n} upgrade": "{n} upgrade",
  "{n} upgrades": "{n} upgrades",
  "Chain intact: {n} entry checked, none changed.": "Corrente intacta: {n} registro verificado, nenhum alterado.",
  "Chain intact: {n} entries checked, none changed.": "Corrente intacta: {n} registros verificados, nenhum alterado.",
  "Booking page, “fully booked” message": "Página de agendamento, mensagem de “agenda lotada”",
  "Fully booked at the time you wanted? Get a longer, upgraded appointment at the same price: {url}": "Lotado no horário que você queria? Garanta um horário mais longo, com upgrade, pelo mesmo preço: {url}",
  "Instagram or Facebook bio": "Bio do Instagram ou Facebook",
  "Fully booked? Upgraded appointments, same price: {url}": "Lotado? Horários com upgrade, mesmo preço: {url}",
  "Auto-reply for messages": "Resposta automática de mensagens",
  "Thanks for your message! If we’re fully booked when you’d like to come, {salon} can offer you a calmer time with extra care included, at the same price. Pick one here: {url}": "Obrigado pela mensagem! Se estivermos lotados quando você quiser vir, {salon} pode oferecer um horário mais tranquilo, com cuidados extras incluídos, pelo mesmo preço. Escolha aqui: {url}",
  "Fully booked? See upgraded times": "Lotado? Veja horários com upgrade",
  "Put your link wherever clients find you fully booked. Texts below are in the language of your request page: {language}.": "Coloque seu link onde os clientes veem que você está lotado. Os textos abaixo estão no idioma da sua página de pedidos: {language}.",
  "Your link": "Seu link",
  "Copy link": "Copiar link",
  "Open page": "Abrir página",
  "Texts to copy": "Textos para copiar",
  "Copy text": "Copiar texto",
  "QR code for the desk and the window": "QR code para o balcão e a vitrine",
  "QR code that opens your request page": "QR code que abre sua página de pedidos",
  "Print the poster for your reception desk or window, or put the QR code on your price list.": "Imprima o cartaz para a recepção ou a vitrine, ou coloque o QR code na sua tabela de preços.",
  "Open printable poster": "Abrir cartaz para impressão",
  "Download QR code": "Baixar QR code",
  "Button for your website": "Botão para o seu site",
  "Paste this code into your website where clients see that you are fully booked.": "Cole este código no seu site, onde os clientes veem que você está lotado.",
  "Copy code": "Copiar código",
  "Fully booked?": "Lotado?",
  "Scan for a longer, upgraded appointment in a calmer hour, at the same price.": "Escaneie para um horário mais longo, com upgrade, em um momento mais tranquilo, pelo mesmo preço.",
  "Print poster": "Imprimir cartaz",
  "Back": "Voltar",
  "Appointment canceled": "Agendamento cancelado",
  "Join the salon team": "Entrar na equipe do salão",
  "Verify your email": "Verifique seu e-mail",
  "This private link expires in 24 hours. If you did not request it, ignore this email.": "Este link privado expira em 24 horas. Se você não o solicitou, ignore este e-mail.",
  "Appointment reminder": "Lembrete de agendamento",
  "Handle future appointments before changing the time zone.": "Resolva os agendamentos futuros antes de alterar o fuso horário.",
  "Only the owner can change these settings.": "Somente o proprietário pode alterar estas configurações.",
  "End your paid subscription before deleting the account.": "Encerre sua assinatura paga antes de excluir a conta.",
  "Completed": "Concluído",
  "No-show": "Não compareceu",
  "Canceled": "Cancelado",
  "All": "Todos",
  "Appointments": "Agendamentos",
  "Block time": "Bloquear horário",
  "Search": "Buscar",
  "No appointments found.": "Nenhum agendamento encontrado.",
  "Mark completed": "Marcar como concluído",
  "Cancel this appointment?": "Cancelar este agendamento?",
  "Cancel appointment": "Cancelar agendamento",
  "Previous": "Anterior",
  "Next": "Próximo",
  "Availability": "Disponibilidade",
  "Block holidays, breaks and appointments from your other booking system.": "Bloqueie férias, pausas e agendamentos do seu outro sistema de reservas.",
  "Close the whole day": "Fechar o dia inteiro",
  "No blocked times.": "Nenhum horário bloqueado.",
  "This block overlaps a reservation. Handle the reservation first.": "Este bloqueio coincide com uma reserva. Resolva a reserva primeiro.",
  "Change appointment": "Alterar agendamento",
  "Your current appointment stays reserved until you choose a new time. The salon must confirm the change.": "Seu agendamento atual permanece reservado até você escolher um novo horário. O salão deve confirmar a alteração.",
  "Cancellation notice (minutes)": "Antecedência para cancelar (minutos)",
  "Request hold (hours)": "Duração da reserva provisória (horas)",
  "Please contact the salon to change this appointment.": "Entre em contato com o salão para alterar este agendamento.",
  "Team": "Equipe",
  "Staff can manage appointments and blocked times. Billing, exports and business settings stay with the owner.": "A equipe pode gerenciar agendamentos e horários bloqueados. Cobrança, exportações e configurações do negócio ficam com o proprietário.",
  "Invitation ready. Send this private link to your colleague.": "Convite pronto. Envie este link privado ao seu colega.",
  "Invitation link": "Link do convite",
  "Invite a colleague": "Convidar um colega",
  "Owner": "Proprietário",
  "Staff": "Equipe",
  "Remove this colleague?": "Remover este colega?",
  "Pending invitations": "Convites pendentes",
  "Check your inbox and confirm your email before opening your dashboard.": "Confira sua caixa de entrada e confirme seu e-mail antes de abrir o painel.",
  "Check your inbox.": "Confira sua caixa de entrada.",
  "Resend email": "Reenviar e-mail",
  "My account": "Minha conta",
  "This action is not available in the demo.": "Esta ação não está disponível na demonstração.",
  "This email is already registered or the team is full.": "Este e-mail já está cadastrado ou a equipe está completa.",
  "Booked value": "Valor reservado",
  "Booked value is not collected revenue. Mark completed services in Appointments.": "O valor reservado não representa receita recebida. Marque os serviços concluídos em Agendamentos.",
  "Completed service value": "Valor dos serviços concluídos",
  "Request hold: {hours} hours. Changes and cancellations close {minutes} minutes before the appointment.": "Reserva provisória: {hours} horas. Alterações e cancelamentos encerram {minutes} minutos antes do agendamento.",
  "Booking policy": "Política de agendamento",
  "Unanswered requests release their reserved time when the hold expires.": "Solicitações sem resposta liberam o horário reservado quando a reserva provisória expira."
};
return { default: __default };
})();

// src/i18n/nl.js
const __m17 = (() => {
// Copyright (c) 2026 Miloš Petrović (Trench Logic Studio) · SPDX-License-Identifier: MIT
// Translations are checked for completeness and placeholder parity.
const __default = {
  "There is nothing at this address.": "Er is niets op dit adres.",
  "That action is not available here.": "Deze actie is hier niet beschikbaar.",
  "This form was sent from another website, so it was blocked. Open the page again and resend it.": "Dit formulier is vanaf een andere website verstuurd en daarom geblokkeerd. Open de pagina opnieuw en verstuur het nog een keer.",
  "12 Example Street": "Voorbeeldstraat 12",
  "Any weekday after 17:00": "Doordeweeks na 17:00",
  "This form could not be read. Please reload the page and try again.": "Dit formulier kon niet worden gelezen. Laad de pagina opnieuw en probeer het nog eens.",
  "That form is too large.": "Dit formulier is te groot.",
  "Send request": "Aanvraag versturen",
  "{m} min": "{m} min",
  "{h} h {m} min": "{h} u {m} min",
  "{h} h": "{h} u",
  "{total} instead of {base}": "{total} in plaats van {base}",
  "Price: {price}, the standard price": "Prijs: {price}, de normale prijs",
  "Reference: {ref}": "Referentie: {ref}",
  "New request: {when}": "Nieuwe aanvraag: {when}",
  "A client asked for an upgraded appointment through your request page.": "Een klant heeft via je aanvraagpagina een afspraak met upgrade aangevraagd.",
  "Client: {contact}": "Klant: {contact}",
  "Confirm or decline": "Bevestigen of afwijzen",
  "You receive these emails because notifications are on in Settings.": "Je ontvangt deze e-mails omdat meldingen aanstaan in Instellingen.",
  "New waitlist request: {service}": "Nieuwe aanmelding voor de wachtlijst: {service}",
  "A client joined your waitlist.": "Een klant heeft zich aangemeld voor je wachtlijst.",
  "Note: “{note}”": "Notitie: “{note}”",
  "Open your dashboard": "Je dashboard openen",
  "You receive this email because you sent a request to {salon}. Your details are deleted {days} days after the appointment.": "Je ontvangt deze e-mail omdat je een aanvraag naar {salon} hebt gestuurd. Je gegevens worden {days} dagen na de afspraak verwijderd.",
  "Your request at {salon}": "Je aanvraag bij {salon}",
  "Request sent": "Aanvraag verstuurd",
  "{salon} has your request and will confirm it personally.": "{salon} heeft je aanvraag ontvangen en bevestigt die persoonlijk.",
  "See your request": "Je aanvraag bekijken",
  "You are on the waitlist at {salon}": "Je staat op de wachtlijst bij {salon}",
  "You are on the waitlist": "Je staat op de wachtlijst",
  "{salon} will contact you when a place opens.": "{salon} neemt contact met je op zodra er een plek vrijkomt.",
  "Address: {address}": "Adres: {address}",
  "Phone: {phone}": "Telefoon: {phone}",
  "Confirmed: {when} at {salon}": "Bevestigd: {when} bij {salon}",
  "Confirmed": "Bevestigd",
  "{salon} has confirmed your appointment.": "{salon} heeft je afspraak bevestigd.",
  "Add to calendar": "Toevoegen aan agenda",
  "{salon} could not confirm your request": "{salon} kon je aanvraag niet bevestigen",
  "Not available": "Niet beschikbaar",
  "{salon} could not confirm the time you chose. You are welcome to pick another one.": "{salon} kon het gekozen tijdstip niet bevestigen. Kies gerust een ander.",
  "Choose another time": "Een ander tijdstip kiezen",
  "Reset your password": "Wachtwoord opnieuw instellen",
  "Someone asked to reset the password for your account. If it was you, choose a new password with the link below. It works once, for {hours} hours.": "Iemand heeft gevraagd om het wachtwoord van je account opnieuw in te stellen. Was jij dat, kies dan via de link hieronder een nieuw wachtwoord. De link werkt één keer, {hours} uur lang.",
  "If it was not you, ignore this email: nothing changes.": "Was jij het niet? Negeer deze e-mail dan: er verandert niets.",
  "Choose a new password": "Een nieuw wachtwoord kiezen",
  "One location": "Eén vestiging",
  "When a client finds you fully booked, offer an upgraded appointment in a quieter hour, at exactly the same price.": "Ben je volgeboekt als een klant wil komen? Bied dan een afspraak met upgrade aan op een rustiger moment, voor precies dezelfde prijs.",
  "Your own request page to share anywhere": "Je eigen aanvraagpagina om overal te delen",
  "Upgrades you define, at least +30% more time": "Upgrades die je zelf bepaalt, minstens +30% meer tijd",
  "Never a discount, enforced by the system": "Nooit korting, afgedwongen door het systeem",
  "You confirm every request yourself": "Je bevestigt elke aanvraag zelf",
  "Free during beta": "Gratis tijdens de bèta",
  "Several locations": "Meerdere vestigingen",
  "When one location is full, route the client to your location or sister brand that has room, at the same price.": "Zit één vestiging vol, stuur de klant dan door naar je vestiging of zustermerk met plek, voor dezelfde prijs.",
  "Everything in Reflow": "Alles uit Reflow",
  "Overflow routed between your locations": "Overloop verdeeld over je vestigingen",
  "One view across all locations": "Eén overzicht van alle vestigingen",
  "Opens with the first multi-location salon": "Start met de eerste salon met meerdere vestigingen",
  "Partner network": "Partnernetwerk",
  "Share overflow with trusted partner businesses. Priority is earned through reliability, never bought.": "Deel overloop met betrouwbare partnerbedrijven. Voorrang verdien je met betrouwbaarheid, je koopt het nooit.",
  "Everything in Relay": "Alles uit Relay",
  "Overflow shared with partner businesses": "Overloop gedeeld met partnerbedrijven",
  "Trust-based priority": "Voorrang op basis van vertrouwen",
  "Later": "Later",
  "This page does not exist.": "Deze pagina bestaat niet.",
  "That user does not exist.": "Deze gebruiker bestaat niet.",
  "Create your own account": "Maak je eigen account aan",
  "See your plan": "Bekijk je pakket",
  "Enter a price such as 40 or 40.50.": "Vul een prijs in zoals 40 of 40,50.",
  "You can have up to {n} services.": "Je kunt maximaal {n} behandelingen hebben.",
  "Choose a service from the list.": "Kies een behandeling uit de lijst.",
  "You can have up to {n} upgrades.": "Je kunt maximaal {n} upgrades hebben.",
  "Choose at least one day.": "Kies minstens één dag.",
  "Choose days from the list.": "Kies dagen uit de lijst.",
  "Enter a start time such as 13:00.": "Vul een begintijd in zoals 13:00.",
  "Enter an end time such as 16:00.": "Vul een eindtijd in zoals 16:00.",
  "Quiet hours must last at least 30 minutes.": "Rustige uren moeten minstens 30 minuten duren.",
  "Check the name, minutes and price of this service.": "Controleer de naam, minuten en prijs van deze behandeling.",
  "Check the name and minutes of this upgrade.": "Controleer de naam en minuten van deze upgrade.",
  "Choose at least one service.": "Kies minstens één behandeling.",
  "You can have up to {n} quiet-hour entries.": "Je kunt maximaal {n} blokken met rustige uren hebben.",
  "Enter a phone number such as +44 20 7946 0000.": "Vul een telefoonnummer in zoals +31 20 123 4567.",
  "Use 2 to 40 lowercase letters, numbers or dashes, starting and ending with a letter or number.": "Gebruik 2 tot 40 kleine letters, cijfers of streepjes, beginnend en eindigend met een letter of cijfer.",
  "Choose your time zone.": "Kies je tijdzone.",
  "That address is already taken. Try another one.": "Dat adres is al in gebruik. Probeer een ander.",
  "The demo account has no password to change.": "Het demoaccount heeft geen wachtwoord om te wijzigen.",
  "That is not your current password.": "Dat is niet je huidige wachtwoord.",
  "That is not your password.": "Dat is niet je wachtwoord.",
  "Reference": "Referentie",
  "Type": "Soort",
  "Status": "Status",
  "Service": "Behandeling",
  "Upgrades": "Upgrades",
  "Date": "Datum",
  "Start": "Begin",
  "End": "Einde",
  "Minutes": "Minuten",
  "Price": "Prijs",
  "Standard price": "Normale prijs",
  "Currency": "Valuta",
  "Client": "Klant",
  "Contact": "Contact",
  "Note": "Notitie",
  "Language": "Taal",
  "Received": "Ontvangen",
  "Answered": "Beantwoord",
  "This is a demo salon: it and its sample data are deleted within 24 hours. {signup} to keep a salon of your own.": "Dit is een demosalon: de salon en de voorbeeldgegevens worden binnen 24 uur verwijderd. {signup} om een eigen salon te houden.",
  "Your request page shows only the waitlist until you subscribe. {plan}": "Je aanvraagpagina toont alleen de wachtlijst tot je een abonnement neemt. {plan}",
  "Your free trial ends on {date}. {plan}": "Je gratis proefperiode eindigt op {date}. {plan}",
  "Name": "Naam",
  "Length": "Duur",
  "Extra minutes": "Extra minuten",
  "Free chairs": "Vrije plekken",
  "Salon name": "Naam van de salon",
  "Address": "Adres",
  "Phone": "Telefoon",
  "Minimum extra time": "Minimale extra tijd",
  "New password": "Nieuw wachtwoord",
  "Choose a valid currency.": "Kies een geldige valuta.",
  "Choose a language from the list.": "Kies een taal uit de lijst.",
  "Choose a notice period from the list.": "Kies een termijn uit de lijst.",
  "That request does not exist.": "Deze aanvraag bestaat niet.",
  "That action does not apply to this request.": "Deze actie past niet bij deze aanvraag.",
  "That service does not exist.": "Deze behandeling bestaat niet.",
  "Unknown action.": "Onbekende actie.",
  "That upgrade does not exist.": "Deze upgrade bestaat niet.",
  "Unknown salon type.": "Onbekend type salon.",
  "Unknown level.": "Onbekend niveau.",
  "Too many sign-ups from here in the last hour. Please try again later.": "Te veel aanmeldingen vanaf hier in het afgelopen uur. Probeer het later nog eens.",
  "Please accept the terms of use to continue.": "Ga akkoord met de gebruiksvoorwaarden om verder te gaan.",
  "Please accept the beta terms to continue.": "Ga akkoord met de bètavoorwaarden om verder te gaan.",
  "An account with this email already exists. Log in instead.": "Er bestaat al een account met dit e-mailadres. Log in plaats daarvan in.",
  "Too many attempts. Wait 15 minutes, then try again.": "Te veel pogingen. Wacht 15 minuten en probeer het dan opnieuw.",
  "Enter your email.": "Vul je e-mailadres in.",
  "Enter your password.": "Vul je wachtwoord in.",
  "Email or password is incorrect.": "E-mailadres of wachtwoord is onjuist.",
  "Password saved. Log in with your new password.": "Wachtwoord opgeslagen. Log in met je nieuwe wachtwoord.",
  "Your account and all of its data have been deleted.": "Je account en alle bijbehorende gegevens zijn verwijderd.",
  "Could not create the account. Please try again.": "Het account kon niet worden aangemaakt. Probeer het opnieuw.",
  "Too many attempts. Please try again in an hour.": "Te veel pogingen. Probeer het over een uur opnieuw.",
  "Too many demos were started from here. Please try again in an hour.": "Er zijn vanaf hier te veel demo's gestart. Probeer het over een uur opnieuw.",
  "The demo is very busy right now. Please try again in a few minutes.": "De demo is nu erg druk. Probeer het over een paar minuten opnieuw.",
  "Enter a phone number or an email address.": "Vul een telefoonnummer of e-mailadres in.",
  "Please agree, so the salon can contact you about this request.": "Geef toestemming, zodat de salon contact met je kan opnemen over deze aanvraag.",
  "Choose one of the times.": "Kies een van de tijden.",
  "That time was just taken or has changed. Here is what is free now.": "Dat tijdstip is net vergeven of gewijzigd. Dit is nu vrij.",
  "Your name": "Je naam",
  "Phone or email": "Telefoon of e-mail",
  "Your note": "Je notitie",
  "There is no salon at this address. Check the link you were given.": "Er is geen salon op dit adres. Controleer de link die je hebt gekregen.",
  "Too many requests were sent from here. Please try again in an hour, or contact the salon directly.": "Er zijn vanaf hier te veel aanvragen verstuurd. Probeer het over een uur opnieuw of neem rechtstreeks contact op met de salon.",
  "This request could not be sent. Please contact the salon directly.": "Deze aanvraag kon niet worden verstuurd. Neem rechtstreeks contact op met de salon.",
  "This request link is not valid.": "Deze aanvraaglink is niet geldig.",
  "This appointment is not confirmed yet.": "Deze afspraak is nog niet bevestigd.",
  "That item does not exist.": "Dit item bestaat niet.",
  "Hair salon": "Kapsalon",
  "Cut & finish": "Knippen & föhnen",
  "Blow-dry & style": "Föhnen & stylen",
  "Colour refresh": "Kleur opfrissen",
  "Highlights": "Highlights",
  "Deep conditioning treatment": "Intensieve haarkuur",
  "Scalp massage": "Hoofdhuidmassage",
  "Gloss treatment": "Glossbehandeling",
  "Extended styling": "Uitgebreid stylen",
  "Barbershop": "Barbershop",
  "Haircut": "Knippen",
  "Beard trim": "Baard trimmen",
  "Haircut & beard": "Knippen & baard",
  "Hot towel shave": "Scheren met hete handdoek",
  "Hot towel treatment": "Hete handdoek",
  "Beard oil treatment": "Baardoliebehandeling",
  "Face mask": "Gezichtsmasker",
  "Nail studio": "Nagelstudio",
  "Gel manicure": "Gelmanicure",
  "Classic manicure": "Klassieke manicure",
  "Pedicure": "Pedicure",
  "Gel pedicure": "Gelpedicure",
  "Hand massage": "Handmassage",
  "Paraffin treatment": "Paraffinebehandeling",
  "Cuticle care": "Nagelriemverzorging",
  "Nail art accent": "Nail-art-accent",
  "Beauty & spa": "Beauty & spa",
  "Classic facial": "Klassieke gezichtsbehandeling",
  "Relaxing massage": "Ontspanningsmassage",
  "Brow & lash tint": "Wenkbrauwen & wimpers verven",
  "Waxing": "Harsen",
  "Eye treatment": "Oogbehandeling",
  "Extended massage": "Verlengde massage",
  "{label} is required.": "Vul ‘{label}’ in.",
  "{label} is too short.": "‘{label}’ is te kort.",
  "{label} must be at most {max} characters.": "‘{label}’ mag maximaal {max} tekens bevatten.",
  "{label} must be a whole number.": "‘{label}’ moet een heel getal zijn.",
  "{label} must be between {min} and {max}.": "‘{label}’ moet tussen {min} en {max} liggen.",
  "{label} must be a multiple of {step}.": "‘{label}’ moet een veelvoud van {step} zijn.",
  "Email": "E-mail",
  "Enter a valid email address.": "Vul een geldig e-mailadres in.",
  "{label} must be at least 10 characters.": "‘{label}’ moet minstens 10 tekens bevatten.",
  "{label} is too long.": "‘{label}’ is te lang.",
  "Password": "Wachtwoord",
  "Choose a valid option.": "Kies een geldige optie.",
  "Start your free trial": "Start je gratis proefperiode",
  "Start your free beta": "Start je gratis bèta",
  "Set-up takes a few minutes: pick your salon type, enter your prices, and you have a page to share.": "Instellen duurt maar een paar minuten: kies je type salon, vul je prijzen in en je hebt een pagina om te delen.",
  "At least 10 characters.": "Minstens 10 tekens.",
  "Time zone": "Tijdzone",
  "terms of use": "gebruiksvoorwaarden",
  "beta terms": "bètavoorwaarden",
  "privacy notice": "privacyverklaring",
  "Create account": "Account aanmaken",
  "Already have an account?": "Heb je al een account?",
  "Log in": "Inloggen",
  "Forgot your password?": "Wachtwoord vergeten?",
  "New here?": "Nieuw hier?",
  "Contact the operator of this service for a reset link.": "Neem contact op met de beheerder van deze dienst voor een herstellink.",
  "If an account exists for that address, a reset link is on its way. It works once, for {hours} hours.": "Als er een account bestaat voor dat adres, is er een herstellink onderweg. De link werkt één keer, {hours} uur lang.",
  "Enter the email you signed up with. We will send you a link to choose a new password.": "Vul het e-mailadres in waarmee je je hebt aangemeld. We sturen je een link om een nieuw wachtwoord te kiezen.",
  "Send reset link": "Herstellink versturen",
  "Back to log in": "Terug naar inloggen",
  "This link has expired": "Deze link is verlopen",
  "Reset links work once and for {hours} hours. Ask for a new one.": "Herstellinks werken één keer en {hours} uur lang. Vraag een nieuwe aan.",
  "Ask for a new link": "Nieuwe link aanvragen",
  "For {email}. You will be logged out everywhere else.": "Voor {email}. Je wordt overal elders uitgelogd.",
  "Save new password": "Nieuw wachtwoord opslaan",
  "I accept the {terms} and the {privacy}.": "Ik ga akkoord met de {terms} en de {privacy}.",
  "Email us from the address you signed up with, and we will send you a reset link: {email}": "Mail ons vanaf het adres waarmee je je hebt aangemeld, dan sturen we je een herstellink: {email}",
  "Hidden from clients.": "Verborgen voor klanten.",
  "Not offered yet: needs upgrades worth at least {n} extra minutes.": "Nog niet aangeboden: er zijn upgrades nodig van samen minstens {n} extra minuten.",
  "Add upgrades": "Upgrades toevoegen",
  "Offered as {what}: {total} instead of {base}.": "Aangeboden als {what}: {total} in plaats van {base}.",
  "Length in minutes": "Duur in minuten",
  "Price ({currency})": "Prijs ({currency})",
  "Services": "Behandelingen",
  "What clients can request. The price here is the price clients pay, always.": "Wat klanten kunnen aanvragen. De prijs hier is altijd de prijs die klanten betalen.",
  "Set up from a template": "Instellen met een sjabloon",
  "Add a service": "Behandeling toevoegen",
  "Add service": "Behandeling toevoegen",
  "Your services": "Je behandelingen",
  "Edit": "Bewerken",
  "Save changes": "Wijzigingen opslaan",
  "Hide from clients": "Verbergen voor klanten",
  "Show to clients": "Tonen aan klanten",
  "No services yet. Start from a template, or add the ones clients most often find fully booked.": "Nog geen behandelingen. Begin met een sjabloon, of voeg de behandelingen toe waarvoor je het vaakst volgeboekt bent.",
  "Can be added to": "Toe te voegen aan",
  "All services": "Alle behandelingen",
  "Extra care you can give when a chair is free: a scalp massage, a treatment, a longer finish. Each offer combines the fewest upgrades needed to add at least {pct}% more time.": "Extra zorg die je kunt geven als er een plek vrij is: een hoofdhuidmassage, een behandeling, een langere afwerking. Elk aanbod combineert zo weinig mogelijk upgrades om minstens {pct}% meer tijd toe te voegen.",
  "Add an upgrade": "Upgrade toevoegen",
  "Add upgrade": "Upgrade toevoegen",
  "Your upgrades": "Je upgrades",
  "Only with {service}": "Alleen bij {service}",
  "a removed service": "een verwijderde behandeling",
  "With any service": "Bij elke behandeling",
  "switched off": "uitgeschakeld",
  "Switch off": "Uitschakelen",
  "Switch on": "Inschakelen",
  "No upgrades yet. Without them no offer can be made, because every offer must add real extra time.": "Nog geen upgrades. Zonder upgrades kan er geen aanbod worden gedaan, want elk aanbod moet echte extra tijd toevoegen.",
  "Set up your request page": "Je aanvraagpagina instellen",
  "Pick the closest salon type. You will see its usual services and upgrades, enter your own prices, and can change everything later.": "Kies het type salon dat het meest op het jouwe lijkt. Je ziet de gebruikelijke behandelingen en upgrades, vult je eigen prijzen in en kunt later alles wijzigen.",
  "Or add services one by one": "Of voeg behandelingen één voor één toe",
  "Untick what you do not offer, adjust names and minutes, and enter your prices. Clients always pay exactly these prices.": "Vink uit wat je niet aanbiedt, pas namen en minuten aan en vul je prijzen in. Klanten betalen altijd precies deze prijzen.",
  "Offer": "Aanbieden",
  "Extra care added to an offer so that it lasts at least {pct}% longer.": "Extra zorg die aan een aanbod wordt toegevoegd, zodat het minstens {pct}% langer duurt.",
  "Quiet hours": "Rustige uren",
  "When do you usually have a free chair? You can add more times later.": "Wanneer heb je meestal een plek vrij? Je kunt later meer tijden toevoegen.",
  "Days": "Dagen",
  "From": "Van",
  "Until": "Tot",
  "Create my request page": "Mijn aanvraagpagina maken",
  "Text message": "Sms",
  "Details erased": "Gegevens gewist",
  "Hi {name}, your appointment at {salon} is confirmed: {date} at {time}. {what} ({length}) for {price}, your usual price. Reference {ref}.": "Hoi {name}, je afspraak bij {salon} is bevestigd: {date} om {time}. {what} ({length}) voor {price}, je normale prijs. Referentie {ref}.",
  "Hi {name}, this is {salon}. A place has opened up for {service}:": "Hoi {name}, met {salon}. Er is een plek vrijgekomen voor {service}:",
  "Waitlist": "Wachtlijst",
  "Waiting for you": "Wacht op jou",
  "standard price": "normale prijs",
  "Reference {ref}": "Referentie {ref}",
  "Confirm": "Bevestigen",
  "Decline": "Afwijzen",
  "Message for the client": "Bericht voor de klant",
  "Copy message": "Bericht kopiëren",
  "Reference {ref}, received {date}": "Referentie {ref}, ontvangen op {date}",
  "Mark as contacted": "Markeren als gecontacteerd",
  "Visits to your page": "Bezoeken aan je pagina",
  "Saw upgraded times": "Zagen tijden met upgrade",
  "Sent a request": "Stuurden een aanvraag",
  "Last 30 days": "Afgelopen 30 dagen",
  "{pct}% of the step before": "{pct}% van de vorige stap",
  "Joined the waitlist: {n}. Times no upgraded slot was free: {m}.": "Aangemeld voor de wachtlijst: {n}. Keren dat er geen tijd met upgrade vrij was: {m}.",
  "Add the services clients book": "Voeg de behandelingen toe die klanten boeken",
  "Pick your salon type and enter your prices": "Kies je type salon en vul je prijzen in",
  "Add upgrades that add extra time": "Voeg upgrades toe die extra tijd geven",
  "Mark the hours that are usually quiet": "Markeer de uren die meestal rustig zijn",
  "Share your link and put up the QR code": "Deel je link en hang de QR-code op",
  "Requests": "Aanvragen",
  "Your request page:": "Je aanvraagpagina:",
  "Get your request page ready": "Maak je aanvraagpagina klaar",
  "Results so far": "Resultaten tot nu toe",
  "Requests received": "Ontvangen aanvragen",
  "Discount given": "Gegeven korting",
  "No requests waiting.": "Geen openstaande aanvragen.",
  "Share your link where clients find you fully booked.": "Deel je link waar klanten zien dat je volgeboekt bent.",
  "Finish the steps above, then share your link.": "Rond de stappen hierboven af en deel dan je link.",
  "Coming up": "Binnenkort",
  "Confirmed appointments from your request page appear here and in your calendar feed (see Settings).": "Bevestigde afspraken via je aanvraagpagina verschijnen hier en in je agendafeed (zie Instellingen).",
  "Recently answered": "Onlangs beantwoord",
  "When": "Wanneer",
  "Client names and contact details are erased {days} days after each appointment. The numbers above keep counting.": "Namen en contactgegevens van klanten worden {days} dagen na elke afspraak gewist. De cijfers hierboven blijven tellen.",
  "Your appointment at {salon}": "Je afspraak bij {salon}",
  "Confirmed. The client’s page now shows it as confirmed.": "Bevestigd. De pagina van de klant toont de afspraak nu als bevestigd.",
  "Declined. The client’s page now offers them another time.": "Afgewezen. De pagina van de klant biedt nu een ander tijdstip aan.",
  "Marked as contacted.": "Gemarkeerd als gecontacteerd.",
  "That time is already at capacity. Add free chairs in Quiet hours to confirm it, or decline it.": "Dat tijdstip zit al vol. Voeg vrije plekken toe bij Rustige uren om het te bevestigen, of wijs het af.",
  "That request was already answered.": "Die aanvraag is al beantwoord.",
  "Service added.": "Behandeling toegevoegd.",
  "Service saved.": "Behandeling opgeslagen.",
  "Service hidden from clients.": "Behandeling verborgen voor klanten.",
  "Service is visible to clients again.": "De behandeling is weer zichtbaar voor klanten.",
  "Upgrade added.": "Upgrade toegevoegd.",
  "Upgrade saved.": "Upgrade opgeslagen.",
  "Upgrade switched off.": "Upgrade uitgeschakeld.",
  "Upgrade switched on.": "Upgrade ingeschakeld.",
  "Quiet hours added.": "Rustige uren toegevoegd.",
  "Quiet hours removed.": "Rustige uren verwijderd.",
  "Settings saved.": "Instellingen opgeslagen.",
  "Password changed. Other devices have been logged out.": "Wachtwoord gewijzigd. Andere apparaten zijn uitgelogd.",
  "Noted. You will hear from us when it opens.": "Genoteerd. We laten het je weten zodra het beschikbaar is.",
  "Your account is ready. A few short steps and your request page is live.": "Je account is klaar. Nog een paar korte stappen en je aanvraagpagina staat online.",
  "Your services, upgrades and quiet hours are set up. Your request page is live.": "Je behandelingen, upgrades en rustige uren zijn ingesteld. Je aanvraagpagina staat online.",
  "New calendar address created. The old one no longer works.": "Nieuw agenda-adres gemaakt. Het oude werkt niet meer.",
  "Thank you! Your subscription becomes active as soon as the payment provider confirms it.": "Bedankt! Je abonnement wordt actief zodra de betaalprovider het bevestigt.",
  "Welcome to the demo. Everything here is sample data you can change freely.": "Welkom in de demo. Alles hier is voorbeelddata die je vrij kunt aanpassen.",
  "Declined": "Afgewezen",
  "Expired": "Verlopen",
  "Contacted": "Gecontacteerd",
  "Request": "Aanvraag",
  "Weekly view of your quiet hours": "Weekoverzicht van je rustige uren",
  "The times you usually have free chairs. Offers are placed only inside these hours, and never more at once than the chairs you list.": "De tijden waarop je meestal vrije plekken hebt. Aanbiedingen vallen alleen binnen deze uren, en nooit meer tegelijk dan het aantal plekken dat je opgeeft.",
  "Add quiet hours": "Rustige uren toevoegen",
  "Your quiet hours": "Je rustige uren",
  "Day": "Dag",
  "Hours": "Tijden",
  "Chairs": "Plekken",
  "Remove": "Verwijderen",
  "No quiet hours yet. Start with the afternoons that are usually slow.": "Nog geen rustige uren. Begin met de middagen waarop het meestal rustig is.",
  "{n} chair": "{n} plek",
  "{n} chairs": "{n} plekken",
  "Start free beta": "Start gratis met de bèta",
  "Try the live demo": "Probeer de live demo",
  "Turn “fully booked” into a booked client.": "Maak van ‘volgeboekt’ een geboekte klant.",
  "When a client can’t get the time they wanted, {product} offers them a longer, upgraded appointment in your quiet hours, at your normal price. Your slow afternoons fill up and you never discount.": "Kan een klant niet terecht op het gewenste tijdstip? Dan biedt {product} een langere afspraak met upgrade aan in je rustige uren, voor je normale prijs. Je rustige middagen lopen vol en je geeft nooit korting.",
  "See how it works": "Zo werkt het",
  "Example: Saturday is fully booked when the client wanted 11:00. {product} offers Tuesday 13:30 instead: cut and finish plus deep conditioning, 60 minutes instead of 45, for the same {price}.": "Voorbeeld: zaterdag is volgeboekt terwijl de klant om 11:00 wilde komen. {product} biedt in plaats daarvan dinsdag 13:30 aan: knippen en föhnen plus een intensieve haarkuur, 60 minuten in plaats van 45, voor dezelfde {price}.",
  "Fully booked": "Volgeboekt",
  "Booked": "Geboekt",
  "Wanted, but taken": "Gewenst, maar bezet",
  "Free": "Vrij",
  "same {price}": "zelfde prijs: {price}",
  "How it works": "Zo werkt het",
  "Share your link": "Deel je link",
  "Put it where clients find you full: the “fully booked” message on your booking page, your Instagram bio, your auto-reply, a QR code at the desk.": "Zet hem waar klanten zien dat je vol zit: in de ‘volgeboekt’-melding op je boekingspagina, je Instagram-bio, je automatische antwoord, een QR-code bij de balie.",
  "The client picks an upgrade": "De klant kiest een upgrade",
  "They choose the service they wanted and see up to three upgraded times in your quiet hours, in their own language. No account, no app.": "De klant kiest de gewenste behandeling en ziet tot drie tijden met upgrade in je rustige uren, in de eigen taal. Geen account, geen app.",
  "You confirm": "Jij bevestigt",
  "You get an email, confirm with one tap, and send the ready-made message by WhatsApp, text or email. Confirmed appointments appear in your calendar.": "Je krijgt een e-mail, bevestigt met één tik en stuurt het kant-en-klare bericht via WhatsApp, sms of e-mail. Bevestigde afspraken verschijnen in je agenda.",
  "Rules {product} never breaks": "Regels die {product} nooit breekt",
  "Same price, every time": "Altijd dezelfde prijs",
  "The client pays exactly your listed price. {product} cannot create a discount, and the database refuses one even if someone tries.": "De klant betaalt precies je normale prijs. {product} kan geen korting geven, en de database weigert die zelfs als iemand het probeert.",
  "Noticeably more care": "Merkbaar meer zorg",
  "Every offer adds at least 30% more time, using upgrades you choose: a scalp massage, a treatment, a longer finish.": "Elk aanbod voegt minstens 30% meer tijd toe, met upgrades die jij kiest: een hoofdhuidmassage, een behandeling, een langere afwerking.",
  "Only in hours you choose": "Alleen op uren die jij kiest",
  "Offers land only in the quiet hours you set, and never more at once than you have free chairs.": "Aanbiedingen vallen alleen in de rustige uren die jij instelt, en nooit meer tegelijk dan je vrije plekken hebt.",
  "You stay in charge": "Jij houdt de regie",
  "Nothing is booked until you confirm it. Client details are deleted {days} days after the appointment.": "Er is niets geboekt tot jij het bevestigt. Klantgegevens worden {days} dagen na de afspraak verwijderd.",
  "One account, three levels": "Eén account, drie niveaus",
  "Start with one location. The next levels switch on as your business grows.": "Begin met één vestiging. De volgende niveaus worden actief als je bedrijf groeit.",
  "Coming": "Binnenkort",
  "{product} turns “fully booked” into an upgraded booking in your quiet hours, at your normal price. Never a discount.": "{product} maakt van ‘volgeboekt’ een boeking met upgrade in je rustige uren, voor je normale prijs. Nooit met korting.",
  "Skip to content": "Naar de inhoud",
  "Privacy": "Privacy",
  "Terms": "Voorwaarden",
  "Dashboard": "Dashboard",
  "Start free": "Gratis starten",
  "Requests by {product}": "Aanvragen via {product}",
  "Log out": "Uitloggen",
  "Share": "Delen",
  "Plan": "Pakket",
  "Settings": "Instellingen",
  "Please correct the highlighted field.": "Corrigeer het gemarkeerde veld.",
  "Please correct the {n} highlighted fields.": "Corrigeer de {n} gemarkeerde velden.",
  "Fully booked when you wanted to come in? Choose your service and we will offer you a calmer time with extra care included, at the same price.": "Volgeboekt op het moment dat je wilde komen? Kies je behandeling en we bieden je een rustiger moment aan met extra zorg erbij, voor dezelfde prijs.",
  "Prices are the salon’s standard prices. Upgraded appointments never cost more, or less.": "De prijzen zijn de normale prijzen van de salon. Afspraken met upgrade kosten nooit meer, of minder.",
  "{salon} is not taking requests through this page yet.": "{salon} neemt via deze pagina nog geen aanvragen aan.",
  "Request an appointment": "Een afspraak aanvragen",
  "{salon} uses this to confirm your appointment. Please include the country code with a phone number, for example +44.": "{salon} gebruikt dit om je afspraak te bevestigen. Zet bij een telefoonnummer de landcode erbij, bijvoorbeeld +31.",
  "Leave this field empty": "Laat dit veld leeg",
  "Privacy notice": "Privacyverklaring",
  "Pick your appointment": "Kies je afspraak",
  "{service} with extra time added, at the usual price of {price}.": "{service} met extra tijd, voor de normale prijs van {price}.",
  "Available upgraded times": "Beschikbare tijden met upgrade",
  "your usual price": "je normale prijs",
  "Nothing is booked yet: {salon} confirms your request personally.": "Er is nog niets geboekt: {salon} bevestigt je aanvraag persoonlijk.",
  "Leave your details": "Laat je gegevens achter",
  "No upgraded time is free right now": "Er is nu geen tijd met upgrade vrij",
  "{salon} is not offering upgraded times online at the moment. Leave your details for {service} and they will get back to you.": "{salon} biedt op dit moment geen tijden met upgrade online aan. Laat je gegevens achter voor {service}, dan nemen ze contact met je op.",
  "Leave your details for {service} and {salon} will get back to you when a place opens.": "Laat je gegevens achter voor {service}, dan neemt {salon} contact met je op zodra er een plek vrijkomt.",
  "When suits you?": "Wanneer komt het je uit?",
  "(optional)": "(optioneel)",
  "Join the waitlist": "Op de wachtlijst",
  "{salon} will confirm it personally. Keep this page: it shows the answer as soon as they reply.": "{salon} bevestigt het persoonlijk. Bewaar deze pagina: hier staat het antwoord zodra het er is.",
  "See you on {date} at {time}.": "Tot {date} om {time}.",
  "{salon} could not confirm this time. You are welcome to choose another one.": "{salon} kon dit tijdstip niet bevestigen. Kies gerust een ander.",
  "This request was not confirmed before its time passed.": "Deze aanvraag is niet op tijd bevestigd.",
  "{salon} has picked up your request.": "{salon} heeft je aanvraag opgepakt.",
  "This waitlist request has expired.": "Deze aanmelding voor de wachtlijst is verlopen.",
  "This waitlist request was closed.": "Deze aanmelding voor de wachtlijst is gesloten.",
  "Included": "Inbegrepen",
  "the standard price": "de normale prijs",
  "the operator of {product}": "de beheerder van {product}",
  "What happens to your details when you use {product}.": "Wat er met je gegevens gebeurt als je {product} gebruikt.",
  "If you send a request to a salon": "Als je een aanvraag naar een salon stuurt",
  "The salon you write to decides what happens with your request; {product} only processes it on the salon’s behalf. We store your name, the phone number or email you give, the service and time you chose, the language you used, and the moment you agreed to be contacted.": "De salon waar je naartoe schrijft, beslist wat er met je aanvraag gebeurt; {product} verwerkt die alleen namens de salon. We bewaren je naam, het telefoonnummer of e-mailadres dat je opgeeft, de gekozen behandeling en tijd, de taal die je gebruikte en het moment waarop je toestemming gaf om contact met je op te nemen.",
  "Your details are used only to answer that request, including emails about it if you gave an email address. They are deleted {days} days after the appointment date (or {days} days after a waitlist request). What remains is anonymous: the service, the time and the price, for the salon’s statistics.": "Je gegevens worden alleen gebruikt om die aanvraag te beantwoorden, inclusief e-mails erover als je een e-mailadres opgaf. Ze worden {days} dagen na de datum van de afspraak verwijderd (of {days} dagen na een aanmelding voor de wachtlijst). Wat overblijft is anoniem: de behandeling, de tijd en de prijs, voor de statistieken van de salon.",
  "Pages for clients set no cookies and load nothing from other websites. Visits are counted per day without any personal data. There is no tracking and no advertising.": "Pagina's voor klanten plaatsen geen cookies en laden niets van andere websites. Bezoeken worden per dag geteld, zonder persoonsgegevens. Er is geen tracking en geen reclame.",
  "If you run a salon account": "Als je een salonaccount beheert",
  "We store your email, a protected form of your password (never the password itself), your salon’s settings and the requests you receive. One cookie keeps you logged in. Email is sent through the provider this installation is configured with. Payments, if switched on, are handled entirely by the payment provider; this site never sees card details. You can delete your account and all of its data at any time from Settings.": "We bewaren je e-mailadres, een beveiligde vorm van je wachtwoord (nooit het wachtwoord zelf), de instellingen van je salon en de aanvragen die je ontvangt. Eén cookie houdt je ingelogd. E-mail wordt verstuurd via de provider waarmee deze installatie is ingesteld. Betalingen, als die aanstaan, worden volledig door de betaalprovider afgehandeld; deze site ziet nooit kaartgegevens. Je kunt je account en alle bijbehorende gegevens op elk moment verwijderen via Instellingen.",
  "Your rights": "Je rechten",
  "You can ask for a copy of your details, for corrections, or for deletion. For a request you sent to a salon, contact that salon directly; for anything else, contact {operator}.": "Je kunt een kopie van je gegevens vragen, of om correctie of verwijdering. Voor een aanvraag die je naar een salon hebt gestuurd, neem je rechtstreeks contact op met die salon; voor al het andere met {operator}.",
  "Terms of use": "Gebruiksvoorwaarden",
  "Legal notice": "Colofon",
  "What you get": "Wat je krijgt",
  "A free trial, then a monthly subscription you can cancel at any time. Prices are shown before you subscribe. Payments and invoices are handled by our payment provider.": "Een gratis proefperiode, daarna een maandabonnement dat je op elk moment kunt opzeggen. Prijzen zie je voordat je een abonnement neemt. Betalingen en facturen worden afgehandeld door onze betaalprovider.",
  "Free use of the Reflow level while the beta runs. Features may change. If paid plans are introduced, you will be told in advance and nothing will be charged without your explicit agreement.": "Gratis gebruik van het Reflow-niveau zolang de bèta loopt. Functies kunnen veranderen. Als er betaalde pakketten komen, hoor je dat vooraf en wordt er niets in rekening gebracht zonder je uitdrukkelijke toestemming.",
  "What we ask": "Wat we vragen",
  "Use your request page only for your own business and only for real appointments. You are responsible for honouring the appointments you confirm and for treating your clients’ details with care.": "Gebruik je aanvraagpagina alleen voor je eigen bedrijf en alleen voor echte afspraken. Je bent zelf verantwoordelijk voor het nakomen van de afspraken die je bevestigt en voor een zorgvuldige omgang met de gegevens van je klanten.",
  "No warranty": "Geen garantie",
  "The service is provided as is. Keep your own booking system as the record of your appointments.": "De dienst wordt geleverd zoals hij is. Houd je eigen boekingssysteem aan als vastlegging van je afspraken.",
  "Ending": "Beëindiging",
  "You can delete your account at any time from Settings; your data is deleted with it.": "Je kunt je account op elk moment verwijderen via Instellingen; je gegevens worden dan ook verwijderd.",
  "Go to the home page": "Naar de startpagina",
  "Handled": "Opgepakt",
  "Closed": "Gesloten",
  "That did not work": "Dat werkte niet",
  "Not allowed": "Niet toegestaan",
  "Page not found": "Pagina niet gevonden",
  "Already changed": "Al gewijzigd",
  "Too large": "Te groot",
  "Form not readable": "Formulier onleesbaar",
  "Too many attempts": "Te veel pogingen",
  "Something went wrong": "Er ging iets mis",
  "{salon} may contact me about this request. My details are deleted {days} days after the appointment. {privacy}": "{salon} mag contact met me opnemen over deze aanvraag. Mijn gegevens worden {days} dagen na de afspraak verwijderd. {privacy}",
  "You can ask for a copy of your details, for corrections, or for deletion. For a request you sent to a salon, contact that salon directly; for anything else, contact {operator} at {email}.": "Je kunt een kopie van je gegevens vragen, of om correctie of verwijdering. Voor een aanvraag die je naar een salon hebt gestuurd, neem je rechtstreeks contact op met die salon; voor al het andere met {operator} via {email}.",
  "Logged in as {email}": "Ingelogd als {email}",
  "Salon": "Salon",
  "Shown to clients on their confirmation.": "Wordt aan klanten getoond bij hun bevestiging.",
  "Page address": "Pagina-adres",
  "Lowercase letters, numbers and dashes. Links you already shared stop working if you change it.": "Kleine letters, cijfers en streepjes. Links die je al hebt gedeeld, werken niet meer als je dit wijzigt.",
  "Language of your request page": "Taal van je aanvraagpagina",
  "Clients can switch to another language on the page.": "Klanten kunnen op de pagina een andere taal kiezen.",
  "Minimum extra time (%)": "Minimale extra tijd (%)",
  "At least {pct}%. Raise it if you want offers to feel even more generous.": "Minstens {pct}%. Verhoog het als je aanbiedingen nog royaler wilt laten voelen.",
  "Minimum notice": "Minimale termijn",
  "How soon an offered time can start, so you have time to confirm.": "Hoe snel een aangeboden tijd op zijn vroegst mag beginnen, zodat je tijd hebt om te bevestigen.",
  "Save settings": "Instellingen opslaan",
  "You": "Jouw account",
  "Language of your dashboard and emails": "Taal van je dashboard en e-mails",
  "Email notifications": "E-mailmeldingen",
  "Email me when a client sends a request": "Stuur me een e-mail als een klant een aanvraag stuurt",
  "Email sending is not set up on this installation yet, so no emails go out for now.": "E-mail versturen is op deze installatie nog niet ingesteld, dus er gaan voorlopig geen e-mails uit.",
  "Save": "Opslaan",
  "Calendar": "Agenda",
  "Subscribe to this address in Google Calendar, Apple Calendar or Outlook, and every appointment you confirm appears there by itself. Keep the address private: it shows your clients’ names.": "Abonneer je op dit adres in Google Agenda, Apple Agenda of Outlook, dan verschijnt elke afspraak die je bevestigt daar vanzelf. Houd het adres privé: het toont de namen van je klanten.",
  "Copy address": "Adres kopiëren",
  "Create a new address (the old one stops working)": "Nieuw adres maken (het oude werkt dan niet meer)",
  "Create calendar address": "Agenda-adres maken",
  "Export": "Exporteren",
  "All requests as a spreadsheet file (CSV), for your records or another tool.": "Alle aanvragen als spreadsheetbestand (CSV), voor je administratie of een ander programma.",
  "Download requests (CSV)": "Aanvragen downloaden (CSV)",
  "Current password": "Huidig wachtwoord",
  "Change password": "Wachtwoord wijzigen",
  "Audit log": "Auditlog",
  "Every offer, confirmation and price change is recorded in a tamper-evident log.": "Elk aanbod, elke bevestiging en elke prijswijziging wordt vastgelegd in een fraudebestendig logboek.",
  "Check the audit log": "Auditlog controleren",
  "Delete account": "Account verwijderen",
  "Deletes your salon, services, requests and client details permanently. This cannot be undone.": "Verwijdert je salon, behandelingen, aanvragen en klantgegevens definitief. Dit kan niet ongedaan worden gemaakt.",
  "Your password": "Je wachtwoord",
  "Delete account and all data": "Account en alle gegevens verwijderen",
  "One account, three levels.": "Eén account, drie niveaus.",
  "Subscription": "Abonnement",
  "Subscribe: {price}": "Abonneren: {price}",
  "Subscribe": "Abonneren",
  "Manage subscription and invoices": "Abonnement en facturen beheren",
  "You are on Reflow, free during the beta.": "Je gebruikt Reflow, gratis tijdens de bèta.",
  "Your plan": "Je pakket",
  "On the list": "Op de lijst",
  "We will tell you when it opens": "We laten het je weten zodra het beschikbaar is",
  "Tell me when {plan} opens": "Laat het me weten als {plan} beschikbaar is",
  "Page address {slug}, {timezone}, {currency}": "Pagina-adres {slug}, {timezone}, {currency}",
  "at least {pct}% extra time": "minstens {pct}% extra tijd",
  "Service {id} shown to clients": "Behandeling {id} zichtbaar voor klanten",
  "Service {id} hidden from clients": "Behandeling {id} verborgen voor klanten",
  "was {price}": "was {price}",
  "Upgrade {id} switched on": "Upgrade {id} ingeschakeld",
  "Upgrade {id} switched off": "Upgrade {id} uitgeschakeld",
  "Each entry carries the fingerprint of the one before it, so a changed or deleted entry breaks the chain.": "Elke regel bevat de vingerafdruk van de vorige, dus een gewijzigde of verwijderde regel breekt de keten.",
  "Chain broken at entry {id}. An entry was changed or removed outside the app.": "Keten verbroken bij regel {id}. Een regel is buiten de app gewijzigd of verwijderd.",
  "Latest fingerprint:": "Laatste vingerafdruk:",
  "Free trial until {date}.": "Gratis proefperiode tot {date}.",
  "Your subscription is active.": "Je abonnement is actief.",
  "Your last payment did not go through. Please update your payment method to keep your request page running.": "Je laatste betaling is niet gelukt. Werk je betaalmethode bij zodat je aanvraagpagina blijft werken.",
  "Your subscription is cancelled. Upgraded offers keep running until {date}.": "Je abonnement is opgezegd. Aanbiedingen met upgrade blijven lopen tot {date}.",
  "Your subscription is paused. Clients can join your waitlist, but see no upgraded times.": "Je abonnement is gepauzeerd. Klanten kunnen zich aanmelden voor je wachtlijst, maar zien geen tijden met upgrade.",
  "Your subscription is not active. Clients can join your waitlist, but see no upgraded times.": "Je abonnement is niet actief. Klanten kunnen zich aanmelden voor je wachtlijst, maar zien geen tijden met upgrade.",
  "Account created": "Account aangemaakt",
  "Settings changed": "Instellingen gewijzigd",
  "Service added": "Behandeling toegevoegd",
  "Service changed": "Behandeling gewijzigd",
  "Upgrade added": "Upgrade toegevoegd",
  "Upgrade changed": "Upgrade gewijzigd",
  "Quiet hours added": "Rustige uren toegevoegd",
  "Quiet hours removed": "Rustige uren verwijderd",
  "Offer requested": "Aanbod aangevraagd",
  "Waitlist request": "Aanmelding wachtlijst",
  "Request confirmed": "Aanvraag bevestigd",
  "Request declined": "Aanvraag afgewezen",
  "Waitlist request handled": "Aanmelding wachtlijst opgepakt",
  "Subscription changed": "Abonnement gewijzigd",
  "Free beta": "Gratis bèta",
  "Free trial": "Gratis proefperiode",
  "{days}-day free trial": "{days} dagen gratis proberen",
  "Monthly subscription": "Maandabonnement",
  "Active": "Actief",
  "Payment overdue": "Betaling achterstallig",
  "Cancelled": "Opgezegd",
  "Paused": "Gepauzeerd",
  "Ended": "Beëindigd",
  "{n} service": "{n} behandeling",
  "{n} services": "{n} behandelingen",
  "{n} upgrade": "{n} upgrade",
  "{n} upgrades": "{n} upgrades",
  "Chain intact: {n} entry checked, none changed.": "Keten intact: {n} regel gecontroleerd, geen gewijzigd.",
  "Chain intact: {n} entries checked, none changed.": "Keten intact: {n} regels gecontroleerd, geen gewijzigd.",
  "Booking page, “fully booked” message": "Boekingspagina, melding ‘volgeboekt’",
  "Fully booked at the time you wanted? Get a longer, upgraded appointment at the same price: {url}": "Volgeboekt op het tijdstip dat je wilde? Krijg een langere afspraak met upgrade voor dezelfde prijs: {url}",
  "Instagram or Facebook bio": "Instagram- of Facebook-bio",
  "Fully booked? Upgraded appointments, same price: {url}": "Volgeboekt? Afspraken met upgrade, zelfde prijs: {url}",
  "Auto-reply for messages": "Automatisch antwoord op berichten",
  "Thanks for your message! If we’re fully booked when you’d like to come, {salon} can offer you a calmer time with extra care included, at the same price. Pick one here: {url}": "Bedankt voor je bericht! Zijn we volgeboekt wanneer je wilt komen, dan kan {salon} je een rustiger moment aanbieden met extra zorg erbij, voor dezelfde prijs. Kies er hier een: {url}",
  "Fully booked? See upgraded times": "Volgeboekt? Bekijk tijden met upgrade",
  "Put your link wherever clients find you fully booked. Texts below are in the language of your request page: {language}.": "Zet je link overal waar klanten zien dat je volgeboekt bent. De teksten hieronder zijn in de taal van je aanvraagpagina: {language}.",
  "Your link": "Je link",
  "Copy link": "Link kopiëren",
  "Open page": "Pagina openen",
  "Texts to copy": "Teksten om te kopiëren",
  "Copy text": "Tekst kopiëren",
  "QR code for the desk and the window": "QR-code voor de balie en het raam",
  "QR code that opens your request page": "QR-code die je aanvraagpagina opent",
  "Print the poster for your reception desk or window, or put the QR code on your price list.": "Print de poster voor je balie of raam, of zet de QR-code op je prijslijst.",
  "Open printable poster": "Printbare poster openen",
  "Download QR code": "QR-code downloaden",
  "Button for your website": "Knop voor je website",
  "Paste this code into your website where clients see that you are fully booked.": "Plak deze code op je website, op de plek waar klanten zien dat je volgeboekt bent.",
  "Copy code": "Code kopiëren",
  "Fully booked?": "Volgeboekt?",
  "Scan for a longer, upgraded appointment in a calmer hour, at the same price.": "Scan voor een langere afspraak met upgrade op een rustiger moment, voor dezelfde prijs.",
  "Print poster": "Poster printen",
  "Back": "Terug",
  "Appointment canceled": "Afspraak geannuleerd",
  "Join the salon team": "Word lid van het salonteam",
  "Verify your email": "Bevestig uw e-mailadres",
  "This private link expires in 24 hours. If you did not request it, ignore this email.": "Deze privélink verloopt na 24 uur. Negeer deze e-mail als u de link niet hebt aangevraagd.",
  "Appointment reminder": "Herinnering aan uw afspraak",
  "Handle future appointments before changing the time zone.": "Handel toekomstige afspraken af voordat u de tijdzone wijzigt.",
  "Only the owner can change these settings.": "Alleen de eigenaar kan deze instellingen wijzigen.",
  "End your paid subscription before deleting the account.": "Beëindig uw betaalde abonnement voordat u het account verwijdert.",
  "Completed": "Afgerond",
  "No-show": "Niet verschenen",
  "Canceled": "Geannuleerd",
  "All": "Alle",
  "Appointments": "Afspraken",
  "Block time": "Tijd blokkeren",
  "Search": "Zoeken",
  "No appointments found.": "Geen afspraken gevonden.",
  "Mark completed": "Markeren als afgerond",
  "Cancel this appointment?": "Deze afspraak annuleren?",
  "Cancel appointment": "Afspraak annuleren",
  "Previous": "Vorige",
  "Next": "Volgende",
  "Availability": "Beschikbaarheid",
  "Block holidays, breaks and appointments from your other booking system.": "Blokkeer vakanties, pauzes en afspraken uit uw andere boekingssysteem.",
  "Close the whole day": "De hele dag sluiten",
  "No blocked times.": "Geen geblokkeerde tijden.",
  "This block overlaps a reservation. Handle the reservation first.": "Deze blokkade overlapt een reservering. Handel eerst de reservering af.",
  "Change appointment": "Afspraak wijzigen",
  "Your current appointment stays reserved until you choose a new time. The salon must confirm the change.": "Uw huidige afspraak blijft gereserveerd totdat u een nieuw tijdstip kiest. De salon moet de wijziging bevestigen.",
  "Cancellation notice (minutes)": "Annuleringstermijn (minuten)",
  "Request hold (hours)": "Vasthoudtijd van de aanvraag (uren)",
  "Please contact the salon to change this appointment.": "Neem contact op met de salon om deze afspraak te wijzigen.",
  "Team": "Team",
  "Staff can manage appointments and blocked times. Billing, exports and business settings stay with the owner.": "Medewerkers kunnen afspraken en geblokkeerde tijden beheren. Facturering, exports en bedrijfsinstellingen blijven bij de eigenaar.",
  "Invitation ready. Send this private link to your colleague.": "Uitnodiging klaar. Stuur deze privélink naar uw collega.",
  "Invitation link": "Uitnodigingslink",
  "Invite a colleague": "Collega uitnodigen",
  "Owner": "Eigenaar",
  "Staff": "Medewerker",
  "Remove this colleague?": "Deze collega verwijderen?",
  "Pending invitations": "Openstaande uitnodigingen",
  "Check your inbox and confirm your email before opening your dashboard.": "Controleer uw inbox en bevestig uw e-mailadres voordat u het dashboard opent.",
  "Check your inbox.": "Controleer uw inbox.",
  "Resend email": "E-mail opnieuw versturen",
  "My account": "Mijn account",
  "This action is not available in the demo.": "Deze actie is niet beschikbaar in de demo.",
  "This email is already registered or the team is full.": "Dit e-mailadres is al geregistreerd of het team is vol.",
  "Booked value": "Boekingswaarde",
  "Booked value is not collected revenue. Mark completed services in Appointments.": "Boekingswaarde is geen ontvangen omzet. Markeer afgeronde diensten onder Afspraken.",
  "Completed service value": "Waarde van afgeronde diensten",
  "Request hold: {hours} hours. Changes and cancellations close {minutes} minutes before the appointment.": "Vasthoudtijd: {hours} uur. Wijzigingen en annuleringen sluiten {minutes} minuten vóór de afspraak.",
  "Booking policy": "Boekingsbeleid",
  "Unanswered requests release their reserved time when the hold expires.": "Onbeantwoorde aanvragen geven hun tijdslot vrij zodra de vasthoudtijd verloopt."
};
return { default: __default };
})();

// src/i18n/index.js
const __m18 = (() => {
// Copyright (c) 2026 Miloš Petrović (Trench Logic Studio) · SPDX-License-Identifier: MIT
// Languages, translation and locale-aware formatting.
//
// English strings are the keys: t('Send request') looks the string up in the
// active language's dictionary and falls back to English when it is missing.
// test/i18n.test.js checks that every string used in the code is translated.

const de = __m12.default;
const fr = __m13.default;
const es = __m14.default;
const it = __m15.default;
const pt = __m16.default;
const nl = __m17.default;

const LOCALES = ['en', 'de', 'fr', 'es', 'it', 'pt', 'nl'];

const LOCALE_NAMES = {
  en: 'English',
  de: 'Deutsch',
  fr: 'Français',
  es: 'Español',
  it: 'Italiano',
  pt: 'Português',
  nl: 'Nederlands',
};

const EN_CURRENCY_LOCALE = { USD: 'en-US', CAD: 'en-CA', AUD: 'en-AU', NZD: 'en-NZ', SGD: 'en-SG', ZAR: 'en-ZA' };
const INTL = { en: 'en-GB', de: 'de-DE', fr: 'fr-FR', es: 'es-ES', it: 'it-IT', pt: 'pt-BR', nl: 'nl-NL' };
const DICTS = { en: null, de, fr, es, it, pt, nl };

const DICTIONARIES = DICTS;

/** Language tag for HTML lang attributes: Portuguese is written as in Brazil. */
const htmlLang = (locale) => (locale === 'pt' ? 'pt-BR' : locale);

function isLocale(value) {
  return typeof value === 'string' && LOCALES.includes(value);
}

/** Best supported language for an Accept-Language header. */
function negotiate(header, fallback = 'en') {
  if (typeof header !== 'string' || !header) return fallback;
  const prefs = header
    .split(',')
    .slice(0, 20)
    .map((part) => {
      const [tag, ...params] = part.trim().split(';');
      const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
      const weight = q ? Number(q.slice(2)) : 1;
      return { lang: tag.trim().toLowerCase().split('-')[0], q: Number.isFinite(weight) ? weight : 0 };
    })
    .filter((p) => p.lang && p.q > 0)
    .sort((a, b) => b.q - a.q);
  for (const p of prefs) if (isLocale(p.lang)) return p.lang;
  return fallback;
}

function fill(text, vars) {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (match, key) => (Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key]) : match));
}

function utcDate(date) {
  const [y, m, d] = String(date).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

const cache = new Map();

let missingHandler = null;
/** Test hook: fn(locale, key) is called whenever a non-English lookup falls back to English. */
function onMissingTranslation(fn) {
  missingHandler = typeof fn === 'function' ? fn : null;
}

/**
 * translator('de') → t, with:
 *   t(key, vars)                 translated string, {name} placeholders filled
 *   t.n(count, one, other, vars) plural-aware: picks `one` or `other` for the language
 *   t.date / t.dateLong          wall-clock dates ('YYYY-MM-DD') in the language
 *   t.weekday(1..7) / t.weekdayShort(1..7)
 *   t.time(min) / t.timeRange(a, b) / t.duration(min) / t.money(cents, currency)
 *   t.instant(iso, timeZone) / t.day(iso, timeZone)   stored instants on the salon's clock
 */
function translator(locale) {
  const loc = isLocale(locale) ? locale : 'en';
  if (cache.has(loc)) return cache.get(loc);
  const dict = DICTS[loc];
  const intl = INTL[loc];
  const plural = new Intl.PluralRules(intl);
  const dateShort = new Intl.DateTimeFormat(intl, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  const dateLong = new Intl.DateTimeFormat(intl, { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
  const dateNumeric = new Intl.DateTimeFormat(intl, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  const wdLong = new Intl.DateTimeFormat(intl, { weekday: 'long', timeZone: 'UTC' });
  const wdShort = new Intl.DateTimeFormat(intl, { weekday: 'short', timeZone: 'UTC' });
  const money = new Map();
  const tidy = (s) => (loc === 'en' ? s.replace(',', '') : s);

  const t = (key, vars) => {
    if (dict && Object.prototype.hasOwnProperty.call(dict, key)) return fill(dict[key], vars);
    if (dict && missingHandler) missingHandler(loc, key);
    return fill(key, vars);
  };
  t.locale = loc;
  t.intl = intl;
  t.n = (count, one, other, vars = {}) => t(plural.select(count) === 'one' ? one : other, { n: count, ...vars });
  t.date = (date) => tidy(dateShort.format(utcDate(date)));
  t.dateLong = (date) => tidy(dateLong.format(utcDate(date)));
  t.dateNumeric = (date) => dateNumeric.format(utcDate(date));
  // 2024-01-01 was a Monday, so day 1..7 maps to Monday..Sunday.
  t.weekday = (iso) => wdLong.format(new Date(Date.UTC(2024, 0, iso)));
  t.weekdayShort = (iso) => wdShort.format(new Date(Date.UTC(2024, 0, iso))).replace(/\.$/, '');
  t.time = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
  t.timeRange = (a, b) => `${t.time(a)}–${t.time(b)}`;
  t.duration = (min) => {
    if (min < 60) return t('{m} min', { m: min });
    const h = Math.floor(min / 60);
    const m = min % 60;
    return m ? t('{h} h {m} min', { h, m }) : t('{h} h', { h });
  };
  const zoned = new Map();
  const zonedFormat = (timeZone, withTime) => {
    const id = `${timeZone}|${withTime}`;
    let f = zoned.get(id);
    if (f === undefined) {
      const opts = { day: 'numeric', month: 'short', year: 'numeric', ...(withTime ? { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' } : {}) };
      try {
        f = new Intl.DateTimeFormat(intl, { ...opts, timeZone });
      } catch {
        f = new Intl.DateTimeFormat(intl, { ...opts, timeZone: 'UTC' });
      }
      zoned.set(id, f);
    }
    return f;
  };
  /** A stored instant (ISO string) on the salon's own clock: '3 Nov 2026, 14:05'. */
  t.instant = (iso, timeZone) => zonedFormat(timeZone, true).format(new Date(iso));
  /** The calendar day of a stored instant on the salon's own clock: '3 Nov 2026'. */
  t.day = (iso, timeZone) => zonedFormat(timeZone, false).format(new Date(iso));
  t.money = (cents, currency) => {
    let f = money.get(currency);
    if (f === undefined) {
      try {
        // English pages show dollars the way their own country writes them ($45.00, not US$45.00).
        const numberLocale = loc === 'en' ? EN_CURRENCY_LOCALE[currency] || intl : intl;
        f = new Intl.NumberFormat(numberLocale, { style: 'currency', currency });
      } catch {
        f = null;
      }
      money.set(currency, f);
    }
    return f ? f.format(cents / 100) : `${(cents / 100).toFixed(2)} ${currency}`;
  };
  cache.set(loc, t);
  return t;
}

/** Marks a string for translation where it is defined, for strings translated later with t(). */
const tk = (key) => key;
return { LOCALES, LOCALE_NAMES, DICTIONARIES, htmlLang, isLocale, negotiate, onMissingTranslation, translator, tk };
})();

// src/html.js
const __m19 = (() => {
// Copyright (c) 2026 Miloš Petrović (Trench Logic Studio) · SPDX-License-Identifier: MIT
// HTML templating. Every interpolated value is escaped unless it is already
// a SafeHtml produced by html`` or raw(). There is no other way to emit markup.

class SafeHtml {
  constructor(value) {
    this.value = value;
  }
  toString() {
    return this.value;
  }
}

const ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' };

function escapeHtml(value) {
  return String(value).replace(/[&<>"'`]/g, (c) => ENTITIES[c]);
}

function render(value) {
  if (value === null || value === undefined || value === false) return '';
  if (value instanceof SafeHtml) return value.value;
  if (Array.isArray(value)) return value.map(render).join('');
  return escapeHtml(value);
}

function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) out += render(values[i]) + strings[i + 1];
  return new SafeHtml(out);
}

/** Trusted markup only: constants written in this codebase, never user input. */
function raw(markup) {
  return new SafeHtml(String(markup));
}

function join(items, separator = '') {
  return new SafeHtml(items.map(render).join(render(separator)));
}
return { SafeHtml, escapeHtml, html, raw, join };
})();

// src/views/layout.js
const __m20 = (() => {
// Copyright (c) 2026 Miloš Petrović (Trench Logic Studio) · SPDX-License-Identifier: MIT
// Page shell, language switcher and shared view helpers.

const { html, raw } = __m19;
const { VERSION } = __m0;
const { LOCALES, LOCALE_NAMES, tk, htmlLang } = __m18;

const MARK = raw(
  '<svg viewBox="0 0 32 32" aria-hidden="true" focusable="false"><rect width="32" height="32" rx="8" fill="currentColor" opacity=".12"/><rect x="7" y="8" width="11" height="5" rx="2" fill="#c0476b"/><rect x="7" y="17" width="18" height="7" rx="2" fill="#4e8a71"/></svg>',
);

/** Same path, with ?lang= set (other query parameters kept, one-off flags dropped). */
function withLang(path, lang) {
  const u = new URL(path, 'http://x');
  u.searchParams.delete('ok');
  u.searchParams.set('lang', lang);
  return `${u.pathname}?${u.searchParams.toString()}`;
}

function languageSwitcher(c, path) {
  if (!path) return '';
  return html`<nav class="langs" aria-label="${c.t('Language')}"><ul>${LOCALES.map(
    (l) =>
      html`<li><a href="${withLang(path, l)}" lang="${htmlLang(l)}" hreflang="${htmlLang(l)}"${l === c.locale ? raw(' aria-current="true"') : ''}>${LOCALE_NAMES[l]}</a></li>`,
  )}</ul></nav>`;
}

/** Search engines and link previews: one URL per language, linked to each other. */
function seoLinks(c, path, title, description) {
  const url = (l) => `${c.url.origin}${withLang(path, l)}`;
  return html`<link rel="canonical" href="${url(c.locale)}">
${LOCALES.map((l) => html`<link rel="alternate" hreflang="${htmlLang(l)}" href="${url(l)}">
`)}<link rel="alternate" hreflang="x-default" href="${c.url.origin}${path}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${c.config.productName}">
<meta property="og:title" content="${title}">
${description ? html`<meta property="og:description" content="${description}">` : ''}
<meta property="og:url" content="${url(c.locale)}">
<meta property="og:locale" content="${c.t.intl.replace('-', '_')}">
${previewImage(c)}`;
}

/** Link previews (WhatsApp, Instagram, Facebook, Slack…): one neutral image for every page that is shared. */
function previewImage(c) {
  return html`<meta property="og:image" content="${c.url.origin}/og.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">`;
}

/** A salon's link as it appears when shared in a chat: the salon's name and what the page offers. */
function salonPreview(c, salon, description) {
  return html`<meta property="og:type" content="website">
<meta property="og:site_name" content="${salon.name}">
<meta property="og:title" content="${salon.name}">
<meta property="og:description" content="${description}">
<meta property="og:locale" content="${c.t.intl.replace('-', '_')}">
${previewImage(c)}`;
}

function document(c, { title, body, bodyClass = '', robots = 'noindex, nofollow', description = '', indexPath = null, preview = '' }) {
  return html`<!doctype html>
<html lang="${htmlLang(c.locale)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<meta name="robots" content="${robots}">
${description ? html`<meta name="description" content="${description}">` : ''}
${indexPath ? seoLinks(c, indexPath, title, description) : preview}
<meta name="color-scheme" content="light dark">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="stylesheet" href="/static/app.css?v=${VERSION}">
<script src="/static/app.js?v=${VERSION}" defer></script>
</head>
<body class="${bodyClass}">
<a class="skip" href="#main">${c.t('Skip to content')}</a>
${body}
</body>
</html>`;
}

function footer(c, { switchPath = null, extra = '' } = {}) {
  const cfg = c.config;
  return html`<footer class="footer">
  <div class="wrap footer-inner">
    <span>${cfg.productName} ${cfg.version}</span>
    <a href="${c.link('/privacy')}">${c.t('Privacy')}</a>
    <a href="${c.link('/terms')}">${c.t('Terms')}</a>
    ${cfg.contactEmail ? html`<a href="mailto:${cfg.contactEmail}">${c.t('Contact')}</a>` : ''}
    ${cfg.legalNotice.length ? html`<a href="${c.link('/legal')}">${c.t('Legal notice')}</a>` : ''}
    ${extra}
  </div>
  <div class="wrap">${languageSwitcher(c, switchPath)}</div>
</footer>`;
}

/** Marketing and account pages. */
function sitePage(c, { title, body, user = null, robots, description, switchPath = null, bare = false }) {
  const cfg = c.config;
  const t = c.t;
  const actions = bare
    ? ''
    : user
    ? html`<a class="btn btn-outline btn-small" href="/app">${t('Dashboard')}</a>`
    : html`<a class="btn btn-link btn-small" href="${c.link('/login')}">${t('Log in')}</a><a class="btn btn-primary btn-small" href="${c.link('/signup')}">${c.billing.enabled && !c.billing.trialDays ? t('Create account') : t('Start free')}</a>`;
  return document(c, {
    title: title ? `${title} | ${cfg.productName}` : cfg.productName,
    robots,
    description,
    indexPath: robots && robots.startsWith('index') ? switchPath : null,
    bodyClass: 'site',
    body: html`<header class="bar"><div class="wrap bar-inner">
  <a class="brand" href="${c.link('/')}">${MARK}<span>${cfg.productName}</span></a>
  <div class="bar-actions">${actions}</div>
</div></header>
<main id="main">${body}</main>
${footer(c, { switchPath })}`,
  });
}

/** A salon's public pages: the salon's name leads, the product stays in the footer. */
function publicPage(c, salon, { title, body, switchPath = null }) {
  return document(c, {
    title: `${title} | ${salon.name}`,
    bodyClass: 'public',
    preview: salonPreview(c, salon, c.t('Fully booked when you wanted to come in? Choose your service and we will offer you a calmer time with extra care included, at the same price.')),
    body: html`<main id="main"><div class="wrap narrow">${body}</div></main>
${footer(c, { switchPath, extra: html`<span>${c.t('Requests by {product}', { product: c.config.productName })}</span>` })}`,
  });
}

const APP_NAV = [
  ['/app', tk('Requests')],
  ['/app/appointments', tk('Appointments')],
  ['/app/availability', tk('Availability')],
  ['/app/services', tk('Services')],
  ['/app/upgrades', tk('Upgrades')],
  ['/app/hours', tk('Quiet hours')],
  ['/app/share', tk('Share')],
  ['/app/plan', tk('Plan')],
  ['/app/settings', tk('Settings')],
  ['/app/team', tk('Team')],
  ['/app/account', tk('My account')],
];

/** The salon's own dashboard. */
function appPage(c, { title, body, current = '/app', banners = [] }) {
  const t = c.t;
  const salon = c.user.salon;
  return document(c, {
    title: `${title} | ${salon.name}`,
    bodyClass: 'app',
    body: html`<header class="bar"><div class="wrap bar-inner">
  <a class="brand" href="/app">${MARK}<span>${salon.name}</span></a>
  <div class="bar-actions">
    <form class="inline" method="post" action="/logout"><button class="btn btn-link btn-small" type="submit">${t('Log out')}</button></form>
  </div>
  <nav class="nav" aria-label="${t('Dashboard')}">
    <ul>${APP_NAV.filter(([path]) => c.user.role !== 'staff' || ['/app', '/app/appointments', '/app/availability', '/app/account'].includes(path)).map(
      ([href, label]) => html`<li><a href="${href}"${href === current ? raw(' aria-current="page"') : ''}>${t(label)}</a></li>`,
    )}</ul>
  </nav>
</div></header>
${banners.length ? html`<div class="wrap banners">${banners}</div>` : ''}
<main id="main"><div class="wrap">${body}</div></main>
${footer(c)}`,
  });
}

/* ------------------------------- form helpers ------------------------------ */

function errorFor(errors, name) {
  return errors && errors[name] ? html`<span class="error-text" id="${name}-error">${errors[name]}</span>` : '';
}

function invalid(errors, name) {
  return errors && errors[name] ? raw(` aria-invalid="true" aria-describedby="${name}-error"`) : '';
}

function formErrors(c, errors) {
  const n = errors ? Object.keys(errors).length : 0;
  if (!n) return '';
  return html`<div class="notice notice-error" role="alert"><p>${c.t.n(n, 'Please correct the highlighted field.', 'Please correct the {n} highlighted fields.')}</p></div>`;
}

function notice(kind, text) {
  if (!text) return '';
  return html`<div class="notice notice-${kind}" role="${kind === 'error' ? 'alert' : 'status'}"><p>${text}</p></div>`;
}

function selected(cond) {
  return cond ? raw(' selected') : '';
}

function checked(cond) {
  return cond ? raw(' checked') : '';
}

function langField(c) {
  return html`<input type="hidden" name="lang" value="${c.locale}">`;
}

/**
 * A translated sentence with markup inside it, e.g.
 *   rich(t, 'I accept the {terms} and the {privacy}.', { terms: html`<a …>…</a>`, privacy: … })
 * Text parts are escaped; each placeholder is replaced by its (already safe) part,
 * so translators can move the links to wherever their language needs them.
 */
function rich(t, key, parts) {
  const template = t(key);
  const out = [];
  let last = 0;
  template.replace(/\{(\w+)\}/g, (match, name, index) => {
    out.push(template.slice(last, index));
    out.push(Object.prototype.hasOwnProperty.call(parts, name) ? parts[name] : match);
    last = index + match.length;
    return match;
  });
  out.push(template.slice(last));
  return html`${out}`;
}
return { withLang, document, sitePage, publicPage, appPage, errorFor, invalid, formErrors, notice, selected, checked, langField, rich };
})();

// src/validate.js
const __m21 = (() => {
// Copyright (c) 2026 Miloš Petrović (Trench Logic Studio) · SPDX-License-Identifier: MIT
// Form input validation. Each reader returns the clean value or records a
// human-readable error against the field name.

class FormReader {
  /** `t` translates messages and field labels (English keys); defaults to English. */
  constructor(params, t = (key, vars) => key.replace(/\{(\w+)\}/g, (m, k) => (vars && k in vars ? String(vars[k]) : m))) {
    this.params = params;
    this.t = t;
    this.errors = {};
  }

  get ok() {
    return Object.keys(this.errors).length === 0;
  }

  fail(field, message) {
    if (!this.errors[field]) this.errors[field] = message;
    return null;
  }

  raw(field) {
    const v = this.params.get(field);
    return v === null ? '' : v;
  }

  text(field, { label = field, min = 1, max = 120, optional = false } = {}) {
    const t = this.t;
    // eslint-disable-next-line no-control-regex -- control characters are removed from input on purpose
    const v = this.raw(field).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().replace(/\s+/g, ' ');
    if (!v) return optional ? '' : this.fail(field, t('{label} is required.', { label: t(label) }));
    if (v.length < min) return this.fail(field, t('{label} is too short.', { label: t(label) }));
    if (v.length > max) return this.fail(field, t('{label} must be at most {max} characters.', { label: t(label), max }));
    return v;
  }

  multiline(field, { label = field, max = 300 } = {}) {
    const t = this.t;
    // eslint-disable-next-line no-control-regex -- control characters are removed from input on purpose
    const v = this.raw(field).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim();
    if (v.length > max) return this.fail(field, t('{label} must be at most {max} characters.', { label: t(label), max }));
    return v;
  }

  int(field, { label = field, min, max, step = 1 } = {}) {
    const t = this.t;
    const s = this.raw(field).trim();
    if (!/^-?\d{1,7}$/.test(s)) return this.fail(field, t('{label} must be a whole number.', { label: t(label) }));
    const n = Number(s);
    if (n < min || n > max) return this.fail(field, t('{label} must be between {min} and {max}.', { label: t(label), min, max }));
    if (step > 1 && n % step !== 0) return this.fail(field, t('{label} must be a multiple of {step}.', { label: t(label), step }));
    return n;
  }

  email(field) {
    const t = this.t;
    const v = this.raw(field).trim().toLowerCase();
    if (!v) return this.fail(field, t('{label} is required.', { label: t('Email') }));
    if (v.length > 254 || !/^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]{2,}$/.test(v)) {
      return this.fail(field, t('Enter a valid email address.'));
    }
    return v;
  }

  password(field, { label = 'Password' } = {}) {
    const t = this.t;
    const v = this.raw(field);
    if (v.length < 10) return this.fail(field, t('{label} must be at least 10 characters.', { label: t(label) }));
    if (v.length > 200) return this.fail(field, t('{label} is too long.', { label: t(label) }));
    return v;
  }

  checkbox(field) {
    const v = this.raw(field);
    return v === 'on' || v === '1' || v === 'yes';
  }

  oneOf(field, allowed, { message = 'Choose a valid option.' } = {}) {
    const v = this.raw(field).trim();
    if (!allowed.includes(v)) return this.fail(field, this.t(message));
    return v;
  }
}

/** A client's phone number or email, kept as typed; only its shape is checked. */
function contactKind(value) {
  const v = String(value || '').trim();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) return 'email';
  const digits = v.replace(/[^\d]/g, '');
  if (/^\+?[\d\s().\-/]{6,}$/.test(v) && digits.length >= 6 && digits.length <= 16) return 'phone';
  return null;
}

/** ASCII slug for public links: 'Studio Lumen & Co' → 'studio-lumen-co' */
function slugify(name) {
  const s = String(name)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  return s.length >= 2 ? s : 'salon';
}

function isValidSlug(slug) {
  return typeof slug === 'string' && /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/.test(slug) && slug.length >= 2;
}
return { FormReader, contactKind, slugify, isValidSlug };
})();

// src/events.js
const __m22 = (() => {
// Copyright (c) 2026 Miloš Petrović (Trench Logic Studio) · SPDX-License-Identifier: MIT
// Tamper-evident audit log. Every event carries the hash of the one before it
// (per salon), so editing or deleting any past event breaks the chain at that
// point. UNIQUE(salon_id, prev_hash) makes a fork impossible: two writers that
// raced on the same parent cannot both commit, and the loser retries.
//
// Payloads never hold personal data, so erasing a client's details after the
// retention period never touches the chain.

const { sha256Hex } = __m1;

const GENESIS = '0'.repeat(64);

async function chainHash(prev, salonId, type, payload, createdAt) {
  return sha256Hex(`${prev}\n${salonId}\n${type}\n${payload}\n${createdAt}`);
}

function isRetryable(err) {
  const msg = String(err && err.message);
  return /UNIQUE constraint failed: events\.salon_id, events\.prev_hash/.test(msg) || /UNIQUE constraint failed: requests\.salon_id, requests\.ref/.test(msg);
}

/**
 * Atomically run `statements(attempt)` together with one appended event.
 *
 * `statements` is a function so each retry can rebuild them (fresh references);
 * `payload` may be a function too, evaluated after `statements` on each attempt.
 * `condition`, when given, is SQL that must be true for the event to be written;
 * it is used when the main statement is itself conditional (for example a
 * capacity-checked confirmation), so a no-op never leaves an event behind.
 */
async function writeWithEvent(db, salonId, type, payload, statements = () => [], { condition = null, conditionParams = [], at = () => new Date() } = {}) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const stmts = statements(attempt);
    const body = JSON.stringify(typeof payload === 'function' ? payload(attempt) : payload);
    const last = await db.prepare('SELECT hash FROM events WHERE salon_id = ? ORDER BY id DESC LIMIT 1').bind(salonId).first();
    const prev = last ? last.hash : GENESIS;
    const createdAt = at().toISOString();
    const hash = await chainHash(prev, salonId, type, body, createdAt);
    const insert = condition
      ? db
          .prepare(`INSERT INTO events (salon_id, type, payload, created_at, prev_hash, hash) SELECT ?, ?, ?, ?, ?, ? WHERE ${condition}`)
          .bind(salonId, type, body, createdAt, prev, hash, ...conditionParams)
      : db
          .prepare('INSERT INTO events (salon_id, type, payload, created_at, prev_hash, hash) VALUES (?, ?, ?, ?, ?, ?)')
          .bind(salonId, type, body, createdAt, prev, hash);
    try {
      const results = await db.batch([...stmts, insert]);
      return results;
    } catch (err) {
      if (isRetryable(err) && attempt < 5) continue;
      throw err;
    }
  }
  throw new Error('Audit log busy, please retry');
}

async function appendEvent(db, salonId, type, payload, opts) {
  return writeWithEvent(db, salonId, type, payload, () => [], opts);
}

/** Walk a salon's chain from the start and recompute every hash. */
async function verifyChain(db, salonId) {
  const { results } = await db
    .prepare('SELECT id, type, payload, created_at, prev_hash, hash FROM events WHERE salon_id = ? ORDER BY id ASC')
    .bind(salonId)
    .all();
  let prev = GENESIS;
  for (const e of results) {
    if (e.prev_hash !== prev) return { ok: false, count: results.length, brokenAt: e.id, problem: 'link' };
    const expect = await chainHash(prev, salonId, e.type, e.payload, e.created_at);
    if (expect !== e.hash) return { ok: false, count: results.length, brokenAt: e.id, problem: 'hash' };
    prev = e.hash;
  }
  return { ok: true, count: results.length, brokenAt: null, head: prev };
}
return { GENESIS, writeWithEvent, appendEvent, verifyChain };
})();

// src/ratelimit.js
const __m23 = (() => {
// Copyright (c) 2026 Miloš Petrović (Trench Logic Studio) · SPDX-License-Identifier: MIT
// Fixed-window rate limits kept in the database (no extra Cloudflare product
// needed). Keys hold a hash of the IP address, never the address itself.

const { sha256Hex } = __m1;

async function limiterKey(scope, value) {
  return `${scope}:${(await sha256Hex(`rrn-rl|${String(value || 'unknown').toLowerCase()}`)).slice(0, 32)}`;
}

/** Count one hit; returns true while the key is within its limit. */
async function hit(db, key, limit, windowSec, nowSec) {
  const row = await db
    .prepare(
      `INSERT INTO rate_limits (key, count, window_start) VALUES (?, 1, ?)
       ON CONFLICT(key) DO UPDATE SET
         count = CASE WHEN rate_limits.window_start <= ? THEN 1 ELSE rate_limits.count + 1 END,
         window_start = CASE WHEN rate_limits.window_start <= ? THEN excluded.window_start ELSE rate_limits.window_start END
       RETURNING count`,
    )
    .bind(key, nowSec, nowSec - windowSec, nowSec - windowSec)
    .first();
  return Number(row.count) <= limit;
}

/** Read without counting; returns true while the key is within its limit. */
async function check(db, key, limit, windowSec, nowSec) {
  const row = await db.prepare('SELECT count, window_start FROM rate_limits WHERE key = ?').bind(key).first();
  if (!row || row.window_start <= nowSec - windowSec) return true;
  return Number(row.count) < limit;
}

async function clear(db, key) {
  await db.prepare('DELETE FROM rate_limits WHERE key = ?').bind(key).run();
}
return { limiterKey, hit, check, clear };
})();

// src/notify.js
const __m24 = (() => {
// Copyright (c) 2026 Miloš Petrović (Trench Logic Studio) · SPDX-License-Identifier: MIT
// What the app tells people by email, in each recipient's language: the salon
// about new requests, the client about the answer. Everything is queued in the
// outbox; nothing is queued when no mail provider is configured or for demo salons.

const { html } = __m19;
const { translator, htmlLang } = __m18;
const { contactKind } = __m21;
const { enqueue } = __m3;
const { parseUpgrades } = __m10;
const { RETENTION_DAYS, RESET_LINK_HOURS } = __m0;

function email({ lang = 'en', heading, paragraphs, button, secondary, footer }) {
  const body = html`<!doctype html>
<html lang="${htmlLang(lang)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${heading}</title></head>
<body style="margin:0;padding:0;background:#f5f7f5;color:#1c2a29;font-family:system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif;font-size:16px;line-height:1.5">
<div style="max-width:520px;margin:0 auto;padding:28px 20px">
<h1 style="font-family:Georgia,'Times New Roman',serif;font-size:24px;line-height:1.25;margin:0 0 16px;color:#1c2a29">${heading}</h1>
${paragraphs.map((p) => html`<p style="margin:0 0 10px">${p}</p>`)}
${
  button
    ? html`<p style="margin:22px 0"><a href="${button.url}" style="display:inline-block;background:#8c2c4b;color:#ffffff;padding:11px 18px;border-radius:6px;text-decoration:none;font-weight:600">${button.label}</a></p>`
    : ''
}
${secondary ? html`<p style="margin:0 0 10px"><a href="${secondary.url}" style="color:#8c2c4b">${secondary.label}</a></p>` : ''}
<p style="margin:26px 0 0;color:#566563;font-size:13px">${footer}</p>
</div></body></html>`;
  const lines = [heading, '', ...paragraphs, ''];
  if (button) lines.push(`${button.label}: ${button.url}`);
  if (secondary) lines.push(`${secondary.label}: ${secondary.url}`);
  lines.push('', footer);
  return { html: String(body), text: lines.join('\n') };
}

function offerLines(t, r) {
  const what = [r.service_name, ...parseUpgrades(r.upgrades_json).map((u) => u.name)].join(' + ');
  return [
    `${t.dateLong(r.slot_date)}, ${t.timeRange(r.start_min, r.end_min)}`,
    what,
    t('{total} instead of {base}', { total: t.duration(r.total_min), base: t.duration(r.base_min) }),
    t('Price: {price}, the standard price', { price: t.money(r.price_cents, r.currency) }),
    t('Reference: {ref}', { ref: r.ref }),
  ];
}

function clientEmailOf(r) {
  return r.client_contact && contactKind(r.client_contact) === 'email' ? r.client_contact.trim() : null;
}

async function owners(db, salonId) {
  const { results } = await db.prepare('SELECT email, locale, notify_email FROM users WHERE salon_id = ? ORDER BY id').bind(salonId).all();
  return results;
}

function active(ctx, salon) {
  return Boolean(ctx.mail.provider) && !salon.is_demo;
}

/** A client sent an upgraded-offer request or joined the waitlist. */
async function notifyNewRequest(ctx, salon, r) {
  if (!active(ctx, salon)) return;
  const list = await owners(ctx.db, salon.id);
  const clientEmail = clientEmailOf(r);
  const statusUrl = `${ctx.origin}/r/${r.token}`;
  for (const owner of list) {
    if (!owner.notify_email) continue;
    const t = translator(owner.locale);
    const contact = `${r.client_name}, ${r.client_contact}`;
    const msg =
      r.kind === 'offer'
        ? email({
            lang: t.locale,
            heading: t('New request: {when}', { when: `${t.date(r.slot_date)} ${t.time(r.start_min)}` }),
            paragraphs: [t('A client asked for an upgraded appointment through your request page.'), ...offerLines(t, r), t('Client: {contact}', { contact })],
            button: { label: t('Confirm or decline'), url: `${ctx.origin}/app` },
            footer: t('You receive these emails because notifications are on in Settings.'),
          })
        : email({
            lang: t.locale,
            heading: t('New waitlist request: {service}', { service: r.service_name }),
            paragraphs: [
              t('A client joined your waitlist.'),
              t('Client: {contact}', { contact }),
              ...(r.note ? [t('Note: “{note}”', { note: r.note })] : []),
              t('Reference: {ref}', { ref: r.ref }),
            ],
            button: { label: t('Open your dashboard'), url: `${ctx.origin}/app` },
            footer: t('You receive these emails because notifications are on in Settings.'),
          });
    await enqueue(
      ctx.db,
      {
        salonId: salon.id, requestId: r.id, requestRevision: r.revision,
        kind: `owner.${r.kind}`,
        to: owner.email,
        replyTo: clientEmail,
        subject: r.kind === 'offer' ? t('New request: {when}', { when: `${t.date(r.slot_date)} ${t.time(r.start_min)}` }) : t('New waitlist request: {service}', { service: r.service_name }),
        ...msg,
      },
      ctx.now,
    );
  }
  if (clientEmail) {
    const t = translator(r.locale);
    const footer = t('You receive this email because you sent a request to {salon}. Your details are deleted {days} days after the appointment.', {
      salon: salon.name,
      days: RETENTION_DAYS,
    });
    const msg =
      r.kind === 'offer'
        ? {
            subject: t('Your request at {salon}', { salon: salon.name }),
            ...email({
              lang: t.locale,
              heading: t('Request sent'),
              paragraphs: [t('{salon} has your request and will confirm it personally.', { salon: salon.name }), ...offerLines(t, r)],
              button: { label: t('See your request'), url: statusUrl },
              footer,
            }),
          }
        : {
            subject: t('You are on the waitlist at {salon}', { salon: salon.name }),
            ...email({
              lang: t.locale,
              heading: t('You are on the waitlist'),
              paragraphs: [t('{salon} will contact you when a place opens.', { salon: salon.name }), r.service_name, t('Reference: {ref}', { ref: r.ref })],
              button: { label: t('See your request'), url: statusUrl },
              footer,
            }),
          };
    await enqueue(ctx.db, { salonId: salon.id, requestId: r.id, requestRevision: r.revision, kind: `client.${r.kind}`, to: clientEmail, replyTo: list[0]?.email || null, ...msg }, ctx.now);
  }
}

/** The salon confirmed or declined. Only clients who left an email address hear about it by email. */
async function notifyDecision(ctx, salon, r) {
  if (!active(ctx, salon)) return;
  const clientEmail = clientEmailOf(r);
  if (!clientEmail || r.kind !== 'offer') return;
  const t = translator(r.locale);
  const list = await owners(ctx.db, salon.id);
  const footer = t('You receive this email because you sent a request to {salon}. Your details are deleted {days} days after the appointment.', {
    salon: salon.name,
    days: RETENTION_DAYS,
  });
  let msg;
  if (r.status === 'confirmed') {
    const extra = [];
    if (salon.address) extra.push(t('Address: {address}', { address: salon.address }));
    if (salon.phone) extra.push(t('Phone: {phone}', { phone: salon.phone }));
    msg = {
      subject: t('Confirmed: {when} at {salon}', { when: `${t.date(r.slot_date)} ${t.time(r.start_min)}`, salon: salon.name }),
      ...email({
        lang: t.locale,
        heading: t('Confirmed'),
        paragraphs: [t('{salon} has confirmed your appointment.', { salon: salon.name }), ...offerLines(t, r), ...extra],
        button: { label: t('Add to calendar'), url: `${ctx.origin}/r/${r.token}/calendar.ics` },
        secondary: { label: t('See your request'), url: `${ctx.origin}/r/${r.token}` },
        footer,
      }),
    };
  } else if (r.status === 'declined') {
    msg = {
      subject: t('{salon} could not confirm your request', { salon: salon.name }),
      ...email({
        lang: t.locale,
        heading: t('Not available'),
        paragraphs: [t('{salon} could not confirm the time you chose. You are welcome to pick another one.', { salon: salon.name })],
        button: { label: t('Choose another time'), url: `${ctx.origin}/s/${salon.slug}?lang=${r.locale}` },
        footer,
      }),
    };
  } else {
    return;
  }
  await enqueue(ctx.db, { salonId: salon.id, requestId: r.id, requestRevision: r.revision, kind: `client.${r.status}`, to: clientEmail, replyTo: list[0]?.email || null, ...msg }, ctx.now);
}

async function notifyPasswordReset(ctx, user, link) {
  if (!ctx.mail.provider) return;
  const t = translator(user.locale);
  const msg = {
    subject: t('Reset your password'),
    ...email({
      lang: t.locale,
      heading: t('Reset your password'),
      paragraphs: [
        t('Someone asked to reset the password for your account. If it was you, choose a new password with the link below. It works once, for {hours} hours.', {
          hours: RESET_LINK_HOURS,
        }),
        t('If it was not you, ignore this email: nothing changes.'),
      ],
      button: { label: t('Choose a new password'), url: link },
      footer: ctx.productName,
    }),
  };
  await enqueue(ctx.db, { salonId: user.salon_id ?? null, kind: 'user.reset', to: user.email, ...msg }, ctx.now);
}

async function notifyCancellation(ctx, salon, request) {
  if (!active(ctx, salon)) return;
  const list = await owners(ctx.db, salon.id);
  const recipients = [...list.filter((u) => u.notify_email).map((u) => ({ email: u.email, locale: u.locale }))];
  const client = clientEmailOf(request);
  if (client) recipients.push({ email: client, locale: request.locale });
  for (const recipient of recipients) {
    const t = translator(recipient.locale);
    const msg = email({ lang: t.locale, heading: t('Appointment canceled'), paragraphs: [salon.name, ...offerLines(t, request)],
      button: { label: t('See your request'), url: `${ctx.origin}/r/${request.token}` }, footer: salon.name });
    await enqueue(ctx.db, { salonId: salon.id, requestId: request.id, requestRevision: request.revision, kind: 'appointment.canceled', to: recipient.email, subject: t('Appointment canceled'),
      dedupeKey: `cancel:${request.token}:${request.outcome_at}:${recipient.email}`, ...msg }, ctx.now);
  }
}

async function notifyAccountToken(ctx, user, link, kind) {
  if (!ctx.mail.provider) return;
  const t = translator(user.locale);
  const heading = kind === 'invite' ? t('Join the salon team') : t('Verify your email');
  const msg = email({ lang: t.locale, heading, paragraphs: [t('This private link expires in 24 hours. If you did not request it, ignore this email.')],
    button: { label: heading, url: link }, footer: ctx.productName });
  await enqueue(ctx.db, { salonId: user.salon_id, kind: `account.${kind}`, to: user.email, subject: heading, ...msg }, ctx.now);
}

async function notifyReminder(ctx, salon, request) {
  const client = clientEmailOf(request);
  if (!active(ctx, salon) || !client) return;
  const t = translator(request.locale);
  const msg = email({ lang: t.locale, heading: t('Appointment reminder'), paragraphs: [salon.name, ...offerLines(t, request)],
    button: { label: t('See your request'), url: `${ctx.origin}/r/${request.token}` }, footer: salon.name });
  await enqueue(ctx.db, { salonId: salon.id, requestId: request.id, requestRevision: request.revision, kind: 'appointment.reminder', to: client, subject: t('Appointment reminder'),
    dedupeKey: `reminder:${request.token}:${request.revision}`, ...msg }, ctx.now);
}
return { notifyNewRequest, notifyDecision, notifyPasswordReset, notifyCancellation, notifyAccountToken, notifyReminder };
})();

// src/maintenance.js
const __m25 = (() => {
// Copyright (c) 2026 Miloš Petrović (Trench Logic Studio) · SPDX-License-Identifier: MIT
// Housekeeping: expire requests whose time has passed, erase client details
// after the retention period, and drop stale sessions, links and counters.
// Runs per salon when its pages load, and for everyone on the daily schedule.

const { RETENTION_DAYS } = __m0;
const { localNow, localToUtc, addDays, epochSeconds } = __m9;
const { pruneOutbox, deliverDue } = __m3;
const { notifyReminder } = __m24;

/** Pending offers whose start time has passed, and waitlist entries older than 30 days, expire. */
async function expireForSalon(db, salon, now) {
  const local = localNow(salon.timezone, now);
  const stamp = now.toISOString();
  await db
    .prepare(
      `UPDATE requests SET status = 'expired', revision = revision + 1, decided_at = ?
        WHERE salon_id = ? AND status = 'pending' AND (
          (kind = 'offer' AND (slot_date < ? OR (slot_date = ? AND start_min <= ?) OR hold_expires_at <= ?))
          OR (kind = 'waitlist' AND created_at < ?)
        )`,
    )
    .bind(stamp, salon.id, local.date, local.date, local.min, stamp, new Date(now.getTime() - 30 * 86400000).toISOString())
    .run();
}

/** Erase client name, contact and note once the retention period has passed. Metrics keep working. */
async function erasePersonalData(db, now, salonId = null) {
  const cutoffDate = addDays(now.toISOString().slice(0, 10), -RETENTION_DAYS);
  const cutoffIso = new Date(now.getTime() - RETENTION_DAYS * 86400000).toISOString();
  const scope = salonId === null ? '' : 'AND salon_id = ?';
  const params = [now.toISOString(), cutoffDate, cutoffIso];
  if (salonId !== null) params.push(salonId);
  await db
    .prepare(
      `UPDATE requests SET client_name = NULL, client_contact = NULL, note = NULL, erased_at = ?
        WHERE erased_at IS NULL
          AND ((kind = 'offer' AND slot_date < ?) OR (kind = 'waitlist' AND created_at < ?))
          ${scope}`,
    )
    .bind(...params)
    .run();
}

async function dailyMaintenance(db, now = new Date(), { env = {}, mail = null, fetchImpl = globalThis.fetch, productName = 'Reflow' } = {}) {
  const sec = epochSeconds(now);
  const iso = now.toISOString();
  const yesterday = addDays(iso.slice(0, 10), -1);
  const month = new Date(now.getTime() - 30 * 86400000).toISOString();
  await db.batch([
    // Any pending offer dated before yesterday (UTC) is past in every time zone.
    db.prepare(`UPDATE requests SET status = 'expired', revision = revision + 1, decided_at = ? WHERE status = 'pending' AND kind = 'offer' AND (slot_date < ? OR hold_expires_at <= ?)`).bind(iso, yesterday, iso),
    db.prepare('DELETE FROM salons WHERE is_demo = 1 AND demo_expires_at < ?').bind(iso),
    db.prepare('DELETE FROM account_tokens WHERE expires_at <= ? OR used_at IS NOT NULL').bind(sec),
    db.prepare('DELETE FROM time_blocks WHERE slot_date < ?').bind(yesterday),
    db.prepare('DELETE FROM sessions WHERE expires_at <= ?').bind(sec),
    db.prepare('DELETE FROM admin_sessions WHERE expires_at <= ?').bind(sec),
    db.prepare('DELETE FROM password_resets WHERE expires_at <= ? OR used_at IS NOT NULL').bind(sec),
    db.prepare('DELETE FROM rate_limits WHERE window_start <= ?').bind(sec - 2 * 86400),
    db.prepare('DELETE FROM error_log WHERE at < ?').bind(month),
    db.prepare('DELETE FROM webhook_events WHERE received_at < ?').bind(new Date(now.getTime() - 90 * 86400000).toISOString()),
  ]);
  await erasePersonalData(db, now);
  await pruneOutbox(db, now);
  if (mail?.provider && /^https:\/\//.test(env.PUBLIC_ORIGIN || '')) {
    const { results: due } = await db.prepare(`SELECT r.*, s.name AS salon_name, s.timezone, s.is_demo FROM requests r JOIN salons s ON s.id = r.salon_id
      WHERE r.kind = 'offer' AND r.status = 'confirmed' AND r.outcome IS NULL AND r.client_contact LIKE '%@%' AND s.is_demo = 0
      AND r.slot_date BETWEEN ? AND ? AND r.decided_at <= ?
      AND NOT EXISTS (SELECT 1 FROM outbox o WHERE o.request_id = r.id AND o.kind = 'appointment.reminder' AND o.request_revision = r.revision)
      ORDER BY r.slot_date, r.start_min LIMIT 500`).bind(addDays(iso.slice(0,10),-1),addDays(iso.slice(0,10),2),new Date(now.getTime()-2*3600000).toISOString()).all();
    for (const request of due) {
      const remaining = localToUtc(request.slot_date,request.start_min,request.timezone)-now;
      if (remaining > 2*3600000 && remaining <= 24*3600000) await notifyReminder({ db,mail,now,origin:new URL(env.PUBLIC_ORIGIN).origin },{ id:request.salon_id,name:request.salon_name,is_demo:0 },request);
    }
  }
  if (mail && mail.provider) await deliverDue(db, env, mail, now, { limit: 50, fetchImpl, productName });
}
return { expireForSalon, erasePersonalData, dailyMaintenance };
})();

// src/stats.js
const __m26 = (() => {
// Copyright (c) 2026 Miloš Petrović (Trench Logic Studio) · SPDX-License-Identifier: MIT
// Privacy-friendly results: one counter per salon, day and step. No cookies,
// no IP addresses, no per-visitor records. Link previews and bots are not counted.

const FUNNEL = ['view', 'offers', 'noslot', 'request', 'waitlist', 'confirmed'];

const BOT_RE = /bot|crawl|spider|slurp|preview|facebookexternalhit|whatsapp|telegram|discord|skype|slack|headless|lighthouse|curl|wget|python|java\/|go-http|monitor|uptime|pingdom/i;

function isBot(userAgent) {
  return !userAgent || BOT_RE.test(userAgent);
}

async function bump(db, salonId, metric, day) {
  await db
    .prepare('INSERT INTO stats_daily (salon_id, day, metric, n) VALUES (?, ?, ?, 1) ON CONFLICT(salon_id, day, metric) DO UPDATE SET n = n + 1')
    .bind(salonId, day, metric)
    .run();
}

async function seed(db, salonId, day, metric, n) {
  await db
    .prepare('INSERT INTO stats_daily (salon_id, day, metric, n) VALUES (?, ?, ?, ?) ON CONFLICT(salon_id, day, metric) DO UPDATE SET n = excluded.n')
    .bind(salonId, day, metric, n)
    .run();
}

/** Totals per step since `fromDay` (inclusive), for one salon or for all (salonId null). */
async function funnel(db, salonId, fromDay) {
  const scoped = salonId === null ? '' : 'salon_id = ? AND';
  const params = salonId === null ? [fromDay] : [salonId, fromDay];
  const { results } = await db
    .prepare(`SELECT metric, SUM(n) AS n FROM stats_daily WHERE ${scoped} day >= ? GROUP BY metric`)
    .bind(...params)
    .all();
  const out = Object.fromEntries(FUNNEL.map((m) => [m, 0]));
  for (const r of results) if (r.metric in out) out[r.metric] = Number(r.n);
  return out;
}
return { FUNNEL, isBot, bump, seed, funnel };
})();

// src/availability.js
const __m27 = (() => {
// Copyright (c) 2026 Miloš Petrović (Trench Logic Studio) · SPDX-License-Identifier: MIT
const { isoWeekday, localToUtc, localNow } = __m9;

/** One SQL predicate used by creation, confirmation and rescheduling. No read/write race. */
function availabilityGuard(salonId, slot, now, excludeId = 0, confirmedOnly = false) {
  return {
    sql: `COALESCE((SELECT MAX(capacity) FROM windows WHERE salon_id = ? AND weekday = ? AND start_min <= ? AND end_min >= ?), 0)
      > (SELECT COUNT(*) FROM requests WHERE salon_id = ? AND kind = 'offer' AND ${confirmedOnly ? "status = 'confirmed'" : "status IN ('pending', 'confirmed')"}
        AND id <> ? AND slot_date = ? AND start_min < ? AND end_min > ?
        AND (status = 'confirmed' OR hold_expires_at IS NULL OR hold_expires_at > ?))
      + COALESCE((SELECT SUM(capacity) FROM time_blocks WHERE salon_id = ? AND slot_date = ? AND start_min < ? AND end_min > ?), 0)`,
    params: [salonId, isoWeekday(slot.slot_date), slot.start_min, slot.end_min, salonId, excludeId, slot.slot_date, slot.end_min, slot.start_min,
      now.toISOString(), salonId, slot.slot_date, slot.end_min, slot.start_min],
  };
}

/** Do not offer nonexistent times or appointments crossing a daylight-saving transition. */
function validSlotInstant(slot, timezone) {
  const start = localToUtc(slot.slot_date, slot.start_min, timezone);
  const end = localToUtc(slot.slot_date, slot.end_min, timezone);
  const roundtrip = localNow(timezone, start);
  return roundtrip.date === slot.slot_date && roundtrip.min === slot.start_min &&
    end.getTime() - start.getTime() === (slot.end_min - slot.start_min) * 60000;
}

function canClientCancel(request, salon, now) {
  if (request.outcome || !['pending', 'confirmed'].includes(request.status)) return false;
  if (request.status === 'pending') return true;
  return localToUtc(request.slot_date, request.start_min, salon.timezone).getTime() - now.getTime() >= salon.cancel_notice_min * 60000;
}
return { availabilityGuard, validSlotInstant, canClientCancel };
})();

// src/quote.js
const __m28 = (() => {
// Copyright (c) 2026 Miloš Petrović (Trench Logic Studio) · SPDX-License-Identifier: MIT
// What the client was shown travels with the choice. The engine's key names the
// time and the upgrades; the quote adds the price and the total duration. A
// request sent from a page that has since changed (the salon edited the price or
// the length of the service) is then refused and the client sees the current
// offers, instead of being stored at terms the client never saw.

const { findOffer } = __m8;

/** The value of the radio button for one offer: engine key, price, total minutes. */
function quotedKey(offer) {
  return `${offer.key}~${offer.price_cents}.${offer.total_min}`;
}

/** The current offer that matches a submitted value in time, upgrades, price and duration; otherwise null. */
function findQuotedOffer(result, value) {
  const text = typeof value === 'string' ? value : '';
  const cut = text.lastIndexOf('~');
  if (cut < 0) return null;
  const offer = findOffer(result, text.slice(0, cut));
  return offer && quotedKey(offer) === text ? offer : null;
}
return { quotedKey, findQuotedOffer };
})();

// src/ics.js
const __m29 = (() => {
// Copyright (c) 2026 Miloš Petrović (Trench Logic Studio) · SPDX-License-Identifier: MIT
// iCalendar (RFC 5545) output: a salon's subscribable feed of confirmed
// appointments, and a single-event file a client can add to their calendar.
// Times are written in UTC, so every calendar app places them correctly.

const enc = new TextEncoder();

function icsText(value) {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/** Fold a content line at 75 octets without splitting a UTF-8 character. */
function fold(line) {
  if (enc.encode(line).length <= 75) return line;
  const parts = [];
  let current = '';
  let bytes = 0;
  let limit = 75;
  for (const ch of line) {
    const size = enc.encode(ch).length;
    if (bytes + size > limit) {
      parts.push(current);
      current = '';
      bytes = 0;
      limit = 74; // continuation lines start with a space
    }
    current += ch;
    bytes += size;
  }
  parts.push(current);
  return parts.join('\r\n ');
}

function icsStamp(date) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/**
 * calendar({ name, events: [{ uid, start: Date, end: Date, summary, description, location }], now })
 */
function calendar({ name, events, now = new Date() }) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//RRN SaaS//Reflow//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${icsText(name)}`,
  ];
  for (const e of events) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${icsText(e.uid)}`,
      `DTSTAMP:${icsStamp(now)}`,
      `DTSTART:${icsStamp(e.start)}`,
      `DTEND:${icsStamp(e.end)}`,
      `SUMMARY:${icsText(e.summary)}`,
    );
    if (e.description) lines.push(`DESCRIPTION:${icsText(e.description)}`);
    if (e.location) lines.push(`LOCATION:${icsText(e.location)}`);
    lines.push('STATUS:CONFIRMED', 'TRANSP:OPAQUE', 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
return { icsText, icsStamp, calendar };
})();

// engines/relay/engine.js
const __m30 = (() => {
// Copyright (c) 2026 Miloš Petrović (Trench Logic Studio) · SPDX-License-Identifier: MIT
/*!
 * Relay engine · placeholder
 *
 * Relay routes overflow from one location to another location (or sister brand)
 * that has room, at the same price. It switches on when the first multi-location
 * customer joins; until then the SaaS shows Relay as "coming".
 *
 * Kept as its own module so it can be built, tested and licensed separately.
 */
const ENGINE = Object.freeze({ name: 'relay', version: '0.0.0', status: 'planned' });
return { ENGINE };
})();

// engines/nexus/engine.js
const __m31 = (() => {
// Copyright (c) 2026 Miloš Petrović (Trench Logic Studio) · SPDX-License-Identifier: MIT
/*!
 * Nexus engine · placeholder
 *
 * Nexus shares overflow across a network of trusted partner businesses, where
 * priority is earned through reliability and can never be bought. It is the last
 * tier to switch on; until then the SaaS shows Nexus as "coming".
 *
 * Kept as its own module so it can be built, tested and licensed separately.
 */
const ENGINE = Object.freeze({ name: 'nexus', version: '0.0.0', status: 'planned' });
return { ENGINE };
})();

// src/plans.js
const __m32 = (() => {
// Copyright (c) 2026 Miloš Petrović (Trench Logic Studio) · SPDX-License-Identifier: MIT
// Subscription tiers. One product, one login; each tier switches on its own
// engine module. Only Reflow is live so far; the others collect interest.

const { tk } = __m18;
const { ENGINE: REFLOW } = __m8;
const { ENGINE: RELAY } = __m30;
const { ENGINE: NEXUS } = __m31;

const PLANS = [
  {
    id: 'reflow',
    name: 'Reflow',
    engine: REFLOW,
    status: 'active',
    scope: tk('One location'),
    pitch: tk('When a client finds you fully booked, offer an upgraded appointment in a quieter hour, at exactly the same price.'),
    features: [tk('Your own request page to share anywhere'), tk('Upgrades you define, at least +30% more time'), tk('Never a discount, enforced by the system'), tk('You confirm every request yourself')],
    price: tk('Free during beta'),
  },
  {
    id: 'relay',
    name: 'Relay',
    engine: RELAY,
    status: 'coming',
    scope: tk('Several locations'),
    pitch: tk('When one location is full, route the client to your location or sister brand that has room, at the same price.'),
    features: [tk('Everything in Reflow'), tk('Overflow routed between your locations'), tk('One view across all locations')],
    price: tk('Opens with the first multi-location salon'),
  },
  {
    id: 'nexus',
    name: 'Nexus',
    engine: NEXUS,
    status: 'coming',
    scope: tk('Partner network'),
    pitch: tk('Share overflow with trusted partner businesses. Priority is earned through reliability, never bought.'),
    features: [tk('Everything in Relay'), tk('Overflow shared with partner businesses'), tk('Trust-based priority')],
    price: tk('Later'),
  },
];

const planById = (id) => PLANS.find((p) => p.id === id) || PLANS[0];
return { PLANS, planById };
})();

// src/views/dashboard.js
const __m33 = (() => {
// Copyright (c) 2026 Miloš Petrović (Trench Logic Studio) · SPDX-License-Identifier: MIT
// The salon's main page: what needs an answer, what is coming up, and results.

const { html } = __m19;
const { appPage, notice } = __m20;
const { contactKind } = __m21;
const { translator, tk, LOCALE_NAMES, htmlLang } = __m18;
const { RETENTION_DAYS } = __m0;

const FLASH = {
  confirmed: ['ok', tk('Confirmed. The client’s page now shows it as confirmed.')],
  declined: ['ok', tk('Declined. The client’s page now offers them another time.')],
  closed: ['ok', tk('Marked as contacted.')],
  full: ['error', tk('That time is already at capacity. Add free chairs in Quiet hours to confirm it, or decline it.')],
  decided: ['info', tk('That request was already answered.')],
  service_added: ['ok', tk('Service added.')],
  service_saved: ['ok', tk('Service saved.')],
  service_hidden: ['ok', tk('Service hidden from clients.')],
  service_shown: ['ok', tk('Service is visible to clients again.')],
  upgrade_added: ['ok', tk('Upgrade added.')],
  upgrade_saved: ['ok', tk('Upgrade saved.')],
  upgrade_hidden: ['ok', tk('Upgrade switched off.')],
  upgrade_shown: ['ok', tk('Upgrade switched on.')],
  hours_added: ['ok', tk('Quiet hours added.')],
  hours_removed: ['ok', tk('Quiet hours removed.')],
  settings_saved: ['ok', tk('Settings saved.')],
  password_saved: ['ok', tk('Password changed. Other devices have been logged out.')],
  interest: ['ok', tk('Noted. You will hear from us when it opens.')],
  welcome: ['ok', tk('Your account is ready. A few short steps and your request page is live.')],
  setup_done: ['ok', tk('Your services, upgrades and quiet hours are set up. Your request page is live.')],
  calendar_new: ['ok', tk('New calendar address created. The old one no longer works.')],
  subscribed: ['ok', tk('Thank you! Your subscription becomes active as soon as the payment provider confirms it.')],
  demo: ['ok', tk('Welcome to the demo. Everything here is sample data you can change freely.')],
};

function flash(c, code) {
  const f = FLASH[code];
  return f ? notice(f[0], c.t(f[1])) : '';
}

const enc = encodeURIComponent;

/** Links that open WhatsApp, a text message, or an email with the message already written. */
function contactActions(c, contact, message, subject) {
  const t = c.t;
  if (!contact) return '';
  const kind = contactKind(contact);
  if (kind === 'email') {
    return html`<a class="btn btn-outline btn-small" href="mailto:${contact.trim()}?subject=${enc(subject)}&body=${enc(message)}">${t('Email')}</a>`;
  }
  if (kind === 'phone') {
    const international = /^\s*(\+|00)/.test(contact);
    const digits = contact.replace(/\D/g, '').replace(/^00/, '');
    const dial = contact.replace(/[^\d+]/g, '');
    return html`${international ? html`<a class="btn btn-outline btn-small" href="https://wa.me/${digits}?text=${enc(message)}" rel="noopener noreferrer" target="_blank">WhatsApp</a>` : ''}
    <a class="btn btn-outline btn-small" href="sms:${dial}?&body=${enc(message)}">${t('Text message')}</a>`;
  }
  return '';
}

/** Phone numbers stay on one line. */
const unbroken = (s) => String(s).replace(/ /g, '\u00a0');

function contactLink(c, value) {
  if (!value) return html`<span class="muted">${c.t('Details erased')}</span>`;
  const kind = contactKind(value);
  if (kind === 'email') return html`<a href="mailto:${value.trim()}">${value}</a>`;
  if (kind === 'phone') return html`<a href="tel:${value.replace(/[^\d+]/g, '')}">${unbroken(value)}</a>`;
  return html`<span>${value}</span>`;
}

const what = (r) => [r.service_name, ...(r.upgrades || []).map((u) => u.name)].join(' + ');

/** The confirmation message, written in the language the client used. */
function confirmationMessage(salon, r) {
  const tc = translator(r.locale);
  const first = r.client_name ? r.client_name.split(' ')[0] : '';
  return tc('Hi {name}, your appointment at {salon} is confirmed: {date} at {time}. {what} ({length}) for {price}, your usual price. Reference {ref}.', {
    name: first,
    salon: salon.name,
    date: tc.dateLong(r.slot_date),
    time: tc.time(r.start_min),
    what: what(r),
    length: tc.duration(r.total_min),
    price: tc.money(r.price_cents, r.currency),
    ref: r.ref,
  });
}

function waitlistMessage(salon, r) {
  const tc = translator(r.locale);
  const first = r.client_name ? r.client_name.split(' ')[0] : '';
  return tc('Hi {name}, this is {salon}. A place has opened up for {service}:', { name: first, salon: salon.name, service: r.service_name });
}

function statusLabel(c, r) {
  const t = c.t;
  if (r.status === 'pending') return r.kind === 'waitlist' ? t('Waitlist') : t('Waiting for you');
  return t({ confirmed: tk('Confirmed'), declined: tk('Declined'), expired: tk('Expired'), closed: tk('Contacted') }[r.status] || tk('Request'));
}

/** Clients may write in another language than the dashboard's: show which, so the owner replies in it. */
function clientLanguage(c, r) {
  if (!r.locale || r.locale === c.locale || !LOCALE_NAMES[r.locale]) return '';
  return html` <span class="small muted">· <span lang="${htmlLang(r.locale)}">${LOCALE_NAMES[r.locale]}</span></span>`;
}

function requestCard(c, r, { actions = true } = {}) {
  const t = c.t;
  const salon = c.user.salon;
  const message = r.status === 'confirmed' && r.client_name ? confirmationMessage(salon, r) : '';
  const subject = translator(r.locale)('Your appointment at {salon}', { salon: salon.name });
  return html`<li class="request is-${r.status}">
  <div class="request-top">
    <span class="request-when">${t.date(r.slot_date)}, <span class="num">${t.timeRange(r.start_min, r.end_min)}</span></span>
    <span class="badge badge-${r.status}">${statusLabel(c, r)}</span>
  </div>
  <div>${what(r)}</div>
  <div class="muted">${t('{total} instead of {base}', { total: t.duration(r.total_min), base: t.duration(r.base_min) })}, ${t.money(r.price_cents, r.currency)} (${t('standard price')})</div>
  <div class="request-who"><span>${r.client_name || t('Client')}</span>, ${contactLink(c, r.client_contact)}${clientLanguage(c, r)}</div>
  <div class="small muted">${t('Reference {ref}', { ref: r.ref })}</div>
  ${
    actions && r.status === 'pending'
      ? html`<div class="actions">
    <form class="inline" method="post" action="/app/requests/${r.id}/confirm"><button class="btn btn-confirm" type="submit">${t('Confirm')}</button></form>
    <form class="inline" method="post" action="/app/requests/${r.id}/decline"><button class="btn btn-outline" type="submit">${t('Decline')}</button></form>
  </div>`
      : ''
  }
  ${
    message
      ? html`<details>
    <summary>${t('Message for the client')}</summary>
    <textarea id="msg-${r.id}" readonly rows="4">${message}</textarea>
    <div class="actions">
      <button class="btn btn-outline btn-small" type="button" data-copy="#msg-${r.id}">${t('Copy message')}</button>
      ${contactActions(c, r.client_contact, message, subject)}
    </div>
  </details>`
      : ''
  }
</li>`;
}

function waitlistCard(c, r) {
  const t = c.t;
  const salon = c.user.salon;
  const message = r.client_name ? waitlistMessage(salon, r) : '';
  return html`<li class="request is-${r.status}">
  <div class="request-top">
    <span class="request-when">${r.service_name}</span>
    <span class="badge badge-${r.status}">${statusLabel(c, r)}</span>
  </div>
  <div class="request-who"><span>${r.client_name || t('Client')}</span>, ${contactLink(c, r.client_contact)}${clientLanguage(c, r)}</div>
  ${r.note ? html`<div><q>${r.note}</q></div>` : ''}
  <div class="small muted">${t('Reference {ref}, received {date}', { ref: r.ref, date: t.day(r.created_at, salon.timezone) })}</div>
  ${
    r.status === 'pending'
      ? html`<div class="actions">
    ${contactActions(c, r.client_contact, message, translator(r.locale)('Your appointment at {salon}', { salon: salon.name }))}
    <form class="inline" method="post" action="/app/requests/${r.id}/close"><button class="btn btn-outline btn-small" type="submit">${t('Mark as contacted')}</button></form>
  </div>`
      : ''
  }
</li>`;
}

function pct(part, whole) {
  return whole > 0 ? Math.round((part / whole) * 100) : 0;
}

function funnelPanel(c, f) {
  const t = c.t;
  const max = Math.max(1, f.view);
  const steps = [
    [t('Visits to your page'), f.view, null],
    [t('Saw upgraded times'), f.offers, pct(f.offers, f.view)],
    [t('Sent a request'), f.request, pct(f.request, f.offers)],
    [t('Confirmed'), f.confirmed, pct(f.confirmed, f.request)],
  ];
  return html`<section class="panel funnel" aria-labelledby="funnel-h">
  <h2 id="funnel-h">${t('Last 30 days')}</h2>
  <ol class="funnel-steps">
    ${steps.map(
      ([label, n, p]) => html`<li>
      <span class="funnel-label">${label}</span>
      <progress max="${max}" value="${n}" aria-hidden="true"></progress>
      <span class="funnel-n num">${n}${p === null ? '' : html` <small>${t('{pct}% of the step before', { pct: p })}</small>`}</span>
    </li>`,
    )}
  </ol>
  ${f.waitlist || f.noslot ? html`<p class="small muted">${t('Joined the waitlist: {n}. Times no upgraded slot was free: {m}.', { n: f.waitlist, m: f.noslot })}</p>` : ''}
</section>`;
}

function dashboardView(c, d) {
  const t = c.t;
  const salon = c.user.salon;
  const m = d.metrics;
  const revenue = m.revenue.length ? m.revenue.map((r) => t.money(r.cents, r.currency)).join(' + ') : t.money(0, salon.currency);
  const steps = [
    [d.setup.services > 0, d.setup.services > 0 ? '/app/services' : '/app/setup', d.setup.services > 0 ? t('Add the services clients book') : t('Pick your salon type and enter your prices')],
    [d.setup.readyServices > 0, '/app/upgrades', t('Add upgrades that add extra time')],
    [d.setup.windows > 0, '/app/hours', t('Mark the hours that are usually quiet')],
    [false, '/app/share', t('Share your link and put up the QR code')],
  ];
  const ready = steps.slice(0, 3).every((s) => s[0]);
  const body = html`
<div class="page-head">
  <div>
    <h1>${t('Requests')}</h1>
    <p class="muted">${t('Your request page:')} <a href="/s/${salon.slug}">${d.publicUrl}</a></p>
  </div>
</div>
${flash(c, d.flash)}
${
  ready
    ? ''
    : html`<section class="panel" aria-labelledby="setup-h">
  <h2 id="setup-h">${t('Get your request page ready')}</h2>
  <ol class="checklist">
    ${steps.map(([done, href, label]) => html`<li class="${done ? 'done' : ''}"><a href="${href}">${label}</a></li>`)}
  </ol>
</section>`
}

<h2 class="visually-hidden">${t('Results so far')}</h2>
<dl class="ledger">
  <div><dt>${t('Requests received')}</dt><dd>${m.offers}</dd></div>
  <div><dt>${t('Confirmed')}</dt><dd>${m.confirmed}</dd></div>
  <div><dt>${t('Booked value')}</dt><dd>${revenue}</dd></div>
  <div class="proof"><dt>${t('Discount given')}</dt><dd>${t.money(m.discount_cents, salon.currency)}</dd></div>
</dl>

<p class="small muted">${t('Booked value is not collected revenue. Mark completed services in Appointments.')} <a href="/app/appointments">${t('Appointments')}</a></p>
<dl class="ledger ledger-two"><div><dt>${t('Completed service value')}</dt><dd>${m.completed.length ? m.completed.map((r) => t.money(r.cents,r.currency)).join(' + ') : t.money(0,salon.currency)}</dd></div><div><dt>${t('Completed')}</dt><dd>${m.completed.reduce((sum,r)=>sum+r.n,0)}</dd></div></dl>
<h2>${t('Waiting for you')}</h2>
${
  d.pending.length
    ? html`<ul class="requests">${d.pending.map((r) => requestCard(c, r))}</ul>`
    : html`<p class="empty">${t('No requests waiting.')} ${ready ? t('Share your link where clients find you fully booked.') : t('Finish the steps above, then share your link.')}</p>`
}

${d.waitlist.length ? html`<h2>${t('Waitlist')}</h2><ul class="requests">${d.waitlist.map((r) => waitlistCard(c, r))}</ul>` : ''}

<h2>${t('Coming up')}</h2>
${
  d.upcoming.length
    ? html`<ul class="requests">${d.upcoming.map((r) => requestCard(c, r, { actions: false }))}</ul>`
    : html`<p class="empty">${t('Confirmed appointments from your request page appear here and in your calendar feed (see Settings).')}</p>`
}

${funnelPanel(c, d.funnel)}

${
  d.recent.length
    ? html`<section class="section"><h2>${t('Recently answered')}</h2>
<section class="table-wrap" tabindex="0" aria-label="${t('Recently answered')}"><table class="list">
  <thead><tr><th scope="col">${t('When')}</th><th scope="col">${t('Service')}</th><th scope="col">${t('Status')}</th><th scope="col">${t('Reference')}</th></tr></thead>
  <tbody>${d.recent.map(
    (r) => html`<tr>
    <td class="num nowrap">${r.kind === 'offer' ? html`${t.date(r.slot_date)} ${t.time(r.start_min)}` : t('Waitlist')}</td>
    <td>${r.service_name}</td>
    <td><span class="badge badge-${r.status}">${statusLabel(c, r)}</span></td>
    <td class="num nowrap">${r.ref}</td>
  </tr>`,
  )}</tbody>
</table></section>
<p class="small muted">${t('Client names and contact details are erased {days} days after each appointment. The numbers above keep counting.', { days: RETENTION_DAYS })}</p>
</section>`
    : ''
}`;
  return appPage(c, { title: t('Requests'), body, current: '/app', banners: d.banners });
}
return { FLASH, flash, contactActions, confirmationMessage, dashboardView };
})();

// src/money.js
const __m34 = (() => {
// Copyright (c) 2026 Miloš Petrović (Trench Logic Studio) · SPDX-License-Identifier: MIT
// Prices are stored as integer minor units (cents) and never as floats.

const CURRENCIES = [
  'EUR', 'USD', 'GBP', 'CHF', 'SEK', 'NOK', 'DKK', 'ISK', 'PLN', 'CZK', 'HUF', 'RON',
  'RSD', 'BAM', 'MKD', 'ALL', 'TRY', 'UAH', 'AED', 'ILS', 'ZAR', 'AUD', 'NZD', 'CAD', 'MXN', 'BRL', 'SGD', 'JPY',
];

/** '40' · '40.5' · '40,50' · '1 200,00' → cents, or null if not a valid price. */
function parseMoney(value) {
  let s = String(value ?? '').trim().replace(/[\s']/g, '');
  if (!s) return null;
  if (/^\d{1,3}(\.\d{3})+,\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.'); // 1.200,50
  else if (/^\d{1,3}(,\d{3})+(\.\d{1,2})?$/.test(s)) s = s.replace(/,/g, ''); // 1,200.50
  else s = s.replace(',', '.');
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(s)) return null;
  const [whole, frac = ''] = s.split('.');
  return Number(whole) * 100 + Number(frac.padEnd(2, '0'));
}

/** 4050 → '40.50' for form fields. */
function centsToInput(cents) {
  return (cents / 100).toFixed(2);
}
return { CURRENCIES, parseMoney, centsToInput };
})();

// src/views/settings.js
const __m35 = (() => {
// Copyright (c) 2026 Miloš Petrović (Trench Logic Studio) · SPDX-License-Identifier: MIT
// Settings, plan and billing, audit log.

const { html } = __m19;
const { appPage, errorFor, invalid, formErrors, notice, selected, checked } = __m20;
const { flash } = __m33;
const { CURRENCIES } = __m34;
const { timeZones } = __m9;
const { MIN_UPLIFT_PCT } = __m8;
const { PLANS } = __m32;
const { LOCALES, LOCALE_NAMES, tk } = __m18;

const NOTICE_OPTIONS = [
  [60, 60],
  [120, 120],
  [240, 240],
  [720, 720],
  [1440, 1440],
  [2880, 2880],
];

const NOTICE_MINUTES = NOTICE_OPTIONS.map(([m]) => String(m));

function settingsView(c, d) {
  const t = c.t;
  const salon = c.user.salon;
  const { values = {}, errors = {}, pwErrors = {}, delErrors = {}, flashCode = '', publicBase, calendarUrl, mailOn, banners = [] } = d;
  const v = {
    name: values.name ?? salon.name,
    slug: values.slug ?? salon.slug,
    address: values.address ?? (salon.address || ''),
    phone: values.phone ?? (salon.phone || ''),
    timezone: values.timezone ?? salon.timezone,
    currency: values.currency ?? salon.currency,
    locale: values.locale ?? salon.locale,
    uplift: values.uplift ?? String(salon.min_uplift_pct),
    lead: values.lead ?? String(salon.lead_min),
  };
  const body = html`
<div class="page-head"><div><h1>${t('Settings')}</h1><p class="muted">${t('Logged in as {email}', { email: c.user.email })}</p></div></div>
${flash(c, flashCode)}
<section class="panel" aria-labelledby="salon-h">
  <h2 id="salon-h">${t('Salon')}</h2>
  ${formErrors(c, errors)}
  <form method="post" action="/app/settings" novalidate>
    <div class="field">
      <label for="name">${t('Salon name')}</label>
      <input id="name" name="name" type="text" maxlength="80" required value="${v.name}"${invalid(errors, 'name')}>
      ${errorFor(errors, 'name')}
    </div>
    <div class="row row-2">
      <div class="field">
        <label for="address">${t('Address')} <span class="muted">${t('(optional)')}</span></label>
        <input id="address" name="address" type="text" maxlength="160" autocomplete="address-line1" value="${v.address}"${invalid(errors, 'address')}>
        <span class="hint">${t('Shown to clients on their confirmation.')}</span>
        ${errorFor(errors, 'address')}
      </div>
      <div class="field">
        <label for="phone">${t('Phone')} <span class="muted">${t('(optional)')}</span></label>
        <input id="phone" name="phone" type="tel" maxlength="40" autocomplete="tel" value="${v.phone}"${invalid(errors, 'phone')}>
        ${errorFor(errors, 'phone')}
      </div>
    </div>
    <div class="field">
      <label for="slug">${t('Page address')}</label>
      <input id="slug" name="slug" type="text" maxlength="40" required value="${v.slug}"${invalid(errors, 'slug')}>
      <span class="hint">${publicBase}/s/<b>${v.slug}</b>. ${t('Lowercase letters, numbers and dashes. Links you already shared stop working if you change it.')}</span>
      ${errorFor(errors, 'slug')}
    </div>
    <div class="row row-3">
      <div class="field">
        <label for="locale">${t('Language of your request page')}</label>
        <select id="locale" name="locale"${invalid(errors, 'locale')}>
          ${LOCALES.map((l) => html`<option value="${l}"${selected(l === v.locale)}>${LOCALE_NAMES[l]}</option>`)}
        </select>
        <span class="hint">${t('Clients can switch to another language on the page.')}</span>
      </div>
      <div class="field">
        <label for="timezone">${t('Time zone')}</label>
        <select id="timezone" name="timezone"${invalid(errors, 'timezone')}>
          ${timeZones().map((z) => html`<option value="${z}"${selected(z === v.timezone)}>${z.replace(/_/g, ' ')}</option>`)}
        </select>
        ${errorFor(errors, 'timezone')}
      </div>
      <div class="field">
        <label for="currency">${t('Currency')}</label>
        <select id="currency" name="currency"${invalid(errors, 'currency')}>
          ${CURRENCIES.map((cur) => html`<option value="${cur}"${selected(cur === v.currency)}>${cur}</option>`)}
        </select>
        ${errorFor(errors, 'currency')}
      </div>
    </div>
    <div class="row row-2">
      <div class="field">
        <label for="uplift">${t('Minimum extra time (%)')}</label>
        <input id="uplift" name="uplift" type="number" min="${MIN_UPLIFT_PCT}" max="200" step="5" inputmode="numeric" required value="${v.uplift}"${invalid(errors, 'uplift')}>
        <span class="hint">${t('At least {pct}%. Raise it if you want offers to feel even more generous.', { pct: MIN_UPLIFT_PCT })}</span>
        ${errorFor(errors, 'uplift')}
      </div>
      <div class="field">
        <label for="lead">${t('Minimum notice')}</label>
        <select id="lead" name="lead"${invalid(errors, 'lead')}>
          ${NOTICE_OPTIONS.map(([min]) => html`<option value="${min}"${selected(String(min) === String(v.lead))}>${t.duration(min)}</option>`)}
        </select>
        <span class="hint">${t('How soon an offered time can start, so you have time to confirm.')}</span>
        ${errorFor(errors, 'lead')}
      </div>
    </div>
    <button class="btn btn-primary" type="submit">${t('Save settings')}</button>
  </form>
</section>

<section class="panel" aria-labelledby="you-h">
  <h2 id="you-h">${t('You')}</h2>
  <form method="post" action="/app/settings/account" novalidate>
    <div class="row row-2">
      <div class="field">
        <label for="user-locale">${t('Language of your dashboard and emails')}</label>
        <select id="user-locale" name="locale">
          ${LOCALES.map((l) => html`<option value="${l}"${selected(l === c.locale)}>${LOCALE_NAMES[l]}</option>`)}
        </select>
      </div>
      <div class="field">
        <span class="label">${t('Email notifications')}</span>
        <label class="check"><input type="checkbox" name="notify" value="on"${checked(c.user.notify_email)}> <span>${t('Email me when a client sends a request')}</span></label>
        ${mailOn ? '' : html`<span class="hint">${t('Email sending is not set up on this installation yet, so no emails go out for now.')}</span>`}
      </div>
    </div>
    <button class="btn btn-outline" type="submit">${t('Save')}</button>
  </form>
</section>

<section class="panel" aria-labelledby="cal-h">
  <h2 id="cal-h">${t('Calendar')}</h2>
  <p class="muted">${t('Subscribe to this address in Google Calendar, Apple Calendar or Outlook, and every appointment you confirm appears there by itself. Keep the address private: it shows your clients’ names.')}</p>
  ${
    calendarUrl
      ? html`<div class="share-link"><code id="cal-url">${calendarUrl}</code><button class="btn btn-outline btn-small" type="button" data-copy="#cal-url">${t('Copy address')}</button></div>
  <form method="post" action="/app/settings/calendar" class="actions"><button class="btn btn-link btn-small" type="submit">${t('Create a new address (the old one stops working)')}</button></form>`
      : html`<form method="post" action="/app/settings/calendar"><button class="btn btn-outline" type="submit">${t('Create calendar address')}</button></form>`
  }
</section>

<section class="panel" aria-labelledby="export-h">
  <h2 id="export-h">${t('Export')}</h2>
  <p class="muted">${t('All requests as a spreadsheet file (CSV), for your records or another tool.')}</p>
  <a class="btn btn-outline" href="/app/export/requests.csv" download>${t('Download requests (CSV)')}</a>
</section>

<section class="panel" aria-labelledby="pw-h">
  <h2 id="pw-h">${t('Password')}</h2>
  ${formErrors(c, pwErrors)}
  <form method="post" action="/app/settings/password" novalidate>
    <div class="row row-2">
      <div class="field">
        <label for="current">${t('Current password')}</label>
        <input id="current" name="current" type="password" autocomplete="current-password" required${invalid(pwErrors, 'current')}>
        ${errorFor(pwErrors, 'current')}
      </div>
      <div class="field">
        <label for="password">${t('New password')}</label>
        <input id="password" name="password" type="password" autocomplete="new-password" minlength="10" required${invalid(pwErrors, 'password')}>
        ${errorFor(pwErrors, 'password')}
      </div>
    </div>
    <button class="btn btn-outline" type="submit">${t('Change password')}</button>
  </form>
</section>

<section class="panel" aria-labelledby="audit-h">
  <h2 id="audit-h">${t('Audit log')}</h2>
  <p class="muted">${t('Every offer, confirmation and price change is recorded in a tamper-evident log.')}</p>
  <a class="btn btn-outline" href="/app/audit">${t('Check the audit log')}</a>
</section>

<section class="panel" aria-labelledby="delete-h">
  <h2 id="delete-h">${t('Delete account')}</h2>
  <p class="muted">${t('Deletes your salon, services, requests and client details permanently. This cannot be undone.')}</p>
  ${formErrors(c, delErrors)}
  <form method="post" action="/app/settings/delete" novalidate>
    <div class="field">
      <label for="delete-password">${t('Your password')}</label>
      <input id="delete-password" name="password" type="password" autocomplete="current-password" required${invalid(delErrors, 'password')}>
      ${errorFor(delErrors, 'password')}
    </div>
    <button class="btn btn-danger" type="submit">${t('Delete account and all data')}</button>
  </form>
</section>`;
  return appPage(c, { title: t('Settings'), body: html`${body}<section class="panel"><h2>${t('Booking policy')}</h2><form method="post" action="/app/settings/policy"><div class="row row-2"><div class="field"><label for="cancel-notice">${t('Cancellation notice (minutes)')}</label><input id="cancel-notice" name="cancel_notice" type="number" min="0" max="10080" value="${salon.cancel_notice_min}" required></div><div class="field"><label for="hold-hours">${t('Request hold (hours)')}</label><input id="hold-hours" name="hold_hours" type="number" min="1" max="168" value="${salon.hold_hours}" required></div></div><p class="hint">${t('Unanswered requests release their reserved time when the hold expires.')}</p><button class="btn btn-primary">${t('Save')}</button></form></section>`, current: '/app/settings', banners });
}

/* ------------------------------ plan and billing ----------------------------- */

const STATUS_LINE = {
  beta: tk('You are on Reflow, free during the beta.'),
  trialing: tk('Free trial until {date}.'),
  active: tk('Your subscription is active.'),
  past_due: tk('Your last payment did not go through. Please update your payment method to keep your request page running.'),
  canceled: tk('Your subscription is cancelled. Upgraded offers keep running until {date}.'),
  paused: tk('Your subscription is paused. Clients can join your waitlist, but see no upgraded times.'),
  expired: tk('Your subscription is not active. Clients can join your waitlist, but see no upgraded times.'),
};

/** The live tier's offer when subscriptions are on: the configured price, else the trial. */
function planOffer(c) {
  const t = c.t;
  if (c.billing.priceLabel) return c.billing.priceLabel;
  return c.billing.trialDays ? t('{days}-day free trial', { days: c.billing.trialDays }) : t('Monthly subscription');
}

function billingLine(c, salon) {
  const t = c.t;
  const date = salon.billing_status === 'trialing' ? salon.trial_ends_at : salon.billing_period_end;
  return t(STATUS_LINE[salon.billing_status] || STATUS_LINE.expired, { date: date ? t.day(date, salon.timezone) : '' });
}

function planView(c, { interest, flashCode = '', banners = [], billing }) {
  const t = c.t;
  const salon = c.user.salon;
  const canSubscribe = billing.enabled && !['active', 'past_due'].includes(salon.billing_status) && !salon.is_demo;
  const body = html`
<div class="page-head"><div><h1>${t('Plan')}</h1><p class="muted">${t('One account, three levels.')}</p></div></div>
${flash(c, flashCode)}
${
  billing.enabled
    ? html`<section class="panel" aria-labelledby="billing-h">
  <h2 id="billing-h">${t('Subscription')}</h2>
  <p>${billingLine(c, salon)}</p>
  <div class="actions">
    ${canSubscribe ? html`<form method="post" action="/app/billing/checkout" class="inline"><button class="btn btn-primary" type="submit">${billing.priceLabel ? t('Subscribe: {price}', { price: billing.priceLabel }) : t('Subscribe')}</button></form>` : ''}
    ${billing.portalUrl && salon.billing_subscription_id ? html`<a class="btn btn-outline" href="${billing.portalUrl}" rel="noopener noreferrer">${t('Manage subscription and invoices')}</a>` : ''}
  </div>
</section>`
    : notice('info', t('You are on Reflow, free during the beta.'))
}
<ul class="tiers">
  ${PLANS.map((p) => {
    const live = p.status === 'active';
    const asked = interest.includes(p.id);
    return html`<li class="${live ? 'tier-live' : 'tier-soon'}">
    <span class="tier-name">${p.name}<span class="tier-scope">${t(p.scope)}</span></span>
    <span>${t(p.pitch)}<br><span class="small muted">${p.features.map((f) => t(f)).join('. ')}.</span></span>
    <div class="tier-state">${
      live
        ? html`${t('Your plan')}<br><span class="small muted">${billing.enabled ? planOffer(c) : t(p.price)}</span>`
        : asked
          ? html`${t('On the list')}<br><span class="small muted">${t('We will tell you when it opens')}</span>`
          : html`<form method="post" action="/app/plan/interest"><input type="hidden" name="tier" value="${p.id}"><button class="btn btn-outline btn-small" type="submit">${t('Tell me when {plan} opens', { plan: p.name })}</button></form>`
    }</div>
  </li>`;
  })}
</ul>`;
  return appPage(c, { title: t('Plan'), body, current: '/app/plan', banners });
}

/* ---------------------------------- audit ---------------------------------- */

const EVENT_LABELS = {
  'salon.created': tk('Account created'),
  'settings.updated': tk('Settings changed'),
  'service.created': tk('Service added'),
  'service.updated': tk('Service changed'),
  'upgrade.created': tk('Upgrade added'),
  'upgrade.updated': tk('Upgrade changed'),
  'window.created': tk('Quiet hours added'),
  'window.deleted': tk('Quiet hours removed'),
  'request.offer': tk('Offer requested'),
  'request.waitlist': tk('Waitlist request'),
  'request.confirmed': tk('Request confirmed'),
  'request.declined': tk('Request declined'),
  'request.closed': tk('Waitlist request handled'),
  'billing.updated': tk('Subscription changed'),
  'setup.applied': tk('Set up from a template'),
};

const BILLING_STATUS = {
  beta: tk('Free beta'),
  trialing: tk('Free trial'),
  active: tk('Active'),
  past_due: tk('Payment overdue'),
  canceled: tk('Cancelled'),
  paused: tk('Paused'),
  expired: tk('Ended'),
};

function describeEvent(c, e, currency) {
  const t = c.t;
  let p = {};
  try {
    p = JSON.parse(e.payload) || {};
  } catch {
    p = {};
  }
  const money = (cents, cur) => (Number.isInteger(cents) ? t.money(cents, cur || currency) : '');
  const days = (list) => (list || []).map((d) => t.weekdayShort(d)).join(', ');
  const chairs = (n) => t.n(n, '{n} chair', '{n} chairs');
  switch (e.type) {
    case 'salon.created':
      return t('Page address {slug}, {timezone}, {currency}', p);
    case 'settings.updated':
      return t('Page address {slug}, {timezone}, {currency}', p) + `, ${t('at least {pct}% extra time', { pct: p.min_uplift_pct })}`;
    case 'service.created':
      return `${p.name}, ${t.duration(p.duration_min)}, ${money(p.price_cents)}`;
    case 'service.updated':
      if (p.active !== undefined) return p.active ? t('Service {id} shown to clients', p) : t('Service {id} hidden from clients', p);
      return `${p.name}, ${t.duration(p.duration_min)}, ${money(p.price_cents)}${
        Number.isInteger(p.previous_price_cents) && p.previous_price_cents !== p.price_cents ? ` (${t('was {price}', { price: money(p.previous_price_cents) })})` : ''
      }`;
    case 'upgrade.created':
    case 'upgrade.updated':
      if (p.active !== undefined) return p.active ? t('Upgrade {id} switched on', p) : t('Upgrade {id} switched off', p);
      return `${p.name}, +${t('{m} min', { m: p.added_min })}`;
    case 'window.created':
      return `${days(p.weekdays)}, ${t.timeRange(p.start_min, p.end_min)}, ${chairs(p.capacity)}`;
    case 'window.deleted':
      return `${days([p.weekday])}, ${t.timeRange(p.start_min, p.end_min)}, ${chairs(p.capacity)}`;
    case 'request.offer':
      return `${p.ref ? `${p.ref}, ` : ''}${p.slot}, ${t.duration(p.base_min)} + ${t.duration(p.added_min)}, ${money(p.price_cents, p.currency)} (${t('standard price')} ${money(p.standard_price_cents, p.currency)})`;
    case 'request.waitlist':
      return p.ref ? String(p.ref) : '';
    case 'request.confirmed':
      return `${p.ref}, ${p.slot}, ${money(p.price_cents, p.currency)} (${t('standard price')} ${money(p.standard_price_cents, p.currency)})`;
    case 'billing.updated':
      return BILLING_STATUS[p.status] ? t(BILLING_STATUS[p.status]) : '';
    case 'setup.applied':
      return `${t.n(p.services, '{n} service', '{n} services')}, ${t.n(p.upgrades, '{n} upgrade', '{n} upgrades')}`;
    default:
      return p.ref ? String(p.ref) : '';
  }
}

function auditView(c, { chain, events, banners = [] }) {
  const t = c.t;
  const currency = c.user.salon.currency;
  const body = html`
<div class="page-head"><div><h1>${t('Audit log')}</h1><p class="muted">${t('Each entry carries the fingerprint of the one before it, so a changed or deleted entry breaks the chain.')}</p></div></div>
${
  chain.ok
    ? notice('ok', t.n(chain.count, 'Chain intact: {n} entry checked, none changed.', 'Chain intact: {n} entries checked, none changed.'))
    : notice('error', t('Chain broken at entry {id}. An entry was changed or removed outside the app.', { id: chain.brokenAt }))
}
<ul class="events">${events.map(
    (e) => html`<li>
    <time datetime="${e.created_at}">${t.instant(e.created_at, c.user.salon.timezone)}</time>
    <strong>${t(EVENT_LABELS[e.type] || e.type)}</strong>
    <span>${describeEvent(c, e, currency)}</span>
  </li>`,
  )}</ul>
${chain.ok && chain.head ? html`<p class="small muted">${t('Latest fingerprint:')} <code class="fingerprint">${chain.head}</code></p>` : ''}`;
  return appPage(c, { title: t('Audit log'), body, current: '/app/settings', banners });
}
return { NOTICE_MINUTES, settingsView, planOffer, billingLine, planView, auditView };
})();

// src/views/landing.js
const __m36 = (() => {
// Copyright (c) 2026 Miloš Petrović (Trench Logic Studio) · SPDX-License-Identifier: MIT
const { html, raw } = __m19;
const { sitePage, langField } = __m20;
const { PLANS } = __m32;
const { RETENTION_DAYS } = __m0;
const { planOffer } = __m35;

const ARROW = raw(
  '<svg viewBox="0 0 40 40" aria-hidden="true" focusable="false"><path d="M6 20h26m-9-9 9 9-9 9" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
);

function landingView(c, user) {
  const t = c.t;
  const name = c.config.productName;
  const price = t.money(4000, 'EUR');
  const start = user ? t('Open your dashboard') : !c.billing.enabled ? t('Start free beta') : c.billing.trialDays ? t('Start your free trial') : t('Create account');
  const demoForm = c.config.demoEnabled
    ? html`<form method="post" action="/demo" class="inline">${langField(c)}<input type="hidden" name="timezone" value="" data-detect-timezone-input><button class="btn btn-outline" type="submit">${t('Try the live demo')}</button></form>`
    : '';
  const body = html`
<section class="hero"><div class="wrap">
  <h1>${t('Turn “fully booked” into a booked client.')}</h1>
  <p class="lead">${t('When a client can’t get the time they wanted, {product} offers them a longer, upgraded appointment in your quiet hours, at your normal price. Your slow afternoons fill up and you never discount.', { product: name })}</p>
  <div class="actions">
    <a class="btn btn-primary" href="${user ? '/app' : c.link('/signup')}">${start}</a>
    ${user ? '' : demoForm}
    <a class="btn btn-link" href="#how">${t('See how it works')}</a>
  </div>

  <div class="demo" role="img" aria-label="${t('Example: Saturday is fully booked when the client wanted 11:00. {product} offers Tuesday 13:30 instead: cut and finish plus deep conditioning, 60 minutes instead of 45, for the same {price}.', { product: name, price })}">
    <div class="day day-full" aria-hidden="true">
      <p class="day-name">${t.weekday(6)} <small>${t('Fully booked')}</small></p>
      <ol class="slots">
        <li class="slot slot-busy"><span>10:00</span><span>${t('Booked')}</span></li>
        <li class="slot slot-busy"><span>10:30</span><span>${t('Booked')}</span></li>
        <li class="slot slot-busy slot-wanted"><span>11:00</span><span>${t('Wanted, but taken')}</span></li>
        <li class="slot slot-busy"><span>11:30</span><span>${t('Booked')}</span></li>
      </ol>
    </div>
    <div class="demo-arrow" aria-hidden="true">${ARROW}</div>
    <div class="day day-quiet" aria-hidden="true">
      <p class="day-name">${t.weekday(2)} <small>${t('Quiet hours')}</small></p>
      <ol class="slots">
        <li class="slot"><span>13:00</span><span>${t('Free')}</span></li>
        <li class="slot slot-offer"><span>13:30</span><span><b>${t('Cut & finish')} + ${t('Deep conditioning treatment')}</b><br>${t('{total} instead of {base}', { total: t.duration(60), base: t.duration(45) })}, <em>${t('same {price}', { price })}</em></span></li>
        <li class="slot"><span>14:30</span><span>${t('Free')}</span></li>
      </ol>
    </div>
  </div>
</div></section>

<section class="section" id="how"><div class="wrap">
  <h2>${t('How it works')}</h2>
  <ol class="steps">
    <li><h3>${t('Share your link')}</h3><p class="muted">${t('Put it where clients find you full: the “fully booked” message on your booking page, your Instagram bio, your auto-reply, a QR code at the desk.')}</p></li>
    <li><h3>${t('The client picks an upgrade')}</h3><p class="muted">${t('They choose the service they wanted and see up to three upgraded times in your quiet hours, in their own language. No account, no app.')}</p></li>
    <li><h3>${t('You confirm')}</h3><p class="muted">${t('You get an email, confirm with one tap, and send the ready-made message by WhatsApp, text or email. Confirmed appointments appear in your calendar.')}</p></li>
  </ol>
</div></section>

<section class="section"><div class="wrap">
  <h2>${t('Rules {product} never breaks', { product: name })}</h2>
  <div class="rules">
    <div><h3>${t('Same price, every time')}</h3><p>${t('The client pays exactly your listed price. {product} cannot create a discount, and the database refuses one even if someone tries.', { product: name })}</p></div>
    <div><h3>${t('Noticeably more care')}</h3><p>${t('Every offer adds at least 30% more time, using upgrades you choose: a scalp massage, a treatment, a longer finish.')}</p></div>
    <div><h3>${t('Only in hours you choose')}</h3><p>${t('Offers land only in the quiet hours you set, and never more at once than you have free chairs.')}</p></div>
    <div><h3>${t('You stay in charge')}</h3><p>${t('Nothing is booked until you confirm it. Client details are deleted {days} days after the appointment.', { days: RETENTION_DAYS })}</p></div>
  </div>
</div></section>

<section class="section"><div class="wrap">
  <h2>${t('One account, three levels')}</h2>
  <p class="lead">${t('Start with one location. The next levels switch on as your business grows.')}</p>
  <ul class="tiers">
    ${PLANS.map(
      (p) => html`<li class="${p.status === 'active' ? 'tier-live' : 'tier-soon'}">
      <span class="tier-name">${p.name}<span class="tier-scope">${t(p.scope)}</span></span>
      <span>${t(p.pitch)}</span>
      <span class="tier-state">${p.status === 'active' ? (c.billing.enabled ? planOffer(c) : t(p.price)) : t('Coming')}</span>
    </li>`,
    )}
  </ul>
  <div class="actions section-end" id="start"><a class="btn btn-primary" href="${user ? '/app' : c.link('/signup')}">${start}</a></div>
</div></section>`;
  return sitePage(c, {
    title: '',
    body,
    user,
    robots: 'index, follow',
    switchPath: '/',
    description: t('{product} turns “fully booked” into an upgraded booking in your quiet hours, at your normal price. Never a discount.', { product: name }),
  });
}
return { landingView };
})();

// src/views/public.js
const __m37 = (() => {
// Copyright (c) 2026 Miloš Petrović (Trench Logic Studio) · SPDX-License-Identifier: MIT
const { canClientCancel } = __m27;
const { html } = __m19;
const { quotedKey } = __m28;
const { publicPage, sitePage, errorFor, invalid, formErrors, notice, langField, rich } = __m20;
const { RETENTION_DAYS } = __m0;
const { tk } = __m18;

function salonMeta(salon) {
  const lines = [salon.address, salon.phone].filter(Boolean);
  return lines.length ? html`<p class="salon-meta">${lines.map((l, i) => html`${i ? html`<br>` : ''}${l}`)}</p>` : '';
}

function salonView(c, salon, services) {
  const t = c.t;
  const body = html`
<header class="salon-head">
  <h1>${salon.name}</h1>
  ${salonMeta(salon)}
  <p class="lead">${t('Fully booked when you wanted to come in? Choose your service and we will offer you a calmer time with extra care included, at the same price.')}</p>
</header>
${
  services.length
    ? html`<h2 class="visually-hidden">${t('Services')}</h2>
<ul class="menu">
  ${services.map(
    (s) => html`<li><a href="${c.link(`/s/${salon.slug}/offers?service=${s.id}`)}">
    <span class="menu-name">${s.name}</span>
    <span class="menu-leader" aria-hidden="true"></span>
    <span class="menu-time">${t.duration(s.duration_min)}</span>
    <span class="menu-price">${t.money(s.price_cents, salon.currency)}</span>
  </a></li>`,
  )}
</ul>
<p class="small muted">${t('Prices are the salon’s standard prices. Upgraded appointments never cost more, or less.')}</p>`
    : html`<div class="notice notice-info"><p>${t('{salon} is not taking requests through this page yet.', { salon: salon.name })}</p></div>`
}`;
  return publicPage(c, salon, { title: t('Request an appointment'), body, switchPath: `/s/${salon.slug}` });
}

function offerTitle(o) {
  return [o.service_name, ...o.upgrades.map((u) => u.name)].join(' + ');
}

function contactFields(c, salon, values, errors) {
  const t = c.t;
  return html`
  <div class="field">
    <label for="name">${t('Your name')}</label>
    <input id="name" name="name" type="text" autocomplete="name" maxlength="80" required value="${values.name || ''}"${invalid(errors, 'name')}>
    ${errorFor(errors, 'name')}
  </div>
  <div class="field">
    <label for="contact">${t('Phone or email')}</label>
    <input id="contact" name="contact" type="text" autocomplete="tel" inputmode="text" maxlength="120" required value="${values.contact || ''}"${invalid(errors, 'contact')}>
    <span class="hint">${t('{salon} uses this to confirm your appointment. Please include the country code with a phone number, for example +44.', { salon: salon.name })}</span>
    ${errorFor(errors, 'contact')}
  </div>
  <div class="trap" aria-hidden="true">
    <label for="website">${t('Leave this field empty')}</label>
    <input id="website" name="website" type="text" tabindex="-1" autocomplete="off">
  </div>
  <div class="field">
    <label class="check"><input type="checkbox" name="consent" value="on"${values.consent ? html` checked` : ''}${invalid(errors, 'consent')}> <span>${rich(
      t,
      '{salon} may contact me about this request. My details are deleted {days} days after the appointment. {privacy}',
      { salon: salon.name, days: String(RETENTION_DAYS), privacy: html`<a href="${c.link('/privacy')}">${t('Privacy notice')}</a>` },
    )}</span></label>
    ${errorFor(errors, 'consent')}
  </div>`;
}

function offersView(c, salon, service, result, { values = {}, errors = {}, message = '', locked = false } = {}) {
  if (locked || result.status !== 'upgrade_redirect') return waitlistView(c, salon, service, { values, errors, message, locked });
  const t = c.t;
  const chosen = values.offer || result.offers[0].key;
  const body = html`
<header class="salon-head">
  <p><a href="${c.link(`/s/${salon.slug}`)}">${salon.name}</a></p>
  <h1>${t('Pick your appointment')}</h1>
  <p class="lead">${t('{service} with extra time added, at the usual price of {price}.', { service: service.name, price: t.money(service.price_cents, salon.currency) })}</p>
</header>
${notice('info', message)}
${formErrors(c, errors)}
<form method="post" action="/s/${salon.slug}/request" novalidate>
  ${langField(c)}
  <input type="hidden" name="service" value="${service.id}">
  <fieldset class="offers">
    <legend>${t('Available upgraded times')}</legend>
    ${result.offers.map(
      (o) => html`<label class="offer">
      <input type="radio" name="offer" value="${quotedKey(o)}"${quotedKey(o) === chosen ? html` checked` : ''}>
      <span class="offer-when">${t.date(o.slot_date)}, <span class="offer-time">${t.timeRange(o.start_min, o.end_min)}</span></span>
      <span class="offer-what">${offerTitle(o)}</span>
      <span class="offer-extra">${t('{total} instead of {base}', { total: t.duration(o.total_min), base: t.duration(o.base_min) })}</span>
      <span class="offer-price">${t.money(o.price_cents, salon.currency)} <span>${t('your usual price')}</span></span>
    </label>`,
    )}
  </fieldset>
  ${errorFor(errors, 'offer')}
  ${contactFields(c, salon, values, errors)}
  <button class="btn btn-primary btn-block" type="submit">${t('Send request')}</button>
  <p class="small muted">${t('Request hold: {hours} hours. Changes and cancellations close {minutes} minutes before the appointment.', {hours:salon.hold_hours,minutes:salon.cancel_notice_min})}</p>
  <p class="small muted">${t('Nothing is booked yet: {salon} confirms your request personally.', { salon: salon.name })}</p>
</form>`;
  return publicPage(c, salon, { title: t('Pick your appointment'), body, switchPath: `/s/${salon.slug}/offers?service=${service.id}` });
}

function waitlistView(c, salon, service, { values = {}, errors = {}, message = '', locked = false } = {}) {
  const t = c.t;
  const heading = locked ? t('Leave your details') : t('No upgraded time is free right now');
  const lead = locked
    ? t('{salon} is not offering upgraded times online at the moment. Leave your details for {service} and they will get back to you.', { salon: salon.name, service: service.name })
    : t('Leave your details for {service} and {salon} will get back to you when a place opens.', { salon: salon.name, service: service.name });
  const body = html`
<header class="salon-head">
  <p><a href="${c.link(`/s/${salon.slug}`)}">${salon.name}</a></p>
  <h1>${heading}</h1>
  <p class="lead">${lead}</p>
</header>
${notice('info', message)}
${formErrors(c, errors)}
<form method="post" action="/s/${salon.slug}/waitlist" novalidate>
  ${langField(c)}
  <input type="hidden" name="service" value="${service.id}">
  ${contactFields(c, salon, values, errors)}
  <div class="field">
    <label for="note">${t('When suits you?')} <span class="muted">${t('(optional)')}</span></label>
    <textarea id="note" name="note" maxlength="300"${invalid(errors, 'note')}>${values.note || ''}</textarea>
    ${errorFor(errors, 'note')}
  </div>
  <button class="btn btn-primary btn-block" type="submit">${t('Join the waitlist')}</button>
</form>`;
  return publicPage(c, salon, { title: heading, body, switchPath: `/s/${salon.slug}/offers?service=${service.id}` });
}

const STATUS_TEXT = {
  offer: {
    pending: [tk('Request sent'), (t, s) => t('{salon} will confirm it personally. Keep this page: it shows the answer as soon as they reply.', { salon: s })],
    confirmed: [tk('Confirmed'), (t, s, r) => t('See you on {date} at {time}.', { date: t.dateLong(r.slot_date), time: t.time(r.start_min) })],
    declined: [tk('Not available'), (t, s) => t('{salon} could not confirm this time. You are welcome to choose another one.', { salon: s })],
    expired: [tk('Expired'), (t) => t('This request was not confirmed before its time passed.')],
  },
  waitlist: {
    pending: [tk('You are on the waitlist'), (t, s) => t('{salon} will contact you when a place opens.', { salon: s })],
    closed: [tk('Handled'), (t, s) => t('{salon} has picked up your request.', { salon: s })],
    expired: [tk('Expired'), (t) => t('This waitlist request has expired.')],
    declined: [tk('Closed'), (t) => t('This waitlist request was closed.')],
  },
};

function statusView(c, salon, r, upgrades) {
  const t = c.t;
  const entry = (STATUS_TEXT[r.kind] && STATUS_TEXT[r.kind][r.status]) || [tk('Request'), () => ''];
  const headline = r.outcome === 'canceled' ? t('Canceled') : r.outcome === 'completed' ? t('Completed') : r.outcome === 'no_show' ? t('No-show') : t(entry[0]);
  const extras = upgrades.map((u) => u.name).join(', ');
  const confirmed = r.kind === 'offer' && r.status === 'confirmed';
  const body = html`
<header class="salon-head">
  <p><a href="${c.link(`/s/${salon.slug}`)}">${salon.name}</a></p>
  <h1>${headline}</h1>
  <p class="lead">${r.outcome ? salon.name : entry[1](t, salon.name, r)}</p>
</header>
<div class="ticket">
  <span class="badge badge-${r.status}">${headline}</span>
  ${
    r.kind === 'offer'
      ? html`<p class="ticket-when">${t.dateLong(r.slot_date)}<br><span class="num">${t.timeRange(r.start_min, r.end_min)}</span></p>`
      : html`<p class="ticket-when">${r.service_name}</p>`
  }
  <dl>
    <dt>${t('Service')}</dt><dd>${r.service_name}</dd>
    ${
      r.kind === 'offer'
        ? html`<dt>${t('Included')}</dt><dd>${extras}</dd><dt>${t('Length')}</dt><dd>${t('{total} instead of {base}', { total: t.duration(r.total_min), base: t.duration(r.base_min) })}</dd>`
        : ''
    }
    <dt>${t('Price')}</dt><dd>${t.money(r.price_cents, r.currency)}${r.kind === 'offer' ? html`, ${t('the standard price')}` : ''}</dd>
    ${salon.address ? html`<dt>${t('Address')}</dt><dd>${salon.address}</dd>` : ''}
    ${salon.phone ? html`<dt>${t('Phone')}</dt><dd><a href="tel:${salon.phone.replace(/[^\d+]/g, '')}">${salon.phone.replace(/ /g, '\u00a0')}</a></dd>` : ''}
    <dt>${t('Reference')}</dt><dd class="num">${r.ref}</dd>
  </dl>
</div>
${r.kind === 'offer' && canClientCancel(r, salon, c.now) ? html`<div class="actions"><form method="post" action="/r/${r.token}/cancel" data-confirm="${t('Cancel this appointment?')}"><button class="btn btn-outline">${t('Cancel appointment')}</button></form>${r.kind === 'offer' ? html`<a class="btn btn-outline" href="/r/${r.token}/reschedule">${t('Change appointment')}</a>` : ''}</div>` : ''}
${confirmed && !r.outcome ? html`<p class="actions"><a class="btn btn-primary" href="/r/${r.token}/calendar.ics" download>${t('Add to calendar')}</a></p>` : ''}
${
  r.status === 'declined' || r.status === 'expired'
    ? html`<p><a class="btn btn-primary" href="${c.link(`/s/${salon.slug}`)}">${t('Choose another time')}</a></p>`
    : ''
}`;
  return publicPage(c, salon, { title: headline, body, switchPath: `/r/${r.token}` });
}

function privacyView(c) {
  const t = c.t;
  const cfg = c.config;
  const operator = cfg.operatorName || t('the operator of {product}', { product: cfg.productName });
  const body = html`<div class="wrap narrow section">
  <h1>${t('Privacy notice')}</h1>
  <p class="lead">${t('What happens to your details when you use {product}.', { product: cfg.productName })}</p>
  <h2>${t('If you send a request to a salon')}</h2>
  <p>${t('The salon you write to decides what happens with your request; {product} only processes it on the salon’s behalf. We store your name, the phone number or email you give, the service and time you chose, the language you used, and the moment you agreed to be contacted.', { product: cfg.productName })}</p>
  <p>${t('Your details are used only to answer that request, including emails about it if you gave an email address. They are deleted {days} days after the appointment date (or {days} days after a waitlist request). What remains is anonymous: the service, the time and the price, for the salon’s statistics.', { days: RETENTION_DAYS })}</p>
  <p>${t('Pages for clients set no cookies and load nothing from other websites. Visits are counted per day without any personal data. There is no tracking and no advertising.')}</p>
  <h2>${t('If you run a salon account')}</h2>
  <p>${t('We store your email, a protected form of your password (never the password itself), your salon’s settings and the requests you receive. One cookie keeps you logged in. Email is sent through the provider this installation is configured with. Payments, if switched on, are handled entirely by the payment provider; this site never sees card details. You can delete your account and all of its data at any time from Settings.')}</p>
  <h2>${t('Your rights')}</h2>
  <p>${
    cfg.contactEmail
      ? rich(t, 'You can ask for a copy of your details, for corrections, or for deletion. For a request you sent to a salon, contact that salon directly; for anything else, contact {operator} at {email}.', {
          operator,
          email: html`<a href="mailto:${cfg.contactEmail}">${cfg.contactEmail}</a>`,
        })
      : t('You can ask for a copy of your details, for corrections, or for deletion. For a request you sent to a salon, contact that salon directly; for anything else, contact {operator}.', { operator })
  }</p>
</div>`;
  return sitePage(c, { title: t('Privacy notice'), body, robots: 'index, follow', switchPath: '/privacy' });
}

function termsView(c) {
  const t = c.t;
  const cfg = c.config;
  const body = html`<div class="wrap narrow section">
  <h1>${t('Terms of use')}</h1>
  <p class="lead">${cfg.productName}</p>
  <h2>${t('What you get')}</h2>
  <p>${
    c.billing.enabled
      ? t('A free trial, then a monthly subscription you can cancel at any time. Prices are shown before you subscribe. Payments and invoices are handled by our payment provider.')
      : t('Free use of the Reflow level while the beta runs. Features may change. If paid plans are introduced, you will be told in advance and nothing will be charged without your explicit agreement.')
  }</p>
  <h2>${t('What we ask')}</h2>
  <p>${t('Use your request page only for your own business and only for real appointments. You are responsible for honouring the appointments you confirm and for treating your clients’ details with care.')}</p>
  <h2>${t('No warranty')}</h2>
  <p>${t('The service is provided as is. Keep your own booking system as the record of your appointments.')}</p>
  <h2>${t('Ending')}</h2>
  <p>${t('You can delete your account at any time from Settings; your data is deleted with it.')}</p>
</div>`;
  return sitePage(c, { title: t('Terms of use'), body, robots: 'index, follow', switchPath: '/terms' });
}

function legalView(c) {
  const t = c.t;
  const body = html`<div class="wrap narrow section">
  <h1>${t('Legal notice')}</h1>
  <p class="legal-notice">${c.config.legalNotice.map((line, i) => html`${i ? html`<br>` : ''}${line}`)}</p>
</div>`;
  return sitePage(c, { title: t('Legal notice'), body, robots: 'index, follow', switchPath: '/legal' });
}

const ERROR_TITLES = {
  400: tk('That did not work'),
  403: tk('Not allowed'),
  404: tk('Page not found'),
  405: tk('Not allowed'),
  409: tk('Already changed'),
  410: tk('This link has expired'),
  413: tk('Too large'),
  415: tk('Form not readable'),
  429: tk('Too many attempts'),
  500: tk('Something went wrong'),
};

function errorView(c, status, message) {
  const t = c.t;
  const title = t(ERROR_TITLES[status] || ERROR_TITLES[500]);
  const body = html`<div class="wrap"><div class="center-card">
  <h1>${title}</h1>
  <p class="lead">${t(message)}</p>
  <p><a class="btn btn-outline" href="${c.link('/')}">${t('Go to the home page')}</a></p>
</div></div>`;
  return sitePage(c, { title, body });
}
return { salonView, offersView, waitlistView, statusView, privacyView, termsView, legalView, errorView };
})();

// src/views/assets.js
const __m38 = (() => {
// Copyright (c) 2026 Miloš Petrović (Trench Logic Studio) · SPDX-License-Identifier: MIT
// Static assets served by the app itself: one stylesheet, one small script,
// the icon. No fonts or files are loaded from anywhere else.

const CSS = `
:root {
  --paper: #f5f7f5;
  --surface: #ffffff;
  --ink: #1c2a29;
  --muted: #566563;
  --line: #d6dedb;
  --line-strong: #a9b6b2;
  --berry: #8c2c4b;
  --berry-ink: #ffffff;
  --berry-soft: #f6e7ed;
  --sage: #3f6f5c;
  --sage-ink: #ffffff;
  --sage-soft: #e2eee8;
  --amber: #7f560b;
  --amber-soft: #f7edd8;
  --danger: #a3261b;
  --danger-soft: #fbe5e2;
  --serif: "Iowan Old Style", "Palatino Linotype", Palatino, "URW Palladio L", P052, "Book Antiqua", Georgia, serif;
  --sans: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif;
  --r-sm: 6px;
  --r-md: 10px;
  --r-lg: 18px;
  color-scheme: light;
}

@media (prefers-color-scheme: dark) {
  :root {
    --paper: #101817;
    --surface: #17211f;
    --ink: #e4ebe9;
    --muted: #9daba8;
    --line: #2a3936;
    --line-strong: #46564f;
    --berry: #e48aa6;
    --berry-ink: #2a0e18;
    --berry-soft: #3a1e29;
    --sage: #8cc2a9;
    --sage-ink: #0f1f18;
    --sage-soft: #1c2f28;
    --amber: #e3b866;
    --amber-soft: #382d16;
    --danger: #f1958a;
    --danger-soft: #3b1f1b;
    color-scheme: dark;
  }
}

*, *::before, *::after { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body {
  margin: 0;
  background: var(--paper);
  color: var(--ink);
  font: 400 1rem/1.55 var(--sans);
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}
main { flex: 1; }
img, svg { max-width: 100%; }
a { color: var(--berry); text-underline-offset: 0.18em; text-decoration-thickness: 1px; }
code { overflow-wrap: anywhere; }
a:hover { text-decoration-thickness: 2px; }
:focus-visible { outline: 3px solid var(--berry); outline-offset: 2px; border-radius: 2px; }
.skip { position: absolute; left: -999px; top: 0; background: var(--surface); padding: .5rem 1rem; z-index: 10; }
.skip:focus { left: 1rem; }

h1, h2, h3 {
  font-family: var(--serif);
  font-weight: 600;
  line-height: 1.15;
  margin: 0 0 .5em;
  text-wrap: balance;
}
h1 { font-size: clamp(2rem, 1.4rem + 2.6vw, 3.1rem); letter-spacing: -0.01em; }
h2 { font-size: clamp(1.4rem, 1.2rem + 0.9vw, 1.85rem); }
h3 { font-size: 1.2rem; }
p { margin: 0 0 1rem; }
.lead { font-size: 1.125rem; color: var(--muted); max-width: 38rem; }
.muted { color: var(--muted); }
.small { font-size: .875rem; }
.num { font-variant-numeric: lining-nums tabular-nums; }
.nowrap { white-space: nowrap; }
.visually-hidden { position: absolute !important; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }

.wrap { width: 100%; max-width: 66rem; margin: 0 auto; padding: 0 1rem; }
.narrow { max-width: 36rem; }
.stack > * + * { margin-top: 1rem; }
.section { padding: 2.5rem 0; }
.section + .section { border-top: 1px solid var(--line); }

/* ---------- header and footer ---------- */
.bar { background: var(--surface); border-bottom: 1px solid var(--line); }
.bar-inner { display: flex; align-items: center; gap: 1rem; min-height: 3.75rem; flex-wrap: wrap; padding-top: .4rem; padding-bottom: .4rem; }
.brand { font-family: var(--serif); font-size: 1.3rem; font-weight: 600; color: var(--ink); text-decoration: none; display: inline-flex; align-items: center; gap: .55rem; }
.brand svg { width: 1.6rem; height: 1.6rem; flex: none; }
.bar-actions { order: 1; margin-left: auto; display: flex; gap: .5rem; align-items: center; }
.nav { order: 2; width: 100%; margin: 0 -.25rem; }
.nav ul { list-style: none; display: flex; flex-wrap: wrap; gap: .15rem .25rem; margin: 0; padding: 0; }
.nav a { display: block; padding: .45rem .75rem; border-radius: var(--r-sm); color: var(--muted); text-decoration: none; white-space: nowrap; font-weight: 500; }
.nav a:hover { color: var(--ink); background: var(--paper); }
.nav a[aria-current="page"] { color: var(--ink); background: var(--paper); box-shadow: inset 0 -2px 0 var(--berry); }
@media (min-width: 52rem) {
  /* Long translations wrap inside the menu instead of pushing "Log out" to its own line. */
  .nav { order: 1; width: auto; margin: 0; flex: 1 1 0; min-width: 0; }
  .nav a { padding: .45rem .6rem; }
  .bar-actions { order: 2; }
}
.footer { margin-top: 3rem; padding: 1.5rem 0 2rem; border-top: 1px solid var(--line); color: var(--muted); font-size: .875rem; }
.footer-inner { display: flex; flex-wrap: wrap; gap: .5rem 1.5rem; }
.footer a { color: var(--muted); }

/* ---------- buttons and forms ---------- */
.btn {
  display: inline-flex; align-items: center; justify-content: center; gap: .4rem;
  min-height: 44px; padding: .55rem 1.1rem;
  border-radius: var(--r-sm); border: 1px solid transparent;
  font: 600 1rem/1.2 var(--sans); cursor: pointer; text-decoration: none;
  background: transparent; color: var(--ink);
}
.btn-primary { background: var(--berry); color: var(--berry-ink); }
.btn-primary:hover { filter: brightness(1.08); }
.btn-confirm { background: var(--sage); color: var(--sage-ink); }
.btn-confirm:hover { filter: brightness(1.08); }
.btn-outline { border-color: var(--line-strong); background: var(--surface); }
.btn-outline:hover { border-color: var(--ink); }
.btn-link { padding-left: .25rem; padding-right: .25rem; color: var(--berry); text-decoration: underline; text-underline-offset: .18em; font-weight: 500; }
.btn-danger { border-color: var(--danger); color: var(--danger); background: var(--surface); }
.btn-small { min-height: 36px; padding: .35rem .8rem; font-size: .9375rem; }
.btn-block { width: 100%; }
.actions { display: flex; flex-wrap: wrap; gap: .6rem; align-items: center; }
form.inline { display: inline; }

.field { margin: 0 0 1.1rem; }
.field > label, .label { display: block; font-weight: 600; margin: 0 0 .35rem; }
.hint { display: block; color: var(--muted); font-size: .875rem; margin-top: .3rem; }
.error-text { display: block; color: var(--danger); font-size: .875rem; margin-top: .3rem; font-weight: 500; }
input[type="text"], input[type="email"], input[type="password"], input[type="number"], input[type="time"], input[type="url"], input[type="tel"], select, textarea {
  width: 100%; font: inherit; color: var(--ink);
  padding: .6rem .75rem; min-height: 44px;
  background: var(--surface); border: 1px solid var(--line-strong); border-radius: var(--r-sm);
}
textarea { min-height: 5.5rem; resize: vertical; }
input:hover, select:hover, textarea:hover { border-color: var(--ink); }
[aria-invalid="true"] { border-color: var(--danger) !important; box-shadow: 0 0 0 1px var(--danger); }
.check, .field > .check { display: flex; gap: .65rem; align-items: flex-start; font-weight: 400; }
.check input { width: 1.15rem; height: 1.15rem; margin: .2rem 0 0; flex: none; accent-color: var(--berry); }
.row { display: grid; gap: 0 1rem; }
@media (min-width: 36rem) {
  .row-2 { grid-template-columns: 1fr 1fr; }
  .row-3 { grid-template-columns: 1fr 1fr 1fr; }
}
.trap { position: absolute; left: -10000px; width: 1px; height: 1px; overflow: hidden; }

.notice { padding: .8rem 1rem; border-radius: var(--r-sm); margin: 0 0 1.25rem; border-left: 4px solid; background: var(--surface); }
.notice-ok { border-color: var(--sage); background: var(--sage-soft); }
.notice-error { border-color: var(--danger); background: var(--danger-soft); }
.notice-info { border-color: var(--amber); background: var(--amber-soft); }
.notice p:last-child { margin-bottom: 0; }

.panel { background: var(--surface); border: 1px solid var(--line); border-radius: var(--r-md); padding: 1.25rem; }
.panel + .panel { margin-top: 1rem; }
.panel h2:first-child, .panel h3:first-child { margin-top: 0; }

/* ---------- badges ---------- */
.badge { display: inline-block; padding: .1rem .6rem; border-radius: 999px; font-size: .8125rem; font-weight: 600; border: 1px solid transparent; white-space: nowrap; }
.badge-pending { color: var(--amber); background: var(--amber-soft); }
.badge-confirmed, .badge-closed, .badge-ok { color: var(--sage); background: var(--sage-soft); }
.badge-declined, .badge-expired, .badge-off { color: var(--muted); border-color: var(--line-strong); }
.badge-warn { color: var(--danger); background: var(--danger-soft); }

/* ---------- the salon price list (client page) ---------- */
.menu { list-style: none; margin: 0 0 1.5rem; padding: 0; border-top: 1px solid var(--line); }
.menu li { border-bottom: 1px solid var(--line); }
.menu a { display: flex; align-items: baseline; gap: .6rem; padding: 1.05rem .2rem; color: var(--ink); text-decoration: none; }
.menu a:hover .menu-name { text-decoration: underline; text-decoration-thickness: 1px; text-underline-offset: .2em; }
.menu-name { font-family: var(--serif); font-size: 1.2rem; line-height: 1.3; }
.menu-leader { flex: 1 1 1.5rem; min-width: 1.5rem; border-bottom: 2px dotted var(--line-strong); transform: translateY(-.32em); }
.menu-time { color: var(--muted); white-space: nowrap; font-variant-numeric: tabular-nums; }
.menu-price { font-weight: 600; white-space: nowrap; font-variant-numeric: lining-nums tabular-nums; }

.salon-head { padding: 2.25rem 0 1rem; }
.salon-head h1 { margin-bottom: .35rem; }
.public main { padding-bottom: 1rem; }

/* ---------- appointment cards ---------- */
.offers { border: 0; padding: 0; margin: 0 0 1.75rem; display: grid; gap: .75rem; min-width: 0; }
.offers legend { font-family: var(--serif); font-size: 1.25rem; font-weight: 600; margin-bottom: .75rem; padding: 0; }
.offer {
  display: grid; grid-template-columns: auto 1fr; gap: .15rem .9rem;
  padding: 1rem 1.1rem; background: var(--surface);
  border: 1px solid var(--line); border-left: 5px solid var(--sage); border-radius: var(--r-md);
  cursor: pointer;
}
.offer:hover { border-color: var(--line-strong); border-left-color: var(--sage); }
.offer:has(input:checked) { border-color: var(--berry); border-left-color: var(--berry); box-shadow: 0 0 0 1px var(--berry); }
.offer input { grid-row: 1 / span 4; width: 1.2rem; height: 1.2rem; margin: .35rem 0 0; accent-color: var(--berry); }
.offer-when { font-family: var(--serif); font-size: 1.3rem; font-weight: 600; line-height: 1.25; }
.offer-time { font-variant-numeric: tabular-nums; }
.offer-what { color: var(--ink); }
.offer-extra { color: var(--muted); font-size: .9375rem; }
.offer-price { font-weight: 600; }
.offer-price span { color: var(--sage); font-weight: 500; }

.ticket {
  background: var(--surface); border: 1px solid var(--line); border-radius: var(--r-lg);
  padding: 1.5rem 1.4rem; margin: 0 0 1.5rem; position: relative;
}
.ticket-when { font-family: var(--serif); font-size: 1.6rem; font-weight: 600; line-height: 1.2; margin: .35rem 0; }
.ticket dl { display: grid; grid-template-columns: max-content 1fr; gap: .35rem 1rem; margin: 1rem 0 0; }
.ticket dt { color: var(--muted); }
.ticket dd { margin: 0; }

/* ---------- landing: the reflow demonstration ---------- */
.hero { padding: 3rem 0 2.5rem; }
.hero h1 { max-width: 20ch; }
.hero .lead { margin-bottom: 1.5rem; }
.demo {
  margin-top: 2.5rem; display: grid; gap: 1rem; align-items: center;
  grid-template-columns: 1fr;
}
@media (min-width: 48rem) { .demo { grid-template-columns: 1fr 3.5rem 1fr; } }
.day { background: var(--surface); border: 1px solid var(--line); border-radius: var(--r-md); padding: 1rem 1rem 1.1rem; }
.day-name { font-family: var(--serif); font-size: 1.15rem; font-weight: 600; margin: 0 0 .7rem; display: flex; justify-content: space-between; align-items: baseline; gap: .5rem; }
.day-name small { font-family: var(--sans); font-size: .8125rem; font-weight: 600; }
.day-full .day-name small { color: var(--berry); }
.day-quiet .day-name small { color: var(--sage); }
.slots { list-style: none; margin: 0; padding: 0; display: grid; grid-auto-rows: 2.6rem; gap: 4px; }
.slot { display: grid; grid-template-columns: 3.2rem 1fr; align-items: center; border-radius: var(--r-sm); padding: 0 .6rem; font-size: .9375rem; color: var(--muted); border: 1px dashed var(--line-strong); }
.slot > span:first-child { font-variant-numeric: tabular-nums; font-weight: 600; color: var(--ink); }
.slot-busy { background: var(--berry-soft); border: 1px solid transparent; color: var(--berry); }
.slot-wanted { box-shadow: inset 0 0 0 2px var(--berry); }
.slot-offer { grid-row: span 2; background: var(--sage-soft); border: 1px solid var(--sage); color: var(--ink); align-items: start; padding-top: .55rem; line-height: 1.35; }
.slot-offer b { font-weight: 600; }
.slot-offer em { font-style: normal; color: var(--sage); font-weight: 600; }
.demo-arrow { display: flex; justify-content: center; color: var(--line-strong); }
.demo-arrow svg { width: 2.5rem; height: 2.5rem; transform: rotate(90deg); }
@media (min-width: 48rem) { .demo-arrow svg { transform: none; } }
.demo-caption { grid-column: 1 / -1; color: var(--muted); font-size: .9375rem; margin: .25rem 0 0; }

.steps { list-style: none; counter-reset: step; margin: 0; padding: 0; display: grid; gap: 1.5rem; }
@media (min-width: 48rem) { .steps { grid-template-columns: repeat(3, 1fr); } }
.steps li { counter-increment: step; padding-top: 2.6rem; position: relative; }
.steps li::before {
  content: counter(step); position: absolute; top: 0; left: 0;
  width: 2rem; height: 2rem; border-radius: 50%; border: 1.5px solid var(--berry); color: var(--berry);
  display: grid; place-items: center; font-family: var(--serif); font-weight: 600;
}
.rules { display: grid; gap: 1.5rem 2.5rem; }
@media (min-width: 48rem) { .rules { grid-template-columns: 1fr 1fr; } }
.rules h3 { margin-bottom: .3rem; }
.rules p { margin: 0; color: var(--muted); }

.tiers { list-style: none; margin: 0; padding: 0; border-top: 1px solid var(--line); }
.panel + .tiers, .notice + .tiers { margin-top: 1.5rem; }
.tiers li { display: grid; gap: .25rem 2rem; padding: 1.25rem 0; border-bottom: 1px solid var(--line); }
@media (min-width: 48rem) { .tiers li { grid-template-columns: 11rem 1fr 13rem; align-items: baseline; } }
.tier-name { font-family: var(--serif); font-size: 1.35rem; font-weight: 600; }
.tier-scope { display: block; font-family: var(--sans); font-size: .875rem; font-weight: 500; color: var(--muted); }
.tier-state { font-weight: 600; }
.tier-live .tier-state { color: var(--sage); }
.tier-soon .tier-state { color: var(--muted); }
.section-end { margin-top: 1.75rem; }
.section-title { margin-top: 2.25rem; }

/* ---------- salon dashboard ---------- */
.page-head { padding: 2rem 0 1.25rem; display: flex; flex-wrap: wrap; gap: .5rem 1rem; align-items: flex-end; justify-content: space-between; }
.page-head h1 { margin: 0; font-size: clamp(1.75rem, 1.4rem + 1.4vw, 2.4rem); }
.page-head p { margin: .35rem 0 0; }

.ledger { display: grid; grid-template-columns: 1fr 1fr; margin: 0 0 2rem; background: var(--surface); border: 1px solid var(--line); border-radius: var(--r-md); }
@media (min-width: 48rem) { .ledger { grid-template-columns: repeat(4, 1fr); } }
.ledger > div { padding: 1rem 1.1rem; border-right: 1px solid var(--line); border-bottom: 1px solid var(--line); }
.ledger > div:nth-child(2n) { border-right: 0; }
.ledger > div:nth-last-child(-n + 2) { border-bottom: 0; }
@media (min-width: 48rem) {
  .ledger > div { border-bottom: 0; border-right: 1px solid var(--line); }
  .ledger > div:nth-child(2n) { border-right: 1px solid var(--line); }
  .ledger > div:last-child { border-right: 0; }
}
.ledger.ledger-two { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.request p { margin: 0; overflow-wrap: anywhere; }
.ledger dt { color: var(--muted); font-size: .875rem; }
.ledger dd { margin: .2rem 0 0; font-family: var(--serif); font-size: 1.7rem; font-weight: 600; font-variant-numeric: lining-nums tabular-nums; line-height: 1.2; }
.ledger .proof dd { color: var(--sage); }

.checklist { list-style: none; counter-reset: task; margin: 0; padding: 0; display: grid; gap: .6rem; }
.checklist li { counter-increment: task; display: grid; grid-template-columns: 2rem 1fr; gap: .2rem .75rem; align-items: start; }
.checklist li::before { content: counter(task); width: 1.75rem; height: 1.75rem; border-radius: 50%; display: grid; place-items: center; font-weight: 700; font-size: .875rem; border: 1.5px solid var(--line-strong); color: var(--muted); }
.checklist li.done::before { content: "\\2713"; background: var(--sage); border-color: var(--sage); color: var(--sage-ink); }
.checklist li.done a { color: var(--muted); }

.share { display: grid; gap: .75rem; }
.share-link { display: flex; flex-wrap: wrap; gap: .5rem; align-items: center; }
.share-link code { font-family: var(--sans); font-weight: 600; background: var(--paper); padding: .4rem .65rem; border-radius: var(--r-sm); border: 1px solid var(--line); word-break: break-all; }
.snippets { display: grid; gap: .75rem; margin-top: .5rem; }
.snippet { border: 1px solid var(--line); border-radius: var(--r-sm); padding: .75rem .9rem; background: var(--paper); }
.snippet p { margin: 0 0 .5rem; }
.snippet .where { font-size: .875rem; color: var(--muted); margin-bottom: .25rem; }

.requests { list-style: none; margin: 0 0 2rem; padding: 0; display: grid; gap: .75rem; }
.request { background: var(--surface); border: 1px solid var(--line); border-left: 5px solid var(--amber); border-radius: var(--r-md); padding: 1rem 1.1rem; display: grid; gap: .6rem; }
.request.is-confirmed { border-left-color: var(--sage); }
.request.is-closed, .request.is-declined, .request.is-expired { border-left-color: var(--line-strong); }
.request-top { display: flex; flex-wrap: wrap; gap: .4rem .9rem; align-items: baseline; justify-content: space-between; }
.request-when { font-family: var(--serif); font-size: 1.25rem; font-weight: 600; }
.request-who a { font-weight: 600; }
.request details summary { cursor: pointer; color: var(--berry); font-weight: 500; }
.request textarea { margin-top: .5rem; font-size: .9375rem; }

.table-wrap { overflow-x: auto; }
table.list { width: 100%; border-collapse: collapse; margin: 0 0 1.5rem; }
.list th, .list td { text-align: left; padding: .7rem .6rem; border-bottom: 1px solid var(--line); vertical-align: top; }
.list th { font-size: .875rem; color: var(--muted); font-weight: 600; }
.day-short { display: none; }
@media (max-width: 30rem) {
  .list th, .list td { padding: .6rem .35rem; }
  .day-long { display: none; }
  .day-short { display: inline; }
}

.items { list-style: none; margin: 0 0 2rem; padding: 0; display: grid; gap: .75rem; }
.item { background: var(--surface); border: 1px solid var(--line); border-radius: var(--r-md); padding: 1rem 1.1rem; }
.item.is-off { opacity: .72; }
.item-head { display: flex; flex-wrap: wrap; gap: .3rem .9rem; align-items: baseline; justify-content: space-between; margin-bottom: .35rem; }
.item-title { font-family: var(--serif); font-size: 1.2rem; font-weight: 600; }
.item details { margin-top: .5rem; }
.item details summary { cursor: pointer; color: var(--berry); font-weight: 500; }
.item details[open] summary { margin-bottom: .75rem; }
.readiness { font-size: .9375rem; }
.readiness.ok { color: var(--sage); }
.readiness.bad { color: var(--danger); }

.week { display: block; width: 100%; max-width: 40rem; height: auto; margin: 0 0 1.5rem; background: var(--surface); border: 1px solid var(--line); border-radius: var(--r-md); }
.week .grid-line { stroke: var(--line); stroke-width: 1; }
.week .day-label { fill: var(--ink); font: 600 15px var(--sans); }
.week .hour-label { fill: var(--muted); font: 12.5px var(--sans); }
.week .qh { fill: var(--sage-soft); stroke: var(--sage); stroke-width: 1.2; }
.week .qh-label { fill: var(--ink); font: 600 12.5px var(--sans); }
.days { display: flex; flex-wrap: wrap; gap: .4rem .9rem; border: 0; padding: 0; margin: 0 0 1.1rem; }
.days legend { font-weight: 600; margin-bottom: .4rem; padding: 0; }
.days label { display: inline-flex; align-items: center; gap: .35rem; font-weight: 400; }
.days input { width: 1.1rem; height: 1.1rem; accent-color: var(--berry); }

.events { list-style: none; margin: 0 0 1.5rem; padding: 0; border-top: 1px solid var(--line); }
.events li { display: grid; gap: .1rem 1rem; padding: .75rem 0; border-bottom: 1px solid var(--line); }
@media (min-width: 44rem) { .events li { grid-template-columns: 9rem 12rem 1fr; align-items: baseline; } }
.events time { color: var(--muted); font-size: .9375rem; font-variant-numeric: tabular-nums; }
.events strong { font-weight: 600; }
.fingerprint { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: .8125rem; }

.center-card { max-width: 28rem; margin: 3rem auto; }
.center-card h1 { font-size: 2rem; }

.empty { color: var(--muted); padding: 1rem 0 1.5rem; }


/* ---------- language switcher ---------- */
.langs { margin-top: .75rem; }
.langs ul { list-style: none; display: flex; flex-wrap: wrap; gap: .25rem .9rem; margin: 0; padding: 0; }
.langs a { color: var(--muted); text-decoration: none; }
.langs a:hover { text-decoration: underline; }
.langs a[aria-current="true"] { color: var(--ink); font-weight: 600; }

.salon-meta { color: var(--muted); margin: -.1rem 0 .8rem; font-size: .9375rem; }
.banners { padding-top: 1rem; }
.banners .notice { margin-bottom: .5rem; }

/* ---------- results funnel ---------- */
.funnel { margin: 0 0 2rem; }
.funnel-steps { list-style: none; margin: 0; padding: 0; display: grid; gap: .65rem; }
.funnel-steps li { display: grid; grid-template-columns: 1fr; gap: .2rem; }
@media (min-width: 40rem) { .funnel-steps li { grid-template-columns: 13rem 1fr 11rem; align-items: center; gap: 1rem; } }
.funnel-label { font-weight: 500; }
.funnel-n { font-weight: 600; }
.funnel-n small { font-weight: 400; color: var(--muted); }
.funnel progress { width: 100%; height: .8rem; appearance: none; -webkit-appearance: none; border: 0; border-radius: 999px; background: var(--paper); overflow: hidden; }
.funnel progress::-webkit-progress-bar { background: var(--paper); border-radius: 999px; }
.funnel progress::-webkit-progress-value { background: var(--sage); border-radius: 999px; }
.funnel progress::-moz-progress-bar { background: var(--sage); border-radius: 999px; }

/* ---------- guided setup ---------- */
.choices { list-style: none; margin: 0 0 1.5rem; padding: 0; display: grid; gap: .75rem; }
@media (min-width: 40rem) { .choices { grid-template-columns: 1fr 1fr; } }
.choice { display: block; height: 100%; padding: 1rem 1.1rem; background: var(--surface); border: 1px solid var(--line); border-radius: var(--r-md); color: var(--ink); text-decoration: none; }
.choice:hover { border-color: var(--berry); }
.choice-title { display: block; font-family: var(--serif); font-size: 1.25rem; font-weight: 600; margin-bottom: .25rem; }
.setup-table td { vertical-align: middle; }
.setup-table input[type="text"], .setup-table input[type="number"] { min-height: 40px; padding: .4rem .55rem; }
.setup-table input[type="checkbox"] { width: 1.2rem; height: 1.2rem; accent-color: var(--berry); }
.setup-table td:nth-child(3) { width: 6.5rem; }
.setup-table td:nth-child(4) { width: 8rem; }
.setup .panel { margin-bottom: 1rem; }

/* ---------- share kit and QR ---------- */
.qr-row { display: flex; flex-wrap: wrap; gap: 1rem 1.5rem; align-items: center; }
.qr { width: 168px; height: 168px; background: #fff; border: 1px solid var(--line); border-radius: var(--r-sm); padding: 6px; }
textarea[readonly] { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: .8125rem; }

/* ---------- printable poster ---------- */
.poster-page { background: #fff; color: #111; }
.poster { max-width: 34rem; margin: 0 auto; padding: 2.5rem 1.5rem; text-align: center; }
.poster-salon { font-family: var(--serif); font-size: 1.4rem; margin: 0 0 1.5rem; }
.poster-title { font-size: 3.4rem; margin: 0 0 .5rem; color: #8c2c4b; }
.poster-lead { font-size: 1.35rem; line-height: 1.4; margin: 0 auto 1.75rem; max-width: 26rem; color: #1c2a29; }
.poster-qr { width: 15rem; height: 15rem; display: block; margin: 0 auto 1rem; }
.poster-url { font-size: 1.1rem; font-weight: 600; margin: 0 0 2rem; word-break: break-all; color: #1c2a29; }
.poster-foot { color: #566563; font-size: .9rem; margin: 0 0 1.5rem; }
@media print {
  .poster-actions, .skip { display: none !important; }
  .poster { padding-top: 0; }
  @page { margin: 1.5cm; }
}

@media (prefers-reduced-motion: no-preference) {
  .offer, .btn { transition: border-color .15s ease, box-shadow .15s ease, filter .15s ease; }
}
@media print {
  .bar, .footer, .actions { display: none; }
}
`;

const JS = `(function () {
  'use strict';
  document.addEventListener('submit', function(event) {
    var form = event.target;
    if (form.dataset.confirm && !window.confirm(form.dataset.confirm)) { event.preventDefault(); return; }
    if (form.dataset.sending === 'true') { event.preventDefault(); return; }
    form.dataset.sending = 'true';
    setTimeout(function() { form.dataset.sending = ''; }, 12000);
  });

  // Copy buttons: <button data-copy="#target"> copies the target's text or value.
  document.addEventListener('click', function (event) {
    var button = event.target.closest('[data-copy]');
    if (!button) return;
    var target = document.querySelector(button.getAttribute('data-copy'));
    if (!target) return;
    var text = 'value' in target && target.value !== undefined ? target.value : target.textContent;
    var done = function () {
      var label = button.getAttribute('data-label') || button.textContent;
      button.setAttribute('data-label', label);
      button.textContent = 'Copied';
      setTimeout(function () { button.textContent = label; }, 1600);
    };
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text.trim()).then(done, function () {});
    } else if (target.select) {
      target.select();
      try { document.execCommand('copy'); done(); } catch (e) {}
    }
  });
  // Printable poster.
  document.addEventListener('click', function (event) {
    if (event.target.closest('[data-print]')) window.print();
  });
  // Demo form: pass the browser's time zone along.
  document.querySelectorAll('input[data-detect-timezone-input]').forEach(function (input) {
    try { input.value = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) {}
  });
  // Sign-up: preselect the browser's own time zone.
  var tz = document.querySelector('select[data-detect-timezone]');
  if (tz && !tz.getAttribute('data-chosen')) {
    try {
      var zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (zone && tz.querySelector('option[value="' + zone.replace(/"/g, '') + '"]')) tz.value = zone;
    } catch (e) {}
  }
})();
`;

const FAVICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#1c2a29"/><rect x="7" y="8" width="11" height="5" rx="2" fill="#e48aa6"/><rect x="7" y="17" width="18" height="7" rx="2" fill="#8cc2a9"/></svg>`;

const ROBOTS = `User-agent: *
Disallow: /app
Disallow: /admin
Disallow: /r/
Disallow: /reset/
Disallow: /s/
`;

/* Link-preview image (1200×630) and home-screen icon (180×180), PNG, drawn without text so they suit any product name and language. */
const OG_PNG = 'iVBORw0KGgoAAAANSUhEUgAABLAAAAJ2BAMAAAC9bmZvAAAAMFBMVEX19/X////25+3i7ujJ08/f5eKyyL4/b1yKqZ0cKimMLEvm6uiJmpWZuavLk6W9gpYOmzRiAAAACXBIWXMAAAsTAAALEwEAmpwYAAAP+0lEQVR42u3dT4ijdx3H8SSdILgdzFP7BxyU2eBJ8E+Zdeuhh9lupqVayhRnRBgvsnXroYeWlobiHgRRKm5vhbr4By2e5lBnoIPIKBTU7oq7UG+VugdLL3rYLR57WE2mtk53/iXPkyfP95e83lgZTx0/+9onT5IneWo1SZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkldrvL17Y07k37aJiPXRh3/5oGRXpdxcO6C+2Uf5mnj0I1ovL1lHuHrxwYC9YR7kPWBcOySFLefvNYbC+Yx/l7M+HwfqpfVTCI6HHQuXt1sNhvWoh5eq3h8P6iYWUq78dDutnFtLoz92dvStvzx4O60ULKVcXjshCAkvxYN249l7XwdIIYf382vv9EyyNDtaND2BdB0ujg3Xt/4ElsASWwAJLTt7l5QZ5gRQseUtHYAkssASWwBJYYAksgaWpgXXp6oc6D5ZGAevHV2/qh2BpBLCu3Azr72BpBLCevxnWG2BpBLCu7gksgSWwBBZYAktgycsNYMkLpPKWjrwJLblsRmCp5sttpZqv41bNDQRUc8sTqeYmTaq5rZzcCFOqFb517xP2Uc6aHglVSg8e7OoF6yj/IevAF99fdMBSGa84eK1BhfrG/q7+ZBkV6/cX97I696ZdJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEk6uu2t1ZRa2zZT4Jk+6Fhae+20YaagM+0arPfvr2cp1TpWwWRmGnqwtbT22tlsa9yTmWnowZazBGs1xzuZmYZtay1Ls601M4WbafffxHqii7XG+XfRTEP/TVzOUq25ZqZgM+36m7iWpdvWhplCzbT7b+IjCS92bM1MoWbaVbKnDuM9fTDTkDWXs5RrLpsp0Ey7D/GbSS82t2amQDPtPsRnabdqpkAz7Xqys5z4Ys0NM4WZafe5wyOpL7ZspognWYmfO4zr7MFMQy9WT3yx1qqZwsw0QSelYzotNdM0vVExvrcrzDR1z3bG83zHTBYzUwhYyT+NzrI7ls0UZCaLmcliYIEFFlgWM5PFwAILLLAsZiaLgQVW3lrtAZqvTzGs1i0LA/aFOlhDuepVn1pYrYUhqoeD1Vrp5G2pyEVL7UGLAauCmRaGKhqsAoMVknXbwLCOR4BVwUwfHw7W3cFgzXSKtFj+AWvPIasSWBXMtLBQ6JBVMaxWp1j1ks+w9jnLqgJWBTO1hoVVDwXrjoKLPVL6I+Gex8IqYFUw08eHhXV3KFgzBRfL+1jYGALWfPWwKpjplmFhfSEUrJWCiy2Vf4oVAVYFMyUOq1O0McBqVw+rgpkWFoqdvYMFFlhggQUWWNN48t5w8j7ZJ+9ebvBygxdIvUCazguk3tLxlo43ob0Jnc6b0C6bcdmMC/1c6JfQhX4uTXZp8qR9mKLhwxQ+TJH5+JeZLGYmsMACCywzWcxMYIEFFlhmspiZwAILLLDMZDEzgQUWWGCZyWJmAgsssMAyk8XMZDGwwAILLIuZyWJggQUWWBYzk8XAAgsssCxmJotFhLXdL+IPYKUN64OvqY32Q1BYjXbIaqFgNTfBGhJWUFd7vtS2Ulhz/W/lW+3X/1/RfggJK6yrg2RVAmulwLdiTufJe6sduHoUWHPFvr2wbEObAWE1IsM6HgXWTCfyk56VxYCw2qGLAmtlKfKj3r43vqj6e95jw6rHgNWKfYY1s9/3yFcM67bYsI7HgHVH6EfC/X+9imE1YsOaD3LEeqUeGVarcyocrHY7uZMs7xXuPclaBAusMp4WfgUssMACK5VeAQusMqrVwAJrOt4rBAsssCqD1VwGC6wSZtrv5BgssMACCyywwAILrMmGtbUGFlheeQcLLLDAAgsssMDa6dgGWGC5bAYssMACCyywwAILLFeQguW9QrDAAssVpGB55R0ssMACCyywwAILLFeQggWWV97BAgsssMACCyxXkIIFlstmwAIr81WRYIHle94nG9YiWGCVUGvTLU/aKd7yxIV+btJUEqwaWG4rV8JMzSWwJulGmPNuhOnWvW7dW9WZe93NxlO+2XhUWa2VxZiw4sqaz+LAmuvs3B+3td1rI9IPq53OUlBYUWXNZ4FgZc2dP7+er064H5ajwnJWOshMzaiwljOwUoaVtfr/rPbajvTDdj0DK21YZrKYmcACCyywzGQxM4EFFlhgmcliZgILLLCmFtbM2asBO7sIVtqwHu8G7TWwUob1QDdsz7hsZqhqkWDd2g3cqy70S/VCv7lu6DZdmpzopckf6f/xXXouYOf7v9kTPkyR6IcpLna7504vhOxE/3fz8a/iH4SuAtadvaPCmYWgnez9ct/0gdUkP7B6V7f79ELYek9Yn/QR+yQ/Yv9Y4APWziHrGV8KkuSXglzsnlsI3MX9TrJ8jVH8rzFqhX4k3HksrPtGvwS/0e/2bvepyLDu6XZPgZUgrN6Twj9EhnXvfk8LwUoC1vciw/oSWGnC+mR8WH8Fq1JYK0tggTV6WLOXL78OFlgjh/X3y5evgAXWqGE1L18e8JAFFlhDNNOHdQUssMqANdAhCyywhn0oHOiQBRZYQ568D3bIAgusYfrsoIcssMDKcch6EyywRgvrf4esDbDAGu1iAx6ywAKrlEMWWGCVcsg6AtbX3hj9BwSf/xZYKcMa7JB1OKyT5Xz29AxYKV+PNdAh63BYb5QD63mwUoY10CHrUFgny/q4/BmwUr6CdJBD1qGwvl4WrO+DlTKsQQ5Zh8L6dlmwfgBW0te8D3DIOhTWG2XBeh6spGENcMg6FFZ530kEVtqf0jn6kHUkrEvPnR/xf4GVPqyjD1lVPBRe8lCY/OcKjzxkOXkHq5RDlpcbwCrlkOUFUrBKOWQd9ZbOJW/pgJXnkHX0m9AlPC30JvQEwDrikOWyGbBKOWS50A+sUg5ZYIFVyiELLLBKOWSBBVYphyywwCrlkAWW73l///9YZ9juP78j60dggXXIYu89sOVpAyy3PDlwsdncri5/Fyw3aTpwsW/kh/VHsNxW7sDFHsoP6wpYU3cjzPlxwHoNLLfujfFQeOJsBX01MVgTcrPxcZ68f/Hs2ViyYsKKK2t/V9W/3HCyGlinU4MVVdYBrg56gfT+of+k8r5Aen81sB5NDlZijWqx2bxv6YAF1iE1cr8JfbaiwEoC1mzuy2bAAivnActDIVilHLDAAquUA1bIlxvOgJUArNkiH/8KdooFVhxYjUIfWD1RwYPho6fBSgDWbKGP2HsTGqx8ByywwCrlgAXWSGDNPHwtYG8vlgarUeyL18AaDNb19aDdKAvWbLGvigRrIFhfXg/by+XAahT8cluwBoH1sfXAvVMKrNmCX8cN1iAf/1oP3fESYDWK3kAArAFgfbT/x/efkPV/s1+UAGu26C1PwBoA1rvr67++L+YVpJ/u/26jh9UofJMmsI6GdXvvqHBf1GveP9f75U6NHNZs4dvKgXU0rE+sr/8q7qd0ek9YfzlqWI0R3AgTrCNh/SvwAWvnkPXyqGHNjuDWvSdK+GzghMF6d/3XkT+w+u5+J1mFFmuM4GbjBT5X+NUpgdUK/Ui481hYH+1igx2wSrvQ7/SUwOqdu78UGdZn9jt7L7LYgAes0i5NfnR6YP07MqzPjxrWgAcssArC+lR8WP8Y5WKDHrDK+/gXWBMJa/bAL8QCC6wCi713wHq9ICwPhWDd9H9+0AMWWGAN08ygB6zSXm44A9bEwrpSKwprIdgpFlghHgpfLw4r7+cKHz0N1sSevF+pFYflTWiw9rzc8DpYYI0cVm1lqQYWWKOHlW8msMACCyywwAILLLDAAgsssMACCyywwAILLLDAAgsssMACCyywwAILLLDAAgsssMACCyywwAILLLDAAgsssMACCyywwAILLLDAKjTTnfFhfdOX21b65ba5Yf0hMqx7I8J6qT1NX8edc6Zu96nIsO7pdk+5gUC70hsI5Jup2306MqwHut26W560K73lSb6ZLnbPRYbV+/WyeDdpeqs9VTdpyjXTY93umbiuTna7z2RuK1fxbeVyzXRX6MfC3iPhk1nAG2G+NV03wswzU+9pYdxDVu+Atc+TQrfubY/51r25ZrrY7Z47HdPVif7vlmUxbzZ+LWCl3Ww8z0wf6R0VupeuBux8/zd7Ih6s29ZDdzwIrLlu6OrxYGUfi+zqnSwIrOzWyK5ezQLCyr4c19XLWRhY2QNxXT2ThYSVXY/q6kYWCFb2eFRXr2VBYWUzD1+7cT3cf95ezELBymbORjx5P1vlTEcsllhVwTKTxcwEFlhggWUmi5kJLLDAAstMFjMTWGCBNcWwtvtF/AGstGF1+kX8ISisRswrSGuhYDU3wRoSViPqNe/zgWDNdXpv9q726/+vaD+EhNWI+ymd+TiwVjqLzhiGWqwV+QOr9Siw5jpL9cCGNgPCakSGdTwKrJlO5Cc9K4sBYbVDFwXWylLkR73OUjxYrdiw6jFgtWKfYc106vE+/hUbVpCPf90R+pFw/1+vYliN2LDmgxyxXqlHhtXqnAoHq91O7iTLe4V7T7IWwQKrjKeFXwELLLDASqVXwAKrjGo1sMCajvcKwQILrMpgNZfBAquEmfY7OQYLLLDAAgsssMACa7Jhba2BBZZX3sECCyywwAILLLB2OrYBFlgumwELLLDAAgsssMACyxWkYHmvECywwHIFKVheeQcLLLDAAgsssMACyxWkYIHllXewwAILLLDAAssVpGCB5bIZsMDKfFUkWGD5nvfJhrUIFlgl1Np0y5N2irc8caGfmzSVBKsGltvKlTBTcwmsSboR5rwbYbp1r1v3VnXmXnez8ZRvNh5VVmtlMSasuLLmsziw5jo798dtbffaiPTDaqezFBRWVFnzWSBYWXPnz6/nqxPuh+WosJyVDjJTMyqs5QyslGFlrf4/q722I/2wXc/AShuWmSxmJrDAAgssM1nMTGCBBRZYZrKYmcACCyywzGQxM4EFFlhgmcliZgILLLDAMpPFzGQxsMACCyyLmcliYIEFFlgWM5PFwAILLLAsZiaLgQUWWGBZzEwWAwsssMCymJksBlYqsI4tJ79Yc8NMQWaymJlKX2wt+cW2NswUZKbdrSa/2KqZwsy0e7F64oO1Vs0UZqZdbW0mvtjcmpnCzDRJT6TH8zTaTFP3fGc8J6VmmrrT0lUzRTx3T/7sYVznDmYa+uwh7YN8c9lMgWbaffaQ9DPp1uqGmQLN9KGD/CMO8WbydsVN56QbZgo104f+LqZ7+tBcM1OwmSbi9GGspw5mGv7vYqpH+a01M4WbafffxUSP8lvj/ZtophxH+bX0DvOtsQ9mphyT9f7tSe313q9spogz3TRZcm2YKehMH2p7O6m5trfNFHgmSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZKkIP0XZd604E4YmBYAAAAASUVORK5CYII=';
const TOUCH_ICON_PNG = 'iVBORw0KGgoAAAANSUhEUgAAALQAAAC0BAMAAADP4xsBAAAAMFBMVEUcKimMwqnkiqZIZlw2OTtiiXhLRkooNDNWeWzTgpubZ3hvm4h4VmOCtJ2PYXG7d4zP/zQXAAAACXBIWXMAAAsTAAALEwEAmpwYAAABWUlEQVR42u3YwSoFURzH8VOTeyWpUxZKNicRK+UFrpIUxSPchZWNm52kKFsliY3yAjZKWdl4AyvKRvctlIXsZ47z6++/0Hw/D/Bt+s+ZOWcmBAAAAAAA0FKbn6nG7d3AXN5KDW6s7fHU6NKYfm5OL/RM5U7KuDalD3LpRVN6mEsn00QusukPr1GndO6z9H7MG9IT+fSsIT2WT8+RbnvacfE5PjKOD7rj6+mXl2rfkt732wqy99G47w695pG97CvrEWevcdL249Nu/QL86oU/sFpjEAAAwL+ytlxoRwx3z2KxN+0IcRIFU0r5MEoehfS9lp4uL49E0XZxekVNT3rNQ5hIN8pK11+lp5cK06N6+thrgZQvEdKkSZMm3fq04wbmuO129HTxf8UXtTzjcwTWjsFHavq1OF153UV9IspnQeV20SFsKOUH7RNs/ak0/H7KlzAAAAAAAG31DeIHH2j4TBxqAAAAAElFTkSuQmCC';
return { CSS, JS, FAVICON, ROBOTS, OG_PNG, TOUCH_ICON_PNG };
})();

// src/routes/util.js
const __m39 = (() => {
// Copyright (c) 2026 Miloš Petrović (Trench Logic Studio) · SPDX-License-Identifier: MIT
const { HttpError, htmlResponse, redirect } = __m6;
const { epochSeconds } = __m9;

function page(view, status = 200, headers = {}) {
  return htmlResponse(view, { status, headers });
}

/** Positive integer id from a route parameter or form field, else 404. */
function toId(value) {
  const s = String(value ?? '');
  if (!/^[1-9]\d{0,15}$/.test(s)) throw new HttpError(404, 'That item does not exist.');
  const n = Number(s);
  if (!Number.isSafeInteger(n)) throw new HttpError(404, 'That item does not exist.');
  return n;
}

/** The logged-in salon owner, or a redirect to the login page. */
async function requireUser(c) {
  const user = await c.getUser();
  if (user && c.config.requireEmailVerification && !user.email_verified_at && !user.salon.is_demo) return { response: redirect('/verify') };
  if (user) return { user };
  const next = c.request.method === 'GET' ? `${c.url.pathname}${c.url.search}` : '/app';
  return { response: redirect(`/login?next=${encodeURIComponent(next)}`) };
}

function nowSec(c) {
  return epochSeconds(c.now);
}

function flashCode(c) {
  const v = c.url.searchParams.get('ok') || '';
  return /^[a-z_]{1,32}$/.test(v) ? v : '';
}
return { page, toId, requireUser, nowSec, flashCode };
})();

// src/routes/public.js
const __m40 = (() => {
// Copyright (c) 2026 Miloš Petrović (Trench Logic Studio) · SPDX-License-Identifier: MIT
// Public pages: landing, a salon's request page, offers, the client's status page.

const { HttpError, readForm, redirect, textResponse, jsonResponse } = __m6;
const { FormReader, contactKind } = __m21;
const { randomToken, shortRef } = __m1;
const { writeWithEvent } = __m22;
const { hit, limiterKey } = __m23;
const { localNow, addDays, fmtTime, localToUtc } = __m9;
const { CONSENT_VERSION } = __m0;
const { isLocale, negotiate, LOCALES, htmlLang } = __m18;
const { salonBySlug, salonById, listServices, getService, listUpgrades, listWindows, busySlots, requestByToken, parseUpgrades } = __m10;
const { expireForSalon } = __m25;
const { hasAccess, ensureBillingTrial } = __m2;
const { bump, isBot } = __m26;
const { availabilityGuard, validSlotInstant } = __m27;
const { findQuotedOffer } = __m28;
const { notifyNewRequest } = __m24;
const { deliverDue } = __m3;
const { calendar } = __m29;
const { computeOffers, assertOffer, DEFAULTS, selfTest, ENGINE } = __m8;
const { SCHEMA_VERSION } = __m7;
const { landingView } = __m36;
const { withLang } = __m20;
const { salonView, offersView, waitlistView, statusView, privacyView, termsView, legalView } = __m37;
const { CSS, JS, FAVICON, ROBOTS, OG_PNG, TOUCH_ICON_PNG } = __m38;
const { page, toId, nowSec } = __m39;

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

function deliverSoon(c) {
  if (!c.mail.provider) return;
  c.defer(() => deliverDue(c.db, c.env, c.mail, c.now, { fetchImpl: c.fetch, productName: c.config.productName }));
}

/** The engine's answer for one service right now, from live salon data. */
async function offersFor(c, salon, service, excludeId = 0) {
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

function registerPublic(r) {
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
return { deliverSoon, offersFor, registerPublic };
})();

// src/account-tokens.js
const __m41 = (() => {
// Copyright (c) 2026 Miloš Petrović (Trench Logic Studio) · SPDX-License-Identifier: MIT
const { randomToken, sha256Hex } = __m1;
const { epochSeconds } = __m9;
const { notifyAccountToken } = __m24;

async function issueAccountToken(c, user, kind) {
  const token = randomToken(32);
  await c.db.batch([
    c.db.prepare('DELETE FROM account_tokens WHERE kind = ? AND salon_id = ? AND email = ?').bind(kind, user.salon_id, user.email),
    c.db.prepare('INSERT INTO account_tokens (token_hash, kind, salon_id, user_id, email, expires_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(await sha256Hex(token),kind,user.salon_id,user.id || null,user.email,epochSeconds(c.now)+86400),
  ]);
  const url = `${c.url.origin}/${kind === 'invite' ? 'join' : 'verify'}/${token}`;
  await notifyAccountToken({ db: c.db, mail: c.mail, now: c.now, productName: c.config.productName }, user, url, kind);
  return url;
}

async function accountToken(c, kind) {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(c.params.token || '')) return null;
  return c.db.prepare('SELECT * FROM account_tokens WHERE token_hash = ? AND kind = ? AND used_at IS NULL AND expires_at > ?')
    .bind(await sha256Hex(c.params.token),kind,epochSeconds(c.now)).first();
}
return { issueAccountToken, accountToken };
})();

// src/views/auth.js
const __m42 = (() => {
// Copyright (c) 2026 Miloš Petrović (Trench Logic Studio) · SPDX-License-Identifier: MIT
const { html } = __m19;
const { sitePage, errorFor, invalid, formErrors, notice, selected, langField, rich } = __m20;
const { CURRENCIES } = __m34;
const { timeZones } = __m9;
const { RESET_LINK_HOURS } = __m0;

function signupView(c, { values = {}, errors = {}, message = '' } = {}) {
  const t = c.t;
  const tz = values.timezone || 'Europe/Berlin';
  const currency = values.currency || 'EUR';
  const heading = !c.billing.enabled ? t('Start your free beta') : c.billing.trialDays ? t('Start your free trial') : t('Create account');
  const body = html`<div class="wrap"><div class="center-card">
  <h1>${heading}</h1>
  <p class="muted">${t('Set-up takes a few minutes: pick your salon type, enter your prices, and you have a page to share.')}</p>
  ${notice('error', message)}
  ${formErrors(c, errors)}
  <form method="post" action="/signup" novalidate>
    ${langField(c)}
    <div class="field">
      <label for="salon">${t('Salon name')}</label>
      <input id="salon" name="salon" type="text" autocomplete="organization" maxlength="80" required value="${values.salon || ''}"${invalid(errors, 'salon')}>
      ${errorFor(errors, 'salon')}
    </div>
    <div class="field">
      <label for="email">${t('Email')}</label>
      <input id="email" name="email" type="email" autocomplete="email" maxlength="254" required value="${values.email || ''}"${invalid(errors, 'email')}>
      ${errorFor(errors, 'email')}
    </div>
    <div class="field">
      <label for="password">${t('Password')}</label>
      <input id="password" name="password" type="password" autocomplete="new-password" minlength="10" maxlength="200" required${invalid(errors, 'password')}>
      <span class="hint">${t('At least 10 characters.')}</span>
      ${errorFor(errors, 'password')}
    </div>
    <div class="row row-2">
      <div class="field">
        <label for="timezone">${t('Time zone')}</label>
        <select id="timezone" name="timezone" data-detect-timezone${values.timezone ? html` data-chosen="1"` : ''}${invalid(errors, 'timezone')}>
          ${timeZones().map((z) => html`<option value="${z}"${selected(z === tz)}>${z.replace(/_/g, ' ')}</option>`)}
        </select>
        ${errorFor(errors, 'timezone')}
      </div>
      <div class="field">
        <label for="currency">${t('Currency')}</label>
        <select id="currency" name="currency"${invalid(errors, 'currency')}>
          ${CURRENCIES.map((cur) => html`<option value="${cur}"${selected(cur === currency)}>${cur}</option>`)}
        </select>
        ${errorFor(errors, 'currency')}
      </div>
    </div>
    <div class="field">
      <label class="check"><input type="checkbox" name="terms" value="on"${values.terms ? html` checked` : ''}${invalid(errors, 'terms')}> <span>${rich(t, 'I accept the {terms} and the {privacy}.', {
        terms: html`<a href="${c.link('/terms')}">${c.billing.enabled ? t('terms of use') : t('beta terms')}</a>`,
        privacy: html`<a href="${c.link('/privacy')}">${t('privacy notice')}</a>`,
      })}</span></label>
      ${errorFor(errors, 'terms')}
    </div>
    <button class="btn btn-primary btn-block" type="submit">${t('Create account')}</button>
  </form>
  <p class="small muted">${t('Already have an account?')} <a href="${c.link('/login')}">${t('Log in')}</a></p>
</div></div>`;
  return sitePage(c, { title: heading, body, switchPath: '/signup' });
}

function loginView(c, { values = {}, errors = {}, message = '', ok = '', next = '' } = {}) {
  const t = c.t;
  const body = html`<div class="wrap"><div class="center-card">
  <h1>${t('Log in')}</h1>
  ${notice('ok', ok)}
  ${notice('error', message)}
  <form method="post" action="/login" novalidate>
    ${langField(c)}
    ${next ? html`<input type="hidden" name="next" value="${next}">` : ''}
    <div class="field">
      <label for="email">${t('Email')}</label>
      <input id="email" name="email" type="email" autocomplete="email" maxlength="254" required value="${values.email || ''}"${invalid(errors, 'email')}>
      ${errorFor(errors, 'email')}
    </div>
    <div class="field">
      <label for="password">${t('Password')}</label>
      <input id="password" name="password" type="password" autocomplete="current-password" maxlength="200" required${invalid(errors, 'password')}>
      ${errorFor(errors, 'password')}
    </div>
    <button class="btn btn-primary btn-block" type="submit">${t('Log in')}</button>
  </form>
  <p class="small muted"><a href="${c.link('/forgot')}">${t('Forgot your password?')}</a></p>
  <p class="small muted">${t('New here?')} <a href="${c.link('/signup')}">${!c.billing.enabled ? t('Start your free beta') : c.billing.trialDays ? t('Start your free trial') : t('Create account')}</a></p>
</div></div>`;
  return sitePage(c, { title: t('Log in'), body, switchPath: '/login' });
}

function forgotView(c, { sent = false, errors = {}, values = {} } = {}) {
  const t = c.t;
  const contact = c.config.contactEmail;
  let content;
  if (!c.mail.provider) {
    content = contact
      ? html`<p class="lead">${rich(t, 'Email us from the address you signed up with, and we will send you a reset link: {email}', {
          email: html`<a href="mailto:${contact}">${contact}</a>`,
        })}</p>`
      : html`<p class="lead">${t('Contact the operator of this service for a reset link.')}</p>`;
  } else if (sent) {
    content = html`<div class="notice notice-ok" role="status"><p>${t('If an account exists for that address, a reset link is on its way. It works once, for {hours} hours.', { hours: RESET_LINK_HOURS })}</p></div>`;
  } else {
    content = html`<p class="muted">${t('Enter the email you signed up with. We will send you a link to choose a new password.')}</p>
  ${formErrors(c, errors)}
  <form method="post" action="/forgot" novalidate>
    ${langField(c)}
    <div class="field">
      <label for="email">${t('Email')}</label>
      <input id="email" name="email" type="email" autocomplete="email" maxlength="254" required value="${values.email || ''}"${invalid(errors, 'email')}>
      ${errorFor(errors, 'email')}
    </div>
    <button class="btn btn-primary btn-block" type="submit">${t('Send reset link')}</button>
  </form>`;
  }
  const body = html`<div class="wrap"><div class="center-card">
  <h1>${t('Forgot your password?')}</h1>
  ${content}
  <p class="small muted"><a href="${c.link('/login')}">${t('Back to log in')}</a></p>
</div></div>`;
  return sitePage(c, { title: t('Forgot your password?'), body, switchPath: '/forgot' });
}

function resetView(c, { token, email, errors = {}, invalidLink = false } = {}) {
  const t = c.t;
  const body = invalidLink
    ? html`<div class="wrap"><div class="center-card">
  <h1>${t('This link has expired')}</h1>
  <p class="muted">${t('Reset links work once and for {hours} hours. Ask for a new one.', { hours: RESET_LINK_HOURS })}</p>
  <p><a class="btn btn-outline" href="${c.link('/forgot')}">${t('Ask for a new link')}</a></p>
</div></div>`
    : html`<div class="wrap"><div class="center-card">
  <h1>${t('Choose a new password')}</h1>
  <p class="muted">${t('For {email}. You will be logged out everywhere else.', { email })}</p>
  ${formErrors(c, errors)}
  <form method="post" action="/reset/${token}" novalidate>
    ${langField(c)}
    <div class="field">
      <label for="password">${t('New password')}</label>
      <input id="password" name="password" type="password" autocomplete="new-password" minlength="10" maxlength="200" required${invalid(errors, 'password')}>
      <span class="hint">${t('At least 10 characters.')}</span>
      ${errorFor(errors, 'password')}
    </div>
    <button class="btn btn-primary btn-block" type="submit">${t('Save new password')}</button>
  </form>
</div></div>`;
  return sitePage(c, { title: t('Choose a new password'), body });
}
return { signupView, loginView, forgotView, resetView };
})();

// src/routes/auth.js
const __m43 = (() => {
// Copyright (c) 2026 Miloš Petrović (Trench Logic Studio) · SPDX-License-Identifier: MIT
// Sign-up, log-in, log-out and password reset.

const { HttpError, readForm, redirect, safeNext } = __m6;
const { FormReader, slugify } = __m21;
const { CURRENCIES } = __m34;
const { isValidTimeZone } = __m9;
const { isLocale, tk } = __m18;
const { appendEvent } = __m22;
const { hit, check, clear, limiterKey } = __m23;
const { createPasswordRecord, authenticate, startSession, endSession, endAllSessions, findResetToken, createResetToken } = __m11;
const { issueAccountToken } = __m41;
const { initialBilling } = __m2;
const { notifyPasswordReset } = __m24;
const { signupView, loginView, forgotView, resetView } = __m42;
const { deliverSoon } = __m40;
const { page, nowSec } = __m39;
const { randomToken } = __m1;

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

async function freeSlug(db, name, prefix = '') {
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

function registerAuth(r) {
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
return { freeSlug, registerAuth };
})();

// src/qr.js
const __m44 = (() => {
// Copyright (c) 2026 Miloš Petrović (Trench Logic Studio) · SPDX-License-Identifier: MIT
// QR Code generator for the salon's poster: byte mode, error correction level M,
// versions 1–10 (up to 213 bytes, far more than any page address needs).
// Implements ISO/IEC 18004; written for this app so nothing is loaded from elsewhere.

// Error correction codewords per block, and number of blocks, for level M (index = version).
const ECC_PER_BLOCK = [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26];
const NUM_BLOCKS = [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5];
const FORMAT_BITS_M = 0; // level M is encoded as 00

function numRawDataModules(ver) {
  let result = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const numAlign = Math.floor(ver / 7) + 2;
    result -= (25 * numAlign - 10) * numAlign - 55;
    if (ver >= 7) result -= 36;
  }
  return result;
}

function numDataCodewords(ver) {
  return Math.floor(numRawDataModules(ver) / 8) - ECC_PER_BLOCK[ver] * NUM_BLOCKS[ver];
}

function alignmentPositions(ver) {
  if (ver === 1) return [];
  const size = ver * 4 + 17;
  const numAlign = Math.floor(ver / 7) + 2;
  const step = Math.ceil((ver * 4 + 4) / (numAlign * 2 - 2)) * 2;
  const result = [6];
  for (let i = 0, pos = size - 7; i < numAlign - 1; i++, pos -= step) result.splice(1, 0, pos);
  return result;
}

/* Reed–Solomon over GF(2^8) with the QR polynomial 0x11D. */
function rsMultiply(x, y) {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}

function rsDivisor(degree) {
  const result = new Array(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < result.length; j++) {
      result[j] = rsMultiply(result[j], root);
      if (j + 1 < result.length) result[j] ^= result[j + 1];
    }
    root = rsMultiply(root, 0x02);
  }
  return result;
}

function rsRemainder(data, divisor) {
  const result = divisor.map(() => 0);
  for (const b of data) {
    const factor = b ^ result.shift();
    result.push(0);
    divisor.forEach((coef, i) => {
      result[i] ^= rsMultiply(coef, factor);
    });
  }
  return result;
}

function addEccAndInterleave(data, ver) {
  const numBlocks = NUM_BLOCKS[ver];
  const blockEccLen = ECC_PER_BLOCK[ver];
  const rawCodewords = Math.floor(numRawDataModules(ver) / 8);
  const numShortBlocks = numBlocks - (rawCodewords % numBlocks);
  const shortBlockLen = Math.floor(rawCodewords / numBlocks);
  const divisor = rsDivisor(blockEccLen);
  const blocks = [];
  for (let i = 0, k = 0; i < numBlocks; i++) {
    const dat = data.slice(k, k + shortBlockLen - blockEccLen + (i < numShortBlocks ? 0 : 1));
    k += dat.length;
    const ecc = rsRemainder(dat, divisor);
    if (i < numShortBlocks) dat.push(0);
    blocks.push(dat.concat(ecc));
  }
  const result = [];
  for (let i = 0; i < blocks[0].length; i++) {
    blocks.forEach((block, j) => {
      if (i !== shortBlockLen - blockEccLen || j >= numShortBlocks) result.push(block[i]);
    });
  }
  return result;
}

const getBit = (x, i) => ((x >>> i) & 1) !== 0;

const MASKS = [
  (x, y) => (x + y) % 2 === 0,
  (x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

/** QR matrix for a text: array of rows, true = dark module. */
function qrMatrix(text) {
  const bytes = new TextEncoder().encode(String(text));
  let ver = 1;
  for (; ver <= 10; ver++) {
    const needed = 4 + (ver <= 9 ? 8 : 16) + bytes.length * 8;
    if (needed <= numDataCodewords(ver) * 8) break;
  }
  if (ver > 10) throw new Error('QR: text is too long for this generator');

  // Data bits: byte mode, length, payload, terminator, padding.
  const bits = [];
  const push = (value, len) => {
    for (let i = len - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  push(0b0100, 4);
  push(bytes.length, ver <= 9 ? 8 : 16);
  for (const b of bytes) push(b, 8);
  const capacity = numDataCodewords(ver) * 8;
  push(0, Math.min(4, capacity - bits.length));
  push(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) push(pad, 8);
  const dataCodewords = [];
  for (let i = 0; i < bits.length; i += 8) {
    let v = 0;
    for (let j = 0; j < 8; j++) v = (v << 1) | bits[i + j];
    dataCodewords.push(v);
  }
  const codewords = addEccAndInterleave(dataCodewords, ver);

  const size = ver * 4 + 17;
  const modules = Array.from({ length: size }, () => new Array(size).fill(false));
  const fixed = Array.from({ length: size }, () => new Array(size).fill(false));
  const setFixed = (x, y, dark) => {
    modules[y][x] = dark;
    fixed[y][x] = true;
  };

  const drawFormatBits = (mask) => {
    const data = (FORMAT_BITS_M << 3) | mask;
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const fmt = ((data << 10) | rem) ^ 0x5412;
    for (let i = 0; i <= 5; i++) setFixed(8, i, getBit(fmt, i));
    setFixed(8, 7, getBit(fmt, 6));
    setFixed(8, 8, getBit(fmt, 7));
    setFixed(7, 8, getBit(fmt, 8));
    for (let i = 9; i < 15; i++) setFixed(14 - i, 8, getBit(fmt, i));
    for (let i = 0; i < 8; i++) setFixed(size - 1 - i, 8, getBit(fmt, i));
    for (let i = 8; i < 15; i++) setFixed(8, size - 15 + i, getBit(fmt, i));
    setFixed(8, size - 8, true);
  };

  // Function patterns: timing, finders, alignment, format area, version.
  for (let i = 0; i < size; i++) {
    setFixed(6, i, i % 2 === 0);
    setFixed(i, 6, i % 2 === 0);
  }
  for (const [cx, cy] of [
    [3, 3],
    [size - 4, 3],
    [3, size - 4],
  ]) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || x >= size || y < 0 || y >= size) continue;
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        setFixed(x, y, dist !== 2 && dist !== 4);
      }
    }
  }
  const align = alignmentPositions(ver);
  for (let i = 0; i < align.length; i++) {
    for (let j = 0; j < align.length; j++) {
      const corner = (i === 0 && j === 0) || (i === 0 && j === align.length - 1) || (i === align.length - 1 && j === 0);
      if (corner) continue;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) setFixed(align[i] + dx, align[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
    }
  }
  drawFormatBits(0);
  if (ver >= 7) {
    let rem = ver;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const verBits = (ver << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const bit = getBit(verBits, i);
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      setFixed(a, b, bit);
      setFixed(b, a, bit);
    }
  }

  // Codewords in the zig-zag order, skipping the vertical timing column.
  let bitIndex = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (!fixed[y][x] && bitIndex < codewords.length * 8) {
          modules[y][x] = getBit(codewords[bitIndex >>> 3], 7 - (bitIndex & 7));
          bitIndex++;
        }
      }
    }
  }

  const applyMask = (mask) => {
    const fn = MASKS[mask];
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) if (!fixed[y][x] && fn(x, y)) modules[y][x] = !modules[y][x];
    }
  };

  let bestMask = 0;
  let bestScore = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    applyMask(mask);
    drawFormatBits(mask);
    const score = penalty(modules, size);
    if (score < bestScore) {
      bestScore = score;
      bestMask = mask;
    }
    applyMask(mask); // XOR again to undo
  }
  applyMask(bestMask);
  drawFormatBits(bestMask);
  return modules;
}

/* Penalty rules from the standard, used only to pick the most readable mask. */
function penalty(m, size) {
  let result = 0;
  const addHistory = (run, history) => {
    if (history[0] === 0) run += size;
    history.pop();
    history.unshift(run);
  };
  const countPatterns = (h) => {
    const n = h[1];
    const core = n > 0 && h[2] === n && h[3] === n * 3 && h[4] === n && h[5] === n;
    return (core && h[0] >= n * 4 && h[6] >= n ? 1 : 0) + (core && h[6] >= n * 4 && h[0] >= n ? 1 : 0);
  };
  const terminate = (color, run, history) => {
    if (color) {
      addHistory(run, history);
      run = 0;
    }
    run += size;
    addHistory(run, history);
    return countPatterns(history);
  };
  for (let pass = 0; pass < 2; pass++) {
    for (let a = 0; a < size; a++) {
      let color = false;
      let run = 0;
      const history = [0, 0, 0, 0, 0, 0, 0];
      for (let b = 0; b < size; b++) {
        const cell = pass === 0 ? m[a][b] : m[b][a];
        if (cell === color) {
          run++;
          if (run === 5) result += 3;
          else if (run > 5) result++;
        } else {
          addHistory(run, history);
          if (!color) result += countPatterns(history) * 40;
          color = cell;
          run = 1;
        }
      }
      result += terminate(color, run, history) * 40;
    }
  }
  for (let y = 0; y < size - 1; y++) {
    for (let x = 0; x < size - 1; x++) {
      const c = m[y][x];
      if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) result += 3;
    }
  }
  let dark = 0;
  for (const row of m) for (const c of row) if (c) dark++;
  const total = size * size;
  result += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
  return result;
}

/** SVG of a QR code with a quiet zone, scalable to any print size. */
function qrSvg(text, { margin = 4, title = '' } = {}) {
  const m = qrMatrix(text);
  const size = m.length + margin * 2;
  let path = '';
  for (let y = 0; y < m.length; y++) {
    for (let x = 0; x < m.length; ) {
      if (!m[y][x]) {
        x++;
        continue;
      }
      let run = 1;
      while (x + run < m.length && m[y][x + run]) run++;
      path += `M${x + margin} ${y + margin}h${run}v1h-${run}z`;
      x += run;
    }
  }
  const label = title ? `<title>${title.replace(/[<>&"]/g, '')}</title>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges" role="img">${label}<rect width="${size}" height="${size}" fill="#fff"/><path d="${path}" fill="#000"/></svg>`;
}
return { qrMatrix, qrSvg };
})();

// src/csv.js
const __m45 = (() => {
// Copyright (c) 2026 Miloš Petrović (Trench Logic Studio) · SPDX-License-Identifier: MIT
// CSV export that spreadsheet programs open safely: values that start with
// =, +, - or @ are prefixed so they can never run as formulas.

function cell(value) {
  let s = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(header, rows) {
  // A byte-order mark makes Excel read UTF-8 names correctly.
  return '﻿' + [header, ...rows].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}
return { toCsv };
})();

// src/templates.js
const __m46 = (() => {
// Copyright (c) 2026 Miloš Petrović (Trench Logic Studio) · SPDX-License-Identifier: MIT
// Starting points for common salon types. Names are English source strings,
// saved in the owner's language when a template is applied. Prices are always
// the owner's own: the setup form asks for them.

const { tk } = __m18;

const TEMPLATES = [
  {
    id: 'hair',
    label: tk('Hair salon'),
    services: [
      [tk('Cut & finish'), 45],
      [tk('Blow-dry & style'), 40],
      [tk('Colour refresh'), 90],
      [tk('Highlights'), 120],
    ],
    upgrades: [
      [tk('Deep conditioning treatment'), 15],
      [tk('Scalp massage'), 10],
      [tk('Gloss treatment'), 20],
      [tk('Extended styling'), 15],
    ],
    demoPrices: [4000, 3500, 8500, 14000],
  },
  {
    id: 'barber',
    label: tk('Barbershop'),
    services: [
      [tk('Haircut'), 30],
      [tk('Beard trim'), 20],
      [tk('Haircut & beard'), 45],
      [tk('Hot towel shave'), 30],
    ],
    upgrades: [
      [tk('Hot towel treatment'), 10],
      [tk('Beard oil treatment'), 5],
      [tk('Scalp massage'), 10],
      [tk('Face mask'), 15],
    ],
    demoPrices: [2500, 1500, 3500, 3000],
  },
  {
    id: 'nails',
    label: tk('Nail studio'),
    services: [
      [tk('Gel manicure'), 50],
      [tk('Classic manicure'), 35],
      [tk('Pedicure'), 50],
      [tk('Gel pedicure'), 60],
    ],
    upgrades: [
      [tk('Hand massage'), 10],
      [tk('Paraffin treatment'), 15],
      [tk('Cuticle care'), 10],
      [tk('Nail art accent'), 10],
    ],
    demoPrices: [3500, 2500, 4000, 5000],
  },
  {
    id: 'beauty',
    label: tk('Beauty & spa'),
    services: [
      [tk('Classic facial'), 50],
      [tk('Relaxing massage'), 50],
      [tk('Brow & lash tint'), 30],
      [tk('Waxing'), 30],
    ],
    upgrades: [
      [tk('Face mask'), 15],
      [tk('Hand massage'), 10],
      [tk('Eye treatment'), 10],
      [tk('Extended massage'), 15],
    ],
    demoPrices: [6000, 6500, 3000, 3500],
  },
];

const templateById = (id) => TEMPLATES.find((tpl) => tpl.id === id) || null;

/** Quiet hours most salons have: early afternoons, Tuesday to Thursday, one free chair. */
const DEFAULT_HOURS = { weekdays: [2, 3, 4], start: 13 * 60, end: 16 * 60, capacity: 1 };
return { TEMPLATES, templateById, DEFAULT_HOURS };
})();

// src/views/catalog.js
const __m47 = (() => {
// Copyright (c) 2026 Miloš Petrović (Trench Logic Studio) · SPDX-License-Identifier: MIT
// Services, upgrades and the guided setup.

const { html, raw } = __m19;
const { appPage, errorFor, invalid, formErrors, selected, checked } = __m20;
const { flash } = __m33;
const { centsToInput } = __m34;
const { selectBundle, requiredAddedMin, MIN_UPLIFT_PCT } = __m8;
const { TEMPLATES, DEFAULT_HOURS } = __m46;

/* -------------------------------- services -------------------------------- */

function readiness(c, service, upgrades, salon) {
  const t = c.t;
  if (!service.active) return html`<span class="readiness muted">${t('Hidden from clients.')}</span>`;
  const bundle = selectBundle(service, upgrades, salon.min_uplift_pct);
  if (!bundle) {
    const need = requiredAddedMin(service.duration_min, salon.min_uplift_pct);
    return html`<span class="readiness bad">${t('Not offered yet: needs upgrades worth at least {n} extra minutes.', { n: need })} <a href="/app/upgrades">${t('Add upgrades')}</a></span>`;
  }
  return html`<span class="readiness ok">${t('Offered as {what}: {total} instead of {base}.', {
    what: [service.name, ...bundle.items.map((u) => u.name)].join(' + '),
    total: t.duration(service.duration_min + bundle.added_min),
    base: t.duration(service.duration_min),
  })}</span>`;
}

function serviceFields(c, prefix, v, errors, currency) {
  const t = c.t;
  return html`<div class="row row-3">
    <div class="field">
      <label for="${prefix}name">${t('Name')}</label>
      <input id="${prefix}name" name="name" type="text" maxlength="80" required value="${v.name ?? ''}"${invalid(errors, 'name')}>
      ${errorFor(errors, 'name')}
    </div>
    <div class="field">
      <label for="${prefix}duration">${t('Length in minutes')}</label>
      <input id="${prefix}duration" name="duration" type="number" min="5" max="600" step="5" inputmode="numeric" required value="${v.duration ?? ''}"${invalid(errors, 'duration')}>
      ${errorFor(errors, 'duration')}
    </div>
    <div class="field">
      <label for="${prefix}price">${t('Price ({currency})', { currency })}</label>
      <input id="${prefix}price" name="price" type="text" inputmode="decimal" maxlength="12" required value="${v.price ?? ''}"${invalid(errors, 'price')}>
      ${errorFor(errors, 'price')}
    </div>
  </div>`;
}

function servicesView(c, { services, upgrades, values = {}, errors = {}, editId = null, flashCode = '', banners = [] }) {
  const t = c.t;
  const salon = c.user.salon;
  const body = html`
<div class="page-head"><div>
  <h1>${t('Services')}</h1>
  <p class="muted">${t('What clients can request. The price here is the price clients pay, always.')}</p>
</div>
${services.length ? '' : html`<a class="btn btn-primary" href="/app/setup">${t('Set up from a template')}</a>`}
</div>
${flash(c, flashCode)}
<section class="panel" aria-labelledby="add-service-h">
  <h2 id="add-service-h">${t('Add a service')}</h2>
  ${editId === null ? formErrors(c, errors) : ''}
  <form method="post" action="/app/services" novalidate>
    ${serviceFields(c, 'new-', editId === null ? values : {}, editId === null ? errors : {}, salon.currency)}
    <button class="btn btn-primary" type="submit">${t('Add service')}</button>
  </form>
</section>

<h2 class="section-title">${t('Your services')}</h2>
${
  services.length
    ? html`<ul class="items">${services.map((s) => {
        const editing = editId === s.id;
        const v = editing ? values : { name: s.name, duration: s.duration_min, price: centsToInput(s.price_cents) };
        return html`<li class="item${s.active ? '' : ' is-off'}" id="service-${s.id}">
      <div class="item-head">
        <span class="item-title">${s.name}</span>
        <span class="num">${t.duration(s.duration_min)}, ${t.money(s.price_cents, salon.currency)}</span>
      </div>
      ${readiness(c, s, upgrades, salon)}
      <details${editing ? raw(' open') : ''}>
        <summary>${t('Edit')}</summary>
        ${editing ? formErrors(c, errors) : ''}
        <form method="post" action="/app/services/${s.id}" novalidate>
          <input type="hidden" name="action" value="save">
          ${serviceFields(c, `s${s.id}-`, v, editing ? errors : {}, salon.currency)}
          <div class="actions">
            <button class="btn btn-primary" type="submit">${t('Save changes')}</button>
          </div>
        </form>
        <form method="post" action="/app/services/${s.id}" class="actions">
          <input type="hidden" name="action" value="${s.active ? 'hide' : 'show'}">
          <button class="btn btn-outline btn-small" type="submit">${s.active ? t('Hide from clients') : t('Show to clients')}</button>
        </form>
      </details>
    </li>`;
      })}</ul>`
    : html`<p class="empty">${t('No services yet. Start from a template, or add the ones clients most often find fully booked.')}</p>`
}`;
  return appPage(c, { title: t('Services'), body, current: '/app/services', banners });
}

/* -------------------------------- upgrades -------------------------------- */

function upgradeFields(c, prefix, v, errors, services) {
  const t = c.t;
  return html`<div class="row row-3">
    <div class="field">
      <label for="${prefix}name">${t('Name')}</label>
      <input id="${prefix}name" name="name" type="text" maxlength="80" required value="${v.name ?? ''}"${invalid(errors, 'name')}>
      ${errorFor(errors, 'name')}
    </div>
    <div class="field">
      <label for="${prefix}minutes">${t('Extra minutes')}</label>
      <input id="${prefix}minutes" name="minutes" type="number" min="5" max="240" step="5" inputmode="numeric" required value="${v.minutes ?? ''}"${invalid(errors, 'minutes')}>
      ${errorFor(errors, 'minutes')}
    </div>
    <div class="field">
      <label for="${prefix}service">${t('Can be added to')}</label>
      <select id="${prefix}service" name="service"${invalid(errors, 'service')}>
        <option value="all"${selected(!v.service || v.service === 'all')}>${t('All services')}</option>
        ${services.map((s) => html`<option value="${s.id}"${selected(String(v.service) === String(s.id))}>${s.name}</option>`)}
      </select>
      ${errorFor(errors, 'service')}
    </div>
  </div>`;
}

function upgradesView(c, { upgrades, services, values = {}, errors = {}, editId = null, flashCode = '', banners = [] }) {
  const t = c.t;
  const body = html`
<div class="page-head"><div>
  <h1>${t('Upgrades')}</h1>
  <p class="muted">${t('Extra care you can give when a chair is free: a scalp massage, a treatment, a longer finish. Each offer combines the fewest upgrades needed to add at least {pct}% more time.', { pct: MIN_UPLIFT_PCT })}</p>
</div></div>
${flash(c, flashCode)}
<section class="panel" aria-labelledby="add-upgrade-h">
  <h2 id="add-upgrade-h">${t('Add an upgrade')}</h2>
  ${editId === null ? formErrors(c, errors) : ''}
  <form method="post" action="/app/upgrades" novalidate>
    ${upgradeFields(c, 'new-', editId === null ? values : {}, editId === null ? errors : {}, services)}
    <button class="btn btn-primary" type="submit">${t('Add upgrade')}</button>
  </form>
</section>
<h2 class="section-title">${t('Your upgrades')}</h2>
${
  upgrades.length
    ? html`<ul class="items">${upgrades.map((u) => {
        const editing = editId === u.id;
        const v = editing ? values : { name: u.name, minutes: u.added_min, service: u.service_id ?? 'all' };
        return html`<li class="item${u.active ? '' : ' is-off'}" id="upgrade-${u.id}">
      <div class="item-head">
        <span class="item-title">${u.name}</span>
        <span class="num">+${t('{m} min', { m: u.added_min })}</span>
      </div>
      <span class="muted">${u.service_id ? t('Only with {service}', { service: u.service_name || t('a removed service') }) : t('With any service')}${u.active ? '' : html`, ${t('switched off')}`}</span>
      <details${editing ? raw(' open') : ''}>
        <summary>${t('Edit')}</summary>
        ${editing ? formErrors(c, errors) : ''}
        <form method="post" action="/app/upgrades/${u.id}" novalidate>
          <input type="hidden" name="action" value="save">
          ${upgradeFields(c, `u${u.id}-`, v, editing ? errors : {}, services)}
          <div class="actions"><button class="btn btn-primary" type="submit">${t('Save changes')}</button></div>
        </form>
        <form method="post" action="/app/upgrades/${u.id}" class="actions">
          <input type="hidden" name="action" value="${u.active ? 'hide' : 'show'}">
          <button class="btn btn-outline btn-small" type="submit">${u.active ? t('Switch off') : t('Switch on')}</button>
        </form>
      </details>
    </li>`;
      })}</ul>`
    : html`<p class="empty">${t('No upgrades yet. Without them no offer can be made, because every offer must add real extra time.')}</p>`
}`;
  return appPage(c, { title: t('Upgrades'), body, current: '/app/upgrades', banners });
}

/* ---------------------------------- setup ---------------------------------- */

function setupChooserView(c, { banners = [] } = {}) {
  const t = c.t;
  const body = html`
<div class="page-head"><div>
  <h1>${t('Set up your request page')}</h1>
  <p class="muted">${t('Pick the closest salon type. You will see its usual services and upgrades, enter your own prices, and can change everything later.')}</p>
</div></div>
<ul class="choices">
  ${TEMPLATES.map(
    (tpl) => html`<li><a class="choice" href="/app/setup?template=${tpl.id}">
    <span class="choice-title">${t(tpl.label)}</span>
    <span class="muted">${tpl.services.map(([name]) => t(name)).join(', ')}</span>
  </a></li>`,
  )}
</ul>
<p><a href="/app/services">${t('Or add services one by one')}</a></p>`;
  return appPage(c, { title: t('Set up your request page'), body, current: '/app/services', banners });
}

function setupFormView(c, { template, values = null, errors = {}, banners = [] }) {
  const t = c.t;
  const salon = c.user.salon;
  const v = values || {
    services: template.services.map(([name, minutes]) => ({ on: true, name: t(name), minutes: String(minutes), price: '' })),
    upgrades: template.upgrades.map(([name, minutes]) => ({ on: true, name: t(name), minutes: String(minutes) })),
    days: DEFAULT_HOURS.weekdays.map(String),
    start: t.time(DEFAULT_HOURS.start),
    end: t.time(DEFAULT_HOURS.end),
    capacity: String(DEFAULT_HOURS.capacity),
  };
  const body = html`
<div class="page-head"><div>
  <h1>${t(template.label)}</h1>
  <p class="muted">${t('Untick what you do not offer, adjust names and minutes, and enter your prices. Clients always pay exactly these prices.')}</p>
</div></div>
${formErrors(c, errors)}
<form method="post" action="/app/setup" novalidate class="setup">
  <input type="hidden" name="template" value="${template.id}">
  <section class="panel">
    <h2>${t('Services')}</h2>
    ${errorFor(errors, 'services')}
    <section class="table-wrap" tabindex="0" aria-label="${t('Services')}"><table class="list setup-table">
      <thead><tr><th scope="col">${t('Offer')}</th><th scope="col">${t('Name')}</th><th scope="col">${t('Minutes')}</th><th scope="col">${t('Price ({currency})', { currency: salon.currency })}</th></tr></thead>
      <tbody>${v.services.map(
        (s, i) => html`<tr>
        <td><input type="checkbox" name="s${i}_on" value="on" aria-label="${t('Offer')}"${checked(s.on)}></td>
        <td><input type="text" name="s${i}_name" maxlength="80" value="${s.name}" aria-label="${t('Name')}"${invalid(errors, `s${i}`)}></td>
        <td><input type="number" name="s${i}_minutes" min="5" max="600" step="5" inputmode="numeric" value="${s.minutes}" aria-label="${t('Minutes')}"></td>
        <td><input type="text" name="s${i}_price" inputmode="decimal" maxlength="12" value="${s.price}" aria-label="${t('Price ({currency})', { currency: salon.currency })}"${invalid(errors, `s${i}`)}>${errorFor(errors, `s${i}`)}</td>
      </tr>`,
      )}</tbody>
    </table></section>
  </section>
  <section class="panel">
    <h2>${t('Upgrades')}</h2>
    <p class="muted small">${t('Extra care added to an offer so that it lasts at least {pct}% longer.', { pct: MIN_UPLIFT_PCT })}</p>
    <section class="table-wrap" tabindex="0" aria-label="${t('Upgrades')}"><table class="list setup-table">
      <thead><tr><th scope="col">${t('Offer')}</th><th scope="col">${t('Name')}</th><th scope="col">${t('Extra minutes')}</th></tr></thead>
      <tbody>${v.upgrades.map(
        (u, i) => html`<tr>
        <td><input type="checkbox" name="u${i}_on" value="on" aria-label="${t('Offer')}"${checked(u.on)}></td>
        <td><input type="text" name="u${i}_name" maxlength="80" value="${u.name}" aria-label="${t('Name')}"${invalid(errors, `u${i}`)}>${errorFor(errors, `u${i}`)}</td>
        <td><input type="number" name="u${i}_minutes" min="5" max="240" step="5" inputmode="numeric" value="${u.minutes}" aria-label="${t('Extra minutes')}"></td>
      </tr>`,
      )}</tbody>
    </table></section>
  </section>
  <section class="panel">
    <h2>${t('Quiet hours')}</h2>
    <p class="muted small">${t('When do you usually have a free chair? You can add more times later.')}</p>
    <fieldset class="days">
      <legend>${t('Days')}</legend>
      ${[1, 2, 3, 4, 5, 6, 7].map((d) => html`<label><input type="checkbox" name="day" value="${d}"${checked(v.days.includes(String(d)))}> ${t.weekday(d)}</label>`)}
    </fieldset>
    ${errorFor(errors, 'day')}
    <div class="row row-3">
      <div class="field"><label for="start">${t('From')}</label><input id="start" name="start" type="time" step="900" value="${v.start}"${invalid(errors, 'start')}>${errorFor(errors, 'start')}</div>
      <div class="field"><label for="end">${t('Until')}</label><input id="end" name="end" type="time" step="900" value="${v.end}"${invalid(errors, 'end')}>${errorFor(errors, 'end')}</div>
      <div class="field"><label for="capacity">${t('Free chairs')}</label><input id="capacity" name="capacity" type="number" min="1" max="50" inputmode="numeric" value="${v.capacity}"${invalid(errors, 'capacity')}>${errorFor(errors, 'capacity')}</div>
    </div>
  </section>
  <button class="btn btn-primary" type="submit">${t('Create my request page')}</button>
</form>`;
  return appPage(c, { title: t(template.label), body, current: '/app/services', banners });
}
return { servicesView, upgradesView, setupChooserView, setupFormView };
})();

// src/views/hours.js
const __m48 = (() => {
// Copyright (c) 2026 Miloš Petrović (Trench Logic Studio) · SPDX-License-Identifier: MIT
// Quiet hours: a weekly picture and the list behind it.

const { html, raw } = __m19;
const { appPage, errorFor, invalid, formErrors, checked } = __m20;
const { flash } = __m33;

function escapeText(s) {
  return String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
}

function weekChart(c, windows) {
  if (!windows.length) return '';
  const t = c.t;
  const startH = Math.min(8, ...windows.map((w) => Math.floor(w.start_min / 60)));
  const endH = Math.max(20, ...windows.map((w) => Math.ceil(w.end_min / 60)));
  const hourH = 34;
  const left = 46;
  const top = 32;
  const colW = 64;
  const width = left + colW * 7 + 8;
  const height = top + (endH - startH) * hourH + 10;
  const y = (min) => top + ((min - startH * 60) / 60) * hourH;
  const parts = [];
  for (let h = startH; h <= endH; h++) {
    parts.push(`<line class="grid-line" x1="${left}" x2="${width - 8}" y1="${y(h * 60)}" y2="${y(h * 60)}"/>`);
    parts.push(`<text class="hour-label" x="${left - 8}" y="${y(h * 60) + 4}" text-anchor="end">${String(h).padStart(2, '0')}:00</text>`);
  }
  for (let d = 0; d < 7; d++) {
    parts.push(`<text class="day-label" x="${left + d * colW + colW / 2}" y="21" text-anchor="middle">${escapeText(t.weekdayShort(d + 1))}</text>`);
    parts.push(`<line class="grid-line" x1="${left + d * colW}" x2="${left + d * colW}" y1="${top}" y2="${height - 10}"/>`);
  }
  for (const w of windows) {
    const x = left + (w.weekday - 1) * colW + 4;
    const y1 = y(w.start_min);
    const h = Math.max(8, y(w.end_min) - y1);
    parts.push(`<rect class="qh" x="${x}" y="${y1}" width="${colW - 8}" height="${h}" rx="6"/>`);
    if (h >= 18) parts.push(`<text class="qh-label" x="${x + 5}" y="${y1 + 16}">${escapeText(t.n(w.capacity, '{n} chair', '{n} chairs'))}</text>`);
  }
  return raw(`<svg class="week" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeText(t('Weekly view of your quiet hours'))}">${parts.join('')}</svg>`);
}

function hoursView(c, { windows, values = {}, errors = {}, flashCode = '', banners = [] }) {
  const t = c.t;
  const days = values.days || [];
  const body = html`
<div class="page-head"><div>
  <h1>${t('Quiet hours')}</h1>
  <p class="muted">${t('The times you usually have free chairs. Offers are placed only inside these hours, and never more at once than the chairs you list.')}</p>
</div></div>
${flash(c, flashCode)}
${weekChart(c, windows)}
<section class="panel" aria-labelledby="add-hours-h">
  <h2 id="add-hours-h">${t('Add quiet hours')}</h2>
  ${formErrors(c, errors)}
  <form method="post" action="/app/hours" novalidate>
    <fieldset class="days">
      <legend>${t('Days')}</legend>
      ${[1, 2, 3, 4, 5, 6, 7].map((d) => html`<label><input type="checkbox" name="day" value="${d}"${checked(days.includes(String(d)))}> ${t.weekday(d)}</label>`)}
    </fieldset>
    ${errorFor(errors, 'day')}
    <div class="row row-3">
      <div class="field">
        <label for="start">${t('From')}</label>
        <input id="start" name="start" type="time" step="900" required value="${values.start || '13:00'}"${invalid(errors, 'start')}>
        ${errorFor(errors, 'start')}
      </div>
      <div class="field">
        <label for="end">${t('Until')}</label>
        <input id="end" name="end" type="time" step="900" required value="${values.end || '16:00'}"${invalid(errors, 'end')}>
        ${errorFor(errors, 'end')}
      </div>
      <div class="field">
        <label for="capacity">${t('Free chairs')}</label>
        <input id="capacity" name="capacity" type="number" min="1" max="50" inputmode="numeric" required value="${values.capacity || '1'}"${invalid(errors, 'capacity')}>
        ${errorFor(errors, 'capacity')}
      </div>
    </div>
    <button class="btn btn-primary" type="submit">${t('Add quiet hours')}</button>
  </form>
</section>
<h2 class="section-title">${t('Your quiet hours')}</h2>
${
  windows.length
    ? html`<section class="table-wrap" tabindex="0" aria-label="${t('Your quiet hours')}"><table class="list">
  <thead><tr><th scope="col">${t('Day')}</th><th scope="col">${t('Hours')}</th><th scope="col">${t('Chairs')}</th><th scope="col"><span class="visually-hidden">${t('Remove')}</span></th></tr></thead>
  <tbody>${windows.map(
    (w) => html`<tr>
    <td><span class="day-long">${t.weekday(w.weekday)}</span><span class="day-short">${t.weekdayShort(w.weekday)}</span></td>
    <td class="num nowrap">${t.timeRange(w.start_min, w.end_min)}</td>
    <td class="num">${w.capacity}</td>
    <td><form method="post" action="/app/hours/${w.id}/delete"><button class="btn btn-link btn-small" type="submit">${t('Remove')}</button></form></td>
  </tr>`,
  )}</tbody>
</table></section>`
    : html`<p class="empty">${t('No quiet hours yet. Start with the afternoons that are usually slow.')}</p>`
}`;
  return appPage(c, { title: t('Quiet hours'), body, current: '/app/hours', banners });
}
return { hoursView };
})();

// src/views/share.js
const __m49 = (() => {
// Copyright (c) 2026 Miloš Petrović (Trench Logic Studio) · SPDX-License-Identifier: MIT
// Everything a salon needs to get its link in front of clients.

const { html } = __m19;
const { appPage, document } = __m20;
const { translator, LOCALE_NAMES } = __m18;

function shareTexts(salon, url) {
  const ts = translator(salon.locale);
  return [
    [ts('Booking page, “fully booked” message'), ts('Fully booked at the time you wanted? Get a longer, upgraded appointment at the same price: {url}', { url })],
    [ts('Instagram or Facebook bio'), ts('Fully booked? Upgraded appointments, same price: {url}', { url })],
    [
      ts('Auto-reply for messages'),
      ts('Thanks for your message! If we’re fully booked when you’d like to come, {salon} can offer you a calmer time with extra care included, at the same price. Pick one here: {url}', {
        salon: salon.name,
        url,
      }),
    ],
  ];
}

function websiteButton(salon, url) {
  const ts = translator(salon.locale);
  const label = ts('Fully booked? See upgraded times');
  const safe = (s) => s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
  return `<a href="${safe(url)}" style="display:inline-block;padding:12px 20px;border-radius:8px;background:#8c2c4b;color:#ffffff;font:600 16px/1.2 system-ui,sans-serif;text-decoration:none">${safe(label)}</a>`;
}

function shareView(c, { publicUrl, banners = [] }) {
  const t = c.t;
  const salon = c.user.salon;
  const texts = shareTexts(salon, publicUrl);
  const body = html`
<div class="page-head"><div>
  <h1>${t('Share your link')}</h1>
  <p class="muted">${t('Put your link wherever clients find you fully booked. Texts below are in the language of your request page: {language}.', { language: LOCALE_NAMES[salon.locale] })}</p>
</div></div>

<section class="panel share" aria-labelledby="link-h">
  <h2 id="link-h">${t('Your link')}</h2>
  <div class="share-link">
    <code id="public-url">${publicUrl}</code>
    <button class="btn btn-outline btn-small" type="button" data-copy="#public-url">${t('Copy link')}</button>
    <a class="btn btn-link btn-small" href="/s/${salon.slug}">${t('Open page')}</a>
  </div>
</section>

<section class="panel share" aria-labelledby="texts-h">
  <h2 id="texts-h">${t('Texts to copy')}</h2>
  <div class="snippets">
    ${texts.map(
      ([where, text], i) => html`<div class="snippet">
      <p class="where">${where}</p>
      <p id="snippet-${i}">${text}</p>
      <button class="btn btn-outline btn-small" type="button" data-copy="#snippet-${i}">${t('Copy text')}</button>
    </div>`,
    )}
  </div>
</section>

<section class="panel share" aria-labelledby="qr-h">
  <h2 id="qr-h">${t('QR code for the desk and the window')}</h2>
  <div class="qr-row">
    <img class="qr" src="/app/qr.svg" alt="${t('QR code that opens your request page')}" width="168" height="168">
    <div>
      <p class="muted">${t('Print the poster for your reception desk or window, or put the QR code on your price list.')}</p>
      <div class="actions">
        <a class="btn btn-primary btn-small" href="/app/poster">${t('Open printable poster')}</a>
        <a class="btn btn-outline btn-small" href="/app/qr.svg" download="qr-${salon.slug}.svg">${t('Download QR code')}</a>
      </div>
    </div>
  </div>
</section>

<section class="panel share" aria-labelledby="web-h">
  <h2 id="web-h">${t('Button for your website')}</h2>
  <p class="muted">${t('Paste this code into your website where clients see that you are fully booked.')}</p>
  <textarea id="web-button" readonly rows="4" aria-labelledby="web-h">${websiteButton(salon, publicUrl)}</textarea>
  <div class="actions"><button class="btn btn-outline btn-small" type="button" data-copy="#web-button">${t('Copy code')}</button></div>
</section>`;
  return appPage(c, { title: t('Share your link'), body, current: '/app/share', banners });
}

function posterView(c, { publicUrl }) {
  const salon = c.user.salon;
  const ts = translator(salon.locale);
  const shortUrl = publicUrl.replace(/^https?:\/\//, '');
  const body = html`<main id="main" class="poster">
  <p class="poster-salon">${salon.name}</p>
  <h1 class="poster-title">${ts('Fully booked?')}</h1>
  <p class="poster-lead">${ts('Scan for a longer, upgraded appointment in a calmer hour, at the same price.')}</p>
  <img class="poster-qr" src="/app/qr.svg" alt="${ts('QR code that opens your request page')}">
  <p class="poster-url">${shortUrl}</p>
  <p class="poster-foot">${ts('Requests by {product}', { product: c.config.productName })}</p>
  <p class="poster-actions"><button class="btn btn-primary" type="button" data-print>${c.t('Print poster')}</button> <a class="btn btn-link" href="/app/share">${c.t('Back')}</a></p>
</main>`;
  return document({ ...c, locale: salon.locale, t: ts }, { title: `${salon.name} | ${ts('Fully booked?')}`, bodyClass: 'poster-page', body });
}
return { shareTexts, websiteButton, shareView, posterView };
})();

// src/routes/app.js
const __m50 = (() => {
// Copyright (c) 2026 Miloš Petrović (Trench Logic Studio) · SPDX-License-Identifier: MIT
// The salon's dashboard: requests, services, upgrades, quiet hours, sharing,
// settings and plan. Every query is scoped by the logged-in salon's id.

const { availabilityGuard } = __m27;
const { hit } = __m23;
const { html } = __m19;
const { HttpError, readForm, redirect, serializeCookie } = __m6;
const { FormReader, isValidSlug } = __m21;
const { parseMoney, CURRENCIES } = __m34;
const { localNow, isoWeekday, isValidTimeZone, parseTime, fmtTime, addDays } = __m9;
const { randomToken, verifyPassword } = __m1;
const { writeWithEvent, appendEvent, verifyChain } = __m22;
const { createPasswordRecord, replacePassword, startSession, endAllSessions, cookieName } = __m11;
const { LOCALES, isLocale } = __m18;
const { selectBundle, MIN_UPLIFT_PCT } = __m8;
const { hasAccess, initialBilling, checkoutLink } = __m2;
const { funnel, bump } = __m26;
const { notifyDecision } = __m24;
const { qrSvg } = __m44;
const { toCsv } = __m45;
const { templateById } = __m46;
const { listServices, getService, listUpgrades, listWindows, setupCounts, metrics, requestsWhere, requestById, parseUpgrades } = __m10;
const { expireForSalon, erasePersonalData } = __m25;
const { notice, rich } = __m20;
const { dashboardView } = __m33;
const { servicesView, upgradesView, setupChooserView, setupFormView } = __m47;
const { hoursView } = __m48;
const { shareView, posterView } = __m49;
const { settingsView, planView, auditView, billingLine, NOTICE_MINUTES } = __m35;
const { deliverSoon } = __m40;
const { page, toId, requireUser, flashCode, nowSec } = __m39;

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

function registerApp(r) {
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
return { registerApp };
})();

// src/views/admin.js
const __m51 = (() => {
// Copyright (c) 2026 Miloš Petrović (Trench Logic Studio) · SPDX-License-Identifier: MIT
// Operator page: traction across all salons, subscriptions, delivery problems,
// and one-time reset links. Switched off unless ADMIN_KEY (24+ characters) is set.
// Shown in English: it is for the operator, not for salons.

const { html } = __m19;
const { sitePage, notice } = __m20;

function adminLoginView(c, { error = '' } = {}) {
  const body = html`
<div class="wrap"><div class="center-card">
  <h1>Operator</h1>
  ${notice('error', error)}
  <form method="post" action="/admin/login" novalidate>
    <div class="field">
      <label for="key">Operator key</label>
      <input id="key" name="key" type="password" autocomplete="off" required>
    </div>
    <button class="btn btn-primary btn-block" type="submit">Open operator page</button>
  </form>
</div></div>`;
  return sitePage(c, { title: 'Operator', body, bare: true });
}

const pct = (a, b) => (b > 0 ? `${Math.round((a / b) * 100)}%` : '–');

function adminView(c, { totals, salons, interest, funnel, billing, outbox, errors, resetLink = null }) {
  const t = c.t;
  const body = html`<div class="wrap">
<section class="panel" aria-labelledby="deployment-h"><h2 id="deployment-h">Deployment readiness</h2><ul>${c.readiness.checks.map((check) => html`<li>${check.ok ? '✓' : '○'} ${check.description}</li>`)}</ul><p>Configuration checks do not prove live payment delivery, email delivery, legal readiness or backup recovery.</p></section>

<div class="page-head"><div><h1>Operator</h1><p class="muted">All salons on this installation. Demo salons are not counted.</p></div>
  <div class="actions">
    <a class="btn btn-outline btn-small" href="/admin/salons.csv" download>Download CSV</a>
    <form method="post" action="/admin/logout" class="inline"><button class="btn btn-outline btn-small" type="submit">Log out</button></form>
  </div>
</div>
${
  resetLink
    ? html`<div class="notice notice-ok" role="status"><p>Reset link for ${resetLink.email}, valid 24 hours and usable once. Send it to them directly:</p>
  <p><code id="reset-link">${resetLink.url}</code> <button class="btn btn-outline btn-small" type="button" data-copy="#reset-link">Copy link</button></p></div>`
    : ''
}
<dl class="ledger">
  <div><dt>Salons</dt><dd>${totals.salons}</dd></div>
  <div><dt>Ready to take requests</dt><dd>${totals.ready}</dd></div>
  <div><dt>Requests received</dt><dd>${totals.offers}</dd></div>
  <div><dt>Confirmed</dt><dd>${totals.confirmed}</dd></div>
</dl>

<section class="panel">
  <h2>Last 30 days, all salons</h2>
  <section class="table-wrap" tabindex="0" aria-label="Last 30 days, all salons"><table class="list">
    <thead><tr><th scope="col">Page visits</th><th scope="col">Saw upgraded times</th><th scope="col">Requests</th><th scope="col">Confirmed</th><th scope="col">Waitlist</th></tr></thead>
    <tbody><tr>
      <td class="num">${funnel.view}</td>
      <td class="num">${funnel.offers} <span class="muted small">${pct(funnel.offers, funnel.view)}</span></td>
      <td class="num">${funnel.request} <span class="muted small">${pct(funnel.request, funnel.offers)}</span></td>
      <td class="num">${funnel.confirmed} <span class="muted small">${pct(funnel.confirmed, funnel.request)}</span></td>
      <td class="num">${funnel.waitlist}</td>
    </tr></tbody>
  </table></section>
</section>

<section class="panel">
  <h2>Subscriptions</h2>
  ${
    billing.enabled
      ? html`<p>Provider: ${billing.provider}. Active: ${billing.counts.active || 0}, on trial: ${billing.counts.trialing || 0}, payment problems: ${billing.counts.past_due || 0}, cancelled: ${billing.counts.canceled || 0}, inactive: ${(billing.counts.expired || 0) + (billing.counts.paused || 0)}.${
          billing.mrrCents ? html` Estimated subscription run rate: ${t.money(billing.mrrCents, billing.currency || 'EUR')}.` : ''
        }</p>`
      : html`<p class="muted">Billing is off: every salon uses Reflow for free (beta). See DEPLOY.md to switch it on.</p>`
  }
</section>

<section class="panel">
  <h2>Email</h2>
  <p>${outbox.provider ? `Provider: ${outbox.provider}. ` : 'No provider configured: no emails are sent. '}Sent in the last 30 days: ${outbox.sent}. Waiting: ${outbox.pending}. Failed: ${outbox.failed}.</p>
  ${outbox.lastError ? html`<p class="small muted">Last error: ${outbox.lastError}</p>` : ''}
</section>

<h2>Salons</h2>
<section class="table-wrap" tabindex="0" aria-label="Salons"><table class="list">
  <thead><tr>
    <th scope="col">Salon</th><th scope="col">Joined</th><th scope="col">Language</th><th scope="col">Setup</th>
    <th scope="col">Requests</th><th scope="col">Confirmed</th><th scope="col">Completed service value</th>
    <th scope="col">Plan</th><th scope="col">Last request</th><th scope="col">Owner</th>
  </tr></thead>
  <tbody>${salons.map(
    (s) => html`<tr>
    <td><a href="/s/${s.slug}">${s.name}</a></td>
    <td class="num nowrap">${s.created_at.slice(0, 10)}</td>
    <td>${s.locale}</td>
    <td class="small">${s.services} services, ${s.upgrades} upgrades, ${s.windows} quiet windows</td>
    <td class="num">${s.offers}</td>
    <td class="num">${s.confirmed}</td>
    <td class="num nowrap">${t.money(s.revenue_cents, s.currency)}</td>
    <td class="small">${s.billing_status}</td>
    <td class="num nowrap">${s.last_request ? s.last_request.slice(0, 10) : 'none'}</td>
    <td class="small">${s.users.map(
      (u) => html`<div>${u.email} <form class="inline" method="post" action="/admin/users/${u.id}/reset"><button class="btn btn-link btn-small" type="submit">Reset link</button></form></div>`,
    )}</td>
  </tr>`,
  )}</tbody>
</table></section>

<h2>Interest in the next levels</h2>
${
  interest.length
    ? html`<ul>${interest.map((i) => html`<li>${i.salon_name}: ${i.tier === 'relay' ? 'Relay' : 'Nexus'}, ${i.created_at.slice(0, 10)}</li>`)}</ul>`
    : html`<p class="empty">No salon has asked for Relay or Nexus yet.</p>`
}

<h2>Recent server errors</h2>
${
  errors.length
    ? html`<ul class="events">${errors.map((e) => html`<li><time>${e.at.slice(0, 16).replace('T', ' ')}</time><strong>${e.method} ${e.path}</strong><span>${e.message}</span></li>`)}</ul>`
    : html`<p class="empty">None in the last 30 days.</p>`
}
</div>`;
  return sitePage(c, { title: 'Operator', body, bare: true });
}
return { adminLoginView, adminView };
})();

// src/routes/admin.js
const __m52 = (() => {
// Copyright (c) 2026 Miloš Petrović (Trench Logic Studio) · SPDX-License-Identifier: MIT
// Operator page. Disabled (404) unless ADMIN_KEY is configured.

const { HttpError, readForm, redirect } = __m6;
const { timingSafeEqual } = __m1;
const { hit, limiterKey } = __m23;
const { startAdminSession, isAdmin, endAdminSession, createResetToken } = __m11;
const { dailyMaintenance } = __m25;
const { funnel } = __m26;
const { toCsv } = __m45;
const { addDays } = __m9;
const { adminLoginView, adminView } = __m51;
const { page, toId, nowSec } = __m39;

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

function registerAdmin(r) {
  r.get('/admin', adminHome);
  r.post('/admin/login', adminLogin);
  r.post('/admin/logout', adminLogout);
  r.post('/admin/users/:id/reset', adminReset);
  r.get('/admin/salons.csv', adminCsv);
}
return { registerAdmin };
})();

// src/lifecycle.js
const __m53 = (() => {
// Copyright (c) 2026 Miloš Petrović (Trench Logic Studio) · SPDX-License-Identifier: MIT
const { writeWithEvent } = __m22;
const { randomToken } = __m1;
const { localToUtc } = __m9;
const { notifyCancellation } = __m24;
const { requestById } = __m10;

async function recordOutcome(c, salon, request, outcome, actor = 'salon') {
  if (!['canceled', 'completed', 'no_show'].includes(outcome) || request.kind !== 'offer' || request.outcome) return false;
  if (outcome !== 'canceled' && (request.status !== 'confirmed' || localToUtc(request.slot_date, request.end_min, salon.timezone) > c.now)) return false;
  const marker = randomToken(12);
  const result = await writeWithEvent(c.db, salon.id, `request.${outcome}`, { ref: request.ref, actor }, () => [
    c.db.prepare(`UPDATE requests SET revision = revision + 1, outcome = ?, outcome_at = ?, canceled_by = ?, decision_ref = ?, decided_at = ?,
      status = CASE WHEN ? = 'canceled' THEN 'declined' ELSE status END, hold_expires_at = NULL
      WHERE id = ? AND salon_id = ? AND revision = ? AND outcome IS NULL AND status IN ('pending', 'confirmed')`)
      .bind(outcome, c.now.toISOString(), outcome === 'canceled' ? actor : null, marker, c.now.toISOString(), outcome, request.id, salon.id, request.revision),
  ], { condition: 'EXISTS (SELECT 1 FROM requests WHERE id = ? AND decision_ref = ?)', conditionParams: [request.id, marker], at: () => c.now });
  if (result[0].meta.changes && outcome === 'canceled') {
    const fresh = await requestById(c.db, salon.id, request.id);
    await notifyCancellation({ db: c.db, mail: c.mail, now: c.now, origin: c.url.origin }, salon, fresh);
  }
  return result[0].meta.changes === 1;
}
return { recordOutcome };
})();

// src/routes/operations.js
const __m54 = (() => {
// Copyright (c) 2026 Miloš Petrović (Trench Logic Studio) · SPDX-License-Identifier: MIT
const { html } = __m19;
const { HttpError, readForm, redirect } = __m6;
const { appPage, publicPage, notice, formErrors } = __m20;
const { FormReader } = __m21;
const { localNow, addDays, parseTime, localToUtc } = __m9;
const { requestById, requestsWhere, parseUpgrades, getService, salonById, requestByToken } = __m10;
const { requireUser, page, toId, nowSec } = __m39;
const { writeWithEvent } = __m22;
const { availabilityGuard, canClientCancel } = __m27;
const { recordOutcome } = __m53;
const { offersFor, deliverSoon } = __m40;
const { findQuotedOffer, quotedKey } = __m28;
const { hasAccess } = __m2;
const { notifyNewRequest } = __m24;
const { randomToken } = __m1;
const { expireForSalon } = __m25;
const { hit, limiterKey } = __m23;

function protectedRoute(handler, ownerOnly = false) {
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

function registerOperations(router) {
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
return { protectedRoute, registerOperations };
})();

// src/routes/team.js
const __m55 = (() => {
// Copyright (c) 2026 Miloš Petrović (Trench Logic Studio) · SPDX-License-Identifier: MIT
const { html } = __m19;
const { HttpError, redirect, readForm } = __m6;
const { appPage, sitePage, notice, formErrors } = __m20;
const { protectedRoute } = __m54;
const { page, toId, nowSec } = __m39;
const { FormReader } = __m21;
const { issueAccountToken, accountToken } = __m41;
const { createPasswordRecord, replacePassword, startSession } = __m11;
const { verifyPassword } = __m1;
const { writeWithEvent } = __m22;
const { hit, limiterKey } = __m23;
const { deliverSoon } = __m40;
const { LOCALES, LOCALE_NAMES, isLocale } = __m18;

async function team(c, salon, link = '') {
  const t = c.t;
  const { results: users } = await c.db.prepare('SELECT id, email, role FROM users WHERE salon_id = ? ORDER BY id').bind(salon.id).all();
  const { results: invites } = await c.db.prepare("SELECT token_hash, email FROM account_tokens WHERE salon_id = ? AND kind = 'invite' AND used_at IS NULL AND expires_at > ?").bind(salon.id,nowSec(c)).all();
  return page(appPage(c,{title:t('Team'), current:'/app/team',body:html`<h1>${t('Team')}</h1>
    <p class="lead">${t('Staff can manage appointments and blocked times. Billing, exports and business settings stay with the owner.')}</p>
    ${link ? html`<div class="notice notice-ok"><p>${t('Invitation ready. Send this private link to your colleague.')}</p><input aria-label="${t('Invitation link')}" value="${link}" readonly></div>` : ''}
    <section class="panel"><h2>${t('Invite a colleague')}</h2><form method="post" action="/app/team"><div class="field"><label for="email">${t('Email')}</label><input id="email" name="email" type="email" maxlength="254" required></div><button class="btn btn-primary">${t('Invite a colleague')}</button></form></section>
    <ul class="requests">${users.map((u)=>html`<li class="request"><div class="request-top"><span>${u.email} · ${u.role === 'owner' ? t('Owner') : t('Staff')}</span>${u.role === 'staff' ? html`<form method="post" action="/app/team/${u.id}/remove" data-confirm="${t('Remove this colleague?')}"><button class="btn btn-outline">${t('Remove')}</button></form>`:''}</div></li>`)}</ul>
    ${invites.length ? html`<h2>${t('Pending invitations')}</h2><ul class="requests">${invites.map((i)=>html`<li class="request"><div class="request-top"><span>${i.email}</span><form method="post" action="/app/team/revoke"><input type="hidden" name="token" value="${i.token_hash}"><button class="btn btn-outline">${t('Remove')}</button></form></div></li>`)}</ul>`:''}
  `}));
}

async function invite(c, salon) {
  if (salon.is_demo) throw new HttpError(403,'This action is not available in the demo.');
  if (!await hit(c.db,`team-invite:${salon.id}`,10,3600,nowSec(c))) throw new HttpError(429,'Too many attempts. Please try again in an hour.');
  const f=new FormReader(await readForm(c.request),c.t); const email=f.email('email');
  if (!f.ok) throw new HttpError(400,'Enter a valid email address.');
  const {n}=await c.db.prepare('SELECT COUNT(*) AS n FROM users WHERE salon_id = ?').bind(salon.id).first();
  const exists=await c.db.prepare('SELECT 1 AS ok FROM users WHERE email = ?').bind(email).first();
  if(n>=10 || exists) throw new HttpError(409,'This email is already registered or the team is full.');
  const link=await issueAccountToken(c,{salon_id:salon.id,email,locale:c.locale},'invite');
  deliverSoon(c); return team(c,salon,link);
}

async function remove(c,salon) {
  const id=toId(c.params.id);
  await writeWithEvent(c.db,salon.id,'team.removed',{id},()=>[c.db.prepare("DELETE FROM users WHERE id = ? AND salon_id = ? AND role = 'staff'").bind(id,salon.id)],{condition:'changes() = 1',at:()=>c.now});
  return redirect('/app/team');
}

async function join(c) {
  const token=await accountToken(c,'invite');
  if(!token) throw new HttpError(410,'This request link is not valid.');
  const t=c.t; let errors={};
  if(c.request.method==='POST') {
    if(!await hit(c.db,await limiterKey('join',c.ip),10,3600,nowSec(c))) throw new HttpError(429,'Too many attempts. Please try again in an hour.');
    const f=new FormReader(await readForm(c.request),c.t); const password=f.password('password'); errors=f.errors;
    if(f.ok) {
      const pw=await createPasswordRecord(password,c.config.pbkdf2Iterations,c.config.authPepper);
      try {
        const result=await writeWithEvent(c.db,token.salon_id,'team.joined',{},()=>[
          c.db.prepare(`INSERT INTO users (salon_id,email,pass_hash,pass_salt,pass_iter,pass_peppered,created_at,locale,role,email_verified_at)
            SELECT ?,?,?,?,?,?,?,?,'staff',? WHERE EXISTS (SELECT 1 FROM account_tokens WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?)
            AND (SELECT COUNT(*) FROM users WHERE salon_id = ?) < 10`)
            .bind(token.salon_id,token.email,pw.pass_hash,pw.pass_salt,pw.pass_iter,pw.pass_peppered,c.now.toISOString(),c.locale,c.now.toISOString(),token.token_hash,nowSec(c),token.salon_id),
          c.db.prepare('UPDATE account_tokens SET used_at = ? WHERE token_hash = ? AND changes() = 1').bind(nowSec(c),token.token_hash),
        ],{condition:'changes() = 1',at:()=>c.now});
        if(result[0].meta.changes!==1) throw new Error('Used invitation');
      } catch { throw new HttpError(409,'This email is already registered or the team is full.'); }
      const user=await c.db.prepare('SELECT id FROM users WHERE email = ? AND salon_id = ?').bind(token.email,token.salon_id).first();
      return redirect('/app',{cookies:[await startSession(c.db,user.id,{secure:c.secure,now:c.now})]});
    }
  }
  return page(sitePage(c,{title:t('Join the salon team'),bare:true,body:html`<section class="wrap narrow section"><h1>${t('Join the salon team')}</h1><p>${token.email}</p>${formErrors(c,errors)}<form method="post" action="/join/${c.params.token}"><div class="field"><label for="password">${t('New password')}</label><input id="password" name="password" type="password" autocomplete="new-password" minlength="10" maxlength="200" required></div><button class="btn btn-primary">${t('Create account')}</button></form></section>`}),Object.keys(errors).length?400:200);
}

async function verifyPage(c) {
  const user=await c.getUser(); if(!user)return redirect('/login');
  c.useLocale(user.locale);
  if(user.email_verified_at || user.salon.is_demo)return redirect('/app');
  if(c.request.method==='POST' && c.mail.provider) {
    if(await hit(c.db,`verify:${user.id}`,3,3600,nowSec(c))) {
      await issueAccountToken(c,{id:user.id,salon_id:user.salon.id,email:user.email,locale:user.locale},'verify');deliverSoon(c);
    }
  }
  const t=c.t;
  return page(sitePage(c,{title:t('Verify your email'),bare:true,body:html`<section class="wrap narrow section"><h1>${t('Verify your email')}</h1><p>${t('Check your inbox and confirm your email before opening your dashboard.')}</p><p>${user.email}</p>
    ${c.request.method==='POST'?notice('info',t('Check your inbox.')):''}<form method="post" action="/verify"><button class="btn btn-primary">${t('Resend email')}</button></form><form method="post" action="/logout"><button class="btn btn-link">${t('Log out')}</button></form></section>`}));
}

async function verifyToken(c) {
  const token=await accountToken(c,'verify');if(!token)throw new HttpError(410,'This request link is not valid.');
  if(c.request.method==='POST') {
    const result=await c.db.batch([
      c.db.prepare(`UPDATE users SET email_verified_at = ? WHERE id = ? AND email = ? AND EXISTS (SELECT 1 FROM account_tokens WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?)`)
        .bind(c.now.toISOString(),token.user_id,token.email,token.token_hash,nowSec(c)),
      c.db.prepare('UPDATE account_tokens SET used_at = ? WHERE token_hash = ? AND changes() = 1').bind(nowSec(c),token.token_hash),
    ]);
    if(!result[0].meta.changes)throw new HttpError(410,'This request link is not valid.');
    return redirect('/app');
  }
  const t=c.t;
  return page(sitePage(c,{title:t('Verify your email'),bare:true,body:html`<section class="wrap narrow section"><h1>${t('Verify your email')}</h1><p>${token.email}</p><form method="post" action="/verify/${c.params.token}"><button class="btn btn-primary">${t('Verify your email')}</button></form></section>`}));
}

async function account(c,salon) {
  const t=c.t;
  if(c.request.method==='POST') {
    if(!await hit(c.db,`account:${c.user.id}`,10,3600,nowSec(c)))throw new HttpError(429,'Too many attempts. Please try again in an hour.');
    const f=new FormReader(await readForm(c.request),t);
    const locale=f.raw('locale');if(!isLocale(locale))throw new HttpError(400,'Choose a language from the list.');
    if(f.raw('password')) {
      const user=await c.db.prepare('SELECT * FROM users WHERE id = ?').bind(c.user.id).first();
      if(salon.is_demo || !await verifyPassword(f.raw('current'),user,c.config.authPepper))throw new HttpError(400,'That is not your current password.');
      const password=f.password('password');if(!f.ok)throw new HttpError(400,'Choose a valid option.');
      const pw=await createPasswordRecord(password,c.config.pbkdf2Iterations,c.config.authPepper);
      if (!await replacePassword(c.db,user,pw)) throw new HttpError(409,'That is not your current password.');
      await c.db.prepare('UPDATE users SET locale = ?, notify_email = ? WHERE id = ?').bind(locale,f.checkbox('notify')?1:0,user.id).run();
      return redirect('/app/account?ok=saved',{cookies:[await startSession(c.db,user.id,{secure:c.secure,now:c.now})]});
    }
    await c.db.prepare('UPDATE users SET locale = ?, notify_email = ? WHERE id = ?').bind(locale,f.checkbox('notify')?1:0,c.user.id).run();
    return redirect('/app/account?ok=saved');
  }
  return page(appPage(c,{title:t('My account'),current:'/app/account',body:html`<h1>${t('My account')}</h1><p>${c.user.email}</p>${c.url.searchParams.has('ok')?notice('ok',t('Settings saved.')):''}
    <form class="panel" method="post" action="/app/account"><div class="field"><label for="locale">${t('Language')}</label><select id="locale" name="locale">${LOCALES.map((l)=>html`<option value="${l}"${l===c.locale?html` selected`:''}>${LOCALE_NAMES[l]}</option>`)}</select></div>
    <label class="check"><input type="checkbox" name="notify"${c.user.notify_email?html` checked`:''}> ${t('Email notifications')}</label>
    <div class="field"><label for="current">${t('Current password')}</label><input id="current" name="current" type="password" autocomplete="current-password" maxlength="200"></div>
    <div class="field"><label for="password">${t('New password')} ${t('(optional)')}</label><input id="password" name="password" type="password" autocomplete="new-password" minlength="10" maxlength="200"></div><button class="btn btn-primary">${t('Save')}</button></form>`}));
}

function registerTeam(r) {
  r.get('/app/team',protectedRoute(team,true));r.post('/app/team',protectedRoute(invite,true));r.post('/app/team/:id/remove',protectedRoute(remove,true));
  r.post('/app/team/revoke',protectedRoute(async(c,s)=>{const f=await readForm(c.request);await c.db.prepare("DELETE FROM account_tokens WHERE token_hash = ? AND salon_id = ? AND kind = 'invite'").bind(f.get('token')||'',s.id).run();return redirect('/app/team');},true));
  r.get('/join/:token',join);r.post('/join/:token',join);
  r.get('/verify',verifyPage);r.post('/verify',verifyPage);r.get('/verify/:token',verifyToken);r.post('/verify/:token',verifyToken);
  r.get('/app/account',protectedRoute(account));r.post('/app/account',protectedRoute(account));
}
return { registerTeam };
})();

// src/billing-state.js
const __m56 = (() => {
// Copyright (c) 2026 Miloš Petrović (Trench Logic Studio) · SPDX-License-Identifier: MIT
// Signed events are notifications, not an authority for granting paid access.
// Production re-reads the subscription from the provider, validates its plan,
// isolates its owner and commits event deduplication and state in one transaction.
const { parseWebhook } = __m2;
const { writeWithEvent } = __m22;

async function currentSubscription(c, update) {
  const b = c.billing;
  if (!b.apiKey) return update; // Local signed fixtures; production readiness forbids this.
  if (!update.subscriptionId || !/^[A-Za-z0-9_-]{1,100}$/.test(update.subscriptionId)) throw new Error('Invalid subscription identifier');
  const base = b.provider === 'stripe' ? 'https://api.stripe.com/v1/subscriptions/' : 'https://api.lemonsqueezy.com/v1/subscriptions/';
  const response = await c.fetch(base + encodeURIComponent(update.subscriptionId), {
    headers: { authorization: `Bearer ${b.apiKey}`, accept: 'application/json' },
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`Subscription verification failed (${response.status})`);
  const data = await response.json();
  const latest = b.provider === 'stripe'
    ? parseWebhook('stripe', { id: 'current', type: 'customer.subscription.updated', created: Math.floor(update.eventAt / 1000), livemode: data.livemode, data: { object: data } })
    : parseWebhook('lemonsqueezy', { meta: { event_name: 'subscription_updated' }, data: data.data });
  if (!latest || latest.subscriptionId !== update.subscriptionId) throw new Error('Subscription verification returned an unexpected object');
  if (latest.salonId && update.salonId && latest.salonId !== update.salonId) throw new Error('Subscription owner mismatch');
  return { ...latest, eventId: update.eventId, salonId: latest.salonId || update.salonId, eventAt: Math.max(latest.eventAt, update.eventAt) };
}

async function applyBillingEvent(c, original) {
  if (!original.subscriptionId || !original.status) return { ok: true, ignored: true };
  const duplicate = await c.db.prepare('SELECT 1 AS found FROM webhook_events WHERE id = ?').bind(original.eventId).first();
  if (duplicate) return { ok: true, duplicate: true };
  const b = c.billing;
  const upd = await currentSubscription(c, original);
  if (b.strict && (!b.apiKey || !b.priceId || !upd.eventAt)) throw new Error('Billing verification is not configured');
  if (upd.live !== null && upd.live !== b.live) return { ok: true, ignored: true, reason: 'mode' };
  if (b.strict && upd.live === null) throw new Error('Missing payment mode');
  const bound = await c.db.prepare('SELECT * FROM billing_subscriptions WHERE provider = ? AND subscription_id = ?').bind(b.provider, upd.subscriptionId).first();
  let salon = await c.db.prepare('SELECT * FROM salons WHERE billing_provider = ? AND billing_subscription_id = ? AND is_demo = 0').bind(b.provider, upd.subscriptionId).first();
  if (b.priceId && !upd.priceIds.includes(b.priceId)) {
    if (!bound && !salon) return { ok: true, ignored: true, reason: 'plan' };
    // A linked customer changing to an unsupported product must lose access.
    upd.status = 'expired';
    upd.periodEnd = null;
    upd.trialEndsAt = null;
  }
  if (bound && upd.salonId && bound.salon_id !== upd.salonId) throw new Error('Subscription cannot be reassigned');
  if (!salon && bound) salon = await c.db.prepare('SELECT * FROM salons WHERE id = ? AND is_demo = 0').bind(bound.salon_id).first();
  if (!salon && upd.salonId) salon = await c.db.prepare('SELECT * FROM salons WHERE id = ? AND is_demo = 0').bind(upd.salonId).first();
  if (!salon) {
    if (upd.salonId) return { ok: true, unknown: true }; // Deleted or demo account.
    // A subscription event can arrive before checkout binds it. Ask for a retry.
    throw new Error('Subscription binding is not available yet');
  }
  if (upd.salonId && upd.salonId !== salon.id) throw new Error('Subscription owner mismatch');
  if (bound && salon.billing_subscription_id && salon.billing_subscription_id !== upd.subscriptionId) return { ok: true, ignored: true, reason: 'superseded' };
  if (!bound && salon.billing_subscription_id && salon.billing_subscription_id !== upd.subscriptionId && ['active', 'trialing', 'past_due', 'canceled'].includes(salon.billing_status)) {
    throw new Error('Another subscription is already linked');
  }
  // Restrictive state wins when providers create two events in the same second.
  // A terminal subscription cannot be revived by a delayed checkout event.
  const rank = upd.terminal ? 100 : ({ active: 1, trialing: 1, past_due: 2, canceled: 3, paused: 4, expired: 5 }[upd.status] || 0);
  const at = upd.eventAt || c.now.getTime();
  const status = upd.terminal ? 'terminal' : upd.status;
  const stamp = c.now.toISOString();
  const sqlEligible = `(billing_subscriptions.status <> 'terminal' AND (excluded.event_at > billing_subscriptions.event_at OR (excluded.event_at = billing_subscriptions.event_at AND excluded.event_rank >= billing_subscriptions.event_rank)))`;
  try {
    const result = await writeWithEvent(c.db, salon.id, 'billing.updated', { provider: b.provider, status: upd.status }, () => [
      c.db.prepare('INSERT INTO webhook_events (id, provider, received_at) VALUES (?, ?, ?)').bind(upd.eventId, b.provider, stamp),
      c.db.prepare(`INSERT INTO billing_subscriptions (provider, subscription_id, salon_id, event_at, event_rank, status) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(provider, subscription_id) DO UPDATE SET event_at = excluded.event_at, event_rank = excluded.event_rank, status = excluded.status
        WHERE billing_subscriptions.salon_id = excluded.salon_id AND ${sqlEligible}`)
        .bind(b.provider, upd.subscriptionId, salon.id, at, rank, status),
      c.db.prepare(`UPDATE salons SET billing_provider = ?, billing_subscription_id = ?, billing_customer_id = ?, billing_status = ?,
        trial_ends_at = ?, billing_period_end = ?, billing_event_at = ?, billing_event_rank = ?
        WHERE id = ? AND changes() = 1`)
        .bind(b.provider, upd.subscriptionId, upd.customerId, upd.status, upd.trialEndsAt, upd.periodEnd, at, rank, salon.id),
    ], { condition: 'changes() = 1', at: () => c.now });
    return result[2].meta.changes ? { ok: true } : { ok: true, stale: true };
  } catch (error) {
    if (/UNIQUE constraint failed: webhook_events.id/.test(String(error.message))) return { ok: true, duplicate: true };
    throw error;
  }
}
return { applyBillingEvent };
})();

// src/demo.js
const __m57 = (() => {
// Copyright (c) 2026 Miloš Petrović (Trench Logic Studio) · SPDX-License-Identifier: MIT
// "Try the live demo": a private sample salon for one visitor, with services,
// upgrades, quiet hours, a few client requests and matching results. It is
// marked as a demo (no emails, no billing) and deleted after 24 hours.

const { randomToken, shortRef } = __m1;
const { appendEvent } = __m22;
const { localNow, fmtTime } = __m9;
const { seed } = __m26;
const { computeOffers } = __m8;
const { TEMPLATES } = __m46;
const { CONSENT_VERSION } = __m0;

const CLIENTS = [
  ['Nora Hale', '+44 7700 900123'],
  ['Lena Brandt', 'lena.brandt@example.com'],
  ['Tom Fischer', '+49 151 23456789'],
  ['Ines Duarte', 'ines.duarte@example.com'],
];

async function createDemoSalon(db, { t, now, timezone }) {
  const template = TEMPLATES[0];
  const stamp = now.toISOString();
  const currency = timezone.startsWith('America/') ? 'USD' : 'EUR';
  let slug = '';
  for (let i = 0; i < 5 && !slug; i++) {
    const candidate = `demo-${randomToken(9).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8)}`;
    if (candidate.length >= 10 && !(await db.prepare('SELECT 1 AS x FROM salons WHERE slug = ?').bind(candidate).first())) slug = candidate;
  }
  if (!slug) throw new Error('Could not create a demo salon');

  const salonRow = await db
    .prepare(
      `INSERT INTO salons (slug, name, timezone, currency, created_at, locale, address, phone, is_demo, demo_expires_at, billing_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 'beta') RETURNING id`,
    )
    .bind(slug, 'Studio Lumen', timezone, currency, stamp, t.locale, t('12 Example Street'), '+44 20 7946 0000', new Date(now.getTime() + 86400000).toISOString())
    .first();
  const salonId = salonRow.id;
  const user = await db
    .prepare('INSERT INTO users (salon_id, email, pass_hash, pass_salt, pass_iter, created_at, locale) VALUES (?, ?, ?, ?, 10000, ?, ?) RETURNING id')
    .bind(salonId, `${slug}@demo.invalid`, randomToken(32), randomToken(16), stamp, t.locale)
    .first();
  await appendEvent(db, salonId, 'salon.created', { slug, timezone, currency }, { at: () => now });

  const statements = [];
  template.services.forEach(([name, minutes], i) => {
    statements.push(
      db.prepare('INSERT INTO services (salon_id, name, duration_min, price_cents, created_at) VALUES (?, ?, ?, ?, ?)').bind(salonId, t(name), minutes, template.demoPrices[i], stamp),
    );
  });
  template.upgrades.forEach(([name, minutes]) => {
    statements.push(db.prepare('INSERT INTO upgrades (salon_id, service_id, name, added_min, created_at) VALUES (?, NULL, ?, ?, ?)').bind(salonId, t(name), minutes, stamp));
  });
  for (const [weekday, start, end, capacity] of [
    [1, 600, 720, 1],
    [2, 780, 990, 2],
    [3, 780, 990, 2],
    [4, 780, 990, 2],
    [5, 600, 720, 1],
  ]) {
    statements.push(
      db.prepare('INSERT INTO windows (salon_id, weekday, start_min, end_min, capacity, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(salonId, weekday, start, end, capacity, stamp),
    );
  }
  await db.batch(statements);
  await appendEvent(db, salonId, 'setup.applied', { template: template.id, services: template.services.length, upgrades: template.upgrades.length }, { at: () => now });

  // Sample client requests, made by the engine itself so they follow every rule.
  const services = (await db.prepare('SELECT id, name, duration_min, price_cents, active FROM services WHERE salon_id = ? ORDER BY id').bind(salonId).all()).results;
  const upgrades = (await db.prepare('SELECT id, name, added_min, active, service_id FROM upgrades WHERE salon_id = ? ORDER BY id').bind(salonId).all()).results;
  const windows = (await db.prepare('SELECT id, weekday, start_min, end_min, capacity FROM windows WHERE salon_id = ?').bind(salonId).all()).results;
  const local = localNow(timezone, now);
  const busy = [];
  const plan = [
    [0, 0, 'confirmed'],
    [0, 1, 'pending'],
    [2, 0, 'pending'],
  ];
  for (let i = 0; i < plan.length; i++) {
    const [serviceIndex, offerIndex, status] = plan[i];
    const result = computeOffers({ service: services[serviceIndex], upgrades, windows, busy, now: local, leadMin: 120 });
    const offer = result.offers[offerIndex] || result.offers[0];
    if (!offer) continue;
    busy.push({ slot_date: offer.slot_date, start_min: offer.start_min, end_min: offer.end_min });
    const ref = shortRef();
    const [name, contact] = CLIENTS[i];
    await db
      .prepare(
        `INSERT INTO requests (salon_id, token, ref, kind, status, service_id, service_name, base_min, added_min, total_min, uplift_pct,
           upgrades_json, standard_price_cents, price_cents, currency, slot_date, start_min, end_min, capacity, client_name, client_contact,
           consent_at, consent_version, created_at, decided_at, locale)
         VALUES (?, ?, ?, 'offer', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        salonId, randomToken(24), ref, status, offer.service_id, offer.service_name, offer.base_min, offer.added_min, offer.total_min,
        offer.uplift_pct, JSON.stringify(offer.upgrades), offer.standard_price_cents, offer.price_cents, currency, offer.slot_date,
        offer.start_min, offer.end_min, offer.capacity, name, contact, stamp, CONSENT_VERSION, stamp, status === 'confirmed' ? stamp : null, t.locale,
      )
      .run();
    await appendEvent(
      db,
      salonId,
      'request.offer',
      { ref, service_id: offer.service_id, slot: `${offer.slot_date} ${fmtTime(offer.start_min)}`, base_min: offer.base_min, added_min: offer.added_min, uplift_pct: offer.uplift_pct, standard_price_cents: offer.standard_price_cents, price_cents: offer.price_cents, currency },
      { at: () => now },
    );
    if (status === 'confirmed') {
      await appendEvent(db, salonId, 'request.confirmed', { ref, slot: `${offer.slot_date} ${fmtTime(offer.start_min)}`, standard_price_cents: offer.standard_price_cents, price_cents: offer.price_cents, currency }, { at: () => now });
    }
  }
  const [name, contact] = CLIENTS[3];
  await db
    .prepare(
      `INSERT INTO requests (salon_id, token, ref, kind, status, service_id, service_name, base_min, added_min, total_min, uplift_pct,
         upgrades_json, standard_price_cents, price_cents, currency, client_name, client_contact, note, consent_at, consent_version, created_at, locale)
       VALUES (?, ?, ?, 'waitlist', 'pending', ?, ?, ?, 0, ?, 30, '[]', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(salonId, randomToken(24), shortRef(), services[3].id, services[3].name, services[3].duration_min, services[3].duration_min, services[3].price_cents, services[3].price_cents, currency, name, contact, t('Any weekday after 17:00'), stamp, CONSENT_VERSION, stamp, t.locale)
    .run();

  // Results that match the sample requests above; the visitor's own clicks on the demo page add to them.
  for (const [metric, n] of [
    ['view', 9],
    ['offers', 6],
    ['noslot', 1],
    ['request', 3],
    ['waitlist', 1],
    ['confirmed', 1],
  ]) {
    await seed(db, salonId, local.date, metric, n);
  }
  return { salonId, userId: user.id, slug };
}
return { createDemoSalon };
})();

// src/routes/extras.js
const __m58 = (() => {
// Copyright (c) 2026 Miloš Petrović (Trench Logic Studio) · SPDX-License-Identifier: MIT
// Salon calendar feed, payment-provider webhook, and the live demo.

const { HttpError, readForm, readLimited, redirect, jsonResponse } = __m6;
const { isLocale, translator } = __m18;
const { isValidTimeZone, localNow, addDays, localToUtc } = __m9;
const { calendar } = __m29;
const { parseUpgrades } = __m10;
const { applyBillingEvent } = __m56;
const { verifyLemonSqueezy, verifyStripe, parseWebhook } = __m2;
const { createDemoSalon } = __m57;
const { startSession } = __m11;
const { hit, limiterKey } = __m23;
const { nowSec } = __m39;

/** GET /cal/<token>.ics: confirmed appointments for the salon's own calendar app. */
async function salonCalendar(c) {
  const m = /^([A-Za-z0-9_-]{20,100})\.ics$/.exec(String(c.params.file || ''));
  if (!m) throw new HttpError(404, 'There is nothing at this address.');
  const salon = await c.db.prepare('SELECT id, name, timezone, address FROM salons WHERE calendar_token = ?').bind(m[1]).first();
  if (!salon) throw new HttpError(404, 'There is nothing at this address.');
  const owner = await c.db.prepare('SELECT locale FROM users WHERE salon_id = ? ORDER BY id LIMIT 1').bind(salon.id).first();
  const t = translator(owner ? owner.locale : 'en');
  const from = addDays(localNow(salon.timezone, c.now).date, -30);
  const { results } = await c.db
    .prepare(
      `SELECT ref, token, service_name, upgrades_json, slot_date, start_min, end_min, total_min, price_cents, currency, client_name, client_contact
         FROM requests WHERE salon_id = ? AND kind = 'offer' AND status = 'confirmed' AND (outcome IS NULL OR outcome = 'completed') AND slot_date >= ?
        ORDER BY slot_date, start_min LIMIT 2000`,
    )
    .bind(salon.id, from)
    .all();
  const events = results.map((r) => {
    const what = [r.service_name, ...parseUpgrades(r.upgrades_json).map((u) => u.name)].join(' + ');
    const who = r.client_name || t('Client');
    return {
      uid: `${r.ref}-${r.token.slice(0, 8)}@${c.url.host}`,
      start: localToUtc(r.slot_date, r.start_min, salon.timezone),
      end: localToUtc(r.slot_date, r.end_min, salon.timezone),
      summary: `${what} (${who.split(' ')[0]})`,
      description: [
        `${who}${r.client_contact ? `, ${r.client_contact}` : ''}`,
        t('Price: {price}, the standard price', { price: t.money(r.price_cents, r.currency) }),
        t('Reference: {ref}', { ref: r.ref }),
      ].join('\n'),
      location: salon.address || '',
    };
  });
  return new Response(calendar({ name: salon.name, events, now: c.now }), {
    headers: { 'content-type': 'text/calendar; charset=utf-8', 'cache-control': 'private, max-age=300', 'x-robots-tag': 'noindex' },
  });
}

/** POST /billing/webhook: signed subscription updates from Lemon Squeezy or Stripe. */
async function billingWebhook(c) {
  const b = c.billing;
  if (!b.enabled) throw new HttpError(404, 'There is nothing at this address.');
  const raw = await readLimited(c.request, 256 * 1024);
  const valid =
    b.provider === 'lemonsqueezy'
      ? await verifyLemonSqueezy(b.secret, raw, c.request.headers.get('x-signature'))
      : await verifyStripe(b.secret, raw, c.request.headers.get('stripe-signature'), nowSec(c));
  if (!valid) return jsonResponse({ ok: false, error: 'invalid signature' }, { status: 400 });
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return jsonResponse({ ok: false, error: 'invalid json' }, { status: 400 });
  }
  const upd = parseWebhook(b.provider, payload);
  if (!upd) return jsonResponse({ ok: true, ignored: true });

  try {
    return jsonResponse(await applyBillingEvent(c, upd));
  } catch {
    // Do not acknowledge an event that could not be safely applied. Providers retry.
    return jsonResponse({ ok: false, retry: true }, { status: 503 });
  }
}

/** POST /demo: a private sample salon for 24 hours, logged in straight away. */
async function startDemo(c) {
  if (!c.config.demoEnabled) throw new HttpError(404, 'There is nothing at this address.');
  const form = await readForm(c.request);
  const lang = form.get('lang');
  if (isLocale(lang)) c.useLocale(lang);
  if (!(await hit(c.db, await limiterKey('demo-ip', c.ip), 5, 3600, nowSec(c)))) {
    throw new HttpError(429, 'Too many demos were started from here. Please try again in an hour.');
  }
  await c.db.prepare('DELETE FROM salons WHERE is_demo = 1 AND demo_expires_at < ?').bind(c.now.toISOString()).run();
  const { n } = await c.db.prepare('SELECT COUNT(*) AS n FROM salons WHERE is_demo = 1').first();
  if (n >= 300) throw new HttpError(429, 'The demo is very busy right now. Please try again in a few minutes.');
  const tz = form.get('timezone');
  const { userId } = await createDemoSalon(c.db, { t: c.t, now: c.now, timezone: isValidTimeZone(tz) ? tz : 'Europe/Berlin' });
  const cookie = await startSession(c.db, userId, { secure: c.secure, now: c.now });
  return redirect('/app?ok=demo', { cookies: [cookie] });
}

function registerExtras(r) {
  r.get('/cal/:file', salonCalendar);
  r.post('/billing/webhook', billingWebhook);
  r.post('/demo', startDemo);
}
return { registerExtras };
})();

// src/app.js
const __m59 = (() => {
// Copyright (c) 2026 Miloš Petrović (Trench Logic Studio) · SPDX-License-Identifier: MIT
// The whole application as one Web-standard handler: Request in, Response out.
// It runs unchanged on Cloudflare Workers (worker.js) and on Node (local.js).

const { readiness } = __m4;
const { Router } = __m5;
const { HttpError, htmlResponse, isSameOrigin, withSecurityHeaders } = __m6;
const { loadConfig } = __m0;
const { ensureSchema } = __m7;
const { currentUser } = __m11;
const { translator, negotiate, isLocale } = __m18;
const { mailConfig } = __m3;
const { billingConfig } = __m2;
const { withLang } = __m20;
const { registerPublic } = __m40;
const { registerAuth } = __m43;
const { registerApp } = __m50;
const { registerAdmin } = __m52;
const { registerTeam } = __m55;
const { registerOperations } = __m54;
const { registerExtras } = __m58;
const { errorView } = __m37;
const { dailyMaintenance } = __m25;

const router = new Router();
registerPublic(router);
registerAuth(router);
registerApp(router);
registerAdmin(router);
registerExtras(router);
registerOperations(router);
registerTeam(router);

const STATIC_PATHS = new Set(['/static/app.css', '/static/app.js', '/favicon.svg', '/robots.txt', '/sitemap.xml', '/og.png', '/apple-touch-icon.png']);
// Server-to-server calls carry no browser Origin; they authenticate by signature instead.
const NO_ORIGIN_CHECK = new Set(['/billing/webhook']);

/**
 * createApp({ db, env, clock, fetchImpl })
 *   db         Cloudflare D1 binding, or the node:sqlite stand-in for local runs and tests
 *   env        environment variables and bindings (see config.js, mail.js, billing.js)
 *   clock      () => Date, injectable so tests can move time
 *   fetchImpl  outgoing HTTP (email provider), injectable for tests
 */
function createApp({ db, env = {}, clock = () => new Date(), fetchImpl = globalThis.fetch }) {
  const config = loadConfig(env);
  const mail = mailConfig(env);
  const billing = billingConfig(env);
  const deployment = readiness(env);

  // Housekeeping runs at most once a day, triggered by ordinary traffic, so
  // retention works even when no scheduled trigger is configured.
  let lastMaintenanceCheck = -Infinity;
  async function maybeMaintain(now) {
    if (now.getTime() - lastMaintenanceCheck < 300000) return;
    lastMaintenanceCheck = now.getTime();
    try {
      const row = await db.prepare("SELECT value FROM meta WHERE key = 'maintenance_at'").first();
      const last = row ? Date.parse(row.value) : 0;
      if (now.getTime() - last < 900000) return;
      await db
        .prepare("INSERT INTO meta (key, value) VALUES ('maintenance_at', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
        .bind(now.toISOString())
        .run();
      await dailyMaintenance(db, now, { env, mail, fetchImpl, productName: config.productName });
    } catch (err) {
      console.error('Maintenance failed', err && err.stack ? err.stack : err);
    }
  }

  async function handle(request, ctx, jobs) {
    const url = new URL(request.url);
    const method = request.method.toUpperCase();
    const secure = url.protocol === 'https:';
    const now = clock();
    const queryLang = url.searchParams.get('lang');
    let user;
    const c = {
      request,
      url,
      db,
      env,
      config,
      readiness: deployment,
      mail,
      billing,
      fetch: fetchImpl,
      params: {},
      ip: ctx.ip || '',
      now,
      secure,
      user: null,
      langParam: isLocale(queryLang) ? queryLang : null,
      async getUser() {
        if (user === undefined) user = await currentUser(db, request, { secure, now });
        return user;
      },
      useLocale(locale) {
        c.locale = isLocale(locale) ? locale : 'en';
        c.t = translator(c.locale);
      },
      /** Keep an explicitly chosen language when following a link. */
      link(path) {
        return c.langParam ? withLang(path, c.langParam) : path;
      },
      /** Work to finish after the response (email delivery); awaited inline where there is no waitUntil. */
      defer(job) {
        jobs.push(job);
      },
    };
    c.useLocale(c.langParam || negotiate(request.headers.get('accept-language')));

    try {
      if (config.publicOrigin && url.origin !== config.publicOrigin) return new Response('Unrecognized origin', { status: 421 });
      if (config.production && !deployment.ready) return new Response(JSON.stringify({ ok: false, error: 'Deployment configuration incomplete', checks: deployment.checks }), { status: 503, headers: { 'content-type': 'application/json' } });
      const match = router.match(method === 'HEAD' ? 'GET' : method, url.pathname);
      if (!match) throw new HttpError(404, 'There is nothing at this address.');
      if (match.methodNotAllowed) throw new HttpError(405, 'That action is not available here.');
      if (!STATIC_PATHS.has(url.pathname)) {
        await ensureSchema(db);
        const job = maybeMaintain(now);
        if (ctx.waitUntil) ctx.waitUntil(job);
        else await job;
      }
      if (method === 'POST' && !NO_ORIGIN_CHECK.has(url.pathname) && !isSameOrigin(request)) {
        throw new HttpError(403, 'This form was sent from another website, so it was blocked. Open the page again and resend it.');
      }
      c.params = match.params;
      return await match.handler(c);
    } catch (err) {
      if (err instanceof HttpError) {
        return htmlResponse(errorView(c, err.status, err.message), { status: err.status });
      }
      const safePath = url.pathname.replace(/\/(r|reset|verify|join|cal)\/[^/]+/g, '/$1/[private]');
      console.error('Unhandled error', method, safePath, err?.name || 'Error');
      try {
        await db
          .prepare('INSERT INTO error_log (at, method, path, message) VALUES (?, ?, ?, ?)')
          .bind(now.toISOString(), method, safePath.slice(0, 200), String(err?.name || 'Internal error').slice(0, 100))
          .run();
      } catch {
        /* the database itself may be the problem */
      }
      return htmlResponse(errorView(c, 500, 'Something went wrong on our side. Please try again in a moment.'), { status: 500 });
    }
  }

  return {
    config,
    async fetch(request, ctx = {}) {
      const jobs = [];
      const response = await handle(request, ctx, jobs);
      for (const job of jobs) {
        const p = Promise.resolve()
          .then(job)
          .catch((err) => console.error('Background job failed', err && err.stack ? err.stack : err));
        if (ctx.waitUntil) ctx.waitUntil(p);
        else await p;
      }
      const secure = new URL(request.url).protocol === 'https:';
      const final = withSecurityHeaders(response, { secure });
      if (request.method.toUpperCase() === 'HEAD') {
        return new Response(null, { status: final.status, headers: final.headers });
      }
      return final;
    },
  };
}
return { createApp };
})();

// worker.js
const __m60 = (() => {
// Copyright (c) 2026 Miloš Petrović (Trench Logic Studio) · SPDX-License-Identifier: MIT
// Cloudflare Workers entry point.
// Bindings: DB (a D1 database). Variables: see src/config.js. ADMIN_KEY must be a Secret.

const { createApp } = __m59;
const { dailyMaintenance } = __m25;
const { ensureSchema } = __m7;
const { mailConfig } = __m3;
const { loadConfig } = __m0;

const __default = {
  async fetch(request, env, ctx) {
    if (!env.DB) {
      return new Response('Database binding "DB" is missing. Add a D1 binding named DB in the Worker settings.', {
        status: 500,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      });
    }
    const app = createApp({ db: env.DB, env });
    return app.fetch(request, {
      ip: request.headers.get('CF-Connecting-IP') || '',
      waitUntil: (promise) => ctx.waitUntil(promise),
    });
  },

  // 15-minute cron trigger: expires stale requests, erases client details
  // after the retention period, clears old sessions and counters.
  async scheduled(event, env, ctx) {
    if (!env.DB) return;
    const options = { env, mail: mailConfig(env), productName: loadConfig(env).productName };
    ctx.waitUntil(ensureSchema(env.DB).then(() => dailyMaintenance(env.DB, new Date(), options)));
  },
};
return { default: __default };
})();

export default __m60.default;
