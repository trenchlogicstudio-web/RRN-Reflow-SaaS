// Copyright (c) 2026 Miloš Petrović (Trench Logic Studio) · SPDX-License-Identifier: MIT
// Tamper-evident audit log. Every event carries the hash of the one before it
// (per salon), so editing or deleting any past event breaks the chain at that
// point. UNIQUE(salon_id, prev_hash) makes a fork impossible: two writers that
// raced on the same parent cannot both commit, and the loser retries.
//
// Payloads never hold personal data, so erasing a client's details after the
// retention period never touches the chain.

import { sha256Hex } from './crypto.js';

export const GENESIS = '0'.repeat(64);

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
export async function writeWithEvent(db, salonId, type, payload, statements = () => [], { condition = null, conditionParams = [], at = () => new Date() } = {}) {
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

export async function appendEvent(db, salonId, type, payload, opts) {
  return writeWithEvent(db, salonId, type, payload, () => [], opts);
}

/** Walk a salon's chain from the start and recompute every hash. */
export async function verifyChain(db, salonId) {
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
