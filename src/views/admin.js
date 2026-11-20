// Copyright (c) 2026 Miloš Petrović (Trench Logic Studio) · SPDX-License-Identifier: MIT
// Operator page: traction across all salons, subscriptions, delivery problems,
// and one-time reset links. Switched off unless ADMIN_KEY (24+ characters) is set.
// Shown in English: it is for the operator, not for salons.

import { html } from '../html.js';
import { sitePage, notice } from './layout.js';

export function adminLoginView(c, { error = '' } = {}) {
  const body = html`
<div class="wrap"><div class="center-card">
  <h1>Operator</h1>
  ${notice('error', error)}
  <form method="post" action="/admin/login" novalidate>
    <div class="field">
      <label for="key">Operator key</label>
      <input id="key" name="key" type="password" autocomplete="off" required>
    </div>
    <button class="btn btn-primary btn-block" type="submit">Open operator page</button>
  </form>
</div></div>`;
  return sitePage(c, { title: 'Operator', body, bare: true });
}

const pct = (a, b) => (b > 0 ? `${Math.round((a / b) * 100)}%` : '–');

export function adminView(c, { totals, salons, interest, funnel, billing, outbox, errors, resetLink = null }) {
  const t = c.t;
  const body = html`<div class="wrap">
<section class="panel" aria-labelledby="deployment-h"><h2 id="deployment-h">Deployment readiness</h2><ul>${c.readiness.checks.map((check) => html`<li>${check.ok ? '✓' : '○'} ${check.description}</li>`)}</ul><p>Configuration checks do not prove live payment delivery, email delivery, legal readiness or backup recovery.</p></section>

<div class="page-head"><div><h1>Operator</h1><p class="muted">All salons on this installation. Demo salons are not counted.</p></div>
  <div class="actions">
    <a class="btn btn-outline btn-small" href="/admin/salons.csv" download>Download CSV</a>
    <form method="post" action="/admin/logout" class="inline"><button class="btn btn-outline btn-small" type="submit">Log out</button></form>
  </div>
</div>
${
  resetLink
    ? html`<div class="notice notice-ok" role="status"><p>Reset link for ${resetLink.email}, valid 24 hours and usable once. Send it to them directly:</p>
  <p><code id="reset-link">${resetLink.url}</code> <button class="btn btn-outline btn-small" type="button" data-copy="#reset-link">Copy link</button></p></div>`
    : ''
}
<dl class="ledger">
  <div><dt>Salons</dt><dd>${totals.salons}</dd></div>
  <div><dt>Ready to take requests</dt><dd>${totals.ready}</dd></div>
  <div><dt>Requests received</dt><dd>${totals.offers}</dd></div>
  <div><dt>Confirmed</dt><dd>${totals.confirmed}</dd></div>
</dl>

<section class="panel">
  <h2>Last 30 days, all salons</h2>
  <section class="table-wrap" tabindex="0" aria-label="Last 30 days, all salons"><table class="list">
    <thead><tr><th scope="col">Page visits</th><th scope="col">Saw upgraded times</th><th scope="col">Requests</th><th scope="col">Confirmed</th><th scope="col">Waitlist</th></tr></thead>
    <tbody><tr>
      <td class="num">${funnel.view}</td>
      <td class="num">${funnel.offers} <span class="muted small">${pct(funnel.offers, funnel.view)}</span></td>
      <td class="num">${funnel.request} <span class="muted small">${pct(funnel.request, funnel.offers)}</span></td>
      <td class="num">${funnel.confirmed} <span class="muted small">${pct(funnel.confirmed, funnel.request)}</span></td>
      <td class="num">${funnel.waitlist}</td>
    </tr></tbody>
  </table></section>
</section>

<section class="panel">
  <h2>Subscriptions</h2>
  ${
    billing.enabled
      ? html`<p>Provider: ${billing.provider}. Active: ${billing.counts.active || 0}, on trial: ${billing.counts.trialing || 0}, payment problems: ${billing.counts.past_due || 0}, cancelled: ${billing.counts.canceled || 0}, inactive: ${(billing.counts.expired || 0) + (billing.counts.paused || 0)}.${
          billing.mrrCents ? html` Estimated subscription run rate: ${t.money(billing.mrrCents, billing.currency || 'EUR')}.` : ''
        }</p>`
      : html`<p class="muted">Billing is off: every salon uses Reflow for free (beta). See DEPLOY.md to switch it on.</p>`
  }
</section>

<section class="panel">
  <h2>Email</h2>
  <p>${outbox.provider ? `Provider: ${outbox.provider}. ` : 'No provider configured: no emails are sent. '}Sent in the last 30 days: ${outbox.sent}. Waiting: ${outbox.pending}. Failed: ${outbox.failed}.</p>
  ${outbox.lastError ? html`<p class="small muted">Last error: ${outbox.lastError}</p>` : ''}
</section>

<h2>Salons</h2>
<section class="table-wrap" tabindex="0" aria-label="Salons"><table class="list">
  <thead><tr>
    <th scope="col">Salon</th><th scope="col">Joined</th><th scope="col">Language</th><th scope="col">Setup</th>
    <th scope="col">Requests</th><th scope="col">Confirmed</th><th scope="col">Completed service value</th>
    <th scope="col">Plan</th><th scope="col">Last request</th><th scope="col">Owner</th>
  </tr></thead>
  <tbody>${salons.map(
    (s) => html`<tr>
    <td><a href="/s/${s.slug}">${s.name}</a></td>
    <td class="num nowrap">${s.created_at.slice(0, 10)}</td>
    <td>${s.locale}</td>
    <td class="small">${s.services} services, ${s.upgrades} upgrades, ${s.windows} quiet windows</td>
    <td class="num">${s.offers}</td>
    <td class="num">${s.confirmed}</td>
    <td class="num nowrap">${t.money(s.revenue_cents, s.currency)}</td>
    <td class="small">${s.billing_status}</td>
    <td class="num nowrap">${s.last_request ? s.last_request.slice(0, 10) : 'none'}</td>
    <td class="small">${s.users.map(
      (u) => html`<div>${u.email} <form class="inline" method="post" action="/admin/users/${u.id}/reset"><button class="btn btn-link btn-small" type="submit">Reset link</button></form></div>`,
    )}</td>
  </tr>`,
  )}</tbody>
</table></section>

<h2>Interest in the next levels</h2>
${
  interest.length
    ? html`<ul>${interest.map((i) => html`<li>${i.salon_name}: ${i.tier === 'relay' ? 'Relay' : 'Nexus'}, ${i.created_at.slice(0, 10)}</li>`)}</ul>`
    : html`<p class="empty">No salon has asked for Relay or Nexus yet.</p>`
}

<h2>Recent server errors</h2>
${
  errors.length
    ? html`<ul class="events">${errors.map((e) => html`<li><time>${e.at.slice(0, 16).replace('T', ' ')}</time><strong>${e.method} ${e.path}</strong><span>${e.message}</span></li>`)}</ul>`
    : html`<p class="empty">None in the last 30 days.</p>`
}
</div>`;
  return sitePage(c, { title: 'Operator', body, bare: true });
}
