// Copyright (c) 2026 Miloš Petrović (Trench Logic Studio) · SPDX-License-Identifier: MIT
// Housekeeping: expire requests whose time has passed, erase client details
// after the retention period, and drop stale sessions, links and counters.
// Runs per salon when its pages load, and for everyone on the daily schedule.

import { RETENTION_DAYS } from './config.js';
import { localNow, localToUtc, addDays, epochSeconds } from './time.js';
import { pruneOutbox, deliverDue } from './mail.js';
import { notifyReminder } from './notify.js';

/** Pending offers whose start time has passed, and waitlist entries older than 30 days, expire. */
export async function expireForSalon(db, salon, now) {
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
export async function erasePersonalData(db, now, salonId = null) {
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

export async function dailyMaintenance(db, now = new Date(), { env = {}, mail = null, fetchImpl = globalThis.fetch, productName = 'Reflow' } = {}) {
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
