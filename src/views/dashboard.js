// Copyright (c) 2026 Miloš Petrović (Trench Logic Studio) · SPDX-License-Identifier: MIT
// The salon's main page: what needs an answer, what is coming up, and results.

import { html } from '../html.js';
import { appPage, notice } from './layout.js';
import { contactKind } from '../validate.js';
import { translator, tk, LOCALE_NAMES, htmlLang } from '../i18n/index.js';
import { RETENTION_DAYS } from '../config.js';

export const FLASH = {
  confirmed: ['ok', tk('Confirmed. The client’s page now shows it as confirmed.')],
  declined: ['ok', tk('Declined. The client’s page now offers them another time.')],
  closed: ['ok', tk('Marked as contacted.')],
  full: ['error', tk('That time is already at capacity. Add free chairs in Quiet hours to confirm it, or decline it.')],
  decided: ['info', tk('That request was already answered.')],
  service_added: ['ok', tk('Service added.')],
  service_saved: ['ok', tk('Service saved.')],
  service_hidden: ['ok', tk('Service hidden from clients.')],
  service_shown: ['ok', tk('Service is visible to clients again.')],
  upgrade_added: ['ok', tk('Upgrade added.')],
  upgrade_saved: ['ok', tk('Upgrade saved.')],
  upgrade_hidden: ['ok', tk('Upgrade switched off.')],
  upgrade_shown: ['ok', tk('Upgrade switched on.')],
  hours_added: ['ok', tk('Quiet hours added.')],
  hours_removed: ['ok', tk('Quiet hours removed.')],
  settings_saved: ['ok', tk('Settings saved.')],
  password_saved: ['ok', tk('Password changed. Other devices have been logged out.')],
  interest: ['ok', tk('Noted. You will hear from us when it opens.')],
  welcome: ['ok', tk('Your account is ready. A few short steps and your request page is live.')],
  setup_done: ['ok', tk('Your services, upgrades and quiet hours are set up. Your request page is live.')],
  calendar_new: ['ok', tk('New calendar address created. The old one no longer works.')],
  subscribed: ['ok', tk('Thank you! Your subscription becomes active as soon as the payment provider confirms it.')],
  demo: ['ok', tk('Welcome to the demo. Everything here is sample data you can change freely.')],
};

export function flash(c, code) {
  const f = FLASH[code];
  return f ? notice(f[0], c.t(f[1])) : '';
}

const enc = encodeURIComponent;

/** Links that open WhatsApp, a text message, or an email with the message already written. */
export function contactActions(c, contact, message, subject) {
  const t = c.t;
  if (!contact) return '';
  const kind = contactKind(contact);
  if (kind === 'email') {
    return html`<a class="btn btn-outline btn-small" href="mailto:${contact.trim()}?subject=${enc(subject)}&body=${enc(message)}">${t('Email')}</a>`;
  }
  if (kind === 'phone') {
    const international = /^\s*(\+|00)/.test(contact);
    const digits = contact.replace(/\D/g, '').replace(/^00/, '');
    const dial = contact.replace(/[^\d+]/g, '');
    return html`${international ? html`<a class="btn btn-outline btn-small" href="https://wa.me/${digits}?text=${enc(message)}" rel="noopener noreferrer" target="_blank">WhatsApp</a>` : ''}
    <a class="btn btn-outline btn-small" href="sms:${dial}?&body=${enc(message)}">${t('Text message')}</a>`;
  }
  return '';
}

/** Phone numbers stay on one line. */
const unbroken = (s) => String(s).replace(/ /g, '\u00a0');

function contactLink(c, value) {
  if (!value) return html`<span class="muted">${c.t('Details erased')}</span>`;
  const kind = contactKind(value);
  if (kind === 'email') return html`<a href="mailto:${value.trim()}">${value}</a>`;
  if (kind === 'phone') return html`<a href="tel:${value.replace(/[^\d+]/g, '')}">${unbroken(value)}</a>`;
  return html`<span>${value}</span>`;
}

const what = (r) => [r.service_name, ...(r.upgrades || []).map((u) => u.name)].join(' + ');

/** The confirmation message, written in the language the client used. */
export function confirmationMessage(salon, r) {
  const tc = translator(r.locale);
  const first = r.client_name ? r.client_name.split(' ')[0] : '';
  return tc('Hi {name}, your appointment at {salon} is confirmed: {date} at {time}. {what} ({length}) for {price}, your usual price. Reference {ref}.', {
    name: first,
    salon: salon.name,
    date: tc.dateLong(r.slot_date),
    time: tc.time(r.start_min),
    what: what(r),
    length: tc.duration(r.total_min),
    price: tc.money(r.price_cents, r.currency),
    ref: r.ref,
  });
}

function waitlistMessage(salon, r) {
  const tc = translator(r.locale);
  const first = r.client_name ? r.client_name.split(' ')[0] : '';
  return tc('Hi {name}, this is {salon}. A place has opened up for {service}:', { name: first, salon: salon.name, service: r.service_name });
}

