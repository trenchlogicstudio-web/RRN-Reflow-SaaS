// Copyright (c) 2026 Miloš Petrović (Trench Logic Studio) · SPDX-License-Identifier: MIT
// Database schema. Applied automatically on the first request after deployment,
// so a fresh Cloudflare D1 database needs no manual setup.
//
// The Reflow invariants live here too, as CHECK constraints on `requests`:
// even a hand-written INSERT cannot store a discounted or under-upgraded offer.
//
// SCHEMA_SQL is version 1 exactly as first shipped; later changes are MIGRATIONS,
// so a fresh database and an upgraded one go through the same steps.

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS salons (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  timezone TEXT NOT NULL,
  currency TEXT NOT NULL,
  plan TEXT NOT NULL DEFAULT 'reflow' CHECK (plan IN ('reflow', 'relay', 'nexus')),
  min_uplift_pct INTEGER NOT NULL DEFAULT 30 CHECK (min_uplift_pct BETWEEN 30 AND 200),
  lead_min INTEGER NOT NULL DEFAULT 120 CHECK (lead_min BETWEEN 0 AND 10080),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  salon_id INTEGER NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
  email TEXT NOT NULL UNIQUE,
  pass_hash TEXT NOT NULL,
  pass_salt TEXT NOT NULL,
  pass_iter INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_users_salon ON users(salon_id);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS services (
  id INTEGER PRIMARY KEY,
  salon_id INTEGER NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  duration_min INTEGER NOT NULL CHECK (duration_min BETWEEN 5 AND 600),
  price_cents INTEGER NOT NULL CHECK (price_cents BETWEEN 0 AND 100000000),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_services_salon ON services(salon_id);

CREATE TABLE IF NOT EXISTS upgrades (
  id INTEGER PRIMARY KEY,
  salon_id INTEGER NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
  service_id INTEGER REFERENCES services(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  added_min INTEGER NOT NULL CHECK (added_min BETWEEN 5 AND 240),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_upgrades_salon ON upgrades(salon_id);

CREATE TABLE IF NOT EXISTS windows (
  id INTEGER PRIMARY KEY,
  salon_id INTEGER NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
  weekday INTEGER NOT NULL CHECK (weekday BETWEEN 1 AND 7),
  start_min INTEGER NOT NULL CHECK (start_min BETWEEN 0 AND 1439),
  end_min INTEGER NOT NULL CHECK (end_min BETWEEN 1 AND 1440),
  capacity INTEGER NOT NULL CHECK (capacity BETWEEN 1 AND 50),
  created_at TEXT NOT NULL,
  CHECK (end_min - start_min >= 30)
);

CREATE INDEX IF NOT EXISTS idx_windows_salon ON windows(salon_id);

CREATE TABLE IF NOT EXISTS requests (
  id INTEGER PRIMARY KEY,
  salon_id INTEGER NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  ref TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('offer', 'waitlist')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'declined', 'expired', 'closed')),
  service_id INTEGER REFERENCES services(id) ON DELETE SET NULL,
  service_name TEXT NOT NULL,
  base_min INTEGER NOT NULL CHECK (base_min > 0),
  added_min INTEGER NOT NULL DEFAULT 0 CHECK (added_min >= 0),
  total_min INTEGER NOT NULL,
  uplift_pct INTEGER NOT NULL,
  upgrades_json TEXT NOT NULL DEFAULT '[]',
  standard_price_cents INTEGER NOT NULL CHECK (standard_price_cents >= 0),
  price_cents INTEGER NOT NULL,
  currency TEXT NOT NULL,
  slot_date TEXT,
  start_min INTEGER,
  end_min INTEGER,
  capacity INTEGER,
  client_name TEXT,
  client_contact TEXT,
  note TEXT,
  consent_at TEXT,
  consent_version TEXT,
  decision_ref TEXT,
  created_at TEXT NOT NULL,
  decided_at TEXT,
  erased_at TEXT,
  CHECK (price_cents = standard_price_cents),
  CHECK (total_min = base_min + added_min),
  CHECK (kind = 'waitlist' OR (uplift_pct >= 30 AND added_min * 100 >= base_min * uplift_pct)),
  CHECK (kind = 'waitlist' OR (slot_date IS NOT NULL AND start_min IS NOT NULL AND end_min IS NOT NULL AND capacity IS NOT NULL AND end_min = start_min + total_min AND capacity >= 1)),
  CHECK (status <> 'confirmed' OR kind = 'offer'),
  CHECK (status <> 'closed' OR kind = 'waitlist')
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_requests_ref ON requests(salon_id, ref);

CREATE INDEX IF NOT EXISTS idx_requests_salon_status ON requests(salon_id, status);

CREATE INDEX IF NOT EXISTS idx_requests_salon_slot ON requests(salon_id, slot_date);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY,
  salon_id INTEGER NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL,
  prev_hash TEXT NOT NULL,
  hash TEXT NOT NULL,
  UNIQUE (salon_id, prev_hash)
);

CREATE TABLE IF NOT EXISTS interest (
  salon_id INTEGER NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
  tier TEXT NOT NULL CHECK (tier IN ('relay', 'nexus')),
  created_at TEXT NOT NULL,
  PRIMARY KEY (salon_id, tier)
);

CREATE TABLE IF NOT EXISTS password_resets (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);

CREATE TABLE IF NOT EXISTS admin_sessions (
  token_hash TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  window_start INTEGER NOT NULL
);

INSERT OR IGNORE INTO meta (key, value) VALUES ('schema_version', '1');
`;

// Migrations bring an existing database up to the current schema, in order.
// Each runs once, atomically, and records its number in meta.schema_version.
export const MIGRATIONS = {
  2: `
ALTER TABLE salons ADD COLUMN locale TEXT NOT NULL DEFAULT 'en';
ALTER TABLE salons ADD COLUMN address TEXT;
ALTER TABLE salons ADD COLUMN phone TEXT;
ALTER TABLE salons ADD COLUMN calendar_token TEXT;
ALTER TABLE salons ADD COLUMN is_demo INTEGER NOT NULL DEFAULT 0;
ALTER TABLE salons ADD COLUMN demo_expires_at TEXT;
ALTER TABLE salons ADD COLUMN billing_status TEXT NOT NULL DEFAULT 'beta';
ALTER TABLE salons ADD COLUMN trial_ends_at TEXT;
ALTER TABLE salons ADD COLUMN billing_provider TEXT;
ALTER TABLE salons ADD COLUMN billing_customer_id TEXT;
ALTER TABLE salons ADD COLUMN billing_subscription_id TEXT;
ALTER TABLE salons ADD COLUMN billing_portal_url TEXT;
ALTER TABLE salons ADD COLUMN billing_period_end TEXT;
ALTER TABLE users ADD COLUMN locale TEXT NOT NULL DEFAULT 'en';
ALTER TABLE users ADD COLUMN notify_email INTEGER NOT NULL DEFAULT 1;
ALTER TABLE requests ADD COLUMN locale TEXT NOT NULL DEFAULT 'en';
CREATE UNIQUE INDEX IF NOT EXISTS idx_salons_calendar ON salons(calendar_token);
CREATE INDEX IF NOT EXISTS idx_salons_demo ON salons(is_demo, demo_expires_at);
CREATE INDEX IF NOT EXISTS idx_salons_subscription ON salons(billing_subscription_id);
CREATE TABLE IF NOT EXISTS outbox (
  id INTEGER PRIMARY KEY,
  salon_id INTEGER REFERENCES salons(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  to_addr TEXT NOT NULL,
  reply_to TEXT,
  subject TEXT NOT NULL,
  body_text TEXT NOT NULL,
  body_html TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL,
  last_error TEXT,
  created_at TEXT NOT NULL,
  sent_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_outbox_due ON outbox(status, next_attempt_at);
CREATE TABLE IF NOT EXISTS stats_daily (
  salon_id INTEGER NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  metric TEXT NOT NULL,
  n INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (salon_id, day, metric)
);
CREATE TABLE IF NOT EXISTS webhook_events (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  received_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS error_log (
  id INTEGER PRIMARY KEY,
  at TEXT NOT NULL,
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  message TEXT NOT NULL
);
`,
  3: `
ALTER TABLE salons ADD COLUMN billing_event_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE salons ADD COLUMN billing_event_rank INTEGER NOT NULL DEFAULT 0;
ALTER TABLE salons ADD COLUMN cancel_notice_min INTEGER NOT NULL DEFAULT 120;
ALTER TABLE salons ADD COLUMN hold_hours INTEGER NOT NULL DEFAULT 24;
ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'owner' CHECK (role IN ('owner', 'staff'));
ALTER TABLE users ADD COLUMN email_verified_at TEXT;
ALTER TABLE users ADD COLUMN pass_peppered INTEGER NOT NULL DEFAULT 0;
ALTER TABLE requests ADD COLUMN outcome TEXT CHECK (outcome IN ('completed', 'no_show', 'canceled'));
ALTER TABLE requests ADD COLUMN outcome_at TEXT;
ALTER TABLE requests ADD COLUMN canceled_by TEXT;
ALTER TABLE requests ADD COLUMN hold_expires_at TEXT;
ALTER TABLE requests ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE outbox ADD COLUMN dedupe_key TEXT;
ALTER TABLE outbox ADD COLUMN request_id INTEGER REFERENCES requests(id) ON DELETE CASCADE;
ALTER TABLE outbox ADD COLUMN request_revision INTEGER;
CREATE UNIQUE INDEX IF NOT EXISTS idx_outbox_dedupe ON outbox(dedupe_key);
CREATE TABLE IF NOT EXISTS billing_subscriptions (
  provider TEXT NOT NULL,
  subscription_id TEXT NOT NULL,
  salon_id INTEGER NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
  event_at INTEGER NOT NULL DEFAULT 0,
  event_rank INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  PRIMARY KEY (provider, subscription_id)
);
CREATE TABLE IF NOT EXISTS time_blocks (
  id INTEGER PRIMARY KEY,
  salon_id INTEGER NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
  slot_date TEXT NOT NULL,
  start_min INTEGER NOT NULL CHECK (start_min BETWEEN 0 AND 1439),
  end_min INTEGER NOT NULL CHECK (end_min BETWEEN 1 AND 1440 AND end_min > start_min),
  capacity INTEGER NOT NULL CHECK (capacity BETWEEN 1 AND 50),
  reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_time_blocks_slot ON time_blocks(salon_id, slot_date);
CREATE TABLE IF NOT EXISTS account_tokens (
  token_hash TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('verify', 'invite')),
  salon_id INTEGER NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_account_tokens_user ON account_tokens(user_id, kind);
`,
};

export const SCHEMA_VERSION = Math.max(1, ...Object.keys(MIGRATIONS).map(Number));

export function schemaStatements(sql = SCHEMA_SQL) {
  return sql
    .split(/;\s*(?:\r?\n|$)/)
    .map((s) => s.trim())
    .filter(Boolean);
}

const ready = new WeakSet();

async function currentVersion(db) {
  try {
    const row = await db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").first();
    return row ? Number(row.value) : 0;
  } catch {
    return 0; // no meta table yet: a fresh database
  }
}

export async function ensureSchema(db) {
  if (ready.has(db)) return;
  let version = await currentVersion(db);
  if (version < 1) {
    await db.batch(schemaStatements().map((s) => db.prepare(s)));
    version = 1;
  }
  for (let next = version + 1; next <= SCHEMA_VERSION; next++) {
    const statements = schemaStatements(MIGRATIONS[next]).map((s) => db.prepare(s));
    statements.push(db.prepare("UPDATE meta SET value = ? WHERE key = 'schema_version'").bind(String(next)));
    try {
      await db.batch(statements);
    } catch (err) {
      // Another worker may have migrated at the same moment; that is fine if the version moved on.
      if ((await currentVersion(db)) < next) throw err;
    }
  }
  ready.add(db);
}
