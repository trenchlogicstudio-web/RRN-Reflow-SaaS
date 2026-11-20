// Copyright (c) 2026 Miloš Petrović (Trench Logic Studio) · SPDX-License-Identifier: MIT
// Quiet hours: a weekly picture and the list behind it.

import { html, raw } from '../html.js';
import { appPage, errorFor, invalid, formErrors, checked } from './layout.js';
import { flash } from './dashboard.js';

function escapeText(s) {
  return String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
}

function weekChart(c, windows) {
  if (!windows.length) return '';
  const t = c.t;
  const startH = Math.min(8, ...windows.map((w) => Math.floor(w.start_min / 60)));
  const endH = Math.max(20, ...windows.map((w) => Math.ceil(w.end_min / 60)));
  const hourH = 34;
  const left = 46;
  const top = 32;
  const colW = 64;
  const width = left + colW * 7 + 8;
  const height = top + (endH - startH) * hourH + 10;
  const y = (min) => top + ((min - startH * 60) / 60) * hourH;
  const parts = [];
  for (let h = startH; h <= endH; h++) {
    parts.push(`<line class="grid-line" x1="${left}" x2="${width - 8}" y1="${y(h * 60)}" y2="${y(h * 60)}"/>`);
    parts.push(`<text class="hour-label" x="${left - 8}" y="${y(h * 60) + 4}" text-anchor="end">${String(h).padStart(2, '0')}:00</text>`);
  }
  for (let d = 0; d < 7; d++) {
    parts.push(`<text class="day-label" x="${left + d * colW + colW / 2}" y="21" text-anchor="middle">${escapeText(t.weekdayShort(d + 1))}</text>`);
    parts.push(`<line class="grid-line" x1="${left + d * colW}" x2="${left + d * colW}" y1="${top}" y2="${height - 10}"/>`);
  }
  for (const w of windows) {
    const x = left + (w.weekday - 1) * colW + 4;
    const y1 = y(w.start_min);
    const h = Math.max(8, y(w.end_min) - y1);
    parts.push(`<rect class="qh" x="${x}" y="${y1}" width="${colW - 8}" height="${h}" rx="6"/>`);
    if (h >= 18) parts.push(`<text class="qh-label" x="${x + 5}" y="${y1 + 16}">${escapeText(t.n(w.capacity, '{n} chair', '{n} chairs'))}</text>`);
  }
  return raw(`<svg class="week" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeText(t('Weekly view of your quiet hours'))}">${parts.join('')}</svg>`);
}

export function hoursView(c, { windows, values = {}, errors = {}, flashCode = '', banners = [] }) {
  const t = c.t;
  const days = values.days || [];
  const body = html`
<div class="page-head"><div>
  <h1>${t('Quiet hours')}</h1>
  <p class="muted">${t('The times you usually have free chairs. Offers are placed only inside these hours, and never more at once than the chairs you list.')}</p>
</div></div>
${flash(c, flashCode)}
${weekChart(c, windows)}
<section class="panel" aria-labelledby="add-hours-h">
  <h2 id="add-hours-h">${t('Add quiet hours')}</h2>
  ${formErrors(c, errors)}
  <form method="post" action="/app/hours" novalidate>
    <fieldset class="days">
      <legend>${t('Days')}</legend>
      ${[1, 2, 3, 4, 5, 6, 7].map((d) => html`<label><input type="checkbox" name="day" value="${d}"${checked(days.includes(String(d)))}> ${t.weekday(d)}</label>`)}
    </fieldset>
    ${errorFor(errors, 'day')}
    <div class="row row-3">
      <div class="field">
        <label for="start">${t('From')}</label>
        <input id="start" name="start" type="time" step="900" required value="${values.start || '13:00'}"${invalid(errors, 'start')}>
        ${errorFor(errors, 'start')}
      </div>
      <div class="field">
        <label for="end">${t('Until')}</label>
        <input id="end" name="end" type="time" step="900" required value="${values.end || '16:00'}"${invalid(errors, 'end')}>
        ${errorFor(errors, 'end')}
      </div>
      <div class="field">
        <label for="capacity">${t('Free chairs')}</label>
        <input id="capacity" name="capacity" type="number" min="1" max="50" inputmode="numeric" required value="${values.capacity || '1'}"${invalid(errors, 'capacity')}>
        ${errorFor(errors, 'capacity')}
      </div>
    </div>
    <button class="btn btn-primary" type="submit">${t('Add quiet hours')}</button>
  </form>
</section>
<h2 class="section-title">${t('Your quiet hours')}</h2>
${
  windows.length
    ? html`<section class="table-wrap" tabindex="0" aria-label="${t('Your quiet hours')}"><table class="list">
  <thead><tr><th scope="col">${t('Day')}</th><th scope="col">${t('Hours')}</th><th scope="col">${t('Chairs')}</th><th scope="col"><span class="visually-hidden">${t('Remove')}</span></th></tr></thead>
  <tbody>${windows.map(
    (w) => html`<tr>
    <td><span class="day-long">${t.weekday(w.weekday)}</span><span class="day-short">${t.weekdayShort(w.weekday)}</span></td>
    <td class="num nowrap">${t.timeRange(w.start_min, w.end_min)}</td>
    <td class="num">${w.capacity}</td>
    <td><form method="post" action="/app/hours/${w.id}/delete"><button class="btn btn-link btn-small" type="submit">${t('Remove')}</button></form></td>
  </tr>`,
  )}</tbody>
</table></section>`
    : html`<p class="empty">${t('No quiet hours yet. Start with the afternoons that are usually slow.')}</p>`
}`;
  return appPage(c, { title: t('Quiet hours'), body, current: '/app/hours', banners });
}
