// Copyright (c) 2026 Miloš Petrović (Trench Logic Studio) · SPDX-License-Identifier: MIT
// What the app tells people by email, in each recipient's language: the salon
// about new requests, the client about the answer. Everything is queued in the
// outbox; nothing is queued when no mail provider is configured or for demo salons.

import { html } from './html.js';
import { translator, htmlLang } from './i18n/index.js';
import { contactKind } from './validate.js';
import { enqueue } from './mail.js';
import { parseUpgrades } from './repo.js';
import { RETENTION_DAYS, RESET_LINK_HOURS } from './config.js';

function email({ lang = 'en', heading, paragraphs, button, secondary, footer }) {
  const body = html`<!doctype html>
<html lang="${htmlLang(lang)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${heading}</title></head>
<body style="margin:0;padding:0;background:#f5f7f5;color:#1c2a29;font-family:system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif;font-size:16px;line-height:1.5">
<div style="max-width:520px;margin:0 auto;padding:28px 20px">
<h1 style="font-family:Georgia,'Times New Roman',serif;font-size:24px;line-height:1.25;margin:0 0 16px;color:#1c2a29">${heading}</h1>
${paragraphs.map((p) => html`<p style="margin:0 0 10px">${p}</p>`)}
${
  button
    ? html`<p style="margin:22px 0"><a href="${button.url}" style="display:inline-block;background:#8c2c4b;color:#ffffff;padding:11px 18px;border-radius:6px;text-decoration:none;font-weight:600">${button.label}</a></p>`
    : ''
}
${secondary ? html`<p style="margin:0 0 10px"><a href="${secondary.url}" style="color:#8c2c4b">${secondary.label}</a></p>` : ''}
<p style="margin:26px 0 0;color:#566563;font-size:13px">${footer}</p>
</div></body></html>`;
  const lines = [heading, '', ...paragraphs, ''];
  if (button) lines.push(`${button.label}: ${button.url}`);
  if (secondary) lines.push(`${secondary.label}: ${secondary.url}`);
  lines.push('', footer);
  return { html: String(body), text: lines.join('\n') };
}

function offerLines(t, r) {
  const what = [r.service_name, ...parseUpgrades(r.upgrades_json).map((u) => u.name)].join(' + ');
  return [
    `${t.dateLong(r.slot_date)}, ${t.timeRange(r.start_min, r.end_min)}`,
    what,
    t('{total} instead of {base}', { total: t.duration(r.total_min), base: t.duration(r.base_min) }),
    t('Price: {price}, the standard price', { price: t.money(r.price_cents, r.currency) }),
    t('Reference: {ref}', { ref: r.ref }),
  ];
}

function clientEmailOf(r) {
  return r.client_contact && contactKind(r.client_contact) === 'email' ? r.client_contact.trim() : null;
}

async function owners(db, salonId) {
  const { results } = await db.prepare('SELECT email, locale, notify_email FROM users WHERE salon_id = ? ORDER BY id').bind(salonId).all();
  return results;
}

function active(ctx, salon) {
  return Boolean(ctx.mail.provider) && !salon.is_demo;
}

