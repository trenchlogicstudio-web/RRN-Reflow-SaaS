// Copyright (c) 2026 Miloš Petrović (Trench Logic Studio) · SPDX-License-Identifier: MIT
// Email: messages go into an outbox table first and are delivered from there,
// so a slow or failing provider never breaks a request, and failed sends are
// retried with back-off. Off until a provider is configured.
//
// Providers:
//   resend      RESEND_API_KEY (works on the Workers Free plan; free tier 3,000/month)
//   cloudflare  an Email Service binding named EMAIL (Workers Paid; sender domain onboarded)
//   console     prints each email to the terminal instead of sending it (local testing only)

import { randomToken } from './crypto.js';

const MAX_ATTEMPTS = 6;
const LEASE_MIN = 10;

export function mailConfig(env = {}) {
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
export function fromHeader(displayName, address) {
  const name = String(displayName || '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/["\\<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
  return name ? `"${name}" <${address}>` : address;
}

export async function enqueue(db, msg, now) {
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
export async function deliverDue(db, env, cfg, now, { limit = 10, fetchImpl = globalThis.fetch, productName = 'Reflow' } = {}) {
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
export async function pruneOutbox(db, now) {
  const cutoff = new Date(now.getTime() - 30 * 86400000).toISOString();
  await db.prepare('DELETE FROM outbox WHERE created_at < ?').bind(cutoff).run();
}
