// Copyright (c) 2026 Miloš Petrović (Trench Logic Studio) · SPDX-License-Identifier: MIT
// Starting points for common salon types. Names are English source strings,
// saved in the owner's language when a template is applied. Prices are always
// the owner's own: the setup form asks for them.

import { tk } from './i18n/index.js';

export const TEMPLATES = [
  {
    id: 'hair',
    label: tk('Hair salon'),
    services: [
      [tk('Cut & finish'), 45],
      [tk('Blow-dry & style'), 40],
      [tk('Colour refresh'), 90],
      [tk('Highlights'), 120],
    ],
    upgrades: [
      [tk('Deep conditioning treatment'), 15],
      [tk('Scalp massage'), 10],
      [tk('Gloss treatment'), 20],
      [tk('Extended styling'), 15],
    ],
    demoPrices: [4000, 3500, 8500, 14000],
  },
  {
    id: 'barber',
    label: tk('Barbershop'),
    services: [
      [tk('Haircut'), 30],
      [tk('Beard trim'), 20],
      [tk('Haircut & beard'), 45],
      [tk('Hot towel shave'), 30],
    ],
    upgrades: [
      [tk('Hot towel treatment'), 10],
      [tk('Beard oil treatment'), 5],
      [tk('Scalp massage'), 10],
      [tk('Face mask'), 15],
    ],
    demoPrices: [2500, 1500, 3500, 3000],
  },
  {
    id: 'nails',
    label: tk('Nail studio'),
    services: [
      [tk('Gel manicure'), 50],
      [tk('Classic manicure'), 35],
      [tk('Pedicure'), 50],
      [tk('Gel pedicure'), 60],
    ],
    upgrades: [
      [tk('Hand massage'), 10],
      [tk('Paraffin treatment'), 15],
      [tk('Cuticle care'), 10],
      [tk('Nail art accent'), 10],
    ],
    demoPrices: [3500, 2500, 4000, 5000],
  },
  {
    id: 'beauty',
    label: tk('Beauty & spa'),
    services: [
      [tk('Classic facial'), 50],
      [tk('Relaxing massage'), 50],
      [tk('Brow & lash tint'), 30],
      [tk('Waxing'), 30],
    ],
    upgrades: [
      [tk('Face mask'), 15],
      [tk('Hand massage'), 10],
      [tk('Eye treatment'), 10],
      [tk('Extended massage'), 15],
    ],
    demoPrices: [6000, 6500, 3000, 3500],
  },
];

export const templateById = (id) => TEMPLATES.find((tpl) => tpl.id === id) || null;

/** Quiet hours most salons have: early afternoons, Tuesday to Thursday, one free chair. */
export const DEFAULT_HOURS = { weekdays: [2, 3, 4], start: 13 * 60, end: 16 * 60, capacity: 1 };
