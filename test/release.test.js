// Copyright (c) 2026 Miloš Petrović (Trench Logic Studio) · SPDX-License-Identifier: MIT
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, setupSalon, clientRequests, Browser, offerKeys, mailEnv, PASSWORD } from './helpers.js';
import { parseWebhook, billingConfig, hasAccess } from '../src/billing.js';
import { applyBillingEvent } from '../src/billing-state.js';
import { localToUtc } from '../src/time.js';
import { recordOutcome } from '../src/lifecycle.js';
import { requestById, salonById, metrics } from '../src/repo.js';
import { createPasswordRecord, replacePassword, authenticate } from '../src/auth.js';
import { dailyMaintenance } from '../src/maintenance.js';
import { enqueue, deliverDue, mailConfig } from '../src/mail.js';
import { validSlotInstant } from '../src/availability.js';

async function booking(env = {}) {
  const t = makeApp({ env });
  const s = await setupSalon(t);
  const c = await clientRequests(t, s.slug, s.serviceId, { contact: 'client@example.com' });
  const row = await t.db.prepare('SELECT * FROM requests').first();
  return { t, ...s, ...c, row };
}

test('simultaneous requests cannot reserve the same last chair', async () => {
  const t = makeApp(); const s = await setupSalon(t);
  const a = new Browser(t.app, { ip: '192.0.2.1' });
  const b = new Browser(t.app, { ip: '192.0.2.2' });
  const key = offerKeys((await a.get(`/s/${s.slug}/offers?service=${s.serviceId}`)).text)[0];
  const form = { service: s.serviceId, offer: key, name: 'Client', contact: 'client@example.com', consent: 'on' };
  const replies = await Promise.all([a.post(`/s/${s.slug}/request`, form), b.post(`/s/${s.slug}/request`, form)]);
  assert.deepEqual(replies.map(r => r.status).sort(), [303, 409]);
  assert.equal((await t.db.prepare('SELECT COUNT(*) AS n FROM requests').first()).n, 1);
});

test('a removed quiet window prevents confirmation of a stale request', async () => {
  const {t, owner, row} = await booking();
  await t.db.prepare('DELETE FROM windows').run();
  await owner.post(`/app/requests/${row.id}/confirm`, {});
  assert.equal((await requestById(t.db,1,row.id)).status, 'pending');
});

test('expired holds release capacity and cannot later be confirmed', async () => {
  const {t, owner, client, token, row} = await booking();
  t.advance(24*3600000+1);
  await client.get(`/r/${token}`);
  await owner.post(`/app/requests/${row.id}/confirm`, {});
  const fresh = await requestById(t.db,1,row.id);
  assert.equal(fresh.status,'expired'); assert.ok(fresh.revision > row.revision);
});

test('blocked days remove offers; occupied slots cannot silently be blocked', async () => {
  const {t, owner, client, slug, serviceId, row} = await booking();
  assert.equal((await owner.post('/app/availability',{date:row.slot_date,all:'on'})).status,400);
  await client.post(`/r/${row.token}/cancel`,{});
  assert.equal((await owner.post('/app/availability',{date:row.slot_date,all:'on'})).status,303);
  const keys=offerKeys((await client.get(`/s/${slug}/offers?service=${serviceId}`)).text);
  assert.ok(keys.every(k=>!k.startsWith(row.slot_date)));
});

test('client cancellation releases a reservation and invalidates its calendar file', async () => {
  const {t,owner,client,row,token}=await booking();
  await owner.post(`/app/requests/${row.id}/confirm`,{});
  assert.equal((await client.post(`/r/${token}/cancel`,{})).status,303);
  assert.equal((await requestById(t.db,1,row.id)).outcome,'canceled');
  assert.equal((await client.get(`/r/${token}/calendar.ics`)).status,404);
  assert.equal((await client.post(`/r/${token}/cancel`,{})).status,409);
});

