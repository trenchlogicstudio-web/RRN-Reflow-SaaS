// Copyright (c) 2026 Miloš Petrović (Trench Logic Studio) · SPDX-License-Identifier: MIT
import { randomToken, sha256Hex } from './crypto.js';
import { epochSeconds } from './time.js';
import { notifyAccountToken } from './notify.js';

export async function issueAccountToken(c, user, kind) {
  const token = randomToken(32);
  await c.db.batch([
    c.db.prepare('DELETE FROM account_tokens WHERE kind = ? AND salon_id = ? AND email = ?').bind(kind, user.salon_id, user.email),
    c.db.prepare('INSERT INTO account_tokens (token_hash, kind, salon_id, user_id, email, expires_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(await sha256Hex(token),kind,user.salon_id,user.id || null,user.email,epochSeconds(c.now)+86400),
  ]);
  const url = `${c.url.origin}/${kind === 'invite' ? 'join' : 'verify'}/${token}`;
  await notifyAccountToken({ db: c.db, mail: c.mail, now: c.now, productName: c.config.productName }, user, url, kind);
  return url;
}

export async function accountToken(c, kind) {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(c.params.token || '')) return null;
  return c.db.prepare('SELECT * FROM account_tokens WHERE token_hash = ? AND kind = ? AND used_at IS NULL AND expires_at > ?')
    .bind(await sha256Hex(c.params.token),kind,epochSeconds(c.now)).first();
}
