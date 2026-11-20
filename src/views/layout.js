// Copyright (c) 2026 Miloš Petrović (Trench Logic Studio) · SPDX-License-Identifier: MIT
// Page shell, language switcher and shared view helpers.

import { html, raw } from '../html.js';
import { VERSION } from '../config.js';
import { LOCALES, LOCALE_NAMES, tk, htmlLang } from '../i18n/index.js';

const MARK = raw(
  '<svg viewBox="0 0 32 32" aria-hidden="true" focusable="false"><rect width="32" height="32" rx="8" fill="currentColor" opacity=".12"/><rect x="7" y="8" width="11" height="5" rx="2" fill="#c0476b"/><rect x="7" y="17" width="18" height="7" rx="2" fill="#4e8a71"/></svg>',
);

/** Same path, with ?lang= set (other query parameters kept, one-off flags dropped). */
export function withLang(path, lang) {
  const u = new URL(path, 'http://x');
  u.searchParams.delete('ok');
  u.searchParams.set('lang', lang);
  return `${u.pathname}?${u.searchParams.toString()}`;
}

function languageSwitcher(c, path) {
  if (!path) return '';
  return html`<nav class="langs" aria-label="${c.t('Language')}"><ul>${LOCALES.map(
    (l) =>
      html`<li><a href="${withLang(path, l)}" lang="${htmlLang(l)}" hreflang="${htmlLang(l)}"${l === c.locale ? raw(' aria-current="true"') : ''}>${LOCALE_NAMES[l]}</a></li>`,
  )}</ul></nav>`;
}

/** Search engines and link previews: one URL per language, linked to each other. */
function seoLinks(c, path, title, description) {
  const url = (l) => `${c.url.origin}${withLang(path, l)}`;
  return html`<link rel="canonical" href="${url(c.locale)}">
${LOCALES.map((l) => html`<link rel="alternate" hreflang="${htmlLang(l)}" href="${url(l)}">
`)}<link rel="alternate" hreflang="x-default" href="${c.url.origin}${path}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${c.config.productName}">
<meta property="og:title" content="${title}">
${description ? html`<meta property="og:description" content="${description}">` : ''}
<meta property="og:url" content="${url(c.locale)}">
<meta property="og:locale" content="${c.t.intl.replace('-', '_')}">
${previewImage(c)}`;
}

/** Link previews (WhatsApp, Instagram, Facebook, Slack…): one neutral image for every page that is shared. */
function previewImage(c) {
  return html`<meta property="og:image" content="${c.url.origin}/og.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">`;
}

/** A salon's link as it appears when shared in a chat: the salon's name and what the page offers. */
function salonPreview(c, salon, description) {
  return html`<meta property="og:type" content="website">
<meta property="og:site_name" content="${salon.name}">
<meta property="og:title" content="${salon.name}">
<meta property="og:description" content="${description}">
<meta property="og:locale" content="${c.t.intl.replace('-', '_')}">
${previewImage(c)}`;
}

export function document(c, { title, body, bodyClass = '', robots = 'noindex, nofollow', description = '', indexPath = null, preview = '' }) {
  return html`<!doctype html>
<html lang="${htmlLang(c.locale)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<meta name="robots" content="${robots}">
${description ? html`<meta name="description" content="${description}">` : ''}
${indexPath ? seoLinks(c, indexPath, title, description) : preview}
<meta name="color-scheme" content="light dark">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="stylesheet" href="/static/app.css?v=${VERSION}">
<script src="/static/app.js?v=${VERSION}" defer></script>
</head>
<body class="${bodyClass}">
<a class="skip" href="#main">${c.t('Skip to content')}</a>
${body}
</body>
</html>`;
}

function footer(c, { switchPath = null, extra = '' } = {}) {
  const cfg = c.config;
  return html`<footer class="footer">
  <div class="wrap footer-inner">
    <span>${cfg.productName} ${cfg.version}</span>
    <a href="${c.link('/privacy')}">${c.t('Privacy')}</a>
    <a href="${c.link('/terms')}">${c.t('Terms')}</a>
    ${cfg.contactEmail ? html`<a href="mailto:${cfg.contactEmail}">${c.t('Contact')}</a>` : ''}
    ${cfg.legalNotice.length ? html`<a href="${c.link('/legal')}">${c.t('Legal notice')}</a>` : ''}
    ${extra}
  </div>
  <div class="wrap">${languageSwitcher(c, switchPath)}</div>
</footer>`;
}

