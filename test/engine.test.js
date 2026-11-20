// Copyright (c) 2026 Miloš Petrović (Trench Logic Studio) · SPDX-License-Identifier: MIT
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MIN_UPLIFT_PCT,
  DISCOUNT_VIOLATION,
  STATUS,
  REASON,
  addDays,
  isoWeekday,
  effectiveUpliftPct,
  requiredAddedMin,
  selectBundle,
  computeOffers,
  findOffer,
  assertNoDiscount,
  assertMinUplift,
  selfTest,
} from '../engines/reflow/engine.js';

const MON = '2026-11-02'; // a Monday
const svc = (over = {}) => ({ id: 1, name: 'Cut & finish', duration_min: 45, price_cents: 4000, active: 1, ...over });
const up = (id, added_min, over = {}) => ({ id, name: `Upgrade ${id}`, added_min, active: 1, service_id: null, ...over });
const win = (weekday, start, end, capacity = 1, id = weekday * 100 + start) => ({ id, weekday, start_min: start, end_min: end, capacity });
const H = (h, m = 0) => h * 60 + m;

test('calendar helpers: weekdays and day arithmetic across boundaries', () => {
  assert.equal(isoWeekday(MON), 1);
  assert.equal(isoWeekday('2026-11-08'), 7);
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2028-02-28', 1), '2028-02-29');
  assert.equal(addDays('2028-02-29', 1), '2028-03-01');
  assert.equal(addDays('2026-03-29', 1), '2026-03-30'); // EU DST change day is irrelevant to wall-clock dates
  assert.throws(() => isoWeekday('02.11.2026'), TypeError);
});

test('uplift minimum is 30% and can be raised but never lowered', () => {
  assert.equal(MIN_UPLIFT_PCT, 30);
  assert.equal(effectiveUpliftPct(10), 30);
  assert.equal(effectiveUpliftPct('abc'), 30);
  assert.equal(effectiveUpliftPct(45), 45);
  assert.equal(requiredAddedMin(45, 30), 14); // 13.5 rounds up
  assert.equal(requiredAddedMin(50, 30), 15);
  assert.equal(requiredAddedMin(60, 40), 24);
  assert.equal(requiredAddedMin(60, 5), 18); // a lower setting is ignored
});

test('bundle: fewest extra minutes, then fewest items, then lowest ids', () => {
  const s = svc();
  // need 14 min: {15} beats {10,5}=15 on item count; {10,5} beats nothing smaller
  let b = selectBundle(s, [up(1, 10), up(2, 5), up(3, 15)], 30);
  assert.deepEqual(b.items.map((u) => u.id), [3]);
  assert.equal(b.added_min, 15);
  // exact 14 via two items beats a single 15
  b = selectBundle(s, [up(1, 9), up(2, 5), up(3, 15)], 30);
  assert.deepEqual(b.items.map((u) => u.id), [1, 2]);
  assert.equal(b.added_min, 14);
  // tie on minutes and items → lowest ids
  b = selectBundle(s, [up(7, 15), up(4, 15)], 30);
  assert.deepEqual(b.items.map((u) => u.id), [4]);
  // cannot reach the minimum → null
  assert.equal(selectBundle(s, [up(1, 5), up(2, 5)], 30), null);
});

test('bundle: inactive upgrades and upgrades for other services are ignored', () => {
  const s = svc({ id: 9 });
  const b = selectBundle(s, [up(1, 20, { active: 0 }), up(2, 20, { service_id: 3 }), up(3, 20, { service_id: 9 })], 30);
  assert.deepEqual(b.items.map((u) => u.id), [3]);
  assert.equal(selectBundle(s, [up(1, 20, { active: 0 }), up(2, 20, { service_id: 3 })], 30), null);
});

test('bundle: exact 30% boundary passes, one minute less fails', () => {
  const s = svc({ duration_min: 50 });
  assert.equal(selectBundle(s, [up(1, 15)], 30).added_min, 15);
  assert.equal(selectBundle(s, [up(1, 14)], 30), null);
});

