// Copyright (c) 2026 Miloš Petrović (Trench Logic Studio) · SPDX-License-Identifier: MIT
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { makeApp, Browser, offerKeys, setupSalon, PASSWORD } from './helpers.js';
import { billingConfig, hasAccess, parseWebhook, verifyStripe, verifyLemonSqueezy, checkoutLink } from '../src/billing.js';

const DAY = 86400000;
const LS = {
  BILLING_PROVIDER: 'lemonsqueezy',
  CHECKOUT_URL: 'https://studio.lemonsqueezy.com/checkout/buy/variant-123',
  BILLING_WEBHOOK_SECRET: 'whsec_lemon_test_secret',
  BILLING_PORTAL_URL: 'https://studio.lemonsqueezy.com/billing',
  TRIAL_DAYS: '14',
  PRICE_LABEL: '€19 per month',
  PRICE_MONTHLY_CENTS: '1900',
};
const STRIPE = {
  BILLING_PROVIDER: 'stripe',
  CHECKOUT_URL: 'https://buy.stripe.com/test_abc123',
  BILLING_WEBHOOK_SECRET: 'whsec_stripe_test_secret',
  BILLING_PORTAL_URL: 'https://billing.stripe.com/p/login/test_xyz',
};

function lsWebhook(app, payload, { secret = LS.BILLING_WEBHOOK_SECRET, signature } = {}) {
  const body = JSON.stringify(payload);
  const sig = signature ?? createHmac('sha256', secret).update(body).digest('hex');
  return app.fetch(
    new Request('http://localhost:8787/billing/webhook', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-signature': sig, 'x-event-name': payload.meta.event_name },
      body,
    }),
  );
}

function stripeWebhook(app, payload, nowSec, { secret = STRIPE.BILLING_WEBHOOK_SECRET, t = nowSec } = {}) {
  const body = JSON.stringify(payload);
  const v1 = createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
  return app.fetch(
    new Request('http://localhost:8787/billing/webhook', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'stripe-signature': `t=${t},v1=${v1},v0=deadbeef` },
      body,
    }),
  );
}

const lsSubscription = (event, status, salonId, extra = {}) => ({
  meta: { event_name: event, custom_data: { salon_id: String(salonId) } },
  data: {
    type: 'subscriptions',
    id: '9001',
    attributes: { status, customer_id: 77, renews_at: '2026-12-18T10:00:00.000000Z', ends_at: null, trial_ends_at: null, updated_at: `2026-11-18T10:00:0${extra.n || 0}.000000Z`, ...extra.attributes },
  },
});

test('config: billing stays off unless provider, https checkout link and secret are all set', () => {
  assert.equal(billingConfig({}).enabled, false);
  assert.equal(billingConfig({ ...LS, CHECKOUT_URL: 'http://insecure.example' }).enabled, false);
  assert.equal(billingConfig({ ...LS, BILLING_WEBHOOK_SECRET: 'short' }).enabled, false);
  assert.equal(billingConfig({ ...LS, BILLING_PROVIDER: 'paypal' }).enabled, false);
  const cfg = billingConfig(LS);
  assert.equal(cfg.enabled, true);
  assert.equal(cfg.trialDays, 14);
  assert.equal(checkoutLink(cfg, 12, 'a@b.co'), 'https://studio.lemonsqueezy.com/checkout/buy/variant-123?checkout%5Bcustom%5D%5Bsalon_id%5D=12&checkout%5Bemail%5D=a%40b.co');
  assert.equal(checkoutLink(billingConfig(STRIPE), 12, 'a@b.co'), 'https://buy.stripe.com/test_abc123?client_reference_id=salon_12&prefilled_email=a%40b.co');
});

