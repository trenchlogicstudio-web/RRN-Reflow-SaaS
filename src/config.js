// Copyright (c) 2026 Miloš Petrović (Trench Logic Studio) · SPDX-License-Identifier: MIT
// Runtime configuration. Every value can be set as an environment variable
// (Cloudflare: Worker → Settings → Variables and Secrets). Nothing here is secret
// except authentication, email and billing keys: store those as secrets.

export const VERSION = '0.3.2';
export const RELEASE_NOTE = 'verified billing, safe booking lifecycle, team access and operational readiness';

export const RETENTION_DAYS = 90; // client name and contact are erased this long after the appointment
export const SESSION_DAYS = 30;
export const ADMIN_SESSION_HOURS = 12;
export const RESET_LINK_HOURS = 24;
export const CONSENT_VERSION = 'c1';

export function loadConfig(env = {}) {
  const iter = Number.parseInt(env.PBKDF2_ITERATIONS || '', 10);
  return {
    production: env.APP_ENV === 'production',
    publicOrigin: origin(env.PUBLIC_ORIGIN),
    authPepper: typeof env.AUTH_PEPPER === 'string' ? env.AUTH_PEPPER : '',
    requireEmailVerification: env.REQUIRE_EMAIL_VERIFICATION === 'on' || env.APP_ENV === 'production',
    version: VERSION,
    productName: clean(env.PRODUCT_NAME) || 'Reflow',
    operatorName: clean(env.OPERATOR_NAME) || '',
    contactEmail: clean(env.CONTACT_EMAIL) || '',
    // Legal notice / imprint (required for businesses in Germany and Austria, among others):
    // free text, lines separated by new lines or " | ". Shown at /legal and linked in the footer.
    legalNotice: lines(env.LEGAL_NOTICE),
    // The operator page stays switched off until a long random key is configured.
    adminKey: typeof env.ADMIN_KEY === 'string' && env.ADMIN_KEY.length >= 24 ? env.ADMIN_KEY : null,
    // "Try the live demo" creates a private sample salon for 24 hours. On unless DEMO_MODE=off.
    demoEnabled: env.DEMO_MODE !== 'off',
    // Workers currently caps a single PBKDF2 call at 100,000. Use Paid Workers
    // and a separately stored pepper; never silently reduce the work factor.
    pbkdf2Iterations: Number.isSafeInteger(iter) && iter >= 10000 && iter <= 100000 ? iter : 100000,
  };
}

function origin(value) {
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.origin : ''; }
  catch { return ''; }
}

function lines(v) {
  if (typeof v !== 'string') return [];
  return v
    .split(/\r?\n|\\n|\s\|\s/)
    .map((line) => line.trim().slice(0, 200))
    .filter(Boolean)
    .slice(0, 20);
}

function clean(v) {
  return typeof v === 'string' ? v.trim().slice(0, 120) : '';
}
