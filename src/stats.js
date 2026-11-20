// Copyright (c) 2026 Miloš Petrović (Trench Logic Studio) · SPDX-License-Identifier: MIT
// Privacy-friendly results: one counter per salon, day and step. No cookies,
// no IP addresses, no per-visitor records. Link previews and bots are not counted.

export const FUNNEL = ['view', 'offers', 'noslot', 'request', 'waitlist', 'confirmed'];

const BOT_RE = /bot|crawl|spider|slurp|preview|facebookexternalhit|whatsapp|telegram|discord|skype|slack|headless|lighthouse|curl|wget|python|java\/|go-http|monitor|uptime|pingdom/i;

export function isBot(userAgent) {
  return !userAgent || BOT_RE.test(userAgent);
}

export async function bump(db, salonId, metric, day) {
  await db
    .prepare('INSERT INTO stats_daily (salon_id, day, metric, n) VALUES (?, ?, ?, 1) ON CONFLICT(salon_id, day, metric) DO UPDATE SET n = n + 1')
    .bind(salonId, day, metric)
    .run();
}

export async function seed(db, salonId, day, metric, n) {
  await db
    .prepare('INSERT INTO stats_daily (salon_id, day, metric, n) VALUES (?, ?, ?, ?) ON CONFLICT(salon_id, day, metric) DO UPDATE SET n = excluded.n')
    .bind(salonId, day, metric, n)
    .run();
}

/** Totals per step since `fromDay` (inclusive), for one salon or for all (salonId null). */
export async function funnel(db, salonId, fromDay) {
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
