// Copyright (c) 2026 Miloš Petrović (Trench Logic Studio) · SPDX-License-Identifier: MIT
// The whole application as one Web-standard handler: Request in, Response out.
// It runs unchanged on Cloudflare Workers (worker.js) and on Node (local.js).

import { readiness } from './readiness.js';
import { Router } from './router.js';
import { HttpError, htmlResponse, isSameOrigin, withSecurityHeaders } from './http.js';
import { loadConfig } from './config.js';
import { ensureSchema } from './db/schema.js';
import { currentUser } from './auth.js';
import { translator, negotiate, isLocale } from './i18n/index.js';
import { mailConfig } from './mail.js';
import { billingConfig } from './billing.js';
import { withLang } from './views/layout.js';
import { registerPublic } from './routes/public.js';
import { registerAuth } from './routes/auth.js';
import { registerApp } from './routes/app.js';
import { registerAdmin } from './routes/admin.js';
import { registerTeam } from './routes/team.js';
import { registerOperations } from './routes/operations.js';
import { registerExtras } from './routes/extras.js';
import { errorView } from './views/public.js';
import { dailyMaintenance } from './maintenance.js';

const router = new Router();
registerPublic(router);
registerAuth(router);
registerApp(router);
registerAdmin(router);
registerExtras(router);
registerOperations(router);
registerTeam(router);

const STATIC_PATHS = new Set(['/static/app.css', '/static/app.js', '/favicon.svg', '/robots.txt', '/sitemap.xml', '/og.png', '/apple-touch-icon.png']);
// Server-to-server calls carry no browser Origin; they authenticate by signature instead.
const NO_ORIGIN_CHECK = new Set(['/billing/webhook']);

/**
 * createApp({ db, env, clock, fetchImpl })
 *   db         Cloudflare D1 binding, or the node:sqlite stand-in for local runs and tests
 *   env        environment variables and bindings (see config.js, mail.js, billing.js)
 *   clock      () => Date, injectable so tests can move time
 *   fetchImpl  outgoing HTTP (email provider), injectable for tests
 */
export function createApp({ db, env = {}, clock = () => new Date(), fetchImpl = globalThis.fetch }) {
  const config = loadConfig(env);
  const mail = mailConfig(env);
  const billing = billingConfig(env);
  const deployment = readiness(env);

  // Housekeeping runs at most once a day, triggered by ordinary traffic, so
  // retention works even when no scheduled trigger is configured.
  let lastMaintenanceCheck = -Infinity;
  async function maybeMaintain(now) {
    if (now.getTime() - lastMaintenanceCheck < 300000) return;
    lastMaintenanceCheck = now.getTime();
    try {
      const row = await db.prepare("SELECT value FROM meta WHERE key = 'maintenance_at'").first();
      const last = row ? Date.parse(row.value) : 0;
      if (now.getTime() - last < 900000) return;
      await db
        .prepare("INSERT INTO meta (key, value) VALUES ('maintenance_at', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
        .bind(now.toISOString())
        .run();
      await dailyMaintenance(db, now, { env, mail, fetchImpl, productName: config.productName });
    } catch (err) {
      console.error('Maintenance failed', err && err.stack ? err.stack : err);
    }
  }

  async function handle(request, ctx, jobs) {
    const url = new URL(request.url);
    const method = request.method.toUpperCase();
    const secure = url.protocol === 'https:';
    const now = clock();
    const queryLang = url.searchParams.get('lang');
    let user;
    const c = {
      request,
      url,
      db,
      env,
      config,
      readiness: deployment,
      mail,
      billing,
      fetch: fetchImpl,
      params: {},
      ip: ctx.ip || '',
      now,
      secure,
      user: null,
      langParam: isLocale(queryLang) ? queryLang : null,
      async getUser() {
        if (user === undefined) user = await currentUser(db, request, { secure, now });
        return user;
      },
      useLocale(locale) {
        c.locale = isLocale(locale) ? locale : 'en';
        c.t = translator(c.locale);
      },
      /** Keep an explicitly chosen language when following a link. */
      link(path) {
        return c.langParam ? withLang(path, c.langParam) : path;
      },
      /** Work to finish after the response (email delivery); awaited inline where there is no waitUntil. */
      defer(job) {
        jobs.push(job);
      },
    };
    c.useLocale(c.langParam || negotiate(request.headers.get('accept-language')));

    try {
      if (config.publicOrigin && url.origin !== config.publicOrigin) return new Response('Unrecognized origin', { status: 421 });
      if (config.production && !deployment.ready) return new Response(JSON.stringify({ ok: false, error: 'Deployment configuration incomplete', checks: deployment.checks }), { status: 503, headers: { 'content-type': 'application/json' } });
      const match = router.match(method === 'HEAD' ? 'GET' : method, url.pathname);
      if (!match) throw new HttpError(404, 'There is nothing at this address.');
      if (match.methodNotAllowed) throw new HttpError(405, 'That action is not available here.');
      if (!STATIC_PATHS.has(url.pathname)) {
        await ensureSchema(db);
        const job = maybeMaintain(now);
        if (ctx.waitUntil) ctx.waitUntil(job);
        else await job;
      }
      if (method === 'POST' && !NO_ORIGIN_CHECK.has(url.pathname) && !isSameOrigin(request)) {
        throw new HttpError(403, 'This form was sent from another website, so it was blocked. Open the page again and resend it.');
      }
      c.params = match.params;
      return await match.handler(c);
    } catch (err) {
      if (err instanceof HttpError) {
        return htmlResponse(errorView(c, err.status, err.message), { status: err.status });
      }
      const safePath = url.pathname.replace(/\/(r|reset|verify|join|cal)\/[^/]+/g, '/$1/[private]');
      console.error('Unhandled error', method, safePath, err?.name || 'Error');
      try {
        await db
          .prepare('INSERT INTO error_log (at, method, path, message) VALUES (?, ?, ?, ?)')
          .bind(now.toISOString(), method, safePath.slice(0, 200), String(err?.name || 'Internal error').slice(0, 100))
          .run();
      } catch {
        /* the database itself may be the problem */
      }
      return htmlResponse(errorView(c, 500, 'Something went wrong on our side. Please try again in a moment.'), { status: 500 });
    }
  }

  return {
    config,
    async fetch(request, ctx = {}) {
      const jobs = [];
      const response = await handle(request, ctx, jobs);
      for (const job of jobs) {
        const p = Promise.resolve()
          .then(job)
          .catch((err) => console.error('Background job failed', err && err.stack ? err.stack : err));
        if (ctx.waitUntil) ctx.waitUntil(p);
        else await p;
      }
      const secure = new URL(request.url).protocol === 'https:';
      const final = withSecurityHeaders(response, { secure });
      if (request.method.toUpperCase() === 'HEAD') {
        return new Response(null, { status: final.status, headers: final.headers });
      }
      return final;
    },
  };
}
