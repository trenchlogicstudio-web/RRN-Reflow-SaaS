// Copyright (c) 2026 Miloš Petrović (Trench Logic Studio) · SPDX-License-Identifier: MIT
import { html } from '../html.js';
import { HttpError, redirect, readForm } from '../http.js';
import { appPage, sitePage, notice, formErrors } from '../views/layout.js';
import { protectedRoute } from './operations.js';
import { page, toId, nowSec } from './util.js';
import { FormReader } from '../validate.js';
import { issueAccountToken, accountToken } from '../account-tokens.js';
import { createPasswordRecord, replacePassword, startSession } from '../auth.js';
import { verifyPassword } from '../crypto.js';
import { writeWithEvent } from '../events.js';
import { hit, limiterKey } from '../ratelimit.js';
import { deliverSoon } from './public.js';
import { LOCALES, LOCALE_NAMES, isLocale } from '../i18n/index.js';

async function team(c, salon, link = '') {
  const t = c.t;
  const { results: users } = await c.db.prepare('SELECT id, email, role FROM users WHERE salon_id = ? ORDER BY id').bind(salon.id).all();
  const { results: invites } = await c.db.prepare("SELECT token_hash, email FROM account_tokens WHERE salon_id = ? AND kind = 'invite' AND used_at IS NULL AND expires_at > ?").bind(salon.id,nowSec(c)).all();
  return page(appPage(c,{title:t('Team'), current:'/app/team',body:html`<h1>${t('Team')}</h1>
    <p class="lead">${t('Staff can manage appointments and blocked times. Billing, exports and business settings stay with the owner.')}</p>
    ${link ? html`<div class="notice notice-ok"><p>${t('Invitation ready. Send this private link to your colleague.')}</p><input aria-label="${t('Invitation link')}" value="${link}" readonly></div>` : ''}
    <section class="panel"><h2>${t('Invite a colleague')}</h2><form method="post" action="/app/team"><div class="field"><label for="email">${t('Email')}</label><input id="email" name="email" type="email" maxlength="254" required></div><button class="btn btn-primary">${t('Invite a colleague')}</button></form></section>
    <ul class="requests">${users.map((u)=>html`<li class="request"><div class="request-top"><span>${u.email} · ${u.role === 'owner' ? t('Owner') : t('Staff')}</span>${u.role === 'staff' ? html`<form method="post" action="/app/team/${u.id}/remove" data-confirm="${t('Remove this colleague?')}"><button class="btn btn-outline">${t('Remove')}</button></form>`:''}</div></li>`)}</ul>
    ${invites.length ? html`<h2>${t('Pending invitations')}</h2><ul class="requests">${invites.map((i)=>html`<li class="request"><div class="request-top"><span>${i.email}</span><form method="post" action="/app/team/revoke"><input type="hidden" name="token" value="${i.token_hash}"><button class="btn btn-outline">${t('Remove')}</button></form></div></li>`)}</ul>`:''}
  `}));
}

async function invite(c, salon) {
  if (salon.is_demo) throw new HttpError(403,'This action is not available in the demo.');
  if (!await hit(c.db,`team-invite:${salon.id}`,10,3600,nowSec(c))) throw new HttpError(429,'Too many attempts. Please try again in an hour.');
  const f=new FormReader(await readForm(c.request),c.t); const email=f.email('email');
  if (!f.ok) throw new HttpError(400,'Enter a valid email address.');
  const {n}=await c.db.prepare('SELECT COUNT(*) AS n FROM users WHERE salon_id = ?').bind(salon.id).first();
  const exists=await c.db.prepare('SELECT 1 AS ok FROM users WHERE email = ?').bind(email).first();
  if(n>=10 || exists) throw new HttpError(409,'This email is already registered or the team is full.');
  const link=await issueAccountToken(c,{salon_id:salon.id,email,locale:c.locale},'invite');
  deliverSoon(c); return team(c,salon,link);
}

async function remove(c,salon) {
  const id=toId(c.params.id);
  await writeWithEvent(c.db,salon.id,'team.removed',{id},()=>[c.db.prepare("DELETE FROM users WHERE id = ? AND salon_id = ? AND role = 'staff'").bind(id,salon.id)],{condition:'changes() = 1',at:()=>c.now});
  return redirect('/app/team');
}