test('offers: same price, +30% time, one per day, earliest first, at most three', () => {
  const r = computeOffers({
    service: svc(),
    upgrades: [up(1, 15)],
    windows: [win(2, H(13), H(16)), win(3, H(10), H(12)), win(4, H(14), H(17)), win(5, H(9), H(11))],
    now: { date: MON, min: H(9) },
  });
  assert.equal(r.status, STATUS.UPGRADE_REDIRECT);
  assert.equal(r.offers.length, 3);
  assert.deepEqual(
    r.offers.map((o) => [o.slot_date, o.start_min]),
    [
      ['2026-11-03', H(13)],
      ['2026-11-04', H(10)],
      ['2026-11-05', H(14)],
    ],
  );
  for (const o of r.offers) {
    assert.equal(o.price_cents, 4000);
    assert.equal(o.standard_price_cents, 4000);
    assert.equal(o.total_min, 60);
    assert.ok(o.added_min * 100 >= o.base_min * 30);
    assert.equal(o.end_min, o.start_min + 60);
  }
  assert.equal(new Set(r.offers.map((o) => o.key)).size, 3);
});

test('offers: minimum notice is respected, including across midnight', () => {
  const base = { service: svc(), upgrades: [up(1, 15)] };
  let r = computeOffers({ ...base, windows: [win(1, H(13), H(16))], now: { date: MON, min: H(12) }, leadMin: 120 });
  assert.equal(r.offers[0].slot_date, MON);
  assert.equal(r.offers[0].start_min, H(14)); // 13:00 and 13:30 are too soon
  r = computeOffers({ ...base, windows: [win(2, H(0, 30), H(4))], now: { date: MON, min: H(23) }, leadMin: 120 });
  assert.equal(r.offers[0].slot_date, '2026-11-03');
  assert.equal(r.offers[0].start_min, H(1)); // 00:30 is inside the notice period
});

test('offers: capacity counts overlapping requests only', () => {
  const base = { service: svc(), upgrades: [up(1, 15)], now: { date: MON, min: H(8) }, horizonDays: 1 };
  const windows = [win(1, H(13), H(16), 2)];
  const at13 = { slot_date: MON, start_min: H(13), end_min: H(14) };
  let r = computeOffers({ ...base, windows, busy: [at13] });
  assert.equal(r.offers[0].start_min, H(13)); // one of two chairs still free
  r = computeOffers({ ...base, windows, busy: [at13, at13] });
  assert.equal(r.offers[0].start_min, H(14)); // 13:00 and 13:30 overlap both bookings
  r = computeOffers({ ...base, windows: [win(1, H(13), H(16), 1)], busy: [{ slot_date: MON, start_min: H(12), end_min: H(13) }] });
  assert.equal(r.offers[0].start_min, H(13)); // touching is not overlapping
  r = computeOffers({ ...base, windows: [win(1, H(13), H(16), 1)], busy: [{ slot_date: '2026-11-03', start_min: H(13), end_min: H(14) }] });
  assert.equal(r.offers[0].start_min, H(13)); // other days do not count
});

test('offers: overlapping windows yield the earliest free start', () => {
  const r = computeOffers({
    service: svc(),
    upgrades: [up(1, 15)],
    windows: [win(1, H(9), H(12), 1, 1), win(1, H(8), H(10), 1, 2)],
    now: { date: MON, min: H(6) },
    horizonDays: 1,
  });
  assert.equal(r.offers[0].start_min, H(8));
});

