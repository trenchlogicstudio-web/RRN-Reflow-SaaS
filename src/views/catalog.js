// Copyright (c) 2026 Miloš Petrović (Trench Logic Studio) · SPDX-License-Identifier: MIT
// Services, upgrades and the guided setup.

import { html, raw } from '../html.js';
import { appPage, errorFor, invalid, formErrors, selected, checked } from './layout.js';
import { flash } from './dashboard.js';
import { centsToInput } from '../money.js';
import { selectBundle, requiredAddedMin, MIN_UPLIFT_PCT } from '../../engines/reflow/engine.js';
import { TEMPLATES, DEFAULT_HOURS } from '../templates.js';

/* -------------------------------- services -------------------------------- */

function readiness(c, service, upgrades, salon) {
  const t = c.t;
  if (!service.active) return html`<span class="readiness muted">${t('Hidden from clients.')}</span>`;
  const bundle = selectBundle(service, upgrades, salon.min_uplift_pct);
  if (!bundle) {
    const need = requiredAddedMin(service.duration_min, salon.min_uplift_pct);
    return html`<span class="readiness bad">${t('Not offered yet: needs upgrades worth at least {n} extra minutes.', { n: need })} <a href="/app/upgrades">${t('Add upgrades')}</a></span>`;
  }
  return html`<span class="readiness ok">${t('Offered as {what}: {total} instead of {base}.', {
    what: [service.name, ...bundle.items.map((u) => u.name)].join(' + '),
    total: t.duration(service.duration_min + bundle.added_min),
    base: t.duration(service.duration_min),
  })}</span>`;
}

function serviceFields(c, prefix, v, errors, currency) {
  const t = c.t;
  return html`<div class="row row-3">
    <div class="field">
      <label for="${prefix}name">${t('Name')}</label>
      <input id="${prefix}name" name="name" type="text" maxlength="80" required value="${v.name ?? ''}"${invalid(errors, 'name')}>
      ${errorFor(errors, 'name')}
    </div>
    <div class="field">
      <label for="${prefix}duration">${t('Length in minutes')}</label>
      <input id="${prefix}duration" name="duration" type="number" min="5" max="600" step="5" inputmode="numeric" required value="${v.duration ?? ''}"${invalid(errors, 'duration')}>
      ${errorFor(errors, 'duration')}
    </div>
    <div class="field">
      <label for="${prefix}price">${t('Price ({currency})', { currency })}</label>
      <input id="${prefix}price" name="price" type="text" inputmode="decimal" maxlength="12" required value="${v.price ?? ''}"${invalid(errors, 'price')}>
      ${errorFor(errors, 'price')}
    </div>
  </div>`;
}

export function servicesView(c, { services, upgrades, values = {}, errors = {}, editId = null, flashCode = '', banners = [] }) {
  const t = c.t;
  const salon = c.user.salon;
  const body = html`
<div class="page-head"><div>
  <h1>${t('Services')}</h1>
  <p class="muted">${t('What clients can request. The price here is the price clients pay, always.')}</p>
</div>
${services.length ? '' : html`<a class="btn btn-primary" href="/app/setup">${t('Set up from a template')}</a>`}
</div>
${flash(c, flashCode)}
<section class="panel" aria-labelledby="add-service-h">
  <h2 id="add-service-h">${t('Add a service')}</h2>
  ${editId === null ? formErrors(c, errors) : ''}
  <form method="post" action="/app/services" novalidate>
    ${serviceFields(c, 'new-', editId === null ? values : {}, editId === null ? errors : {}, salon.currency)}
    <button class="btn btn-primary" type="submit">${t('Add service')}</button>
  </form>
</section>

<h2 class="section-title">${t('Your services')}</h2>
${
  services.length
    ? html`<ul class="items">${services.map((s) => {
        const editing = editId === s.id;
        const v = editing ? values : { name: s.name, duration: s.duration_min, price: centsToInput(s.price_cents) };
        return html`<li class="item${s.active ? '' : ' is-off'}" id="service-${s.id}">
      <div class="item-head">
        <span class="item-title">${s.name}</span>
        <span class="num">${t.duration(s.duration_min)}, ${t.money(s.price_cents, salon.currency)}</span>
      </div>
      ${readiness(c, s, upgrades, salon)}
      <details${editing ? raw(' open') : ''}>
        <summary>${t('Edit')}</summary>
        ${editing ? formErrors(c, errors) : ''}
        <form method="post" action="/app/services/${s.id}" novalidate>
          <input type="hidden" name="action" value="save">
          ${serviceFields(c, `s${s.id}-`, v, editing ? errors : {}, salon.currency)}
          <div class="actions">
            <button class="btn btn-primary" type="submit">${t('Save changes')}</button>
          </div>
        </form>
        <form method="post" action="/app/services/${s.id}" class="actions">
          <input type="hidden" name="action" value="${s.active ? 'hide' : 'show'}">
          <button class="btn btn-outline btn-small" type="submit">${s.active ? t('Hide from clients') : t('Show to clients')}</button>
        </form>
      </details>
    </li>`;
      })}</ul>`
    : html`<p class="empty">${t('No services yet. Start from a template, or add the ones clients most often find fully booked.')}</p>`
}`;
  return appPage(c, { title: t('Services'), body, current: '/app/services', banners });
}

