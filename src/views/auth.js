// Copyright (c) 2026 Miloš Petrović (Trench Logic Studio) · SPDX-License-Identifier: MIT
import { html } from '../html.js';
import { sitePage, errorFor, invalid, formErrors, notice, selected, langField, rich } from './layout.js';
import { CURRENCIES } from '../money.js';
import { timeZones } from '../time.js';
import { RESET_LINK_HOURS } from '../config.js';

export function signupView(c, { values = {}, errors = {}, message = '' } = {}) {
  const t = c.t;
  const tz = values.timezone || 'Europe/Berlin';
  const currency = values.currency || 'EUR';
  const heading = !c.billing.enabled ? t('Start your free beta') : c.billing.trialDays ? t('Start your free trial') : t('Create account');
  const body = html`<div class="wrap"><div class="center-card">
  <h1>${heading}</h1>
  <p class="muted">${t('Set-up takes a few minutes: pick your salon type, enter your prices, and you have a page to share.')}</p>
  ${notice('error', message)}
  ${formErrors(c, errors)}
  <form method="post" action="/signup" novalidate>
    ${langField(c)}
    <div class="field">
      <label for="salon">${t('Salon name')}</label>
      <input id="salon" name="salon" type="text" autocomplete="organization" maxlength="80" required value="${values.salon || ''}"${invalid(errors, 'salon')}>
      ${errorFor(errors, 'salon')}
    </div>
    <div class="field">
      <label for="email">${t('Email')}</label>
      <input id="email" name="email" type="email" autocomplete="email" maxlength="254" required value="${values.email || ''}"${invalid(errors, 'email')}>
      ${errorFor(errors, 'email')}
    </div>
    <div class="field">
      <label for="password">${t('Password')}</label>
      <input id="password" name="password" type="password" autocomplete="new-password" minlength="10" maxlength="200" required${invalid(errors, 'password')}>
      <span class="hint">${t('At least 10 characters.')}</span>
      ${errorFor(errors, 'password')}
    </div>
    <div class="row row-2">
      <div class="field">
        <label for="timezone">${t('Time zone')}</label>
        <select id="timezone" name="timezone" data-detect-timezone${values.timezone ? html` data-chosen="1"` : ''}${invalid(errors, 'timezone')}>
          ${timeZones().map((z) => html`<option value="${z}"${selected(z === tz)}>${z.replace(/_/g, ' ')}</option>`)}
        </select>
        ${errorFor(errors, 'timezone')}
      </div>
      <div class="field">
        <label for="currency">${t('Currency')}</label>
        <select id="currency" name="currency"${invalid(errors, 'currency')}>
          ${CURRENCIES.map((cur) => html`<option value="${cur}"${selected(cur === currency)}>${cur}</option>`)}
        </select>
        ${errorFor(errors, 'currency')}
      </div>
    </div>
    <div class="field">
      <label class="check"><input type="checkbox" name="terms" value="on"${values.terms ? html` checked` : ''}${invalid(errors, 'terms')}> <span>${rich(t, 'I accept the {terms} and the {privacy}.', {
        terms: html`<a href="${c.link('/terms')}">${c.billing.enabled ? t('terms of use') : t('beta terms')}</a>`,
        privacy: html`<a href="${c.link('/privacy')}">${t('privacy notice')}</a>`,
      })}</span></label>
      ${errorFor(errors, 'terms')}
    </div>
    <button class="btn btn-primary btn-block" type="submit">${t('Create account')}</button>
  </form>
  <p class="small muted">${t('Already have an account?')} <a href="${c.link('/login')}">${t('Log in')}</a></p>
</div></div>`;
  return sitePage(c, { title: heading, body, switchPath: '/signup' });
}