async function join(c) {
  const token=await accountToken(c,'invite');
  if(!token) throw new HttpError(410,'This request link is not valid.');
  const t=c.t; let errors={};
  if(c.request.method==='POST') {
    if(!await hit(c.db,await limiterKey('join',c.ip),10,3600,nowSec(c))) throw new HttpError(429,'Too many attempts. Please try again in an hour.');
    const f=new FormReader(await readForm(c.request),c.t); const password=f.password('password'); errors=f.errors;
    if(f.ok) {
      const pw=await createPasswordRecord(password,c.config.pbkdf2Iterations,c.config.authPepper);
      try {
        const result=await writeWithEvent(c.db,token.salon_id,'team.joined',{},()=>[
          c.db.prepare(`INSERT INTO users (salon_id,email,pass_hash,pass_salt,pass_iter,pass_peppered,created_at,locale,role,email_verified_at)
            SELECT ?,?,?,?,?,?,?,?,'staff',? WHERE EXISTS (SELECT 1 FROM account_tokens WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?)
            AND (SELECT COUNT(*) FROM users WHERE salon_id = ?) < 10`)
            .bind(token.salon_id,token.email,pw.pass_hash,pw.pass_salt,pw.pass_iter,pw.pass_peppered,c.now.toISOString(),c.locale,c.now.toISOString(),token.token_hash,nowSec(c),token.salon_id),
          c.db.prepare('UPDATE account_tokens SET used_at = ? WHERE token_hash = ? AND changes() = 1').bind(nowSec(c),token.token_hash),
        ],{condition:'changes() = 1',at:()=>c.now});
        if(result[0].meta.changes!==1) throw new Error('Used invitation');
      } catch { throw new HttpError(409,'This email is already registered or the team is full.'); }
      const user=await c.db.prepare('SELECT id FROM users WHERE email = ? AND salon_id = ?').bind(token.email,token.salon_id).first();
      return redirect('/app',{cookies:[await startSession(c.db,user.id,{secure:c.secure,now:c.now})]});
    }
  }
  return page(sitePage(c,{title:t('Join the salon team'),bare:true,body:html`<section class="wrap narrow section"><h1>${t('Join the salon team')}</h1><p>${token.email}</p>${formErrors(c,errors)}<form method="post" action="/join/${c.params.token}"><div class="field"><label for="password">${t('New password')}</label><input id="password" name="password" type="password" autocomplete="new-password" minlength="10" maxlength="200" required></div><button class="btn btn-primary">${t('Create account')}</button></form></section>`}),Object.keys(errors).length?400:200);
}

async function verifyPage(c) {
  const user=await c.getUser(); if(!user)return redirect('/login');
  c.useLocale(user.locale);
  if(user.email_verified_at || user.salon.is_demo)return redirect('/app');
  if(c.request.method==='POST' && c.mail.provider) {
    if(await hit(c.db,`verify:${user.id}`,3,3600,nowSec(c))) {
      await issueAccountToken(c,{id:user.id,salon_id:user.salon.id,email:user.email,locale:user.locale},'verify');deliverSoon(c);
    }
  }
  const t=c.t;
  return page(sitePage(c,{title:t('Verify your email'),bare:true,body:html`<section class="wrap narrow section"><h1>${t('Verify your email')}</h1><p>${t('Check your inbox and confirm your email before opening your dashboard.')}</p><p>${user.email}</p>
    ${c.request.method==='POST'?notice('info',t('Check your inbox.')):''}<form method="post" action="/verify"><button class="btn btn-primary">${t('Resend email')}</button></form><form method="post" action="/logout"><button class="btn btn-link">${t('Log out')}</button></form></section>`}));
}

