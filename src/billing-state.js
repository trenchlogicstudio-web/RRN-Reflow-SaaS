// Copyright (c) 2026 Miloš Petrović (Trench Logic Studio) · SPDX-License-Identifier: MIT
// Signed events are notifications, not an authority for granting paid access.
// Production re-reads the subscription from the provider, validates its plan,
// isolates its owner and commits event deduplication and state in one transaction.
import { parseWebhook } from './billing.js';
import { writeWithEvent } from './events.js';

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

export async function applyBillingEvent(c, original) {
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