test('access rules: trial, active, past due, cancelled until period end, then off', () => {
  const cfg = billingConfig(LS);
  const now = new Date('2026-11-10T00:00:00Z');
  const s = (over) => ({ is_demo: 0, billing_status: 'trialing', trial_ends_at: '2026-11-16T00:00:00Z', billing_period_end: null, ...over });
  assert.equal(hasAccess(s(), cfg, now), true);
  assert.equal(hasAccess(s({ trial_ends_at: '2026-11-09T00:00:00Z' }), cfg, now), false);
  assert.equal(hasAccess(s({ billing_status: 'active' }), cfg, now), true);
  assert.equal(hasAccess(s({ billing_status: 'past_due' }), cfg, now), false);
  assert.equal(hasAccess(s({ billing_status: 'canceled', billing_period_end: '2026-11-20T00:00:00Z' }), cfg, now), true);
  assert.equal(hasAccess(s({ billing_status: 'canceled', billing_period_end: '2026-11-01T00:00:00Z' }), cfg, now), false);
  assert.equal(hasAccess(s({ billing_status: 'expired' }), cfg, now), false);
  assert.equal(hasAccess(s({ billing_status: 'expired', is_demo: 1 }), cfg, now), true);
  assert.equal(hasAccess(s({ billing_status: 'expired' }), billingConfig({}), now), true, 'billing off: everyone has access');
});

test('signatures: Lemon Squeezy and Stripe verification, including replay protection', async () => {
  const body = '{"x":1}';
  const ls = createHmac('sha256', 'secret_1').update(body).digest('hex');
  assert.equal(await verifyLemonSqueezy('secret_1', body, ls), true);
  assert.equal(await verifyLemonSqueezy('secret_2', body, ls), false);
  assert.equal(await verifyLemonSqueezy('secret_1', body + ' ', ls), false);
  assert.equal(await verifyLemonSqueezy('secret_1', body, ''), false);
  const t = 1793000000;
  const v1 = createHmac('sha256', 'whsec_1').update(`${t}.${body}`).digest('hex');
  assert.equal(await verifyStripe('whsec_1', body, `t=${t},v1=${v1}`, t + 10), true);
  assert.equal(await verifyStripe('whsec_1', body, `t=${t},v1=${v1}`, t + 301), false, 'older than 5 minutes');
  assert.equal(await verifyStripe('whsec_1', body, `t=${t},v0=${v1}`, t), false, 'only v1 counts');
  assert.equal(await verifyStripe('whsec_1', body, `t=${t},v1=${'0'.repeat(64)},v1=${v1}`, t), true, 'any v1 may match (secret rotation)');
});

test('Lemon Squeezy flow: trial at sign-up, gate after the trial, subscribe, webhook activates, cancel keeps access to period end', async () => {
  const t = makeApp({ env: { ...LS, ADMIN_KEY: 'k'.repeat(32) } });
  const { owner, slug, serviceId } = await setupSalon(t);
  let salon = await t.db.prepare('SELECT id, billing_status, trial_ends_at FROM salons').first();
  assert.equal(salon.billing_status, 'trialing');
  assert.equal(salon.trial_ends_at, '2026-11-16T08:00:00.000Z');
  assert.match((await owner.get('/app/plan')).text, /Free trial until 16 Nov 2026/);

  // Trial over: clients only see the waitlist, the owner sees why.
  t.advance(15 * DAY);
  const client = new Browser(t.app, { ip: '198.51.100.90' });
  const offers = await client.get(`/s/${slug}/offers?service=${serviceId}`);
  assert.match(offers.text, /Leave your details/);
  assert.equal(offerKeys(offers.text).length, 0);
  const sneak = await client.post(`/s/${slug}/request`, { service: serviceId, offer: '2026-11-17@780#1', name: 'X', contact: 'x@example.com', consent: 'on' });
  assert.equal(sneak.status, 409);
  assert.equal((await t.db.prepare("SELECT COUNT(*) AS n FROM requests WHERE kind = 'offer'").first()).n, 0);
  assert.match((await owner.get('/app')).text, /shows only the waitlist until you subscribe/);

  const go = await owner.post('/app/billing/checkout', {});
  assert.match(go.location, /^https:\/\/studio\.lemonsqueezy\.com\/checkout\/buy\/variant-123\?checkout%5Bcustom%5D%5Bsalon_id%5D=1&checkout%5Bemail%5D=owner%40lumen\.test$/);

  // Forged and broken webhooks change nothing.
  assert.equal((await lsWebhook(t.app, lsSubscription('subscription_created', 'active', 1), { secret: 'wrong' })).status, 400);
  // The real one activates the salon.
  let res = await lsWebhook(t.app, lsSubscription('subscription_created', 'active', 1));
  assert.equal(res.status, 200);
  salon = await t.db.prepare('SELECT billing_status, billing_subscription_id, billing_customer_id, billing_period_end FROM salons').first();
  assert.deepEqual({ ...salon }, { billing_status: 'active', billing_subscription_id: '9001', billing_customer_id: '77', billing_period_end: '2026-12-18T10:00:00.000Z' });
  assert.equal(offerKeys((await client.get(`/s/${slug}/offers?service=${serviceId}`)).text).length > 0, true);
  // The same delivery twice is applied once.
  res = await lsWebhook(t.app, lsSubscription('subscription_created', 'active', 1));
  assert.deepEqual(await res.json(), { ok: true, duplicate: true });

  // Cancelled: access until the paid period ends, then the waitlist again.
  res = await lsWebhook(t.app, lsSubscription('subscription_cancelled', 'cancelled', 1, { n: 1, attributes: { ends_at: '2026-12-18T10:00:00.000000Z', renews_at: null } }));
  assert.equal(res.status, 200);
  assert.match((await owner.get('/app/plan')).text, /Upgraded offers keep running until 18 Dec 2026/);
  t.advance(30 * DAY); // 17 Dec: still inside the paid period
  assert.equal(offerKeys((await client.get(`/s/${slug}/offers?service=${serviceId}`)).text).length > 0, true);
  t.advance(2 * DAY); // 19 Dec: period over
  assert.match((await client.get(`/s/${slug}/offers?service=${serviceId}`)).text, /Leave your details/);

  // The owner (signed in again: sessions last 30 days) sees an expired plan and
  // the audit log records every change; the operator sees the subscription counts.
  const back = new Browser(t.app);
  assert.equal((await back.post('/login', { email: 'owner@lumen.test', password: PASSWORD })).status, 303);
  assert.match((await back.get('/app/plan')).text, /action="\/app\/billing\/checkout"/);
  assert.equal((await back.get('/app/audit')).text.match(/Subscription changed/g).length, 2);
  const op = new Browser(t.app);
  await op.post('/admin/login', { key: 'k'.repeat(32) });
  assert.match((await op.get('/admin')).text, /Provider: lemonsqueezy/);
});

