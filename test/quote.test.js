// Copyright (c) 2026 Miloš Petrović (Trench Logic Studio) · SPDX-License-Identifier: MIT
// A request must carry the terms the client was shown. If the salon edits the
// price or the length of the service between the page and the request, the
// request is refused and the client sees the current offers.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, Browser, offerKeys, requestIds, setupSalon, clientRequests } from './helpers.js';

const count = async (t) => (await t.db.prepare("SELECT COUNT(*) AS n FROM requests WHERE kind = 'offer'").first()).n;
const send = (client, s, offer, name = 'Nora Hale') =>
  client.post(`/s/${s.slug}/request`, { service: s.serviceId, offer, name, contact: '+44 7700 900123', consent: 'on' });

test('a price changed after the page was shown refuses the request and shows the new price', async () => {
  const t = makeApp();
  const s = await setupSalon(t);
  const client = new Browser(t.app, { ip: '198.51.100.7' });
  const page = await client.get(`/s/${s.slug}/offers?service=${s.serviceId}`);
  assert.match(page.text, /€40\.00/);
  const [key] = offerKeys(page.text);

  await s.owner.post(`/app/services/${s.serviceId}`, { action: 'save', name: 'Cut & finish', duration: '45', price: '80' });
  const stale = await send(client, s, key);
  assert.equal(stale.status, 409);
  assert.match(stale.text, /That time was just taken or has changed/);
  assert.match(stale.text, /€80\.00/, 'the answer shows the current price');
  assert.equal(await count(t), 0, 'nothing is stored at terms the client did not see');

  const [fresh] = offerKeys(stale.text);
  assert.notEqual(fresh, key);
  const ok = await send(client, s, fresh);
  assert.equal(ok.status, 303);
  const stored = await t.db.prepare('SELECT price_cents, standard_price_cents FROM requests').first();
  assert.deepEqual({ ...stored }, { price_cents: 8000, standard_price_cents: 8000 });
});

test('a duration changed after the page was shown refuses the request, even when +30% still holds', async () => {
  const t = makeApp();
  const s = await setupSalon(t);
  const client = new Browser(t.app, { ip: '198.51.100.8' });
  const [key] = offerKeys((await client.get(`/s/${s.slug}/offers?service=${s.serviceId}`)).text);

  // 40 min + 15 min is +37.5%: a valid offer, but not the 60 minutes the client chose.
  await s.owner.post(`/app/services/${s.serviceId}`, { action: 'save', name: 'Cut & finish', duration: '40', price: '40' });
  const stale = await send(client, s, key);
  assert.equal(stale.status, 409);
  assert.equal(await count(t), 0);
});

test('an unchanged page is accepted, and a choice without its quote is not', async () => {
  const t = makeApp();
  const s = await setupSalon(t);
  const client = new Browser(t.app, { ip: '198.51.100.9' });
  const [key] = offerKeys((await client.get(`/s/${s.slug}/offers?service=${s.serviceId}`)).text);
  assert.match(key, /~4000\.60$/, 'the choice carries price in cents and total minutes');

  const bare = await send(client, s, key.split('~')[0]);
  assert.equal(bare.status, 409);
  const wrong = await send(client, s, `${key.split('~')[0]}~1.60`);
  assert.equal(wrong.status, 409);
  assert.equal(await count(t), 0);

  assert.equal((await send(client, s, key)).status, 303);
  assert.equal(await count(t), 1);
});

test('rescheduling from a page that has since changed keeps the old reservation', async () => {
  const t = makeApp();
  const s = await setupSalon(t, { windows: [['2', '13:00', '16:00'], ['3', '13:00', '16:00'], ['4', '13:00', '16:00']] });
  const a = await clientRequests(t, s.slug, s.serviceId);
  const [id] = requestIds((await s.owner.get('/app')).text);
  await s.owner.post(`/app/requests/${id}/confirm`, {});
  const before = await t.db.prepare('SELECT slot_date, start_min, price_cents, status FROM requests WHERE id = ?').bind(id).first();

  const page = await a.client.get(`/r/${a.token}/reschedule`);
  const [key] = offerKeys(page.text);
  assert.ok(key, 'a time to move to is offered');
  await s.owner.post(`/app/services/${s.serviceId}`, { action: 'save', name: 'Cut & finish', duration: '45', price: '90' });

  const stale = await a.client.post(`/r/${a.token}/reschedule`, { offer: key });
  assert.equal(stale.status, 409);
  const after = await t.db.prepare('SELECT slot_date, start_min, price_cents, status FROM requests WHERE id = ?').bind(id).first();
  assert.deepEqual({ ...after }, { ...before }, 'the confirmed appointment is untouched');
});
