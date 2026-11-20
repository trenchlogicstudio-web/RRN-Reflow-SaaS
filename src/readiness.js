// Copyright (c) 2026 Miloš Petrović (Trench Logic Studio) · SPDX-License-Identifier: MIT
import { loadConfig } from './config.js';
import { billingConfig } from './billing.js';
import { mailConfig } from './mail.js';

/** Configuration checks, never secret values. Also used by npm run doctor. */
export function readiness(env = {}) {
  const config = loadConfig(env), billing = billingConfig(env), mail = mailConfig(env);
  const checks = [
    { id: 'origin', ok: config.publicOrigin.startsWith('https://'), description: 'PUBLIC_ORIGIN is an HTTPS origin' },
    { id: 'admin', ok: (config.adminKey || '').length >= 32, description: 'ADMIN_KEY has at least 32 random characters' },
    { id: 'pepper', ok: config.authPepper.length >= 32, description: 'AUTH_PEPPER is a separate secret of at least 32 random characters' },
    { id: 'password_cost', ok: config.pbkdf2Iterations === 100000, description: 'Password work factor is set to the Workers maximum (100,000)' },
    { id: 'email', ok: ['resend','cloudflare'].includes(mail.provider), description: 'A real email provider and sender are configured' },
    { id: 'verification', ok: config.requireEmailVerification, description: 'Email ownership verification is required' },
    { id: 'operator', ok: Boolean(config.operatorName && config.contactEmail), description: 'Operator name and support contact are configured' },
  ];
  if (env.BILLING_PROVIDER || env.CHECKOUT_URL || env.BILLING_WEBHOOK_SECRET) {
    checks.push({ id: 'billing', ok: billing.enabled && billing.secret.length >= 24 && Boolean(billing.apiKey && billing.priceId), description: 'Billing has a checkout, signing secret, API key and allowed price/variant ID' });
    checks.push({ id: 'billing_mode', ok: !config.production || billing.live, description: 'Production billing uses live mode' });
  }
  return { ready: checks.every((check) => check.ok), production: config.production, checks };
}