test('Stripe flow: checkout links the subscription, updates follow it, deletion ends it', async () => {
  const t = makeApp({ env: STRIPE });
  await setupSalon(t);
  const sec = () => Math.floor(t.now.getTime() / 1000);
  let res = await stripeWebhook(
    t.app,
    { id: 'evt_1', type: 'checkout.session.completed', data: { object: { client_reference_id: 'salon_1', customer: 'cus_A', subscription: 'sub_A', mode: 'subscription', payment_status: 'paid' } } },
    sec(),
  );
  assert.equal(res.status, 200);
  let salon = await t.db.prepare('SELECT billing_status, billing_subscription_id, billing_customer_id FROM salons').first();
  assert.deepEqual({ ...salon }, { billing_status: 'active', billing_subscription_id: 'sub_A', billing_customer_id: 'cus_A' });

  // Newer API versions put the period end on the subscription item; both shapes are read.
  res = await stripeWebhook(
    t.app,
    { id: 'evt_2', type: 'customer.subscription.updated', data: { object: { id: 'sub_A', customer: 'cus_A', status: 'active', cancel_at_period_end: true, items: { data: [{ current_period_end: 1796000000 }] } } } },
    sec(),
  );
  salon = await t.db.prepare('SELECT billing_status, billing_period_end FROM salons').first();
  assert.deepEqual({ ...salon }, { billing_status: 'canceled', billing_period_end: new Date(1796000000 * 1000).toISOString() });

  res = await stripeWebhook(t.app, { id: 'evt_3', type: 'customer.subscription.deleted', data: { object: { id: 'sub_A', customer: 'cus_A', status: 'canceled' } } }, sec());
  assert.equal((await t.db.prepare('SELECT billing_status FROM salons').first()).billing_status, 'expired');

  // Reject old signatures; unbound events request retry because delivery order is not guaranteed.
  res = await stripeWebhook(t.app, { id: 'evt_4', type: 'customer.subscription.updated', data: { object: { id: 'sub_A', status: 'active' } } }, sec(), { t: sec() - 3600 });
  assert.equal(res.status, 400);
  res = await stripeWebhook(t.app, { id: 'evt_5', type: 'customer.subscription.updated', data: { object: { id: 'sub_ZZZ', status: 'active' } } }, sec());
  assert.equal(res.status, 503);
  assert.deepEqual(await res.json(), { ok: false, retry: true });
  res = await stripeWebhook(t.app, { id: 'evt_6', type: 'invoice.paid', data: { object: {} } }, sec());
  assert.deepEqual(await res.json(), { ok: true, ignored: true });
});