test('waitlist reasons: no bundle, no quiet hours, no free slot, service unavailable', () => {
  const now = { date: MON, min: H(9) };
  let r = computeOffers({ service: svc(), upgrades: [up(1, 5)], windows: [win(2, H(13), H(16))], now });
  assert.equal(r.status, STATUS.WAITLIST_ONLY);
  assert.equal(r.reason, REASON.NO_UPGRADE_BUNDLE);
  assert.equal(r.required_added_min, 14);
  r = computeOffers({ service: svc(), upgrades: [up(1, 15)], windows: [], now });
  assert.equal(r.reason, REASON.NO_QUIET_HOURS);
  r = computeOffers({ service: svc(), upgrades: [up(1, 15)], windows: [win(2, H(13), H(13, 45))], now });
  assert.equal(r.reason, REASON.NO_FREE_SLOT); // a 60-minute offer does not fit a 45-minute window
  r = computeOffers({ service: svc({ active: 0 }), upgrades: [up(1, 15)], windows: [win(2, H(13), H(16))], now });
  assert.equal(r.reason, REASON.SERVICE_UNAVAILABLE);
  assert.deepEqual(r.offers, []);
});

test('invalid windows are ignored and "now" is validated', () => {
  const r = computeOffers({
    service: svc(),
    upgrades: [up(1, 15)],
    windows: [win(9, H(13), H(16)), { weekday: 2, start_min: H(16), end_min: H(13), capacity: 1 }, win(2, H(13), H(16), 0)],
    now: { date: MON, min: H(9) },
  });
  assert.equal(r.reason, REASON.NO_QUIET_HOURS);
  assert.throws(() => computeOffers({ service: svc(), now: { date: MON, min: 1440 } }), TypeError);
  assert.throws(() => computeOffers({ service: svc(), now: null }), TypeError);
});

test('deterministic: identical input gives identical output', () => {
  const input = {
    service: svc(),
    upgrades: [up(3, 10), up(1, 5), up(2, 5)],
    windows: [win(2, H(13), H(16)), win(4, H(10), H(12), 3)],
    busy: [{ slot_date: '2026-11-03', start_min: H(13), end_min: H(14) }],
    now: { date: MON, min: H(9) },
  };
  assert.deepEqual(computeOffers(input), computeOffers(structuredClone(input)));
  assert.equal(findOffer(computeOffers(input), computeOffers(input).offers[0].key).key, computeOffers(input).offers[0].key);
  assert.equal(findOffer(computeOffers(input), 'nope'), null);
});

test('forbidden path: any price other than the standard price is refused', () => {
  const s = svc();
  const [o] = computeOffers({ service: s, upgrades: [up(1, 15)], windows: [win(2, H(13), H(16))], now: { date: MON, min: H(9) } }).offers;
  assert.doesNotThrow(() => assertNoDiscount(o, s));
  assert.throws(() => assertNoDiscount({ ...o, price_cents: 3600 }, s), { message: DISCOUNT_VIOLATION });
  assert.throws(() => assertNoDiscount({ ...o, price_cents: 4400 }, s), { message: DISCOUNT_VIOLATION });
  assert.throws(() => assertNoDiscount({ ...o, standard_price_cents: 3600, price_cents: 3600 }, s), { message: DISCOUNT_VIOLATION });
  assert.throws(() => assertNoDiscount({ ...o, price_cents: '4000' }, s), { message: DISCOUNT_VIOLATION });
  assert.throws(() => assertNoDiscount(o, { ...s, price_cents: 4000.5 }), { message: DISCOUNT_VIOLATION });
  assert.equal(DISCOUNT_VIOLATION, 'INVARIANT VIOLATION: non-standard price forbidden');
});

test('forbidden path: an upgrade below the minimum is refused', () => {
  assert.throws(() => assertMinUplift({ base_min: 45, added_min: 10, total_min: 55, uplift_pct: 30 }), {
    message: 'INVARIANT VIOLATION: uplift 22.2% < required 30%',
  });
  assert.throws(() => assertMinUplift({ base_min: 45, added_min: 15, total_min: 60, uplift_pct: 10 }), /required 30%/);
  assert.throws(() => assertMinUplift({ base_min: 45, added_min: 15, total_min: 45, uplift_pct: 30 }), /duration mismatch/);
  assert.doesNotThrow(() => assertMinUplift({ base_min: 45, added_min: 14, total_min: 59, uplift_pct: 30 }));
});

test('self-test passes', () => {
  const r = selfTest();
  assert.equal(r.ok, true, JSON.stringify(r.checks));
  assert.ok(r.checks.length >= 5);
});
