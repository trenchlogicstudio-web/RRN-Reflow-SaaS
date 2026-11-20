// Copyright (c) 2026 Miloš Petrović (Trench Logic Studio) · SPDX-License-Identifier: MIT
// Form input validation. Each reader returns the clean value or records a
// human-readable error against the field name.

export class FormReader {
  /** `t` translates messages and field labels (English keys); defaults to English. */
  constructor(params, t = (key, vars) => key.replace(/\{(\w+)\}/g, (m, k) => (vars && k in vars ? String(vars[k]) : m))) {
    this.params = params;
    this.t = t;
    this.errors = {};
  }

  get ok() {
    return Object.keys(this.errors).length === 0;
  }

  fail(field, message) {
    if (!this.errors[field]) this.errors[field] = message;
    return null;
  }

  raw(field) {
    const v = this.params.get(field);
    return v === null ? '' : v;
  }

  text(field, { label = field, min = 1, max = 120, optional = false } = {}) {
    const t = this.t;
    // eslint-disable-next-line no-control-regex -- control characters are removed from input on purpose
    const v = this.raw(field).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().replace(/\s+/g, ' ');
    if (!v) return optional ? '' : this.fail(field, t('{label} is required.', { label: t(label) }));
    if (v.length < min) return this.fail(field, t('{label} is too short.', { label: t(label) }));
    if (v.length > max) return this.fail(field, t('{label} must be at most {max} characters.', { label: t(label), max }));
    return v;
  }

  multiline(field, { label = field, max = 300 } = {}) {
    const t = this.t;
    // eslint-disable-next-line no-control-regex -- control characters are removed from input on purpose
    const v = this.raw(field).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim();
    if (v.length > max) return this.fail(field, t('{label} must be at most {max} characters.', { label: t(label), max }));
    return v;
  }

  int(field, { label = field, min, max, step = 1 } = {}) {
    const t = this.t;
    const s = this.raw(field).trim();
    if (!/^-?\d{1,7}$/.test(s)) return this.fail(field, t('{label} must be a whole number.', { label: t(label) }));
    const n = Number(s);
    if (n < min || n > max) return this.fail(field, t('{label} must be between {min} and {max}.', { label: t(label), min, max }));
    if (step > 1 && n % step !== 0) return this.fail(field, t('{label} must be a multiple of {step}.', { label: t(label), step }));
    return n;
  }

  email(field) {
    const t = this.t;
    const v = this.raw(field).trim().toLowerCase();
    if (!v) return this.fail(field, t('{label} is required.', { label: t('Email') }));
    if (v.length > 254 || !/^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]{2,}$/.test(v)) {
      return this.fail(field, t('Enter a valid email address.'));
    }
    return v;
  }

  password(field, { label = 'Password' } = {}) {
    const t = this.t;
    const v = this.raw(field);
    if (v.length < 10) return this.fail(field, t('{label} must be at least 10 characters.', { label: t(label) }));
    if (v.length > 200) return this.fail(field, t('{label} is too long.', { label: t(label) }));
    return v;
  }

  checkbox(field) {
    const v = this.raw(field);
    return v === 'on' || v === '1' || v === 'yes';
  }

  oneOf(field, allowed, { message = 'Choose a valid option.' } = {}) {
    const v = this.raw(field).trim();
    if (!allowed.includes(v)) return this.fail(field, this.t(message));
    return v;
  }
}

/** A client's phone number or email, kept as typed; only its shape is checked. */
export function contactKind(value) {
  const v = String(value || '').trim();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) return 'email';
  const digits = v.replace(/[^\d]/g, '');
  if (/^\+?[\d\s().\-/]{6,}$/.test(v) && digits.length >= 6 && digits.length <= 16) return 'phone';
  return null;
}

/** ASCII slug for public links: 'Studio Lumen & Co' → 'studio-lumen-co' */
export function slugify(name) {
  const s = String(name)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  return s.length >= 2 ? s : 'salon';
}

export function isValidSlug(slug) {
  return typeof slug === 'string' && /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/.test(slug) && slug.length >= 2;
}
