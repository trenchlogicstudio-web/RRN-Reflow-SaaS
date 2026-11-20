// Copyright (c) 2026 Miloš Petrović (Trench Logic Studio) · SPDX-License-Identifier: MIT
// Settings, plan and billing, audit log.

import { html } from '../html.js';
import { appPage, errorFor, invalid, formErrors, notice, selected, checked } from './layout.js';
import { flash } from './dashboard.js';
import { CURRENCIES } from '../money.js';
import { timeZones } from '../time.js';
import { MIN_UPLIFT_PCT } from '../../engines/reflow/engine.js';
import { PLANS } from '../plans.js';
import { LOCALES, LOCALE_NAMES, tk } from '../i18n/index.js';

const NOTICE_OPTIONS = [
  [60, 60],
  [120, 120],
  [240, 240],
  [720, 720],
  [1440, 1440],
  [2880, 2880],
];

export const NOTICE_MINUTES = NOTICE_OPTIONS.map(([m]) => String(m));

export function settingsView(c, d) {
  const t = c.t;
  const salon = c.user.salon;
  const { values = {}, errors = {}, pwErrors = {}, delErrors = {}, flashCode = '', publicBase, calendarUrl, mailOn, banners = [] } = d;
  const v = {
    name: values.name ?? salon.name,
    slug: values.slug ?? salon.slug,
    address: values.address ?? (salon.address || ''),
    phone: values.phone ?? (salon.phone || ''),
    timezone: values.timezone ?? salon.timezone,
    currency: values.currency ?? salon.currency,
    locale: values.locale ?? salon.locale,
    uplift: values.uplift ?? String(salon.min_uplift_pct),
    lead: values.lead ?? String(salon.lead_min),
  };
  const body = html`
<div class="page-head"><div><h1>${t('Settings')}</h1><p class="muted">${t('Logged in as {email}', { email: c.user.email })}</p></div></div>
${flash(c, flashCode)}
<section class="panel" aria-labelledby="salon-h">
  <h2 id="salon-h">${t('Salon')}</h2>
  ${formErrors(c, errors)}
  <form method="post" action="/app/settings" novalidate>
    <div class="field">
      <label for="name">${t('Salon name')}</label>
      <input id="name" name="name" type="text" maxlength="80" required value="${v.name}"${invalid(errors, 'name')}>
      ${errorFor(errors, 'name')}
    </div>
    <div class="row row-2">
      <div class="field">
        <label for="address">${t('Address')} <span class="muted">${t('(optional)')}</span></label>
        <input id="address" name="address" type="text" maxlength="160" autocomplete="address-line1" value="${v.address}"${invalid(errors, 'address')}>
        <span class="hint">${t('Shown to clients on their confirmation.')}</span>
        ${errorFor(errors, 'address')}
      </div>
      <div class="field">
        <label for="phone">${t('Phone')} <span class="muted">${t('(optional)')}</span></label>
        <input id="phone" name="phone" type="tel" maxlength="40" autocomplete="tel" value="${v.phone}"${invalid(errors, 'phone')}>
        ${errorFor(errors, 'phone')}
      </div>
    </div>
    <div class="field">
      <label for="slug">${t('Page address')}</label>
      <input id="slug" name="slug" type="text" maxlength="40" required value="${v.slug}"${invalid(errors, 'slug')}>
      <span class="hint">${publicBase}/s/<b>${v.slug}</b>. ${t('Lowercase letters, numbers and dashes. Links you already shared stop working if you change it.')}</span>
      ${errorFor(errors, 'slug')}
    </div>
    <div class="row row-3">
      <div class="field">
        <label for="locale">${t('Language of your request page')}</label>
        <select id="locale" name="locale"${invalid(errors, 'locale')}>
          ${LOCALES.map((l) => html`<option value="${l}"${selected(l === v.locale)}>${LOCALE_NAMES[l]}</option>`)}
        </select>
        <span class="hint">${t('Clients can switch to another language on the page.')}</span>
      </div>
      <div class="field">
        <label for="timezone">${t('Time zone')}</label>
        <select id="timezone" name="timezone"${invalid(errors, 'timezone')}>
          ${timeZones().map((z) => html`<option value="${z}"${selected(z === v.timezone)}>${z.replace(/_/g, ' ')}</option>`)}
        </select>
        ${errorFor(errors, 'timezone')}
      </div>
      <div class="field">
        <label for="currency">${t('Currency')}</label>
        <select id="currency" name="currency"${invalid(errors, 'currency')}>
          ${CURRENCIES.map((cur) => html`<option value="${cur}"${selected(cur === v.currency)}>${cur}</option>`)}
        </select>
        ${errorFor(errors, 'currency')}
      </div>
    </div>
    <div class="row row-2">
      <div class="field">
        <label for="uplift">${t('Minimum extra time (%)')}</label>
        <input id="uplift" name="uplift" type="number" min="${MIN_UPLIFT_PCT}" max="200" step="5" inputmode="numeric" required value="${v.uplift}"${invalid(errors, 'uplift')}>
        <span class="hint">${t('At least {pct}%. Raise it if you want offers to feel even more generous.', { pct: MIN_UPLIFT_PCT })}</span>
        ${errorFor(errors, 'uplift')}
      </div>
      <div class="field">
        <label for="lead">${t('Minimum notice')}</label>
        <select id="lead" name="lead"${invalid(errors, 'lead')}>
          ${NOTICE_OPTIONS.map(([min]) => html`<option value="${min}"${selected(String(min) === String(v.lead))}>${t.duration(min)}</option>`)}
        </select>
        <span class="hint">${t('How soon an offered time can start, so you have time to confirm.')}</span>
        ${errorFor(errors, 'lead')}
      </div>
    </div>
    <button class="btn btn-primary" type="submit">${t('Save settings')}</button>
  </form>
</section>

<section class="panel" aria-labelledby="you-h">
  <h2 id="you-h">${t('You')}</h2>
  <form method="post" action="/app/settings/account" novalidate>
    <div class="row row-2">
      <div class="field">
        <label for="user-locale">${t('Language of your dashboard and emails')}</label>
        <select id="user-locale" name="locale">
          ${LOCALES.map((l) => html`<option value="${l}"${selected(l === c.locale)}>${LOCALE_NAMES[l]}</option>`)}
        </select>
      </div>
      <div class="field">
        <span class="label">${t('Email notifications')}</span>
        <label class="check"><input type="checkbox" name="notify" value="on"${checked(c.user.notify_email)}> <span>${t('Email me when a client sends a request')}</span></label>
        ${mailOn ? '' : html`<span class="hint">${t('Email sending is not set up on this installation yet, so no emails go out for now.')}</span>`}
      </div>
    </div>
    <button class="btn btn-outline" type="submit">${t('Save')}</button>
  </form>
</section>

<section class="panel" aria-labelledby="cal-h">
  <h2 id="cal-h">${t('Calendar')}</h2>
  <p class="muted">${t('Subscribe to this address in Google Calendar, Apple Calendar or Outlook, and every appointment you confirm appears there by itself. Keep the address private: it shows your clients’ names.')}</p>
  ${
    calendarUrl
      ? html`<div class="share-link"><code id="cal-url">${calendarUrl}</code><button class="btn btn-outline btn-small" type="button" data-copy="#cal-url">${t('Copy address')}</button></div>
  <form method="post" action="/app/settings/calendar" class="actions"><button class="btn btn-link btn-small" type="submit">${t('Create a new address (the old one stops working)')}</button></form>`
      : html`<form method="post" action="/app/settings/calendar"><button class="btn btn-outline" type="submit">${t('Create calendar address')}</button></form>`
  }
</section>

<section class="panel" aria-labelledby="export-h">
  <h2 id="export-h">${t('Export')}</h2>
  <p class="muted">${t('All requests as a spreadsheet file (CSV), for your records or another tool.')}</p>
  <a class="btn btn-outline" href="/app/export/requests.csv" download>${t('Download requests (CSV)')}</a>
</section>

<section class="panel" aria-labelledby="pw-h">
  <h2 id="pw-h">${t('Password')}</h2>
  ${formErrors(c, pwErrors)}
  <form method="post" action="/app/settings/password" novalidate>
    <div class="row row-2">
      <div class="field">
        <label for="current">${t('Current password')}</label>
        <input id="current" name="current" type="password" autocomplete="current-password" required${invalid(pwErrors, 'current')}>
        ${errorFor(pwErrors, 'current')}
      </div>
      <div class="field">
        <label for="password">${t('New password')}</label>
        <input id="password" name="password" type="password" autocomplete="new-password" minlength="10" required${invalid(pwErrors, 'password')}>
        ${errorFor(pwErrors, 'password')}
      </div>
    </div>
    <button class="btn btn-outline" type="submit">${t('Change password')}</button>
  </form>
</section>

<section class="panel" aria-labelledby="audit-h">
  <h2 id="audit-h">${t('Audit log')}</h2>
  <p class="muted">${t('Every offer, confirmation and price change is recorded in a tamper-evident log.')}</p>
  <a class="btn btn-outline" href="/app/audit">${t('Check the audit log')}</a>
</section>

<section class="panel" aria-labelledby="delete-h">
  <h2 id="delete-h">${t('Delete account')}</h2>
  <p class="muted">${t('Deletes your salon, services, requests and client details permanently. This cannot be undone.')}</p>
  ${formErrors(c, delErrors)}
  <form method="post" action="/app/settings/delete" novalidate>
    <div class="field">
      <label for="delete-password">${t('Your password')}</label>
      <input id="delete-password" name="password" type="password" autocomplete="current-password" required${invalid(delErrors, 'password')}>
      ${errorFor(delErrors, 'password')}
    </div>
    <button class="btn btn-danger" type="submit">${t('Delete account and all data')}</button>
  </form>
</section>`;
  return appPage(c, { title: t('Settings'), body: html`${body}<section class="panel"><h2>${t('Booking policy')}</h2><form method="post" action="/app/settings/policy"><div class="row row-2"><div class="field"><label for="cancel-notice">${t('Cancellation notice (minutes)')}</label><input id="cancel-notice" name="cancel_notice" type="number" min="0" max="10080" value="${salon.cancel_notice_min}" required></div><div class="field"><label for="hold-hours">${t('Request hold (hours)')}</label><input id="hold-hours" name="hold_hours" type="number" min="1" max="168" value="${salon.hold_hours}" required></div></div><p class="hint">${t('Unanswered requests release their reserved time when the hold expires.')}</p><button class="btn btn-primary">${t('Save')}</button></form></section>`, current: '/app/settings', banners });
}

