// Copyright (c) 2026 Miloš Petrović (Trench Logic Studio) · SPDX-License-Identifier: MIT
import { canClientCancel } from '../availability.js';
import { html } from '../html.js';
import { quotedKey } from '../quote.js';
import { publicPage, sitePage, errorFor, invalid, formErrors, notice, langField, rich } from './layout.js';
import { RETENTION_DAYS } from '../config.js';
import { tk } from '../i18n/index.js';

function salonMeta(salon) {
  const lines = [salon.address, salon.phone].filter(Boolean);
  return lines.length ? html`<p class="salon-meta">${lines.map((l, i) => html`${i ? html`<br>` : ''}${l}`)}</p>` : '';
}

export function salonView(c, salon, services) {
  const t = c.t;
  const body = html`
<header class="salon-head">
  <h1>${salon.name}</h1>
  ${salonMeta(salon)}
  <p class="lead">${t('Fully booked when you wanted to come in? Choose your service and we will offer you a calmer time with extra care included, at the same price.')}</p>
</header>
${
  services.length
    ? html`<h2 class="visually-hidden">${t('Services')}</h2>
<ul class="menu">
  ${services.map(
    (s) => html`<li><a href="${c.link(`/s/${salon.slug}/offers?service=${s.id}`)}">
    <span class="menu-name">${s.name}</span>
    <span class="menu-leader" aria-hidden="true"></span>
    <span class="menu-time">${t.duration(s.duration_min)}</span>
    <span class="menu-price">${t.money(s.price_cents, salon.currency)}</span>
  </a></li>`,
  )}
</ul>
<p class="small muted">${t('Prices are the salon’s standard prices. Upgraded appointments never cost more, or less.')}</p>`
    : html`<div class="notice notice-info"><p>${t('{salon} is not taking requests through this page yet.', { salon: salon.name })}</p></div>`
}`;
  return publicPage(c, salon, { title: t('Request an appointment'), body, switchPath: `/s/${salon.slug}` });
}

function offerTitle(o) {
  return [o.service_name, ...o.upgrades.map((u) => u.name)].join(' + ');
}

function contactFields(c, salon, values, errors) {
  const t = c.t;
  return html`
  <div class="field">
    <label for="name">${t('Your name')}</label>
    <input id="name" name="name" type="text" autocomplete="name" maxlength="80" required value="${values.name || ''}"${invalid(errors, 'name')}>
    ${errorFor(errors, 'name')}
  </div>
  <div class="field">
    <label for="contact">${t('Phone or email')}</label>
    <input id="contact" name="contact" type="text" autocomplete="tel" inputmode="text" maxlength="120" required value="${values.contact || ''}"${invalid(errors, 'contact')}>
    <span class="hint">${t('{salon} uses this to confirm your appointment. Please include the country code with a phone number, for example +44.', { salon: salon.name })}</span>
    ${errorFor(errors, 'contact')}
  </div>
  <div class="trap" aria-hidden="true">
    <label for="website">${t('Leave this field empty')}</label>
    <input id="website" name="website" type="text" tabindex="-1" autocomplete="off">
  </div>
  <div class="field">
    <label class="check"><input type="checkbox" name="consent" value="on"${values.consent ? html` checked` : ''}${invalid(errors, 'consent')}> <span>${rich(
      t,
      '{salon} may contact me about this request. My details are deleted {days} days after the appointment. {privacy}',
      { salon: salon.name, days: String(RETENTION_DAYS), privacy: html`<a href="${c.link('/privacy')}">${t('Privacy notice')}</a>` },
    )}</span></label>
    ${errorFor(errors, 'consent')}
  </div>`;
}

