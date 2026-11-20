// Copyright (c) 2026 Miloš Petrović (Trench Logic Studio) · SPDX-License-Identifier: MIT
import { html, raw } from '../html.js';
import { sitePage, langField } from './layout.js';
import { PLANS } from '../plans.js';
import { RETENTION_DAYS } from '../config.js';
import { planOffer } from './settings.js';

const ARROW = raw(
  '<svg viewBox="0 0 40 40" aria-hidden="true" focusable="false"><path d="M6 20h26m-9-9 9 9-9 9" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
);

export function landingView(c, user) {
  const t = c.t;
  const name = c.config.productName;
  const price = t.money(4000, 'EUR');
  const start = user ? t('Open your dashboard') : !c.billing.enabled ? t('Start free beta') : c.billing.trialDays ? t('Start your free trial') : t('Create account');
  const demoForm = c.config.demoEnabled
    ? html`<form method="post" action="/demo" class="inline">${langField(c)}<input type="hidden" name="timezone" value="" data-detect-timezone-input><button class="btn btn-outline" type="submit">${t('Try the live demo')}</button></form>`
    : '';
  const body = html`
<section class="hero"><div class="wrap">
  <h1>${t('Turn “fully booked” into a booked client.')}</h1>
  <p class="lead">${t('When a client can’t get the time they wanted, {product} offers them a longer, upgraded appointment in your quiet hours, at your normal price. Your slow afternoons fill up and you never discount.', { product: name })}</p>
  <div class="actions">
    <a class="btn btn-primary" href="${user ? '/app' : c.link('/signup')}">${start}</a>
    ${user ? '' : demoForm}
    <a class="btn btn-link" href="#how">${t('See how it works')}</a>
  </div>

  <div class="demo" role="img" aria-label="${t('Example: Saturday is fully booked when the client wanted 11:00. {product} offers Tuesday 13:30 instead: cut and finish plus deep conditioning, 60 minutes instead of 45, for the same {price}.', { product: name, price })}">
    <div class="day day-full" aria-hidden="true">
      <p class="day-name">${t.weekday(6)} <small>${t('Fully booked')}</small></p>
      <ol class="slots">
        <li class="slot slot-busy"><span>10:00</span><span>${t('Booked')}</span></li>
        <li class="slot slot-busy"><span>10:30</span><span>${t('Booked')}</span></li>
        <li class="slot slot-busy slot-wanted"><span>11:00</span><span>${t('Wanted, but taken')}</span></li>
        <li class="slot slot-busy"><span>11:30</span><span>${t('Booked')}</span></li>
      </ol>
    </div>
    <div class="demo-arrow" aria-hidden="true">${ARROW}</div>
    <div class="day day-quiet" aria-hidden="true">
      <p class="day-name">${t.weekday(2)} <small>${t('Quiet hours')}</small></p>
      <ol class="slots">
        <li class="slot"><span>13:00</span><span>${t('Free')}</span></li>
        <li class="slot slot-offer"><span>13:30</span><span><b>${t('Cut & finish')} + ${t('Deep conditioning treatment')}</b><br>${t('{total} instead of {base}', { total: t.duration(60), base: t.duration(45) })}, <em>${t('same {price}', { price })}</em></span></li>
        <li class="slot"><span>14:30</span><span>${t('Free')}</span></li>
      </ol>
    </div>
  </div>
</div></section>

<section class="section" id="how"><div class="wrap">
  <h2>${t('How it works')}</h2>
  <ol class="steps">
    <li><h3>${t('Share your link')}</h3><p class="muted">${t('Put it where clients find you full: the “fully booked” message on your booking page, your Instagram bio, your auto-reply, a QR code at the desk.')}</p></li>
    <li><h3>${t('The client picks an upgrade')}</h3><p class="muted">${t('They choose the service they wanted and see up to three upgraded times in your quiet hours, in their own language. No account, no app.')}</p></li>
    <li><h3>${t('You confirm')}</h3><p class="muted">${t('You get an email, confirm with one tap, and send the ready-made message by WhatsApp, text or email. Confirmed appointments appear in your calendar.')}</p></li>
  </ol>
</div></section>

<section class="section"><div class="wrap">
  <h2>${t('Rules {product} never breaks', { product: name })}</h2>
  <div class="rules">
    <div><h3>${t('Same price, every time')}</h3><p>${t('The client pays exactly your listed price. {product} cannot create a discount, and the database refuses one even if someone tries.', { product: name })}</p></div>
    <div><h3>${t('Noticeably more care')}</h3><p>${t('Every offer adds at least 30% more time, using upgrades you choose: a scalp massage, a treatment, a longer finish.')}</p></div>
    <div><h3>${t('Only in hours you choose')}</h3><p>${t('Offers land only in the quiet hours you set, and never more at once than you have free chairs.')}</p></div>
    <div><h3>${t('You stay in charge')}</h3><p>${t('Nothing is booked until you confirm it. Client details are deleted {days} days after the appointment.', { days: RETENTION_DAYS })}</p></div>
  </div>
</div></section>

<section class="section"><div class="wrap">
  <h2>${t('One account, three levels')}</h2>
  <p class="lead">${t('Start with one location. The next levels switch on as your business grows.')}</p>
  <ul class="tiers">
    ${PLANS.map(
      (p) => html`<li class="${p.status === 'active' ? 'tier-live' : 'tier-soon'}">
      <span class="tier-name">${p.name}<span class="tier-scope">${t(p.scope)}</span></span>
      <span>${t(p.pitch)}</span>
      <span class="tier-state">${p.status === 'active' ? (c.billing.enabled ? planOffer(c) : t(p.price)) : t('Coming')}</span>
    </li>`,
    )}
  </ul>
  <div class="actions section-end" id="start"><a class="btn btn-primary" href="${user ? '/app' : c.link('/signup')}">${start}</a></div>
</div></section>`;
  return sitePage(c, {
    title: '',
    body,
    user,
    robots: 'index, follow',
    switchPath: '/',
    description: t('{product} turns “fully booked” into an upgraded booking in your quiet hours, at your normal price. Never a discount.', { product: name }),
  });
}