test('confirmed appointments respect the cancellation deadline', async () => {
  const {t,owner,client,row,token}=await booking();
  await owner.post(`/app/requests/${row.id}/confirm`,{});
  t.setNow(new Date(localToUtc(row.slot_date,row.start_min,'Europe/Berlin').getTime()-3600000));
  assert.equal((await client.post(`/r/${token}/cancel`,{})).status,409);
  assert.equal((await requestById(t.db,1,row.id)).status,'confirmed');
});

test('failed rescheduling keeps the old reservation; a valid change needs reconfirmation', async () => {
  const {t,owner,client,row,token}=await booking();
  await owner.post(`/app/requests/${row.id}/confirm`,{});
  assert.equal((await client.post(`/r/${token}/reschedule`,{offer:'forged'})).status,409);
  assert.equal((await requestById(t.db,1,row.id)).status,'confirmed');
  const keys=offerKeys((await client.get(`/r/${token}/reschedule`)).text);
  assert.ok(keys.length>1);
  assert.equal((await client.post(`/r/${token}/reschedule`,{offer:keys[1]})).status,303);
  const next=await requestById(t.db,1,row.id);
  assert.equal(next.status,'pending');assert.notEqual(next.slot_date,row.slot_date);assert.equal(next.price_cents,4000);
});

test('completion is allowed only after the service, once, and contributes to completed value', async () => {
  const {t,owner,row}=await booking();
  await owner.post(`/app/requests/${row.id}/confirm`,{});
  assert.equal((await owner.post(`/app/appointments/${row.id}/completed`,{})).status,409);
  t.setNow(new Date(localToUtc(row.slot_date,row.end_min,'Europe/Berlin').getTime()+1000));
  assert.equal((await owner.post(`/app/appointments/${row.id}/completed`,{})).status,303);
  assert.equal((await owner.post(`/app/appointments/${row.id}/no_show`,{})).status,409);
  const data=await metrics(t.db,1);
  assert.equal(data.completed[0].cents,4000);
});

test('a stale lifecycle decision cannot overwrite a newer revision', async () => {
  const {t,row}=await booking();
  await t.db.prepare('UPDATE requests SET revision = revision + 1').run();
  const salon=await salonById(t.db,1);
  assert.equal(await recordOutcome({db:t.db,now:t.now,url:new URL('http://localhost:8787')},salon,row,'canceled'),false);
  assert.equal((await requestById(t.db,1,row.id)).status,'pending');
});

test('staff invites are single use, permissions are enforced and removal revokes sessions', async () => {
  const t=makeApp();const {owner}=await setupSalon(t);
  const invite=await owner.post('/app/team',{email:'staff@example.com'});
  assert.equal(invite.status,200);
  const path=/\/join\/[A-Za-z0-9_-]+/.exec(invite.text)[0];
  const staff=new Browser(t.app,{ip:'192.0.2.9'});
  assert.equal((await staff.post(path,{password:PASSWORD})).status,303);
  assert.equal((await new Browser(t.app).post(path,{password:PASSWORD})).status,410);
  for(const path of ['/app/appointments','/app/availability','/app/account'])assert.equal((await staff.get(path)).status,200,path);
  for(const path of ['/app/settings','/app/team','/app/export/requests.csv','/app/plan'])assert.equal((await staff.get(path)).status,403,path);
  assert.equal((await staff.post('/app/services',{name:'Illegal',duration:'45',price:'1'})).status,403);
  const user=await t.db.prepare("SELECT id FROM users WHERE role = 'staff'").first();
  await owner.post(`/app/team/${user.id}/remove`,{});
  assert.equal((await staff.get('/app/appointments')).status,303);
});

