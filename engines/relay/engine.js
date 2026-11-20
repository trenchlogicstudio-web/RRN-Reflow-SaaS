// Copyright (c) 2026 Miloš Petrović (Trench Logic Studio) · SPDX-License-Identifier: MIT
/*!
 * Relay engine · placeholder
 *
 * Relay routes overflow from one location to another location (or sister brand)
 * that has room, at the same price. It switches on when the first multi-location
 * customer joins; until then the SaaS shows Relay as "coming".
 *
 * Kept as its own module so it can be built, tested and licensed separately.
 */
export const ENGINE = Object.freeze({ name: 'relay', version: '0.0.0', status: 'planned' });
