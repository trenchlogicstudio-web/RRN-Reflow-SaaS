// Copyright (c) 2026 Miloš Petrović (Trench Logic Studio) · SPDX-License-Identifier: MIT
import { writeWithEvent } from './events.js';
import { randomToken } from './crypto.js';
import { localToUtc } from './time.js';
import { notifyCancellation } from './notify.js';
import { requestById } from './repo.js';

export async function recordOutcome(c, salon, request, outcome, actor = 'salon') {
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