export function offersView(c, salon, service, result, { values = {}, errors = {}, message = '', locked = false } = {}) {
  if (locked || result.status !== 'upgrade_redirect') return waitlistView(c, salon, service, { values, errors, message, locked });
  const t = c.t;
  const chosen = values.offer || result.offers[0].key;
  const body = html`
<header class="salon-head">
  <p><a href="${c.link(`/s/${salon.slug}`)}">${salon.name}</a></p>
  <h1>${t('Pick your appointment')}</h1>
  <p class="lead">${t('{service} with extra time added, at the usual price of {price}.', { service: service.name, price: t.money(service.price_cents, salon.currency) })}</p>
</header>
${notice('info', message)}
${formErrors(c, errors)}
<form method="post" action="/s/${salon.slug}/request" novalidate>
  ${langField(c)}
  <input type="hidden" name="service" value="${service.id}">
  <fieldset class="offers">
    <legend>${t('Available upgraded times')}</legend>
    ${result.offers.map(
      (o) => html`<label class="offer">
      <input type="radio" name="offer" value="${quotedKey(o)}"${quotedKey(o) === chosen ? html` checked` : ''}>
      <span class="offer-when">${t.date(o.slot_date)}, <span class="offer-time">${t.timeRange(o.start_min, o.end_min)}</span></span>
      <span class="offer-what">${offerTitle(o)}</span>
      <span class="offer-extra">${t('{total} instead of {base}', { total: t.duration(o.total_min), base: t.duration(o.base_min) })}</span>
      <span class="offer-price">${t.money(o.price_cents, salon.currency)} <span>${t('your usual price')}</span></span>
    </label>`,
    )}
  </fieldset>
  ${errorFor(errors, 'offer')}
  ${contactFields(c, salon, values, errors)}
  <button class="btn btn-primary btn-block" type="submit">${t('Send request')}</button>
  <p class="small muted">${t('Request hold: {hours} hours. Changes and cancellations close {minutes} minutes before the appointment.', {hours:salon.hold_hours,minutes:salon.cancel_notice_min})}</p>
  <p class="small muted">${t('Nothing is booked yet: {salon} confirms your request personally.', { salon: salon.name })}</p>
</form>`;
  return publicPage(c, salon, { title: t('Pick your appointment'), body, switchPath: `/s/${salon.slug}/offers?service=${service.id}` });
}

export function waitlistView(c, salon, service, { values = {}, errors = {}, message = '', locked = false } = {}) {
  const t = c.t;
  const heading = locked ? t('Leave your details') : t('No upgraded time is free right now');
  const lead = locked
    ? t('{salon} is not offering upgraded times online at the moment. Leave your details for {service} and they will get back to you.', { salon: salon.name, service: service.name })
    : t('Leave your details for {service} and {salon} will get back to you when a place opens.', { salon: salon.name, service: service.name });
  const body = html`
<header class="salon-head">
  <p><a href="${c.link(`/s/${salon.slug}`)}">${salon.name}</a></p>
  <h1>${heading}</h1>
  <p class="lead">${lead}</p>
</header>
${notice('info', message)}
${formErrors(c, errors)}
<form method="post" action="/s/${salon.slug}/waitlist" novalidate>
  ${langField(c)}
  <input type="hidden" name="service" value="${service.id}">
  ${contactFields(c, salon, values, errors)}
  <div class="field">
    <label for="note">${t('When suits you?')} <span class="muted">${t('(optional)')}</span></label>
    <textarea id="note" name="note" maxlength="300"${invalid(errors, 'note')}>${values.note || ''}</textarea>
    ${errorFor(errors, 'note')}
  </div>
  <button class="btn btn-primary btn-block" type="submit">${t('Join the waitlist')}</button>
</form>`;
  return publicPage(c, salon, { title: heading, body, switchPath: `/s/${salon.slug}/offers?service=${service.id}` });
}

const STATUS_TEXT = {
  offer: {
    pending: [tk('Request sent'), (t, s) => t('{salon} will confirm it personally. Keep this page: it shows the answer as soon as they reply.', { salon: s })],
    confirmed: [tk('Confirmed'), (t, s, r) => t('See you on {date} at {time}.', { date: t.dateLong(r.slot_date), time: t.time(r.start_min) })],
    declined: [tk('Not available'), (t, s) => t('{salon} could not confirm this time. You are welcome to choose another one.', { salon: s })],
    expired: [tk('Expired'), (t) => t('This request was not confirmed before its time passed.')],
  },
  waitlist: {
    pending: [tk('You are on the waitlist'), (t, s) => t('{salon} will contact you when a place opens.', { salon: s })],
    closed: [tk('Handled'), (t, s) => t('{salon} has picked up your request.', { salon: s })],
    expired: [tk('Expired'), (t) => t('This waitlist request has expired.')],
    declined: [tk('Closed'), (t) => t('This waitlist request was closed.')],
  },
};