test('email verification requires a deliberate POST and cannot be reused', async () => {
  const env=mailEnv({REQUIRE_EMAIL_VERIFICATION:'on'});const t=makeApp({env});const b=new Browser(t.app);
  assert.equal((await b.post('/signup',{salon:'Verified',email:'owner@verify.test',password:PASSWORD,timezone:'Europe/Berlin',currency:'EUR',terms:'on'})).status,303);
  assert.equal((await b.get('/app')).location,'/verify');
  const mail=env.MAIL_SINK.find(m=>m.kind==='account.verify');
  assert.ok(mail);
  const path=/\/verify\/[A-Za-z0-9_-]+/.exec(mail.text)[0];
  await b.get(path);
  assert.equal((await t.db.prepare('SELECT email_verified_at FROM users').first()).email_verified_at,null);
  assert.equal((await b.post(path,{})).status,303);
  assert.equal((await b.get('/app')).status,200);
  assert.equal((await b.post(path,{})).status,410);
});

test('legacy passwords gain a pepper; concurrent changes cannot overwrite a newer password', async () => {
  const t=makeApp();await setupSalon(t);const pepper='p'.repeat(40);
  assert.ok(await authenticate(t.db,'owner@lumen.test',PASSWORD,10000,pepper));
  const user=await t.db.prepare('SELECT * FROM users').first();assert.equal(user.pass_peppered,1);
  const a=await createPasswordRecord('the first new password',10000,pepper);
  const b=await createPasswordRecord('the second new password',10000,pepper);
  assert.equal(await replacePassword(t.db,user,a),true);
  assert.equal(await replacePassword(t.db,user,b),false);
  assert.equal(await authenticate(t.db,user.email,PASSWORD,10000,pepper),null);
});

const BILLING={BILLING_PROVIDER:'stripe',CHECKOUT_URL:'https://buy.stripe.com/test_example',BILLING_WEBHOOK_SECRET:'secret_long_enough_for_tests',BILLING_MODE:'test'};
function event(id,status,at,extra={}) {return parseWebhook('stripe',{id,type:status==='canceled'?'customer.subscription.deleted':'customer.subscription.updated',created:at,livemode:false,data:{object:{id:'sub_1',customer:'cus_1',status,metadata:{salon_id:'1'},current_period_end:1796000000,items:{data:[{price:{id:'price_allowed'}}]},...extra}}});}
async function billingFixture(extra={}){const t=makeApp();await setupSalon(t);return {t,c:{db:t.db,now:t.now,billing:billingConfig({...BILLING,...extra}),fetch:async()=>{throw Error('Unexpected network')}}};}

test('unpaid checkout never grants paid access',()=>{
  const update=parseWebhook('stripe',{id:'evt_unpaid',type:'checkout.session.completed',data:{object:{mode:'subscription',subscription:'sub_1',client_reference_id:'salon_1',payment_status:'unpaid'}}});
  assert.equal(update.status,'expired');
});

test('older and duplicate billing events cannot revive a terminated subscription',async()=>{
  const {t,c}=await billingFixture();
  await applyBillingEvent(c,event('active','active',100));
  await applyBillingEvent(c,event('deleted','canceled',200));
  await applyBillingEvent(c,event('late','active',150));
  assert.equal((await salonById(t.db,1)).billing_status,'expired');
  assert.equal((await applyBillingEvent(c,event('deleted','canceled',200))).duplicate,true);
});

test('billing rejects the wrong mode and revokes a linked unsupported plan',async()=>{
  const {t,c}=await billingFixture({BILLING_PRICE_ID:'price_allowed'});
  await applyBillingEvent(c,event('one','active',100));
  await applyBillingEvent(c,event('two','active',200,{items:{data:[{price:{id:'price_other'}}]}}));
  assert.equal((await salonById(t.db,1)).billing_status,'expired');
  const wrong=event('live','active',300);wrong.live=true;
  assert.equal((await applyBillingEvent(c,wrong)).reason,'mode');
});