/* -------------------------------- upgrades -------------------------------- */

function upgradeFields(c, prefix, v, errors, services) {
  const t = c.t;
  return html`<div class="row row-3">
    <div class="field">
      <label for="${prefix}name">${t('Name')}</label>
      <input id="${prefix}name" name="name" type="text" maxlength="80" required value="${v.name ?? ''}"${invalid(errors, 'name')}>
      ${errorFor(errors, 'name')}
    </div>
    <div class="field">
      <label for="${prefix}minutes">${t('Extra minutes')}</label>
      <input id="${prefix}minutes" name="minutes" type="number" min="5" max="240" step="5" inputmode="numeric" required value="${v.minutes ?? ''}"${invalid(errors, 'minutes')}>
      ${errorFor(errors, 'minutes')}
    </div>
    <div class="field">
      <label for="${prefix}service">${t('Can be added to')}</label>
      <select id="${prefix}service" name="service"${invalid(errors, 'service')}>
        <option value="all"${selected(!v.service || v.service === 'all')}>${t('All services')}</option>
        ${services.map((s) => html`<option value="${s.id}"${selected(String(v.service) === String(s.id))}>${s.name}</option>`)}
      </select>
      ${errorFor(errors, 'service')}
    </div>
  </div>`;
}

export function upgradesView(c, { upgrades, services, values = {}, errors = {}, editId = null, flashCode = '', banners = [] }) {
  const t = c.t;
  const body = html`
<div class="page-head"><div>
  <h1>${t('Upgrades')}</h1>
  <p class="muted">${t('Extra care you can give when a chair is free: a scalp massage, a treatment, a longer finish. Each offer combines the fewest upgrades needed to add at least {pct}% more time.', { pct: MIN_UPLIFT_PCT })}</p>
</div></div>
${flash(c, flashCode)}
<section class="panel" aria-labelledby="add-upgrade-h">
  <h2 id="add-upgrade-h">${t('Add an upgrade')}</h2>
  ${editId === null ? formErrors(c, errors) : ''}
  <form method="post" action="/app/upgrades" novalidate>
    ${upgradeFields(c, 'new-', editId === null ? values : {}, editId === null ? errors : {}, services)}
    <button class="btn btn-primary" type="submit">${t('Add upgrade')}</button>
  </form>
</section>
<h2 class="section-title">${t('Your upgrades')}</h2>
${
  upgrades.length
    ? html`<ul class="items">${upgrades.map((u) => {
        const editing = editId === u.id;
        const v = editing ? values : { name: u.name, minutes: u.added_min, service: u.service_id ?? 'all' };
        return html`<li class="item${u.active ? '' : ' is-off'}" id="upgrade-${u.id}">
      <div class="item-head">
        <span class="item-title">${u.name}</span>
        <span class="num">+${t('{m} min', { m: u.added_min })}</span>
      </div>
      <span class="muted">${u.service_id ? t('Only with {service}', { service: u.service_name || t('a removed service') }) : t('With any service')}${u.active ? '' : html`, ${t('switched off')}`}</span>
      <details${editing ? raw(' open') : ''}>
        <summary>${t('Edit')}</summary>
        ${editing ? formErrors(c, errors) : ''}
        <form method="post" action="/app/upgrades/${u.id}" novalidate>
          <input type="hidden" name="action" value="save">
          ${upgradeFields(c, `u${u.id}-`, v, editing ? errors : {}, services)}
          <div class="actions"><button class="btn btn-primary" type="submit">${t('Save changes')}</button></div>
        </form>
        <form method="post" action="/app/upgrades/${u.id}" class="actions">
          <input type="hidden" name="action" value="${u.active ? 'hide' : 'show'}">
          <button class="btn btn-outline btn-small" type="submit">${u.active ? t('Switch off') : t('Switch on')}</button>
        </form>
      </details>
    </li>`;
      })}</ul>`
    : html`<p class="empty">${t('No upgrades yet. Without them no offer can be made, because every offer must add real extra time.')}</p>`
}`;
  return appPage(c, { title: t('Upgrades'), body, current: '/app/upgrades', banners });
}

/* ---------------------------------- setup ---------------------------------- */

export function setupChooserView(c, { banners = [] } = {}) {
  const t = c.t;
  const body = html`
<div class="page-head"><div>
  <h1>${t('Set up your request page')}</h1>
  <p class="muted">${t('Pick the closest salon type. You will see its usual services and upgrades, enter your own prices, and can change everything later.')}</p>
</div></div>
<ul class="choices">
  ${TEMPLATES.map(
    (tpl) => html`<li><a class="choice" href="/app/setup?template=${tpl.id}">
    <span class="choice-title">${t(tpl.label)}</span>
    <span class="muted">${tpl.services.map(([name]) => t(name)).join(', ')}</span>
  </a></li>`,
  )}
</ul>
<p><a href="/app/services">${t('Or add services one by one')}</a></p>`;
  return appPage(c, { title: t('Set up your request page'), body, current: '/app/services', banners });
}

