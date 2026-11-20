// Copyright (c) 2026 Miloš Petrović (Trench Logic Studio) · SPDX-License-Identifier: MIT
// Wall-clock time in the salon's own time zone. The engine works on local dates
// and minutes only, so daylight-saving changes never shift an offered slot.

import { addDays, isoWeekday } from '../engines/reflow/engine.js';

export { addDays, isoWeekday };

const formatters = new Map();

function formatterFor(timeZone) {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

/** Current local date and minute of day in a time zone: { date: 'YYYY-MM-DD', min }. */
export function localNow(timeZone, at = new Date()) {
  const parts = {};
  for (const p of formatterFor(timeZone).formatToParts(at)) parts[p.type] = p.value;
  const hour = Number(parts.hour) % 24;
  return { date: `${parts.year}-${parts.month}-${parts.day}`, min: hour * 60 + Number(parts.minute) };
}

export function isValidTimeZone(tz) {
  if (typeof tz !== 'string' || !tz || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function timeZones() {
  try {
    return Intl.supportedValuesOf('timeZone');
  } catch {
    return ['UTC', 'Europe/London', 'Europe/Berlin', 'Europe/Paris', 'America/New_York'];
  }
}

/** 810 → '13:30' */
export function fmtTime(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** '13:30' → 810 · '24:00' → 1440 · anything else → null */
export function parseTime(value) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(value || '').trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (min > 59) return null;
  if (h === 24 && min === 0) return 1440;
  if (h > 23) return null;
  return h * 60 + min;
}

export function epochSeconds(at = new Date()) {
  return Math.floor(at.getTime() / 1000);
}

/** Minutes the time zone is ahead of UTC at a given instant. */
function offsetMinutes(timeZone, at) {
  const { date, min } = localNow(timeZone, at);
  const [y, m, d] = date.split('-').map(Number);
  const wallAsUtc = Date.UTC(y, m - 1, d, Math.floor(min / 60), min % 60);
  return Math.round((wallAsUtc - Math.floor(at.getTime() / 60000) * 60000) / 60000);
}

/** Salon wall-clock time ('YYYY-MM-DD', minutes) → the real instant, correct across daylight-saving changes. */
export function localToUtc(date, min, timeZone) {
  const [y, m, d] = date.split('-').map(Number);
  const wall = Date.UTC(y, m - 1, d, Math.floor(min / 60), min % 60);
  let instant = wall - offsetMinutes(timeZone, new Date(wall)) * 60000;
  instant = wall - offsetMinutes(timeZone, new Date(instant)) * 60000;
  return new Date(instant);
}
