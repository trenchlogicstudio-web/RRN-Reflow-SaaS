// Copyright (c) 2026 Miloš Petrović (Trench Logic Studio) · SPDX-License-Identifier: MIT
// iCalendar (RFC 5545) output: a salon's subscribable feed of confirmed
// appointments, and a single-event file a client can add to their calendar.
// Times are written in UTC, so every calendar app places them correctly.

const enc = new TextEncoder();

export function icsText(value) {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/** Fold a content line at 75 octets without splitting a UTF-8 character. */
function fold(line) {
  if (enc.encode(line).length <= 75) return line;
  const parts = [];
  let current = '';
  let bytes = 0;
  let limit = 75;
  for (const ch of line) {
    const size = enc.encode(ch).length;
    if (bytes + size > limit) {
      parts.push(current);
      current = '';
      bytes = 0;
      limit = 74; // continuation lines start with a space
    }
    current += ch;
    bytes += size;
  }
  parts.push(current);
  return parts.join('\r\n ');
}

export function icsStamp(date) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/**
 * calendar({ name, events: [{ uid, start: Date, end: Date, summary, description, location }], now })
 */
export function calendar({ name, events, now = new Date() }) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//RRN SaaS//Reflow//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${icsText(name)}`,
  ];
  for (const e of events) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${icsText(e.uid)}`,
      `DTSTAMP:${icsStamp(now)}`,
      `DTSTART:${icsStamp(e.start)}`,
      `DTEND:${icsStamp(e.end)}`,
      `SUMMARY:${icsText(e.summary)}`,
    );
    if (e.description) lines.push(`DESCRIPTION:${icsText(e.description)}`);
    if (e.location) lines.push(`LOCATION:${icsText(e.location)}`);
    lines.push('STATUS:CONFIRMED', 'TRANSP:OPAQUE', 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
