// Copyright (c) 2026 Miloš Petrović (Trench Logic Studio) · SPDX-License-Identifier: MIT
// "Try the live demo": a private sample salon for one visitor, with services,
// upgrades, quiet hours, a few client requests and matching results. It is
// marked as a demo (no emails, no billing) and deleted after 24 hours.

import { randomToken, shortRef } from './crypto.js';
import { appendEvent } from './events.js';
import { localNow, fmtTime } from './time.js';
import { seed } from './stats.js';
import { computeOffers } from '../engines/reflow/engine.js';
import { TEMPLATES } from './templates.js';
import { CONSENT_VERSION } from './config.js';

const CLIENTS = [
  ['Nora Hale', '+44 7700 900123'],
  ['Lena Brandt', 'lena.brandt@example.com'],
  ['Tom Fischer', '+49 151 23456789'],
  ['Ines Duarte', 'ines.duarte@example.com'],
];

export async function createDemoSalon(db, { t, now, timezone }) {
  const template = TEMPLATES[0];
  const stamp = now.toISOString();
  const currency = timezone.startsWith('America/') ? 'USD' : 'EUR';
  let slug = '';
  for (let i = 0; i < 5 && !slug; i++) {
    const candidate = `demo-${randomToken(9).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8)}`;
    if (candidate.length >= 10 && !(await db.prepare('SELECT 1 AS x FROM salons WHERE slug = ?').bind(candidate).first())) slug = candidate;
  }
  if (!slug) throw new Error('Could not create a demo salon');

  const salonRow = await db
    .prepare(
      `INSERT INTO salons (slug, name, timezone, currency, created_at, locale, address, phone, is_demo, demo_expires_at, billing_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 'beta') RETURNING id`,
    )
    .bind(slug, 'Studio Lumen', timezone, currency, stamp, t.locale, t('12 Example Street'), '+44 20 7946 0000', new Date(now.getTime() + 86400000).toISOString())
    .first();
  const salonId = salonRow.id;
  const user = await db
    .prepare('INSERT INTO users (salon_id, email, pass_hash, pass_salt, pass_iter, created_at, locale) VALUES (?, ?, ?, ?, 10000, ?, ?) RETURNING id')
    .bind(salonId, `${slug}@demo.invalid`, randomToken(32), randomToken(16), stamp, t.locale)
    .first();
  await appendEvent(db, salonId, 'salon.created', { slug, timezone, currency }, { at: () => now });

  const statements = [];
  template.services.forEach(([name, minutes], i) => {
    statements.push(
      db.prepare('INSERT INTO services (salon_id, name, duration_min, price_cents, created_at) VALUES (?, ?, ?, ?, ?)').bind(salonId, t(name), minutes, template.demoPrices[i], stamp),
    );
  });
  template.upgrades.forEach(([name, minutes]) => {
    statements.push(db.prepare('INSERT INTO upgrades (salon_id, service_id, name, added_min, created_at) VALUES (?, NULL, ?, ?, ?)').bind(salonId, t(name), minutes, stamp));
  });
  for (const [weekday, start, end, capacity] of [
    [1, 600, 720, 1],
    [2, 780, 990, 2],
    [3, 780, 990, 2],
    [4, 780, 990, 2],
    [5, 600, 720, 1],
  ]) {
    statements.push(
      db.prepare('INSERT INTO windows (salon_id, weekday, start_min, end_min, capacity, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(salonId, weekday, start, end, capacity, stamp),
    );
  }
  await db.batch(statements);
  await appendEvent(db, salonId, 'setup.applied', { template: template.id, services: template.services.length, upgrades: template.upgrades.length }, { at: () => now });

  // Sample client requests, made by the engine itself so they follow every rule.
  const services = (await db.prepare('SELECT id, name, duration_min, price_cents, active FROM services WHERE salon_id = ? ORDER BY id').bind(salonId).all()).results;
  const upgrades = (await db.prepare('SELECT id, name, added_min, active, service_id FROM upgrades WHERE salon_id = ? ORDER BY id').bind(salonId).all()).results;
  const windows = (await db.prepare('SELECT id, weekday, start_min, end_min, capacity FROM windows WHERE salon_id = ?').bind(salonId).all()).results;
  const local = localNow(timezone, now);
  const busy = [];
  const plan = [
    [0, 0, 'confirmed'],
    [0, 1, 'pending'],
    [2, 0, 'pending'],
  ];
  for (let i = 0; i < plan.length; i++) {
    const [serviceIndex, offerIndex, status] = plan[i];
    const result = computeOffers({ service: services[serviceIndex], upgrades, windows, busy, now: local, leadMin: 120 });
    const offer = result.offers[offerIndex] || result.offers[0];
    if (!offer) continue;
    busy.push({ slot_date: offer.slot_date, start_min: offer.start_min, end_min: offer.end_min });
    const ref = shortRef();
    const [name, contact] = CLIENTS[i];
    await db
      .prepare(
        `INSERT INTO requests (salon_id, token, ref, kind, status, service_id, service_name, base_min, added_min, total_min, uplift_pct,
           upgrades_json, standard_price_cents, price_cents, currency, slot_date, start_min, end_min, capacity, client_name, client_contact,
           consent_at, consent_version, created_at, decided_at, locale)
         VALUES (?, ?, ?, 'offer', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        salonId, randomToken(24), ref, status, offer.service_id, offer.service_name, offer.base_min, offer.added_min, offer.total_min,
        offer.uplift_pct, JSON.stringify(offer.upgrades), offer.standard_price_cents, offer.price_cents, currency, offer.slot_date,
        offer.start_min, offer.end_min, offer.capacity, name, contact, stamp, CONSENT_VERSION, stamp, status === 'confirmed' ? stamp : null, t.locale,
      )
      .run();
    await appendEvent(
      db,
      salonId,
      'request.offer',
      { ref, service_id: offer.service_id, slot: `${offer.slot_date} ${fmtTime(offer.start_min)}`, base_min: offer.base_min, added_min: offer.added_min, uplift_pct: offer.uplift_pct, standard_price_cents: offer.standard_price_cents, price_cents: offer.price_cents, currency },
      { at: () => now },
    );
    if (status === 'confirmed') {
      await appendEvent(db, salonId, 'request.confirmed', { ref, slot: `${offer.slot_date} ${fmtTime(offer.start_min)}`, standard_price_cents: offer.standard_price_cents, price_cents: offer.price_cents, currency }, { at: () => now });
    }
  }
  const [name, contact] = CLIENTS[3];
  await db
    .prepare(
      `INSERT INTO requests (salon_id, token, ref, kind, status, service_id, service_name, base_min, added_min, total_min, uplift_pct,
         upgrades_json, standard_price_cents, price_cents, currency, client_name, client_contact, note, consent_at, consent_version, created_at, locale)
       VALUES (?, ?, ?, 'waitlist', 'pending', ?, ?, ?, 0, ?, 30, '[]', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(salonId, randomToken(24), shortRef(), services[3].id, services[3].name, services[3].duration_min, services[3].duration_min, services[3].price_cents, services[3].price_cents, currency, name, contact, t('Any weekday after 17:00'), stamp, CONSENT_VERSION, stamp, t.locale)
    .run();

  // Results that match the sample requests above; the visitor's own clicks on the demo page add to them.
  for (const [metric, n] of [
    ['view', 9],
    ['offers', 6],
    ['noslot', 1],
    ['request', 3],
    ['waitlist', 1],
    ['confirmed', 1],
  ]) {
    await seed(db, salonId, local.date, metric, n);
  }
  return { salonId, userId: user.id, slug };
}
