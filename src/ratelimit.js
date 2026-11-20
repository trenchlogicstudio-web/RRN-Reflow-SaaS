// Copyright (c) 2026 Miloš Petrović (Trench Logic Studio) · SPDX-License-Identifier: MIT
// Fixed-window rate limits kept in the database (no extra Cloudflare product
// needed). Keys hold a hash of the IP address, never the address itself.

import { sha256Hex } from './crypto.js';

export async function limiterKey(scope, value) {
  return `${scope}:${(await sha256Hex(`rrn-rl|${String(value || 'unknown').toLowerCase()}`)).slice(0, 32)}`;
}

/** Count one hit; returns true while the key is within its limit. */
export async function hit(db, key, limit, windowSec, nowSec) {
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
export async function check(db, key, limit, windowSec, nowSec) {
  const row = await db.prepare('SELECT count, window_start FROM rate_limits WHERE key = ?').bind(key).first();
  if (!row || row.window_start <= nowSec - windowSec) return true;
  return Number(row.count) < limit;
}

export async function clear(db, key) {
  await db.prepare('DELETE FROM rate_limits WHERE key = ?').bind(key).run();
}