export function statusView(c, salon, r, upgrades) {
  const t = c.t;
  const entry = (STATUS_TEXT[r.kind] && STATUS_TEXT[r.kind][r.status]) || [tk('Request'), () => ''];
  const headline = r.outcome === 'canceled' ? t('Canceled') : r.outcome === 'completed' ? t('Completed') : r.outcome === 'no_show' ? t('No-show') : t(entry[0]);
  const extras = upgrades.map((u) => u.name).join(', ');
  const confirmed = r.kind === 'offer' && r.status === 'confirmed';
  const body = html`
<header class="salon-head">
  <p><a href="${c.link(`/s/${salon.slug}`)}">${salon.name}</a></p>
  <h1>${headline}</h1>
  <p class="lead">${r.outcome ? salon.name : entry[1](t, salon.name, r)}</p>
</header>
<div class="ticket">
  <span class="badge badge-${r.status}">${headline}</span>
  ${
    r.kind === 'offer'
      ? html`<p class="ticket-when">${t.dateLong(r.slot_date)}<br><span class="num">${t.timeRange(r.start_min, r.end_min)}</span></p>`
      : html`<p class="ticket-when">${r.service_name}</p>`
  }
  <dl>
    <dt>${t('Service')}</dt><dd>${r.service_name}</dd>
    ${
      r.kind === 'offer'
        ? html`<dt>${t('Included')}</dt><dd>${extras}</dd><dt>${t('Length')}</dt><dd>${t('{total} instead of {base}', { total: t.duration(r.total_min), base: t.duration(r.base_min) })}</dd>`
        : ''
    }
    <dt>${t('Price')}</dt><dd>${t.money(r.price_cents, r.currency)}${r.kind === 'offer' ? html`, ${t('the standard price')}` : ''}</dd>
    ${salon.address ? html`<dt>${t('Address')}</dt><dd>${salon.address}</dd>` : ''}
    ${salon.phone ? html`<dt>${t('Phone')}</dt><dd><a href="tel:${salon.phone.replace(/[^\d+]/g, '')}">${salon.phone.replace(/ /g, '\u00a0')}</a></dd>` : ''}
    <dt>${t('Reference')}</dt><dd class="num">${r.ref}</dd>
  </dl>
</div>
${r.kind === 'offer' && canClientCancel(r, salon, c.now) ? html`<div class="actions"><form method="post" action="/r/${r.token}/cancel" data-confirm="${t('Cancel this appointment?')}"><button class="btn btn-outline">${t('Cancel appointment')}</button></form>${r.kind === 'offer' ? html`<a class="btn btn-outline" href="/r/${r.token}/reschedule">${t('Change appointment')}</a>` : ''}</div>` : ''}
${confirmed && !r.outcome ? html`<p class="actions"><a class="btn btn-primary" href="/r/${r.token}/calendar.ics" download>${t('Add to calendar')}</a></p>` : ''}
${
  r.status === 'declined' || r.status === 'expired'
    ? html`<p><a class="btn btn-primary" href="${c.link(`/s/${salon.slug}`)}">${t('Choose another time')}</a></p>`
    : ''
}`;
  return publicPage(c, salon, { title: headline, body, switchPath: `/r/${r.token}` });
}

