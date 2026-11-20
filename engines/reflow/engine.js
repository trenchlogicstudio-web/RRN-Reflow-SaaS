// Copyright (c) 2026 Miloš Petrović (Trench Logic Studio) · SPDX-License-Identifier: MIT
/*!
 * Reflow engine · v0.1.0 · RRN SaaS
 *
 * Turns "fully booked" into an upgraded booking in a quiet hour,
 * at exactly the standard price.
 *
 * Pure and deterministic: no I/O, no clock, no randomness, zero dependencies.
 * The same file runs unchanged in Node, in browsers and on Cloudflare Workers,
 * so it can be lifted out of the SaaS and licensed on its own.
 *
 * Invariants (each one is also enforced by a CHECK constraint in the database):
 *   I1  An offer's price is exactly the service's standard price. Never a discount.
 *   I2  An offer adds at least MIN_UPLIFT_PCT (30%) of the base service time.
 *   I3  An offer sits inside a quiet-hour window the salon declared, within its capacity.
 */

export const ENGINE = Object.freeze({ name: 'reflow', version: '0.1.0' });

export const MIN_UPLIFT_PCT = 30;

export const DISCOUNT_VIOLATION = 'INVARIANT VIOLATION: non-standard price forbidden';

export const STATUS = Object.freeze({
  UPGRADE_REDIRECT: 'upgrade_redirect',
  WAITLIST_ONLY: 'waitlist_only',
});

export const REASON = Object.freeze({
  SERVICE_UNAVAILABLE: 'service_unavailable',
  NO_UPGRADE_BUNDLE: 'no_upgrade_bundle',
  NO_QUIET_HOURS: 'no_quiet_hours',
  NO_FREE_SLOT: 'no_free_slot',
});

export const DEFAULTS = Object.freeze({
  leadMin: 120, // earliest offer: this many minutes after "now"
  horizonDays: 14, // look this many days ahead, today included
  maxOffers: 3, // at most this many offers, one per day
  gridMin: 30, // candidate start times step from the window start
});

const MAX_POOL = 12; // upgrades considered per service (2^12 subsets at most)
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/* ------------------------------------------------------------------ */
/* Calendar helpers (wall-clock dates, no time zones involved)         */
/* ------------------------------------------------------------------ */

