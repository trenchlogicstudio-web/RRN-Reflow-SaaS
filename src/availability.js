// Copyright (c) 2026 Miloš Petrović (Trench Logic Studio) · SPDX-License-Identifier: MIT
import { isoWeekday, localToUtc, localNow } from './time.js';

/** One SQL predicate used by creation, confirmation and rescheduling. No read/write race. */
export function availabilityGuard(salonId, slot, now, excludeId = 0, confirmedOnly = false) {
  return {
    sql: `COALESCE((SELECT MAX(capacity) FROM windows WHERE salon_id = ? AND weekday = ? AND start_min <= ? AND end_min >= ?), 0)
      > (SELECT COUNT(*) FROM requests WHERE salon_id = ? AND kind = 'offer' AND ${confirmedOnly ? "status = 'confirmed'" : "status IN ('pending', 'confirmed')"}
        AND id <> ? AND slot_date = ? AND start_min < ? AND end_min > ?
        AND (status = 'confirmed' OR hold_expires_at IS NULL OR hold_expires_at > ?))
      + COALESCE((SELECT SUM(capacity) FROM time_blocks WHERE salon_id = ? AND slot_date = ? AND start_min < ? AND end_min > ?), 0)`,
    params: [salonId, isoWeekday(slot.slot_date), slot.start_min, slot.end_min, salonId, excludeId, slot.slot_date, slot.end_min, slot.start_min,
      now.toISOString(), salonId, slot.slot_date, slot.end_min, slot.start_min],
  };
}

/** Do not offer nonexistent times or appointments crossing a daylight-saving transition. */
export function validSlotInstant(slot, timezone) {
  const start = localToUtc(slot.slot_date, slot.start_min, timezone);
  const end = localToUtc(slot.slot_date, slot.end_min, timezone);
  const roundtrip = localNow(timezone, start);
  return roundtrip.date === slot.slot_date && roundtrip.min === slot.start_min &&
    end.getTime() - start.getTime() === (slot.end_min - slot.start_min) * 60000;
}

export function canClientCancel(request, salon, now) {
  if (request.outcome || !['pending', 'confirmed'].includes(request.status)) return false;
  if (request.status === 'pending') return true;
  return localToUtc(request.slot_date, request.start_min, salon.timezone).getTime() - now.getTime() >= salon.cancel_notice_min * 60000;
}