export function privacyView(c) {
  const t = c.t;
  const cfg = c.config;
  const operator = cfg.operatorName || t('the operator of {product}', { product: cfg.productName });
  const body = html`<div class="wrap narrow section">
  <h1>${t('Privacy notice')}</h1>
  <p class="lead">${t('What happens to your details when you use {product}.', { product: cfg.productName })}</p>
  <h2>${t('If you send a request to a salon')}</h2>
  <p>${t('The salon you write to decides what happens with your request; {product} only processes it on the salon’s behalf. We store your name, the phone number or email you give, the service and time you chose, the language you used, and the moment you agreed to be contacted.', { product: cfg.productName })}</p>
  <p>${t('Your details are used only to answer that request, including emails about it if you gave an email address. They are deleted {days} days after the appointment date (or {days} days after a waitlist request). What remains is anonymous: the service, the time and the price, for the salon’s statistics.', { days: RETENTION_DAYS })}</p>
  <p>${t('Pages for clients set no cookies and load nothing from other websites. Visits are counted per day without any personal data. There is no tracking and no advertising.')}</p>
  <h2>${t('If you run a salon account')}</h2>
  <p>${t('We store your email, a protected form of your password (never the password itself), your salon’s settings and the requests you receive. One cookie keeps you logged in. Email is sent through the provider this installation is configured with. Payments, if switched on, are handled entirely by the payment provider; this site never sees card details. You can delete your account and all of its data at any time from Settings.')}</p>
  <h2>${t('Your rights')}</h2>
  <p>${
    cfg.contactEmail
      ? rich(t, 'You can ask for a copy of your details, for corrections, or for deletion. For a request you sent to a salon, contact that salon directly; for anything else, contact {operator} at {email}.', {
          operator,
          email: html`<a href="mailto:${cfg.contactEmail}">${cfg.contactEmail}</a>`,
        })
      : t('You can ask for a copy of your details, for corrections, or for deletion. For a request you sent to a salon, contact that salon directly; for anything else, contact {operator}.', { operator })
  }</p>
</div>`;
  return sitePage(c, { title: t('Privacy notice'), body, robots: 'index, follow', switchPath: '/privacy' });
}

export function termsView(c) {
  const t = c.t;
  const cfg = c.config;
  const body = html`<div class="wrap narrow section">
  <h1>${t('Terms of use')}</h1>
  <p class="lead">${cfg.productName}</p>
  <h2>${t('What you get')}</h2>
  <p>${
    c.billing.enabled
      ? t('A free trial, then a monthly subscription you can cancel at any time. Prices are shown before you subscribe. Payments and invoices are handled by our payment provider.')
      : t('Free use of the Reflow level while the beta runs. Features may change. If paid plans are introduced, you will be told in advance and nothing will be charged without your explicit agreement.')
  }</p>
  <h2>${t('What we ask')}</h2>
  <p>${t('Use your request page only for your own business and only for real appointments. You are responsible for honouring the appointments you confirm and for treating your clients’ details with care.')}</p>
  <h2>${t('No warranty')}</h2>
  <p>${t('The service is provided as is. Keep your own booking system as the record of your appointments.')}</p>
  <h2>${t('Ending')}</h2>
  <p>${t('You can delete your account at any time from Settings; your data is deleted with it.')}</p>
</div>`;
  return sitePage(c, { title: t('Terms of use'), body, robots: 'index, follow', switchPath: '/terms' });
}

export function legalView(c) {
  const t = c.t;
  const body = html`<div class="wrap narrow section">
  <h1>${t('Legal notice')}</h1>
  <p class="legal-notice">${c.config.legalNotice.map((line, i) => html`${i ? html`<br>` : ''}${line}`)}</p>
</div>`;
  return sitePage(c, { title: t('Legal notice'), body, robots: 'index, follow', switchPath: '/legal' });
}

const ERROR_TITLES = {
  400: tk('That did not work'),
  403: tk('Not allowed'),
  404: tk('Page not found'),
  405: tk('Not allowed'),
  409: tk('Already changed'),
  410: tk('This link has expired'),
  413: tk('Too large'),
  415: tk('Form not readable'),
  429: tk('Too many attempts'),
  500: tk('Something went wrong'),
};

export function errorView(c, status, message) {
  const t = c.t;
  const title = t(ERROR_TITLES[status] || ERROR_TITLES[500]);
  const body = html`<div class="wrap"><div class="center-card">
  <h1>${title}</h1>
  <p class="lead">${t(message)}</p>
  <p><a class="btn btn-outline" href="${c.link('/')}">${t('Go to the home page')}</a></p>
</div></div>`;
  return sitePage(c, { title, body });
}