/** Marketing and account pages. */
export function sitePage(c, { title, body, user = null, robots, description, switchPath = null, bare = false }) {
  const cfg = c.config;
  const t = c.t;
  const actions = bare
    ? ''
    : user
    ? html`<a class="btn btn-outline btn-small" href="/app">${t('Dashboard')}</a>`
    : html`<a class="btn btn-link btn-small" href="${c.link('/login')}">${t('Log in')}</a><a class="btn btn-primary btn-small" href="${c.link('/signup')}">${c.billing.enabled && !c.billing.trialDays ? t('Create account') : t('Start free')}</a>`;
  return document(c, {
    title: title ? `${title} | ${cfg.productName}` : cfg.productName,
    robots,
    description,
    indexPath: robots && robots.startsWith('index') ? switchPath : null,
    bodyClass: 'site',
    body: html`<header class="bar"><div class="wrap bar-inner">
  <a class="brand" href="${c.link('/')}">${MARK}<span>${cfg.productName}</span></a>
  <div class="bar-actions">${actions}</div>
</div></header>
<main id="main">${body}</main>
${footer(c, { switchPath })}`,
  });
}

/** A salon's public pages: the salon's name leads, the product stays in the footer. */
export function publicPage(c, salon, { title, body, switchPath = null }) {
  return document(c, {
    title: `${title} | ${salon.name}`,
    bodyClass: 'public',
    preview: salonPreview(c, salon, c.t('Fully booked when you wanted to come in? Choose your service and we will offer you a calmer time with extra care included, at the same price.')),
    body: html`<main id="main"><div class="wrap narrow">${body}</div></main>
${footer(c, { switchPath, extra: html`<span>${c.t('Requests by {product}', { product: c.config.productName })}</span>` })}`,
  });
}

const APP_NAV = [
  ['/app', tk('Requests')],
  ['/app/appointments', tk('Appointments')],
  ['/app/availability', tk('Availability')],
  ['/app/services', tk('Services')],
  ['/app/upgrades', tk('Upgrades')],
  ['/app/hours', tk('Quiet hours')],
  ['/app/share', tk('Share')],
  ['/app/plan', tk('Plan')],
  ['/app/settings', tk('Settings')],
  ['/app/team', tk('Team')],
  ['/app/account', tk('My account')],
];

/** The salon's own dashboard. */
export function appPage(c, { title, body, current = '/app', banners = [] }) {
  const t = c.t;
  const salon = c.user.salon;
  return document(c, {
    title: `${title} | ${salon.name}`,
    bodyClass: 'app',
    body: html`<header class="bar"><div class="wrap bar-inner">
  <a class="brand" href="/app">${MARK}<span>${salon.name}</span></a>
  <div class="bar-actions">
    <form class="inline" method="post" action="/logout"><button class="btn btn-link btn-small" type="submit">${t('Log out')}</button></form>
  </div>
  <nav class="nav" aria-label="${t('Dashboard')}">
    <ul>${APP_NAV.filter(([path]) => c.user.role !== 'staff' || ['/app', '/app/appointments', '/app/availability', '/app/account'].includes(path)).map(
      ([href, label]) => html`<li><a href="${href}"${href === current ? raw(' aria-current="page"') : ''}>${t(label)}</a></li>`,
    )}</ul>
  </nav>
</div></header>
${banners.length ? html`<div class="wrap banners">${banners}</div>` : ''}
<main id="main"><div class="wrap">${body}</div></main>
${footer(c)}`,
  });
}

/* ------------------------------- form helpers ------------------------------ */

export function errorFor(errors, name) {
  return errors && errors[name] ? html`<span class="error-text" id="${name}-error">${errors[name]}</span>` : '';
}

export function invalid(errors, name) {
  return errors && errors[name] ? raw(` aria-invalid="true" aria-describedby="${name}-error"`) : '';
}

export function formErrors(c, errors) {
  const n = errors ? Object.keys(errors).length : 0;
  if (!n) return '';
  return html`<div class="notice notice-error" role="alert"><p>${c.t.n(n, 'Please correct the highlighted field.', 'Please correct the {n} highlighted fields.')}</p></div>`;
}

export function notice(kind, text) {
  if (!text) return '';
  return html`<div class="notice notice-${kind}" role="${kind === 'error' ? 'alert' : 'status'}"><p>${text}</p></div>`;
}

export function selected(cond) {
  return cond ? raw(' selected') : '';
}

export function checked(cond) {
  return cond ? raw(' checked') : '';
}

export function langField(c) {
  return html`<input type="hidden" name="lang" value="${c.locale}">`;
}

/**
 * A translated sentence with markup inside it, e.g.
 *   rich(t, 'I accept the {terms} and the {privacy}.', { terms: html`<a …>…</a>`, privacy: … })
 * Text parts are escaped; each placeholder is replaced by its (already safe) part,
 * so translators can move the links to wherever their language needs them.
 */
export function rich(t, key, parts) {
  const template = t(key);
  const out = [];
  let last = 0;
  template.replace(/\{(\w+)\}/g, (match, name, index) => {
    out.push(template.slice(last, index));
    out.push(Object.prototype.hasOwnProperty.call(parts, name) ? parts[name] : match);
    last = index + match.length;
    return match;
  });
  out.push(template.slice(last));
  return html`${out}`;
}
