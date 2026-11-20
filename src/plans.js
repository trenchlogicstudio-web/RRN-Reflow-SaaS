// Copyright (c) 2026 Miloš Petrović (Trench Logic Studio) · SPDX-License-Identifier: MIT
// Subscription tiers. One product, one login; each tier switches on its own
// engine module. Only Reflow is live so far; the others collect interest.

import { tk } from './i18n/index.js';
import { ENGINE as REFLOW } from '../engines/reflow/engine.js';
import { ENGINE as RELAY } from '../engines/relay/engine.js';
import { ENGINE as NEXUS } from '../engines/nexus/engine.js';

export const PLANS = [
  {
    id: 'reflow',
    name: 'Reflow',
    engine: REFLOW,
    status: 'active',
    scope: tk('One location'),
    pitch: tk('When a client finds you fully booked, offer an upgraded appointment in a quieter hour, at exactly the same price.'),
    features: [tk('Your own request page to share anywhere'), tk('Upgrades you define, at least +30% more time'), tk('Never a discount, enforced by the system'), tk('You confirm every request yourself')],
    price: tk('Free during beta'),
  },
  {
    id: 'relay',
    name: 'Relay',
    engine: RELAY,
    status: 'coming',
    scope: tk('Several locations'),
    pitch: tk('When one location is full, route the client to your location or sister brand that has room, at the same price.'),
    features: [tk('Everything in Reflow'), tk('Overflow routed between your locations'), tk('One view across all locations')],
    price: tk('Opens with the first multi-location salon'),
  },
  {
    id: 'nexus',
    name: 'Nexus',
    engine: NEXUS,
    status: 'coming',
    scope: tk('Partner network'),
    pitch: tk('Share overflow with trusted partner businesses. Priority is earned through reliability, never bought.'),
    features: [tk('Everything in Relay'), tk('Overflow shared with partner businesses'), tk('Trust-based priority')],
    price: tk('Later'),
  },
];

export const planById = (id) => PLANS.find((p) => p.id === id) || PLANS[0];