test('production billing verifies the provider before changing access, and retries API failures',async()=>{
  const {t,c}=await billingFixture({APP_ENV:'production',BILLING_API_KEY:'test_key',BILLING_PRICE_ID:'price_allowed'});
  c.fetch=async()=>new Response('{}',{status:503});
  await assert.rejects(applyBillingEvent(c,event('failure','active',100)),/verification failed/);
  assert.equal((await t.db.prepare('SELECT COUNT(*) AS n FROM webhook_events').first()).n,0);
  c.fetch=async()=>Response.json({id:'sub_1',status:'past_due',customer:'cus_1',metadata:{salon_id:'1'},livemode:false,current_period_end:1796000000,items:{data:[{price:{id:'price_allowed'}}]}});
  await applyBillingEvent(c,event('verified','active',200));
  assert.equal((await salonById(t.db,1)).billing_status,'past_due');
});

test('past-due access is bounded and production refuses active state without a period end',()=>{
  const b=billingConfig({...BILLING,APP_ENV:'production'});const now=new Date('2026-11-10T00:00:00Z');
  assert.equal(hasAccess({billing_status:'active'},b,now),false);
  assert.equal(hasAccess({billing_status:'past_due',billing_period_end:'2026-11-09T00:00:00Z'},b,now),true);
  assert.equal(hasAccess({billing_status:'past_due',billing_period_end:'2026-11-01T00:00:00Z'},b,now),false);
});

test('outdated queued notifications are suppressed after a reservation changes',async()=>{
  const {t,row}=await booking();const env=mailEnv();const mail=mailConfig(env);
  await enqueue(t.db,{salonId:1,kind:'test',to:'client@example.com',subject:'Old',text:'Old',html:'Old',requestId:row.id,requestRevision:row.revision},t.now);
  await t.db.prepare('UPDATE requests SET revision = revision + 1').run();
  await deliverDue(t.db,env,mail,t.now);
  assert.equal(env.MAIL_SINK.length,0);
});

test('maintenance schedules one reminder per current confirmed appointment',async()=>{
  const env=mailEnv();const {t,owner,row}=await booking(env);
  await owner.post(`/app/requests/${row.id}/confirm`,{});
  t.setNow(new Date(localToUtc(row.slot_date,row.start_min,'Europe/Berlin').getTime()-12*3600000));
  const opts={env:{...env,PUBLIC_ORIGIN:'https://example.com'},mail:mailConfig(env)};
  await dailyMaintenance(t.db,t.now,opts);await dailyMaintenance(t.db,t.now,opts);
  assert.equal(env.MAIL_SINK.filter(m=>m.kind==='appointment.reminder').length,1);
});

test('production fails closed when required configuration is absent',async()=>{
  const t=makeApp({env:{APP_ENV:'production'}});
  assert.equal((await new Browser(t.app).get('/')).status,503);
});

test('nonexistent daylight-saving times are excluded',()=>{
  assert.equal(validSlotInstant({slot_date:'2026-03-29',start_min:150,end_min:210},'Europe/Berlin'),false);
  assert.equal(validSlotInstant({slot_date:'2026-03-30',start_min:150,end_min:210},'Europe/Berlin'),true);
});

test('concurrent password reset submissions consume a reset token only once', async () => {
  const env=mailEnv();const t=makeApp({env});await setupSalon(t);
  const first=new Browser(t.app,{ip:'192.0.2.41'});const second=new Browser(t.app,{ip:'192.0.2.42'});
  await first.post('/forgot',{email:'owner@lumen.test'});
  const link=/\/reset\/[A-Za-z0-9_-]+/.exec(env.MAIL_SINK.find(m=>m.kind==='user.reset').text)[0];
  const responses=await Promise.all([first.post(link,{password:'first new secret phrase'}),second.post(link,{password:'second new secret phrase'})]);
  assert.equal(responses.filter(r=>r.status===303).length,1);
  assert.equal(responses.filter(r=>r.status===410).length,1);
  assert.equal((await t.db.prepare('SELECT COUNT(*) AS n FROM password_resets').first()).n,0);
});
