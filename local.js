// Copyright (c) 2026 Miloš Petrović (Trench Logic Studio) · SPDX-License-Identifier: MIT
// Run the app on your own computer: npm start, then open http://localhost:8787
// Data is kept in data/local.sqlite (or DB_PATH). Requires Node 22.13 or newer.
// To see the emails the app would send, start it with MAIL_PROVIDER=console and
// MAIL_FROM="Reflow <requests@example.com>": they are printed here instead.

import http from 'node:http';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createApp } from './src/app.js';
import { ensureSchema } from './src/db/schema.js';
import { dailyMaintenance } from './src/maintenance.js';
import { mailConfig } from './src/mail.js';

const port = Number(process.env.PORT || 8787);
const file = process.env.DB_PATH || 'data/local.sqlite';
if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });

let createD1;
try {
  ({ createD1 } = await import('./src/db/node-d1.js'));
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
const db = createD1(file);
await ensureSchema(db);
const app = createApp({ db, env: process.env });

const MAX_BODY = 64 * 1024;

const server = http.createServer(async (req, res) => {
  try {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > MAX_BODY) {
        res.writeHead(413, { 'content-type': 'text/plain' }).end('Request too large');
        return;
      }
      chunks.push(chunk);
    }
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) {
      if (Array.isArray(v)) v.forEach((x) => headers.append(k, x));
      else if (v !== undefined) headers.set(k, v);
    }
    const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
    const origin = process.env.PUBLIC_ORIGIN ? new URL(process.env.PUBLIC_ORIGIN).origin : `http://${req.headers.host || `localhost:${port}`}`;
    if (process.env.PUBLIC_ORIGIN && req.headers.host !== new URL(origin).host) {
      res.writeHead(421, { 'content-type': 'text/plain' }).end('Unexpected host');
      return;
    }
    const request = new Request(`${origin}${req.url}`, {
      method: req.method,
      headers,
      body: hasBody ? Buffer.concat(chunks) : undefined,
    });
    const response = await app.fetch(request, { ip: req.socket.remoteAddress || '' });
    const out = {};
    response.headers.forEach((value, key) => {
      if (key !== 'set-cookie') out[key] = value;
    });
    const cookies = response.headers.getSetCookie();
    if (cookies.length) out['set-cookie'] = cookies;
    res.writeHead(response.status, out);
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (err) {
    console.error(err);
    if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain' });
    res.end('Internal error');
  }
});

server.listen(port, () => {
  console.log(`${app.config.productName} ${app.config.version} running on http://localhost:${port}`);
});

const timer = setInterval(
  () => dailyMaintenance(db, new Date(), { env: process.env, mail: mailConfig(process.env), productName: app.config.productName }).catch((e) => console.error('maintenance', e)),
  15 * 60 * 1000,
);
timer.unref();