async function verifyToken(c) {
  const token=await accountToken(c,'verify');if(!token)throw new HttpError(410,'This request link is not valid.');
  if(c.request.method==='POST') {
    const result=await c.db.batch([
      c.db.prepare(`UPDATE users SET email_verified_at = ? WHERE id = ? AND email = ? AND EXISTS (SELECT 1 FROM account_tokens WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?)`)
        .bind(c.now.toISOString(),token.user_id,token.email,token.token_hash,nowSec(c)),
      c.db.prepare('UPDATE account_tokens SET used_at = ? WHERE token_hash = ? AND changes() = 1').bind(nowSec(c),token.token_hash),
    ]);
    if(!result[0].meta.changes)throw new HttpError(410,'This request link is not valid.');
    return redirect('/app');
  }
  const t=c.t;
  return page(sitePage(c,{title:t('Verify your email'),bare:true,body:html`<section class="wrap narrow section"><h1>${t('Verify your email')}</h1><p>${token.email}</p><form method="post" action="/verify/${c.params.token}"><button class="btn btn-primary">${t('Verify your email')}</button></form></section>`}));
}

async function account(c,salon) {
  const t=c.t;
  if(c.request.method==='POST') {
    if(!await hit(c.db,`account:${c.user.id}`,10,3600,nowSec(c)))throw new HttpError(429,'Too many attempts. Please try again in an hour.');
    const f=new FormReader(await readForm(c.request),t);
    const locale=f.raw('locale');if(!isLocale(locale))throw new HttpError(400,'Choose a language from the list.');
    if(f.raw('password')) {
      const user=await c.db.prepare('SELECT * FROM users WHERE id = ?').bind(c.user.id).first();
      if(salon.is_demo || !await verifyPassword(f.raw('current'),user,c.config.authPepper))throw new HttpError(400,'That is not your current password.');
      const password=f.password('password');if(!f.ok)throw new HttpError(400,'Choose a valid option.');
      const pw=await createPasswordRecord(password,c.config.pbkdf2Iterations,c.config.authPepper);
      if (!await replacePassword(c.db,user,pw)) throw new HttpError(409,'That is not your current password.');
      await c.db.prepare('UPDATE users SET locale = ?, notify_email = ? WHERE id = ?').bind(locale,f.checkbox('notify')?1:0,user.id).run();
      return redirect('/app/account?ok=saved',{cookies:[await startSession(c.db,user.id,{secure:c.secure,now:c.now})]});
    }
    await c.db.prepare('UPDATE users SET locale = ?, notify_email = ? WHERE id = ?').bind(locale,f.checkbox('notify')?1:0,c.user.id).run();
    return redirect('/app/account?ok=saved');
  }
  return page(appPage(c,{title:t('My account'),current:'/app/account',body:html`<h1>${t('My account')}</h1><p>${c.user.email}</p>${c.url.searchParams.has('ok')?notice('ok',t('Settings saved.')):''}
    <form class="panel" method="post" action="/app/account"><div class="field"><label for="locale">${t('Language')}</label><select id="locale" name="locale">${LOCALES.map((l)=>html`<option value="${l}"${l===c.locale?html` selected`:''}>${LOCALE_NAMES[l]}</option>`)}</select></div>
    <label class="check"><input type="checkbox" name="notify"${c.user.notify_email?html` checked`:''}> ${t('Email notifications')}</label>
    <div class="field"><label for="current">${t('Current password')}</label><input id="current" name="current" type="password" autocomplete="current-password" maxlength="200"></div>
    <div class="field"><label for="password">${t('New password')} ${t('(optional)')}</label><input id="password" name="password" type="password" autocomplete="new-password" minlength="10" maxlength="200"></div><button class="btn btn-primary">${t('Save')}</button></form>`}));
}

export function registerTeam(r) {
  r.get('/app/team',protectedRoute(team,true));r.post('/app/team',protectedRoute(invite,true));r.post('/app/team/:id/remove',protectedRoute(remove,true));
  r.post('/app/team/revoke',protectedRoute(async(c,s)=>{const f=await readForm(c.request);await c.db.prepare("DELETE FROM account_tokens WHERE token_hash = ? AND salon_id = ? AND kind = 'invite'").bind(f.get('token')||'',s.id).run();return redirect('/app/team');},true));
  r.get('/join/:token',join);r.post('/join/:token',join);
  r.get('/verify',verifyPage);r.post('/verify',verifyPage);r.get('/verify/:token',verifyToken);r.post('/verify/:token',verifyToken);
  r.get('/app/account',protectedRoute(account));r.post('/app/account',protectedRoute(account));
}