/* ------------------------------ plan and billing ----------------------------- */

const STATUS_LINE = {
  beta: tk('You are on Reflow, free during the beta.'),
  trialing: tk('Free trial until {date}.'),
  active: tk('Your subscription is active.'),
  past_due: tk('Your last payment did not go through. Please update your payment method to keep your request page running.'),
  canceled: tk('Your subscription is cancelled. Upgraded offers keep running until {date}.'),
  paused: tk('Your subscription is paused. Clients can join your waitlist, but see no upgraded times.'),
  expired: tk('Your subscription is not active. Clients can join your waitlist, but see no upgraded times.'),
};

/** The live tier's offer when subscriptions are on: the configured price, else the trial. */
export function planOffer(c) {
  const t = c.t;
  if (c.billing.priceLabel) return c.billing.priceLabel;
  return c.billing.trialDays ? t('{days}-day free trial', { days: c.billing.trialDays }) : t('Monthly subscription');
}

export function billingLine(c, salon) {
  const t = c.t;
  const date = salon.billing_status === 'trialing' ? salon.trial_ends_at : salon.billing_period_end;
  return t(STATUS_LINE[salon.billing_status] || STATUS_LINE.expired, { date: date ? t.day(date, salon.timezone) : '' });
}

export function planView(c, { interest, flashCode = '', banners = [], billing }) {
  const t = c.t;
  const salon = c.user.salon;
  const canSubscribe = billing.enabled && !['active', 'past_due'].includes(salon.billing_status) && !salon.is_demo;
  const body = html`
<div class="page-head"><div><h1>${t('Plan')}</h1><p class="muted">${t('One account, three levels.')}</p></div></div>
${flash(c, flashCode)}
${
  billing.enabled
    ? html`<section class="panel" aria-labelledby="billing-h">
  <h2 id="billing-h">${t('Subscription')}</h2>
  <p>${billingLine(c, salon)}</p>
  <div class="actions">
    ${canSubscribe ? html`<form method="post" action="/app/billing/checkout" class="inline"><button class="btn btn-primary" type="submit">${billing.priceLabel ? t('Subscribe: {price}', { price: billing.priceLabel }) : t('Subscribe')}</button></form>` : ''}
    ${billing.portalUrl && salon.billing_subscription_id ? html`<a class="btn btn-outline" href="${billing.portalUrl}" rel="noopener noreferrer">${t('Manage subscription and invoices')}</a>` : ''}
  </div>
</section>`
    : notice('info', t('You are on Reflow, free during the beta.'))
}
<ul class="tiers">
  ${PLANS.map((p) => {
    const live = p.status === 'active';
    const asked = interest.includes(p.id);
    return html`<li class="${live ? 'tier-live' : 'tier-soon'}">
    <span class="tier-name">${p.name}<span class="tier-scope">${t(p.scope)}</span></span>
    <span>${t(p.pitch)}<br><span class="small muted">${p.features.map((f) => t(f)).join('. ')}.</span></span>
    <div class="tier-state">${
      live
        ? html`${t('Your plan')}<br><span class="small muted">${billing.enabled ? planOffer(c) : t(p.price)}</span>`
        : asked
          ? html`${t('On the list')}<br><span class="small muted">${t('We will tell you when it opens')}</span>`
          : html`<form method="post" action="/app/plan/interest"><input type="hidden" name="tier" value="${p.id}"><button class="btn btn-outline btn-small" type="submit">${t('Tell me when {plan} opens', { plan: p.name })}</button></form>`
    }</div>
  </li>`;
  })}
</ul>`;
  return appPage(c, { title: t('Plan'), body, current: '/app/plan', banners });
}