test('webhook endpoint: off without billing, no browser Origin needed, demo salons never billed', async () => {
  const off = makeApp();
  assert.equal((await off.app.fetch(new Request('http://localhost:8787/billing/webhook', { method: 'POST', body: '{}' }))).status, 404);
  const t = makeApp({ env: LS });
  const visitor = new Browser(t.app, { ip: '192.0.2.40' });
  await visitor.post('/demo', { timezone: 'Europe/Berlin' });
  const plan = await visitor.get('/app/plan');
  assert.doesNotMatch(plan.text, /action="\/app\/billing\/checkout"/);
  assert.equal((await visitor.post('/app/billing/checkout', {})).status, 404);
  const res = await lsWebhook(t.app, lsSubscription('subscription_created', 'active', 1));
  assert.deepEqual(await res.json(), { ok: true, unknown: true });
  assert.equal((await t.db.prepare('SELECT billing_status FROM salons').first()).billing_status, 'beta');
});

test('billing switched on later: existing beta salons get a fresh trial on their next visit', async () => {
  const t = makeApp();
  const owner = new Browser(t.app);
  await owner.post('/signup', { salon: 'Early Salon', email: 'e@e.test', password: PASSWORD, timezone: 'UTC', currency: 'EUR', terms: 'on' });
  assert.equal((await t.db.prepare('SELECT billing_status FROM salons').first()).billing_status, 'beta');
  const { createApp } = await import('../src/app.js');
  const paid = createApp({ db: t.db, env: { ...LS, PBKDF2_ITERATIONS: '10000' }, clock: () => t.now });
  const again = new Browser(paid);
  await again.post('/login', { email: 'e@e.test', password: PASSWORD });
  await again.get('/app');
  const s = await t.db.prepare('SELECT billing_status, trial_ends_at FROM salons').first();
  assert.equal(s.billing_status, 'trialing');
  assert.equal(s.trial_ends_at, new Date(t.now.getTime() + 14 * DAY).toISOString());
});

test('parseWebhook maps every provider status', () => {
  const ls = (status) => parseWebhook('lemonsqueezy', lsSubscription('subscription_updated', status, 1)).status;
  assert.deepEqual(['on_trial', 'active', 'paused', 'past_due', 'unpaid', 'cancelled', 'expired'].map(ls), ['trialing', 'active', 'paused', 'past_due', 'expired', 'canceled', 'expired']);
  const st = (status) => parseWebhook('stripe', { id: 'e', type: 'customer.subscription.updated', data: { object: { id: 's', status } } }).status;
  assert.deepEqual(['trialing', 'active', 'past_due', 'incomplete', 'unpaid', 'canceled', 'incomplete_expired', 'paused'].map(st), ['trialing', 'active', 'past_due', 'expired', 'expired', 'expired', 'expired', 'paused']);
  assert.equal(parseWebhook('lemonsqueezy', { meta: { event_name: 'order_created' }, data: { type: 'orders' } }), null);
});

test('wording follows the offer: price label, trial length, or pay from day one', async () => {
  const trial = makeApp({ env: { ...LS, PRICE_LABEL: '' } });
  let home = await new Browser(trial.app).get('/');
  assert.match(home.text, /14-day free trial/);
  assert.match(home.text, />Start your free trial</);
  const priced = makeApp({ env: LS });
  home = await new Browser(priced.app).get('/');
  assert.match(home.text, /€19 per month/);
  const paidOnly = makeApp({ env: { ...LS, TRIAL_DAYS: '0', PRICE_LABEL: '' } });
  home = await new Browser(paidOnly.app).get('/');
  assert.match(home.text, /Monthly subscription/);
  assert.doesNotMatch(home.text, /free trial|Start free/i);
  const signup = await new Browser(paidOnly.app).get('/signup');
  assert.match(signup.text, /<h1>Create account<\/h1>/);
  // Without a trial the request page shows the waitlist until the salon subscribes.
  const { slug, serviceId } = await setupSalon(paidOnly);
  assert.equal((await paidOnly.db.prepare('SELECT billing_status FROM salons').first()).billing_status, 'expired');
  assert.match((await new Browser(paidOnly.app).get(`/s/${slug}/offers?service=${serviceId}`)).text, /Leave your details/);
});
