// Copyright (c) 2026 Miloš Petrović (Trench Logic Studio) · SPDX-License-Identifier: MIT
// Data access. Every query that touches salon data is scoped by salon_id.

export const SALON_COLUMNS = `id, slug, name, timezone, currency, plan, min_uplift_pct, lead_min, created_at, locale, address, phone,
  calendar_token, is_demo, demo_expires_at, billing_status, trial_ends_at, billing_provider, billing_customer_id,
  billing_subscription_id, billing_portal_url, billing_period_end, billing_event_at, billing_event_rank, cancel_notice_min, hold_hours`;

export async function salonBySlug(db, slug) {
  return db.prepare(`SELECT ${SALON_COLUMNS} FROM salons WHERE slug = ?`).bind(slug).first();
}

export async function salonById(db, id) {
  return db.prepare(`SELECT ${SALON_COLUMNS} FROM salons WHERE id = ?`).bind(id).first();
}

export async function listServices(db, salonId, { activeOnly = false } = {}) {
  const sql = `SELECT id, name, duration_min, price_cents, active FROM services
                WHERE salon_id = ? ${activeOnly ? 'AND active = 1' : ''}
                ORDER BY active DESC, name COLLATE NOCASE, id`;
  return (await db.prepare(sql).bind(salonId).all()).results;
}

export async function getService(db, salonId, id) {
  return db
    .prepare('SELECT id, name, duration_min, price_cents, active FROM services WHERE salon_id = ? AND id = ?')
    .bind(salonId, id)
    .first();
}

export async function listUpgrades(db, salonId) {
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

export async function listWindows(db, salonId) {
  return (
    await db
      .prepare('SELECT id, weekday, start_min, end_min, capacity FROM windows WHERE salon_id = ? ORDER BY weekday, start_min, id')
      .bind(salonId)
      .all()
  ).results;
}

/** Offers that already hold time: pending ones count too, so two clients are not offered the last chair. */
export async function busySlots(db, salonId, fromDate, toDate, excludeId = 0) {
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

export async function setupCounts(db, salonId) {
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

export async function metrics(db, salonId) {
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

export async function requestsWhere(db, salonId, where, params = [], { order = 'id DESC', limit = 100, offset = 0 } = {}) {
  return (
    await db
      .prepare(`SELECT ${REQUEST_COLUMNS} FROM requests WHERE salon_id = ? AND ${where} ORDER BY ${order} LIMIT ${Math.max(1, Math.min(100000, Number(limit) || 100))} OFFSET ${Math.max(0, Math.min(100000, Number(offset) || 0))}`)
      .bind(salonId, ...params)
      .all()
  ).results;
}

export async function requestById(db, salonId, id) {
  return db.prepare(`SELECT ${REQUEST_COLUMNS} FROM requests WHERE salon_id = ? AND id = ?`).bind(salonId, id).first();
}

export async function requestByToken(db, token) {
  return db.prepare(`SELECT ${REQUEST_COLUMNS} FROM requests WHERE token = ?`).bind(token).first();
}

export function parseUpgrades(json) {
  try {
    const list = JSON.parse(json);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}