export function setupFormView(c, { template, values = null, errors = {}, banners = [] }) {
  const t = c.t;
  const salon = c.user.salon;
  const v = values || {
    services: template.services.map(([name, minutes]) => ({ on: true, name: t(name), minutes: String(minutes), price: '' })),
    upgrades: template.upgrades.map(([name, minutes]) => ({ on: true, name: t(name), minutes: String(minutes) })),
    days: DEFAULT_HOURS.weekdays.map(String),
    start: t.time(DEFAULT_HOURS.start),
    end: t.time(DEFAULT_HOURS.end),
    capacity: String(DEFAULT_HOURS.capacity),
  };
  const body = html`
<div class="page-head"><div>
  <h1>${t(template.label)}</h1>
  <p class="muted">${t('Untick what you do not offer, adjust names and minutes, and enter your prices. Clients always pay exactly these prices.')}</p>
</div></div>
${formErrors(c, errors)}
<form method="post" action="/app/setup" novalidate class="setup">
  <input type="hidden" name="template" value="${template.id}">
  <section class="panel">
    <h2>${t('Services')}</h2>
    ${errorFor(errors, 'services')}
    <section class="table-wrap" tabindex="0" aria-label="${t('Services')}"><table class="list setup-table">
      <thead><tr><th scope="col">${t('Offer')}</th><th scope="col">${t('Name')}</th><th scope="col">${t('Minutes')}</th><th scope="col">${t('Price ({currency})', { currency: salon.currency })}</th></tr></thead>
      <tbody>${v.services.map(
        (s, i) => html`<tr>
        <td><input type="checkbox" name="s${i}_on" value="on" aria-label="${t('Offer')}"${checked(s.on)}></td>
        <td><input type="text" name="s${i}_name" maxlength="80" value="${s.name}" aria-label="${t('Name')}"${invalid(errors, `s${i}`)}></td>
        <td><input type="number" name="s${i}_minutes" min="5" max="600" step="5" inputmode="numeric" value="${s.minutes}" aria-label="${t('Minutes')}"></td>
        <td><input type="text" name="s${i}_price" inputmode="decimal" maxlength="12" value="${s.price}" aria-label="${t('Price ({currency})', { currency: salon.currency })}"${invalid(errors, `s${i}`)}>${errorFor(errors, `s${i}`)}</td>
      </tr>`,
      )}</tbody>
    </table></section>
  </section>
  <section class="panel">
    <h2>${t('Upgrades')}</h2>
    <p class="muted small">${t('Extra care added to an offer so that it lasts at least {pct}% longer.', { pct: MIN_UPLIFT_PCT })}</p>
    <section class="table-wrap" tabindex="0" aria-label="${t('Upgrades')}"><table class="list setup-table">
      <thead><tr><th scope="col">${t('Offer')}</th><th scope="col">${t('Name')}</th><th scope="col">${t('Extra minutes')}</th></tr></thead>
      <tbody>${v.upgrades.map(
        (u, i) => html`<tr>
        <td><input type="checkbox" name="u${i}_on" value="on" aria-label="${t('Offer')}"${checked(u.on)}></td>
        <td><input type="text" name="u${i}_name" maxlength="80" value="${u.name}" aria-label="${t('Name')}"${invalid(errors, `u${i}`)}>${errorFor(errors, `u${i}`)}</td>
        <td><input type="number" name="u${i}_minutes" min="5" max="240" step="5" inputmode="numeric" value="${u.minutes}" aria-label="${t('Extra minutes')}"></td>
      </tr>`,
      )}</tbody>
    </table></section>
  </section>
  <section class="panel">
    <h2>${t('Quiet hours')}</h2>
    <p class="muted small">${t('When do you usually have a free chair? You can add more times later.')}</p>
    <fieldset class="days">
      <legend>${t('Days')}</legend>
      ${[1, 2, 3, 4, 5, 6, 7].map((d) => html`<label><input type="checkbox" name="day" value="${d}"${checked(v.days.includes(String(d)))}> ${t.weekday(d)}</label>`)}
    </fieldset>
    ${errorFor(errors, 'day')}
    <div class="row row-3">
      <div class="field"><label for="start">${t('From')}</label><input id="start" name="start" type="time" step="900" value="${v.start}"${invalid(errors, 'start')}>${errorFor(errors, 'start')}</div>
      <div class="field"><label for="end">${t('Until')}</label><input id="end" name="end" type="time" step="900" value="${v.end}"${invalid(errors, 'end')}>${errorFor(errors, 'end')}</div>
      <div class="field"><label for="capacity">${t('Free chairs')}</label><input id="capacity" name="capacity" type="number" min="1" max="50" inputmode="numeric" value="${v.capacity}"${invalid(errors, 'capacity')}>${errorFor(errors, 'capacity')}</div>
    </div>
  </section>
  <button class="btn btn-primary" type="submit">${t('Create my request page')}</button>
</form>`;
  return appPage(c, { title: t(template.label), body, current: '/app/services', banners });
}