/* ---------------------------------- audit ---------------------------------- */

const EVENT_LABELS = {
  'salon.created': tk('Account created'),
  'settings.updated': tk('Settings changed'),
  'service.created': tk('Service added'),
  'service.updated': tk('Service changed'),
  'upgrade.created': tk('Upgrade added'),
  'upgrade.updated': tk('Upgrade changed'),
  'window.created': tk('Quiet hours added'),
  'window.deleted': tk('Quiet hours removed'),
  'request.offer': tk('Offer requested'),
  'request.waitlist': tk('Waitlist request'),
  'request.confirmed': tk('Request confirmed'),
  'request.declined': tk('Request declined'),
  'request.closed': tk('Waitlist request handled'),
  'billing.updated': tk('Subscription changed'),
  'setup.applied': tk('Set up from a template'),
};

const BILLING_STATUS = {
  beta: tk('Free beta'),
  trialing: tk('Free trial'),
  active: tk('Active'),
  past_due: tk('Payment overdue'),
  canceled: tk('Cancelled'),
  paused: tk('Paused'),
  expired: tk('Ended'),
};

function describeEvent(c, e, currency) {
  const t = c.t;
  let p = {};
  try {
    p = JSON.parse(e.payload) || {};
  } catch {
    p = {};
  }
  const money = (cents, cur) => (Number.isInteger(cents) ? t.money(cents, cur || currency) : '');
  const days = (list) => (list || []).map((d) => t.weekdayShort(d)).join(', ');
  const chairs = (n) => t.n(n, '{n} chair', '{n} chairs');
  switch (e.type) {
    case 'salon.created':
      return t('Page address {slug}, {timezone}, {currency}', p);
    case 'settings.updated':
      return t('Page address {slug}, {timezone}, {currency}', p) + `, ${t('at least {pct}% extra time', { pct: p.min_uplift_pct })}`;
    case 'service.created':
      return `${p.name}, ${t.duration(p.duration_min)}, ${money(p.price_cents)}`;
    case 'service.updated':
      if (p.active !== undefined) return p.active ? t('Service {id} shown to clients', p) : t('Service {id} hidden from clients', p);
      return `${p.name}, ${t.duration(p.duration_min)}, ${money(p.price_cents)}${
        Number.isInteger(p.previous_price_cents) && p.previous_price_cents !== p.price_cents ? ` (${t('was {price}', { price: money(p.previous_price_cents) })})` : ''
      }`;
    case 'upgrade.created':
    case 'upgrade.updated':
      if (p.active !== undefined) return p.active ? t('Upgrade {id} switched on', p) : t('Upgrade {id} switched off', p);
      return `${p.name}, +${t('{m} min', { m: p.added_min })}`;
    case 'window.created':
      return `${days(p.weekdays)}, ${t.timeRange(p.start_min, p.end_min)}, ${chairs(p.capacity)}`;
    case 'window.deleted':
      return `${days([p.weekday])}, ${t.timeRange(p.start_min, p.end_min)}, ${chairs(p.capacity)}`;
    case 'request.offer':
      return `${p.ref ? `${p.ref}, ` : ''}${p.slot}, ${t.duration(p.base_min)} + ${t.duration(p.added_min)}, ${money(p.price_cents, p.currency)} (${t('standard price')} ${money(p.standard_price_cents, p.currency)})`;
    case 'request.waitlist':
      return p.ref ? String(p.ref) : '';
    case 'request.confirmed':
      return `${p.ref}, ${p.slot}, ${money(p.price_cents, p.currency)} (${t('standard price')} ${money(p.standard_price_cents, p.currency)})`;
    case 'billing.updated':
      return BILLING_STATUS[p.status] ? t(BILLING_STATUS[p.status]) : '';
    case 'setup.applied':
      return `${t.n(p.services, '{n} service', '{n} services')}, ${t.n(p.upgrades, '{n} upgrade', '{n} upgrades')}`;
    default:
      return p.ref ? String(p.ref) : '';
  }
}

export function auditView(c, { chain, events, banners = [] }) {
  const t = c.t;
  const currency = c.user.salon.currency;
  const body = html`
<div class="page-head"><div><h1>${t('Audit log')}</h1><p class="muted">${t('Each entry carries the fingerprint of the one before it, so a changed or deleted entry breaks the chain.')}</p></div></div>
${
  chain.ok
    ? notice('ok', t.n(chain.count, 'Chain intact: {n} entry checked, none changed.', 'Chain intact: {n} entries checked, none changed.'))
    : notice('error', t('Chain broken at entry {id}. An entry was changed or removed outside the app.', { id: chain.brokenAt }))
}
<ul class="events">${events.map(
    (e) => html`<li>
    <time datetime="${e.created_at}">${t.instant(e.created_at, c.user.salon.timezone)}</time>
    <strong>${t(EVENT_LABELS[e.type] || e.type)}</strong>
    <span>${describeEvent(c, e, currency)}</span>
  </li>`,
  )}</ul>
${chain.ok && chain.head ? html`<p class="small muted">${t('Latest fingerprint:')} <code class="fingerprint">${chain.head}</code></p>` : ''}`;
  return appPage(c, { title: t('Audit log'), body, current: '/app/settings', banners });
}