function statusLabel(c, r) {
  const t = c.t;
  if (r.status === 'pending') return r.kind === 'waitlist' ? t('Waitlist') : t('Waiting for you');
  return t({ confirmed: tk('Confirmed'), declined: tk('Declined'), expired: tk('Expired'), closed: tk('Contacted') }[r.status] || tk('Request'));
}

/** Clients may write in another language than the dashboard's: show which, so the owner replies in it. */
function clientLanguage(c, r) {
  if (!r.locale || r.locale === c.locale || !LOCALE_NAMES[r.locale]) return '';
  return html` <span class="small muted">· <span lang="${htmlLang(r.locale)}">${LOCALE_NAMES[r.locale]}</span></span>`;
}

function requestCard(c, r, { actions = true } = {}) {
  const t = c.t;
  const salon = c.user.salon;
  const message = r.status === 'confirmed' && r.client_name ? confirmationMessage(salon, r) : '';
  const subject = translator(r.locale)('Your appointment at {salon}', { salon: salon.name });
  return html`<li class="request is-${r.status}">
  <div class="request-top">
    <span class="request-when">${t.date(r.slot_date)}, <span class="num">${t.timeRange(r.start_min, r.end_min)}</span></span>
    <span class="badge badge-${r.status}">${statusLabel(c, r)}</span>
  </div>
  <div>${what(r)}</div>
  <div class="muted">${t('{total} instead of {base}', { total: t.duration(r.total_min), base: t.duration(r.base_min) })}, ${t.money(r.price_cents, r.currency)} (${t('standard price')})</div>
  <div class="request-who"><span>${r.client_name || t('Client')}</span>, ${contactLink(c, r.client_contact)}${clientLanguage(c, r)}</div>
  <div class="small muted">${t('Reference {ref}', { ref: r.ref })}</div>
  ${
    actions && r.status === 'pending'
      ? html`<div class="actions">
    <form class="inline" method="post" action="/app/requests/${r.id}/confirm"><button class="btn btn-confirm" type="submit">${t('Confirm')}</button></form>
    <form class="inline" method="post" action="/app/requests/${r.id}/decline"><button class="btn btn-outline" type="submit">${t('Decline')}</button></form>
  </div>`
      : ''
  }
  ${
    message
      ? html`<details>
    <summary>${t('Message for the client')}</summary>
    <textarea id="msg-${r.id}" readonly rows="4">${message}</textarea>
    <div class="actions">
      <button class="btn btn-outline btn-small" type="button" data-copy="#msg-${r.id}">${t('Copy message')}</button>
      ${contactActions(c, r.client_contact, message, subject)}
    </div>
  </details>`
      : ''
  }
</li>`;
}

function waitlistCard(c, r) {
  const t = c.t;
  const salon = c.user.salon;
  const message = r.client_name ? waitlistMessage(salon, r) : '';
  return html`<li class="request is-${r.status}">
  <div class="request-top">
    <span class="request-when">${r.service_name}</span>
    <span class="badge badge-${r.status}">${statusLabel(c, r)}</span>
  </div>
  <div class="request-who"><span>${r.client_name || t('Client')}</span>, ${contactLink(c, r.client_contact)}${clientLanguage(c, r)}</div>
  ${r.note ? html`<div><q>${r.note}</q></div>` : ''}
  <div class="small muted">${t('Reference {ref}, received {date}', { ref: r.ref, date: t.day(r.created_at, salon.timezone) })}</div>
  ${
    r.status === 'pending'
      ? html`<div class="actions">
    ${contactActions(c, r.client_contact, message, translator(r.locale)('Your appointment at {salon}', { salon: salon.name }))}
    <form class="inline" method="post" action="/app/requests/${r.id}/close"><button class="btn btn-outline btn-small" type="submit">${t('Mark as contacted')}</button></form>
  </div>`
      : ''
  }
</li>`;
}

function pct(part, whole) {
  return whole > 0 ? Math.round((part / whole) * 100) : 0;
}

function funnelPanel(c, f) {
  const t = c.t;
  const max = Math.max(1, f.view);
  const steps = [
    [t('Visits to your page'), f.view, null],
    [t('Saw upgraded times'), f.offers, pct(f.offers, f.view)],
    [t('Sent a request'), f.request, pct(f.request, f.offers)],
    [t('Confirmed'), f.confirmed, pct(f.confirmed, f.request)],
  ];
  return html`<section class="panel funnel" aria-labelledby="funnel-h">
  <h2 id="funnel-h">${t('Last 30 days')}</h2>
  <ol class="funnel-steps">
    ${steps.map(
      ([label, n, p]) => html`<li>
      <span class="funnel-label">${label}</span>
      <progress max="${max}" value="${n}" aria-hidden="true"></progress>
      <span class="funnel-n num">${n}${p === null ? '' : html` <small>${t('{pct}% of the step before', { pct: p })}</small>`}</span>
    </li>`,
    )}
  </ol>
  ${f.waitlist || f.noslot ? html`<p class="small muted">${t('Joined the waitlist: {n}. Times no upgraded slot was free: {m}.', { n: f.waitlist, m: f.noslot })}</p>` : ''}
</section>`;
}