export function loginView(c, { values = {}, errors = {}, message = '', ok = '', next = '' } = {}) {
  const t = c.t;
  const body = html`<div class="wrap"><div class="center-card">
  <h1>${t('Log in')}</h1>
  ${notice('ok', ok)}
  ${notice('error', message)}
  <form method="post" action="/login" novalidate>
    ${langField(c)}
    ${next ? html`<input type="hidden" name="next" value="${next}">` : ''}
    <div class="field">
      <label for="email">${t('Email')}</label>
      <input id="email" name="email" type="email" autocomplete="email" maxlength="254" required value="${values.email || ''}"${invalid(errors, 'email')}>
      ${errorFor(errors, 'email')}
    </div>
    <div class="field">
      <label for="password">${t('Password')}</label>
      <input id="password" name="password" type="password" autocomplete="current-password" maxlength="200" required${invalid(errors, 'password')}>
      ${errorFor(errors, 'password')}
    </div>
    <button class="btn btn-primary btn-block" type="submit">${t('Log in')}</button>
  </form>
  <p class="small muted"><a href="${c.link('/forgot')}">${t('Forgot your password?')}</a></p>
  <p class="small muted">${t('New here?')} <a href="${c.link('/signup')}">${!c.billing.enabled ? t('Start your free beta') : c.billing.trialDays ? t('Start your free trial') : t('Create account')}</a></p>
</div></div>`;
  return sitePage(c, { title: t('Log in'), body, switchPath: '/login' });
}

export function forgotView(c, { sent = false, errors = {}, values = {} } = {}) {
  const t = c.t;
  const contact = c.config.contactEmail;
  let content;
  if (!c.mail.provider) {
    content = contact
      ? html`<p class="lead">${rich(t, 'Email us from the address you signed up with, and we will send you a reset link: {email}', {
          email: html`<a href="mailto:${contact}">${contact}</a>`,
        })}</p>`
      : html`<p class="lead">${t('Contact the operator of this service for a reset link.')}</p>`;
  } else if (sent) {
    content = html`<div class="notice notice-ok" role="status"><p>${t('If an account exists for that address, a reset link is on its way. It works once, for {hours} hours.', { hours: RESET_LINK_HOURS })}</p></div>`;
  } else {
    content = html`<p class="muted">${t('Enter the email you signed up with. We will send you a link to choose a new password.')}</p>
  ${formErrors(c, errors)}
  <form method="post" action="/forgot" novalidate>
    ${langField(c)}
    <div class="field">
      <label for="email">${t('Email')}</label>
      <input id="email" name="email" type="email" autocomplete="email" maxlength="254" required value="${values.email || ''}"${invalid(errors, 'email')}>
      ${errorFor(errors, 'email')}
    </div>
    <button class="btn btn-primary btn-block" type="submit">${t('Send reset link')}</button>
  </form>`;
  }
  const body = html`<div class="wrap"><div class="center-card">
  <h1>${t('Forgot your password?')}</h1>
  ${content}
  <p class="small muted"><a href="${c.link('/login')}">${t('Back to log in')}</a></p>
</div></div>`;
  return sitePage(c, { title: t('Forgot your password?'), body, switchPath: '/forgot' });
}

export function resetView(c, { token, email, errors = {}, invalidLink = false } = {}) {
  const t = c.t;
  const body = invalidLink
    ? html`<div class="wrap"><div class="center-card">
  <h1>${t('This link has expired')}</h1>
  <p class="muted">${t('Reset links work once and for {hours} hours. Ask for a new one.', { hours: RESET_LINK_HOURS })}</p>
  <p><a class="btn btn-outline" href="${c.link('/forgot')}">${t('Ask for a new link')}</a></p>
</div></div>`
    : html`<div class="wrap"><div class="center-card">
  <h1>${t('Choose a new password')}</h1>
  <p class="muted">${t('For {email}. You will be logged out everywhere else.', { email })}</p>
  ${formErrors(c, errors)}
  <form method="post" action="/reset/${token}" novalidate>
    ${langField(c)}
    <div class="field">
      <label for="password">${t('New password')}</label>
      <input id="password" name="password" type="password" autocomplete="new-password" minlength="10" maxlength="200" required${invalid(errors, 'password')}>
      <span class="hint">${t('At least 10 characters.')}</span>
      ${errorFor(errors, 'password')}
    </div>
    <button class="btn btn-primary btn-block" type="submit">${t('Save new password')}</button>
  </form>
</div></div>`;
  return sitePage(c, { title: t('Choose a new password'), body });
}
