// Copyright (c) 2026 Miloš Petrović (Trench Logic Studio) · SPDX-License-Identifier: MIT
// Cloudflare Workers entry point.
// Bindings: DB (a D1 database). Variables: see src/config.js. ADMIN_KEY must be a Secret.

import { createApp } from './src/app.js';
import { dailyMaintenance } from './src/maintenance.js';
import { ensureSchema } from './src/db/schema.js';
import { mailConfig } from './src/mail.js';
import { loadConfig } from './src/config.js';

export default {
  async fetch(request, env, ctx) {
    if (!env.DB) {
      return new Response('Database binding "DB" is missing. Add a D1 binding named DB in the Worker settings.', {
        status: 500,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      });
    }
    const app = createApp({ db: env.DB, env });
    return app.fetch(request, {
      ip: request.headers.get('CF-Connecting-IP') || '',
      waitUntil: (promise) => ctx.waitUntil(promise),
    });
  },

  // 15-minute cron trigger: expires stale requests, erases client details
  // after the retention period, clears old sessions and counters.
  async scheduled(event, env, ctx) {
    if (!env.DB) return;
    const options = { env, mail: mailConfig(env), productName: loadConfig(env).productName };
    ctx.waitUntil(ensureSchema(env.DB).then(() => dailyMaintenance(env.DB, new Date(), options)));
  },
};