/** A client sent an upgraded-offer request or joined the waitlist. */
export async function notifyNewRequest(ctx, salon, r) {
  if (!active(ctx, salon)) return;
  const list = await owners(ctx.db, salon.id);
  const clientEmail = clientEmailOf(r);
  const statusUrl = `${ctx.origin}/r/${r.token}`;
  for (const owner of list) {
    if (!owner.notify_email) continue;
    const t = translator(owner.locale);
    const contact = `${r.client_name}, ${r.client_contact}`;
    const msg =
      r.kind === 'offer'
        ? email({
            lang: t.locale,
            heading: t('New request: {when}', { when: `${t.date(r.slot_date)} ${t.time(r.start_min)}` }),
            paragraphs: [t('A client asked for an upgraded appointment through your request page.'), ...offerLines(t, r), t('Client: {contact}', { contact })],
            button: { label: t('Confirm or decline'), url: `${ctx.origin}/app` },
            footer: t('You receive these emails because notifications are on in Settings.'),
          })
        : email({
            lang: t.locale,
            heading: t('New waitlist request: {service}', { service: r.service_name }),
            paragraphs: [
              t('A client joined your waitlist.'),
              t('Client: {contact}', { contact }),
              ...(r.note ? [t('Note: “{note}”', { note: r.note })] : []),
              t('Reference: {ref}', { ref: r.ref }),
            ],
            button: { label: t('Open your dashboard'), url: `${ctx.origin}/app` },
            footer: t('You receive these emails because notifications are on in Settings.'),
          });
    await enqueue(
      ctx.db,
      {
        salonId: salon.id, requestId: r.id, requestRevision: r.revision,
        kind: `owner.${r.kind}`,
        to: owner.email,
        replyTo: clientEmail,
        subject: r.kind === 'offer' ? t('New request: {when}', { when: `${t.date(r.slot_date)} ${t.time(r.start_min)}` }) : t('New waitlist request: {service}', { service: r.service_name }),
        ...msg,
      },
      ctx.now,
    );
  }
  if (clientEmail) {
    const t = translator(r.locale);
    const footer = t('You receive this email because you sent a request to {salon}. Your details are deleted {days} days after the appointment.', {
      salon: salon.name,
      days: RETENTION_DAYS,
    });
    const msg =
      r.kind === 'offer'
        ? {
            subject: t('Your request at {salon}', { salon: salon.name }),
            ...email({
              lang: t.locale,
              heading: t('Request sent'),
              paragraphs: [t('{salon} has your request and will confirm it personally.', { salon: salon.name }), ...offerLines(t, r)],
              button: { label: t('See your request'), url: statusUrl },
              footer,
            }),
          }
        : {
            subject: t('You are on the waitlist at {salon}', { salon: salon.name }),
            ...email({
              lang: t.locale,
              heading: t('You are on the waitlist'),
              paragraphs: [t('{salon} will contact you when a place opens.', { salon: salon.name }), r.service_name, t('Reference: {ref}', { ref: r.ref })],
              button: { label: t('See your request'), url: statusUrl },
              footer,
            }),
          };
    await enqueue(ctx.db, { salonId: salon.id, requestId: r.id, requestRevision: r.revision, kind: `client.${r.kind}`, to: clientEmail, replyTo: list[0]?.email || null, ...msg }, ctx.now);
  }
}

/** The salon confirmed or declined. Only clients who left an email address hear about it by email. */
export async function notifyDecision(ctx, salon, r) {
  if (!active(ctx, salon)) return;
  const clientEmail = clientEmailOf(r);
  if (!clientEmail || r.kind !== 'offer') return;
  const t = translator(r.locale);
  const list = await owners(ctx.db, salon.id);
  const footer = t('You receive this email because you sent a request to {salon}. Your details are deleted {days} days after the appointment.', {
    salon: salon.name,
    days: RETENTION_DAYS,
  });
  let msg;
  if (r.status === 'confirmed') {
    const extra = [];
    if (salon.address) extra.push(t('Address: {address}', { address: salon.address }));
    if (salon.phone) extra.push(t('Phone: {phone}', { phone: salon.phone }));
    msg = {
      subject: t('Confirmed: {when} at {salon}', { when: `${t.date(r.slot_date)} ${t.time(r.start_min)}`, salon: salon.name }),
      ...email({
        lang: t.locale,
        heading: t('Confirmed'),
        paragraphs: [t('{salon} has confirmed your appointment.', { salon: salon.name }), ...offerLines(t, r), ...extra],
        button: { label: t('Add to calendar'), url: `${ctx.origin}/r/${r.token}/calendar.ics` },
        secondary: { label: t('See your request'), url: `${ctx.origin}/r/${r.token}` },
        footer,
      }),
    };
  } else if (r.status === 'declined') {
    msg = {
      subject: t('{salon} could not confirm your request', { salon: salon.name }),
      ...email({
        lang: t.locale,
        heading: t('Not available'),
        paragraphs: [t('{salon} could not confirm the time you chose. You are welcome to pick another one.', { salon: salon.name })],
        button: { label: t('Choose another time'), url: `${ctx.origin}/s/${salon.slug}?lang=${r.locale}` },
        footer,
      }),
    };
  } else {
    return;
  }
  await enqueue(ctx.db, { salonId: salon.id, requestId: r.id, requestRevision: r.revision, kind: `client.${r.status}`, to: clientEmail, replyTo: list[0]?.email || null, ...msg }, ctx.now);
}