export function dashboardView(c, d) {
  const t = c.t;
  const salon = c.user.salon;
  const m = d.metrics;
  const revenue = m.revenue.length ? m.revenue.map((r) => t.money(r.cents, r.currency)).join(' + ') : t.money(0, salon.currency);
  const steps = [
    [d.setup.services > 0, d.setup.services > 0 ? '/app/services' : '/app/setup', d.setup.services > 0 ? t('Add the services clients book') : t('Pick your salon type and enter your prices')],
    [d.setup.readyServices > 0, '/app/upgrades', t('Add upgrades that add extra time')],
    [d.setup.windows > 0, '/app/hours', t('Mark the hours that are usually quiet')],
    [false, '/app/share', t('Share your link and put up the QR code')],
  ];
  const ready = steps.slice(0, 3).every((s) => s[0]);
  const body = html`
<div class="page-head">
  <div>
    <h1>${t('Requests')}</h1>
    <p class="muted">${t('Your request page:')} <a href="/s/${salon.slug}">${d.publicUrl}</a></p>
  </div>
</div>
${flash(c, d.flash)}
${
  ready
    ? ''
    : html`<section class="panel" aria-labelledby="setup-h">
  <h2 id="setup-h">${t('Get your request page ready')}</h2>
  <ol class="checklist">
    ${steps.map(([done, href, label]) => html`<li class="${done ? 'done' : ''}"><a href="${href}">${label}</a></li>`)}
  </ol>
</section>`
}

<h2 class="visually-hidden">${t('Results so far')}</h2>
<dl class="ledger">
  <div><dt>${t('Requests received')}</dt><dd>${m.offers}</dd></div>
  <div><dt>${t('Confirmed')}</dt><dd>${m.confirmed}</dd></div>
  <div><dt>${t('Booked value')}</dt><dd>${revenue}</dd></div>
  <div class="proof"><dt>${t('Discount given')}</dt><dd>${t.money(m.discount_cents, salon.currency)}</dd></div>
</dl>

<p class="small muted">${t('Booked value is not collected revenue. Mark completed services in Appointments.')} <a href="/app/appointments">${t('Appointments')}</a></p>
<dl class="ledger ledger-two"><div><dt>${t('Completed service value')}</dt><dd>${m.completed.length ? m.completed.map((r) => t.money(r.cents,r.currency)).join(' + ') : t.money(0,salon.currency)}</dd></div><div><dt>${t('Completed')}</dt><dd>${m.completed.reduce((sum,r)=>sum+r.n,0)}</dd></div></dl>
<h2>${t('Waiting for you')}</h2>
${
  d.pending.length
    ? html`<ul class="requests">${d.pending.map((r) => requestCard(c, r))}</ul>`
    : html`<p class="empty">${t('No requests waiting.')} ${ready ? t('Share your link where clients find you fully booked.') : t('Finish the steps above, then share your link.')}</p>`
}

${d.waitlist.length ? html`<h2>${t('Waitlist')}</h2><ul class="requests">${d.waitlist.map((r) => waitlistCard(c, r))}</ul>` : ''}

<h2>${t('Coming up')}</h2>
${
  d.upcoming.length
    ? html`<ul class="requests">${d.upcoming.map((r) => requestCard(c, r, { actions: false }))}</ul>`
    : html`<p class="empty">${t('Confirmed appointments from your request page appear here and in your calendar feed (see Settings).')}</p>`
}

${funnelPanel(c, d.funnel)}

${
  d.recent.length
    ? html`<section class="section"><h2>${t('Recently answered')}</h2>
<section class="table-wrap" tabindex="0" aria-label="${t('Recently answered')}"><table class="list">
  <thead><tr><th scope="col">${t('When')}</th><th scope="col">${t('Service')}</th><th scope="col">${t('Status')}</th><th scope="col">${t('Reference')}</th></tr></thead>
  <tbody>${d.recent.map(
    (r) => html`<tr>
    <td class="num nowrap">${r.kind === 'offer' ? html`${t.date(r.slot_date)} ${t.time(r.start_min)}` : t('Waitlist')}</td>
    <td>${r.service_name}</td>
    <td><span class="badge badge-${r.status}">${statusLabel(c, r)}</span></td>
    <td class="num nowrap">${r.ref}</td>
  </tr>`,
  )}</tbody>
</table></section>
<p class="small muted">${t('Client names and contact details are erased {days} days after each appointment. The numbers above keep counting.', { days: RETENTION_DAYS })}</p>
</section>`
    : ''
}`;
  return appPage(c, { title: t('Requests'), body, current: '/app', banners: d.banners });
}
