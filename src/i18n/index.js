// Copyright (c) 2026 Miloš Petrović (Trench Logic Studio) · SPDX-License-Identifier: MIT
// Languages, translation and locale-aware formatting.
//
// English strings are the keys: t('Send request') looks the string up in the
// active language's dictionary and falls back to English when it is missing.
// test/i18n.test.js checks that every string used in the code is translated.

import de from './de.js';
import fr from './fr.js';
import es from './es.js';
import it from './it.js';
import pt from './pt.js';
import nl from './nl.js';

export const LOCALES = ['en', 'de', 'fr', 'es', 'it', 'pt', 'nl'];

export const LOCALE_NAMES = {
  en: 'English',
  de: 'Deutsch',
  fr: 'Français',
  es: 'Español',
  it: 'Italiano',
  pt: 'Português',
  nl: 'Nederlands',
};

const EN_CURRENCY_LOCALE = { USD: 'en-US', CAD: 'en-CA', AUD: 'en-AU', NZD: 'en-NZ', SGD: 'en-SG', ZAR: 'en-ZA' };
const INTL = { en: 'en-GB', de: 'de-DE', fr: 'fr-FR', es: 'es-ES', it: 'it-IT', pt: 'pt-BR', nl: 'nl-NL' };
const DICTS = { en: null, de, fr, es, it, pt, nl };

export const DICTIONARIES = DICTS;

/** Language tag for HTML lang attributes: Portuguese is written as in Brazil. */
export const htmlLang = (locale) => (locale === 'pt' ? 'pt-BR' : locale);

export function isLocale(value) {
  return typeof value === 'string' && LOCALES.includes(value);
}

/** Best supported language for an Accept-Language header. */
export function negotiate(header, fallback = 'en') {
  if (typeof header !== 'string' || !header) return fallback;
  const prefs = header
    .split(',')
    .slice(0, 20)
    .map((part) => {
      const [tag, ...params] = part.trim().split(';');
      const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
      const weight = q ? Number(q.slice(2)) : 1;
      return { lang: tag.trim().toLowerCase().split('-')[0], q: Number.isFinite(weight) ? weight : 0 };
    })
    .filter((p) => p.lang && p.q > 0)
    .sort((a, b) => b.q - a.q);
  for (const p of prefs) if (isLocale(p.lang)) return p.lang;
  return fallback;
}

function fill(text, vars) {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (match, key) => (Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key]) : match));
}

function utcDate(date) {
  const [y, m, d] = String(date).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

const cache = new Map();

let missingHandler = null;
/** Test hook: fn(locale, key) is called whenever a non-English lookup falls back to English. */
export function onMissingTranslation(fn) {
  missingHandler = typeof fn === 'function' ? fn : null;
}

/**
 * translator('de') → t, with:
 *   t(key, vars)                 translated string, {name} placeholders filled
 *   t.n(count, one, other, vars) plural-aware: picks `one` or `other` for the language
 *   t.date / t.dateLong          wall-clock dates ('YYYY-MM-DD') in the language
 *   t.weekday(1..7) / t.weekdayShort(1..7)
 *   t.time(min) / t.timeRange(a, b) / t.duration(min) / t.money(cents, currency)
 *   t.instant(iso, timeZone) / t.day(iso, timeZone)   stored instants on the salon's clock
 */
export function translator(locale) {
  const loc = isLocale(locale) ? locale : 'en';
  if (cache.has(loc)) return cache.get(loc);
  const dict = DICTS[loc];
  const intl = INTL[loc];
  const plural = new Intl.PluralRules(intl);
  const dateShort = new Intl.DateTimeFormat(intl, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  const dateLong = new Intl.DateTimeFormat(intl, { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
  const dateNumeric = new Intl.DateTimeFormat(intl, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  const wdLong = new Intl.DateTimeFormat(intl, { weekday: 'long', timeZone: 'UTC' });
  const wdShort = new Intl.DateTimeFormat(intl, { weekday: 'short', timeZone: 'UTC' });
  const money = new Map();
  const tidy = (s) => (loc === 'en' ? s.replace(',', '') : s);

  const t = (key, vars) => {
    if (dict && Object.prototype.hasOwnProperty.call(dict, key)) return fill(dict[key], vars);
    if (dict && missingHandler) missingHandler(loc, key);
    return fill(key, vars);
  };
  t.locale = loc;
  t.intl = intl;
  t.n = (count, one, other, vars = {}) => t(plural.select(count) === 'one' ? one : other, { n: count, ...vars });
  t.date = (date) => tidy(dateShort.format(utcDate(date)));
  t.dateLong = (date) => tidy(dateLong.format(utcDate(date)));
  t.dateNumeric = (date) => dateNumeric.format(utcDate(date));
  // 2024-01-01 was a Monday, so day 1..7 maps to Monday..Sunday.
  t.weekday = (iso) => wdLong.format(new Date(Date.UTC(2024, 0, iso)));
  t.weekdayShort = (iso) => wdShort.format(new Date(Date.UTC(2024, 0, iso))).replace(/\.$/, '');
  t.time = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
  t.timeRange = (a, b) => `${t.time(a)}–${t.time(b)}`;
  t.duration = (min) => {
    if (min < 60) return t('{m} min', { m: min });
    const h = Math.floor(min / 60);
    const m = min % 60;
    return m ? t('{h} h {m} min', { h, m }) : t('{h} h', { h });
  };
  const zoned = new Map();
  const zonedFormat = (timeZone, withTime) => {
    const id = `${timeZone}|${withTime}`;
    let f = zoned.get(id);
    if (f === undefined) {
      const opts = { day: 'numeric', month: 'short', year: 'numeric', ...(withTime ? { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' } : {}) };
      try {
        f = new Intl.DateTimeFormat(intl, { ...opts, timeZone });
      } catch {
        f = new Intl.DateTimeFormat(intl, { ...opts, timeZone: 'UTC' });
      }
      zoned.set(id, f);
    }
    return f;
  };
  /** A stored instant (ISO string) on the salon's own clock: '3 Nov 2026, 14:05'. */
  t.instant = (iso, timeZone) => zonedFormat(timeZone, true).format(new Date(iso));
  /** The calendar day of a stored instant on the salon's own clock: '3 Nov 2026'. */
  t.day = (iso, timeZone) => zonedFormat(timeZone, false).format(new Date(iso));
  t.money = (cents, currency) => {
    let f = money.get(currency);
    if (f === undefined) {
      try {
        // English pages show dollars the way their own country writes them ($45.00, not US$45.00).
        const numberLocale = loc === 'en' ? EN_CURRENCY_LOCALE[currency] || intl : intl;
        f = new Intl.NumberFormat(numberLocale, { style: 'currency', currency });
      } catch {
        f = null;
      }
      money.set(currency, f);
    }
    return f ? f.format(cents / 100) : `${(cents / 100).toFixed(2)} ${currency}`;
  };
  cache.set(loc, t);
  return t;
}

/** Marks a string for translation where it is defined, for strings translated later with t(). */
export const tk = (key) => key;
