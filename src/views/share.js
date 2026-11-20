// Copyright (c) 2026 Miloš Petrović (Trench Logic Studio) · SPDX-License-Identifier: MIT
// Everything a salon needs to get its link in front of clients.

import { html } from '../html.js';
import { appPage, document } from './layout.js';
import { translator, LOCALE_NAMES } from '../i18n/index.js';

export function shareTexts(salon, url) {
  const ts = translator(salon.locale);
  return [
    [ts('Booking page, “fully booked” message'), ts('Fully booked at the time you wanted? Get a longer, upgraded appointment at the same price: {url}', { url })],
    [ts('Instagram or Facebook bio'), ts('Fully booked? Upgraded appointments, same price: {url}', { url })],
    [
      ts('Auto-reply for messages'),
      ts('Thanks for your message! If we’re fully booked when you’d like to come, {salon} can offer you a calmer time with extra care included, at the same price. Pick one here: {url}', {
        salon: salon.name,
        url,
      }),
    ],
  ];
}

export function websiteButton(salon, url) {
  const ts = translator(salon.locale);
  const label = ts('Fully booked? See upgraded times');
  const safe = (s) => s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
  return `<a href="${safe(url)}" style="display:inline-block;padding:12px 20px;border-radius:8px;background:#8c2c4b;color:#ffffff;font:600 16px/1.2 system-ui,sans-serif;text-decoration:none">${safe(label)}</a>`;
}

export function shareView(c, { publicUrl, banners = [] }) {
  const t = c.t;
  const salon = c.user.salon;
  const texts = shareTexts(salon, publicUrl);
  const body = html`
<div class="page-head"><div>
  <h1>${t('Share your link')}</h1>
  <p class="muted">${t('Put your link wherever clients find you fully booked. Texts below are in the language of your request page: {language}.', { language: LOCALE_NAMES[salon.locale] })}</p>
</div></div>

<section class="panel share" aria-labelledby="link-h">
  <h2 id="link-h">${t('Your link')}</h2>
  <div class="share-link">
    <code id="public-url">${publicUrl}</code>
    <button class="btn btn-outline btn-small" type="button" data-copy="#public-url">${t('Copy link')}</button>
    <a class="btn btn-link btn-small" href="/s/${salon.slug}">${t('Open page')}</a>
  </div>
</section>

<section class="panel share" aria-labelledby="texts-h">
  <h2 id="texts-h">${t('Texts to copy')}</h2>
  <div class="snippets">
    ${texts.map(
      ([where, text], i) => html`<div class="snippet">
      <p class="where">${where}</p>
      <p id="snippet-${i}">${text}</p>
      <button class="btn btn-outline btn-small" type="button" data-copy="#snippet-${i}">${t('Copy text')}</button>
    </div>`,
    )}
  </div>
</section>

<section class="panel share" aria-labelledby="qr-h">
  <h2 id="qr-h">${t('QR code for the desk and the window')}</h2>
  <div class="qr-row">
    <img class="qr" src="/app/qr.svg" alt="${t('QR code that opens your request page')}" width="168" height="168">
    <div>
      <p class="muted">${t('Print the poster for your reception desk or window, or put the QR code on your price list.')}</p>
      <div class="actions">
        <a class="btn btn-primary btn-small" href="/app/poster">${t('Open printable poster')}</a>
        <a class="btn btn-outline btn-small" href="/app/qr.svg" download="qr-${salon.slug}.svg">${t('Download QR code')}</a>
      </div>
    </div>
  </div>
</section>

<section class="panel share" aria-labelledby="web-h">
  <h2 id="web-h">${t('Button for your website')}</h2>
  <p class="muted">${t('Paste this code into your website where clients see that you are fully booked.')}</p>
  <textarea id="web-button" readonly rows="4" aria-labelledby="web-h">${websiteButton(salon, publicUrl)}</textarea>
  <div class="actions"><button class="btn btn-outline btn-small" type="button" data-copy="#web-button">${t('Copy code')}</button></div>
</section>`;
  return appPage(c, { title: t('Share your link'), body, current: '/app/share', banners });
}

export function posterView(c, { publicUrl }) {
  const salon = c.user.salon;
  const ts = translator(salon.locale);
  const shortUrl = publicUrl.replace(/^https?:\/\//, '');
  const body = html`<main id="main" class="poster">
  <p class="poster-salon">${salon.name}</p>
  <h1 class="poster-title">${ts('Fully booked?')}</h1>
  <p class="poster-lead">${ts('Scan for a longer, upgraded appointment in a calmer hour, at the same price.')}</p>
  <img class="poster-qr" src="/app/qr.svg" alt="${ts('QR code that opens your request page')}">
  <p class="poster-url">${shortUrl}</p>
  <p class="poster-foot">${ts('Requests by {product}', { product: c.config.productName })}</p>
  <p class="poster-actions"><button class="btn btn-primary" type="button" data-print>${c.t('Print poster')}</button> <a class="btn btn-link" href="/app/share">${c.t('Back')}</a></p>
</main>`;
  return document({ ...c, locale: salon.locale, t: ts }, { title: `${salon.name} | ${ts('Fully booked?')}`, bodyClass: 'poster-page', body });
}
