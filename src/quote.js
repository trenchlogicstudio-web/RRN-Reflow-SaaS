// Copyright (c) 2026 Miloš Petrović (Trench Logic Studio) · SPDX-License-Identifier: MIT
// What the client was shown travels with the choice. The engine's key names the
// time and the upgrades; the quote adds the price and the total duration. A
// request sent from a page that has since changed (the salon edited the price or
// the length of the service) is then refused and the client sees the current
// offers, instead of being stored at terms the client never saw.

import { findOffer } from '../engines/reflow/engine.js';

/** The value of the radio button for one offer: engine key, price, total minutes. */
export function quotedKey(offer) {
  return `${offer.key}~${offer.price_cents}.${offer.total_min}`;
}

/** The current offer that matches a submitted value in time, upgrades, price and duration; otherwise null. */
export function findQuotedOffer(result, value) {
  const text = typeof value === 'string' ? value : '';
  const cut = text.lastIndexOf('~');
  if (cut < 0) return null;
  const offer = findOffer(result, text.slice(0, cut));
  return offer && quotedKey(offer) === text ? offer : null;
}
