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

import { timingSafeEqual } from './crypto.js';

const enc = new TextEncoder();
export const BILLING_STATUSES = ['beta', 'trialing', 'active', 'past_due', 'canceled', 'paused', 'expired'];

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

export function billingConfig(env = {}) {
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
export function hasAccess(salon, cfg, now) {
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
export function initialBilling(cfg, now) {
  if (!cfg.enabled) return { status: 'beta', trialEndsAt: null };
  if (cfg.trialDays === 0) return { status: 'expired', trialEndsAt: null };
  return { status: 'trialing', trialEndsAt: new Date(now.getTime() + cfg.trialDays * 86400000).toISOString() };
}

/** Hosted checkout link that carries the salon id back in the webhook. */
export function checkoutLink(cfg, salonId, email) {
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
export async function verifyLemonSqueezy(secret, rawBody, signature) {
  if (!signature || !/^[0-9a-f]{64}$/i.test(signature)) return false;
  return timingSafeEqual(await hmacHex(secret, rawBody), signature.toLowerCase());
}

/** Stripe: Stripe-Signature = t=<unix>,v1=<hex HMAC-SHA256 of "t.body">; 5-minute tolerance. */
export async function verifyStripe(secret, rawBody, header, nowSec, tolerance = 300) {
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
export function parseWebhook(provider, payload) {
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
export async function ensureBillingTrial(db, salon, cfg, now) {
  if (!cfg.enabled || salon.is_demo || salon.billing_status !== 'beta') return salon;
  const bill = initialBilling(cfg, now);
  await db.prepare("UPDATE salons SET billing_status = ?, trial_ends_at = ? WHERE id = ? AND billing_status = 'beta'")
    .bind(bill.status, bill.trialEndsAt, salon.id).run();
  const fresh = await db.prepare('SELECT billing_status, trial_ends_at FROM salons WHERE id = ?').bind(salon.id).first();
  Object.assign(salon, fresh);
  return salon;
}