function dateToUTC(date) {
  const m = DATE_RE.exec(String(date));
  if (!m) throw new TypeError(`Reflow engine: invalid date "${date}"`);
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** 'YYYY-MM-DD' + n days → 'YYYY-MM-DD' */
export function addDays(date, n) {
  return new Date(dateToUTC(date) + n * 86400000).toISOString().slice(0, 10);
}

/** ISO weekday of a 'YYYY-MM-DD' date: 1 = Monday … 7 = Sunday */
export function isoWeekday(date) {
  const wd = new Date(dateToUTC(date)).getUTCDay();
  return wd === 0 ? 7 : wd;
}

function isInt(v) {
  return Number.isSafeInteger(v);
}

/* ------------------------------------------------------------------ */
/* Invariants                                                          */
/* ------------------------------------------------------------------ */

/** The salon's uplift setting, never below the canon minimum. */
export function effectiveUpliftPct(pct) {
  const n = Math.floor(Number(pct));
  return Number.isFinite(n) && n > MIN_UPLIFT_PCT ? n : MIN_UPLIFT_PCT;
}

/** Smallest number of extra minutes that satisfies the uplift rule. */
export function requiredAddedMin(baseMin, pct) {
  return Math.ceil((baseMin * effectiveUpliftPct(pct)) / 100);
}

/** I1: the offer price must equal the standard price, exactly. */
export function assertNoDiscount(offer, service) {
  const std = service ? service.price_cents : undefined;
  if (
    !isInt(std) ||
    std < 0 ||
    !offer ||
    offer.price_cents !== std ||
    offer.standard_price_cents !== std
  ) {
    throw new Error(DISCOUNT_VIOLATION);
  }
}

/** I2: the offer must add at least the required share of service time. */
export function assertMinUplift(offer) {
  if (!offer || !isInt(offer.base_min) || offer.base_min <= 0 || !isInt(offer.added_min) || offer.added_min < 0) {
    throw new Error('INVARIANT VIOLATION: offer duration missing');
  }
  if (offer.total_min !== offer.base_min + offer.added_min) {
    throw new Error('INVARIANT VIOLATION: offer duration mismatch');
  }
  const required = isInt(offer.uplift_pct) ? offer.uplift_pct : MIN_UPLIFT_PCT;
  if (required < MIN_UPLIFT_PCT || offer.added_min * 100 < offer.base_min * required) {
    const actual = (offer.added_min * 100) / offer.base_min;
    throw new Error(
      `INVARIANT VIOLATION: uplift ${actual.toFixed(1)}% < required ${Math.max(required, MIN_UPLIFT_PCT)}%`,
    );
  }
}

/** Both invariants that can be checked on a single offer. */
export function assertOffer(offer, service) {
  assertNoDiscount(offer, service);
  assertMinUplift(offer);
}

/* ------------------------------------------------------------------ */
/* Upgrade bundle                                                      */
/* ------------------------------------------------------------------ */

function compareIds(a, b) {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return a.length - b.length;
}

function applies(upgrade, service) {
  return (
    upgrade &&
    upgrade.active !== 0 &&
    isInt(upgrade.id) &&
    isInt(upgrade.added_min) &&
    upgrade.added_min > 0 &&
    (upgrade.service_id == null || upgrade.service_id === service.id)
  );
}

/**
 * The smallest set of salon-defined upgrades that reaches the uplift minimum.
 * Smallest = fewest extra minutes; ties → fewer items; ties → lowest ids.
 * Returns null when no combination reaches the minimum.
 */
export function selectBundle(service, upgrades, upliftPct = MIN_UPLIFT_PCT) {
  if (!service || !isInt(service.duration_min) || service.duration_min <= 0) return null;
  const need = requiredAddedMin(service.duration_min, upliftPct);
  const pool = (upgrades || [])
    .filter((u) => applies(u, service))
    .sort((a, b) => a.added_min - b.added_min || a.id - b.id)
    .slice(0, MAX_POOL);

  let best = null;
  for (let mask = 1; mask < 1 << pool.length; mask++) {
    let sum = 0;
    const items = [];
    for (let i = 0; i < pool.length; i++) {
      if (mask & (1 << i)) {
        sum += pool[i].added_min;
        items.push(pool[i]);
      }
    }
    if (sum < need) continue;
    const ids = items.map((u) => u.id).sort((a, b) => a - b);
    if (
      !best ||
      sum < best.added_min ||
      (sum === best.added_min &&
        (items.length < best.items.length ||
          (items.length === best.items.length && compareIds(ids, best.ids) < 0)))
    ) {
      best = { added_min: sum, items, ids };
    }
  }
  if (!best) return null;
  const items = best.items
    .slice()
    .sort((a, b) => a.id - b.id)
    .map((u) => ({ id: u.id, name: String(u.name), added_min: u.added_min }));
  return { items, added_min: best.added_min, required_min: need };
}

/* ------------------------------------------------------------------ */
/* Offers                                                              */
/* ------------------------------------------------------------------ */

function isValidWindow(w) {
  return (
    w &&
    isInt(w.weekday) &&
    w.weekday >= 1 &&
    w.weekday <= 7 &&
    isInt(w.start_min) &&
    isInt(w.end_min) &&
    w.start_min >= 0 &&
    w.end_min <= 1440 &&
    w.end_min > w.start_min &&
    isInt(w.capacity) &&
    w.capacity >= 1
  );
}

function assertNow(now) {
  if (!now || !DATE_RE.test(String(now.date)) || !isInt(now.min) || now.min < 0 || now.min > 1439) {
    throw new TypeError('Reflow engine: "now" must be { date: "YYYY-MM-DD", min: 0..1439 } in salon local time');
  }
}

function overlapCount(busy, date, start, end) {
  let n = 0;
  for (const b of busy) {
    if (b.slot_date === date && b.start_min < end && b.end_min > start) n += Number.isSafeInteger(b.units) && b.units > 0 ? b.units : 1;
  }
  return n;
}

/** Stable identifier of one offer: date, start minute and the upgrade ids. */
export function offerKey(date, startMin, upgradeIds) {
  return `${date}@${startMin}#${upgradeIds.length ? upgradeIds.join('.') : '0'}`;
}

function makeOffer(service, bundle, pct, date, weekday, start, capacity) {
  const offer = {
    key: offerKey(date, start, bundle.items.map((u) => u.id)),
    service_id: service.id,
    service_name: String(service.name),
    base_min: service.duration_min,
    added_min: bundle.added_min,
    total_min: service.duration_min + bundle.added_min,
    uplift_pct: pct,
    upgrades: bundle.items,
    slot_date: date,
    weekday,
    start_min: start,
    end_min: start + service.duration_min + bundle.added_min,
    capacity,
    standard_price_cents: service.price_cents,
    price_cents: service.price_cents,
  };
  assertOffer(offer, service);
  return offer;
}

/**
 * Compute up to `maxOffers` upgraded offers for one service.
 *
 * input.service   { id, name, duration_min, price_cents, active }
 * input.upgrades  [{ id, name, added_min, active, service_id|null }]
 * input.windows   [{ id, weekday 1..7, start_min, end_min, capacity }]   quiet hours, salon local time
 * input.busy      [{ slot_date, start_min, end_min }]                     requests already holding time
 * input.now       { date: 'YYYY-MM-DD', min }                              salon local time
 *
 * Returns { status, reason, required_added_min, bundle, offers }.
 */
export function computeOffers(input) {
  const {
    service,
    upgrades = [],
    windows = [],
    busy = [],
    now,
    upliftPct = MIN_UPLIFT_PCT,
    leadMin = DEFAULTS.leadMin,
    horizonDays = DEFAULTS.horizonDays,
    maxOffers = DEFAULTS.maxOffers,
    gridMin = DEFAULTS.gridMin,
  } = input || {};
  assertNow(now);

  const pct = effectiveUpliftPct(upliftPct);
  const waitlist = (reason, extra = {}) => ({
    status: STATUS.WAITLIST_ONLY,
    reason,
    required_added_min: null,
    bundle: null,
    offers: [],
    ...extra,
  });

  if (!service || service.active === 0 || !isInt(service.duration_min) || service.duration_min <= 0) {
    return waitlist(REASON.SERVICE_UNAVAILABLE);
  }
  const required = requiredAddedMin(service.duration_min, pct);
  const bundle = selectBundle(service, upgrades, pct);
  if (!bundle) return waitlist(REASON.NO_UPGRADE_BUNDLE, { required_added_min: required });

  const usable = (windows || []).filter(isValidWindow);
  if (!usable.length) return waitlist(REASON.NO_QUIET_HOURS, { required_added_min: required, bundle });

  const total = service.duration_min + bundle.added_min;
  const step = isInt(gridMin) && gridMin > 0 ? gridMin : DEFAULTS.gridMin;
  const earliest = now.min + Math.max(0, isInt(leadMin) ? leadMin : DEFAULTS.leadMin);
  const offers = [];

  for (let d = 0; d < horizonDays && offers.length < maxOffers; d++) {
    const date = addDays(now.date, d);
    const weekday = isoWeekday(date);
    let best = null;
    for (const w of usable) {
      if (w.weekday !== weekday) continue;
      for (let t = w.start_min; t + total <= w.end_min; t += step) {
        if (best && t >= best.start) break;
        if (d * 1440 + t < earliest) continue;
        if (overlapCount(busy, date, t, t + total) < w.capacity) {
          best = { start: t, capacity: w.capacity };
          break;
        }
      }
    }
    if (best) offers.push(makeOffer(service, bundle, pct, date, weekday, best.start, best.capacity));
  }

  if (!offers.length) return waitlist(REASON.NO_FREE_SLOT, { required_added_min: required, bundle });
  return { status: STATUS.UPGRADE_REDIRECT, reason: null, required_added_min: required, bundle, offers };
}

/** The offer with this key in a computeOffers() result, or null. */
export function findOffer(result, key) {
  if (!result || !Array.isArray(result.offers)) return null;
  return result.offers.find((o) => o.key === key) || null;
}

/* ------------------------------------------------------------------ */
/* Self-test: the forbidden path must be refused                       */
/* ------------------------------------------------------------------ */

export function selfTest() {
  const checks = [];
  const check = (name, pass) => checks.push({ name, pass: Boolean(pass) });

  const service = { id: 1, name: 'Cut & finish', duration_min: 45, price_cents: 4000, active: 1 };
  const upgrades = [
    { id: 1, name: 'Scalp massage', added_min: 10, active: 1, service_id: null },
    { id: 2, name: 'Deep conditioning', added_min: 15, active: 1, service_id: null },
  ];
  const windows = [{ id: 1, weekday: 2, start_min: 780, end_min: 960, capacity: 1 }];
  const now = { date: '2026-01-05', min: 540 }; // a Monday, 09:00

  const r = computeOffers({ service, upgrades, windows, busy: [], now });
  check('offer produced', r.status === STATUS.UPGRADE_REDIRECT && r.offers.length > 0);
  check('price equals standard price', r.offers.every((o) => o.price_cents === 4000 && o.standard_price_cents === 4000));
  check('uplift at least 30%', r.offers.every((o) => o.added_min * 100 >= o.base_min * MIN_UPLIFT_PCT));

  let refused = false;
  try {
    assertNoDiscount({ ...r.offers[0], price_cents: 3600 }, service);
  } catch (e) {
    refused = e.message === DISCOUNT_VIOLATION;
  }
  check('forbidden path refused: discount', refused);

  let refusedUplift = false;
  try {
    assertMinUplift({ base_min: 45, added_min: 0, total_min: 45, uplift_pct: 30 });
  } catch (e) {
    refusedUplift = e.message.startsWith('INVARIANT VIOLATION: uplift');
  }
  check('forbidden path refused: no uplift', refusedUplift);

  const full = computeOffers({
    service,
    upgrades,
    windows,
    busy: Array.from({ length: 14 }, (_, i) => ({ slot_date: addDays(now.date, i), start_min: 0, end_min: 1440 })),
    now,
  });
  check('full calendar falls back to waitlist', full.status === STATUS.WAITLIST_ONLY && full.reason === REASON.NO_FREE_SLOT);

  return { engine: ENGINE.name, version: ENGINE.version, ok: checks.every((c) => c.pass), checks };
}