export async function notifyPasswordReset(ctx, user, link) {
  if (!ctx.mail.provider) return;
  const t = translator(user.locale);
  const msg = {
    subject: t('Reset your password'),
    ...email({
      lang: t.locale,
      heading: t('Reset your password'),
      paragraphs: [
        t('Someone asked to reset the password for your account. If it was you, choose a new password with the link below. It works once, for {hours} hours.', {
          hours: RESET_LINK_HOURS,
        }),
        t('If it was not you, ignore this email: nothing changes.'),
      ],
      button: { label: t('Choose a new password'), url: link },
      footer: ctx.productName,
    }),
  };
  await enqueue(ctx.db, { salonId: user.salon_id ?? null, kind: 'user.reset', to: user.email, ...msg }, ctx.now);
}

export async function notifyCancellation(ctx, salon, request) {
  if (!active(ctx, salon)) return;
  const list = await owners(ctx.db, salon.id);
  const recipients = [...list.filter((u) => u.notify_email).map((u) => ({ email: u.email, locale: u.locale }))];
  const client = clientEmailOf(request);
  if (client) recipients.push({ email: client, locale: request.locale });
  for (const recipient of recipients) {
    const t = translator(recipient.locale);
    const msg = email({ lang: t.locale, heading: t('Appointment canceled'), paragraphs: [salon.name, ...offerLines(t, request)],
      button: { label: t('See your request'), url: `${ctx.origin}/r/${request.token}` }, footer: salon.name });
    await enqueue(ctx.db, { salonId: salon.id, requestId: request.id, requestRevision: request.revision, kind: 'appointment.canceled', to: recipient.email, subject: t('Appointment canceled'),
      dedupeKey: `cancel:${request.token}:${request.outcome_at}:${recipient.email}`, ...msg }, ctx.now);
  }
}

export async function notifyAccountToken(ctx, user, link, kind) {
  if (!ctx.mail.provider) return;
  const t = translator(user.locale);
  const heading = kind === 'invite' ? t('Join the salon team') : t('Verify your email');
  const msg = email({ lang: t.locale, heading, paragraphs: [t('This private link expires in 24 hours. If you did not request it, ignore this email.')],
    button: { label: heading, url: link }, footer: ctx.productName });
  await enqueue(ctx.db, { salonId: user.salon_id, kind: `account.${kind}`, to: user.email, subject: heading, ...msg }, ctx.now);
}

export async function notifyReminder(ctx, salon, request) {
  const client = clientEmailOf(request);
  if (!active(ctx, salon) || !client) return;
  const t = translator(request.locale);
  const msg = email({ lang: t.locale, heading: t('Appointment reminder'), paragraphs: [salon.name, ...offerLines(t, request)],
    button: { label: t('See your request'), url: `${ctx.origin}/r/${request.token}` }, footer: salon.name });
  await enqueue(ctx.db, { salonId: salon.id, requestId: request.id, requestRevision: request.revision, kind: 'appointment.reminder', to: client, subject: t('Appointment reminder'),
    dedupeKey: `reminder:${request.token}:${request.revision}`, ...msg }, ctx.now);
}
