// Copyright (c) 2026 Miloš Petrović (Trench Logic Studio) · SPDX-License-Identifier: MIT
// HTML templating. Every interpolated value is escaped unless it is already
// a SafeHtml produced by html`` or raw(). There is no other way to emit markup.

export class SafeHtml {
  constructor(value) {
    this.value = value;
  }
  toString() {
    return this.value;
  }
}

const ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' };

export function escapeHtml(value) {
  return String(value).replace(/[&<>"'`]/g, (c) => ENTITIES[c]);
}

function render(value) {
  if (value === null || value === undefined || value === false) return '';
  if (value instanceof SafeHtml) return value.value;
  if (Array.isArray(value)) return value.map(render).join('');
  return escapeHtml(value);
}

export function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) out += render(values[i]) + strings[i + 1];
  return new SafeHtml(out);
}

/** Trusted markup only: constants written in this codebase, never user input. */
export function raw(markup) {
  return new SafeHtml(String(markup));
}

export function join(items, separator = '') {
  return new SafeHtml(items.map(render).join(render(separator)));
}
