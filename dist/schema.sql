-- RRN SaaS v0.3.2: BASE SCHEMA ONLY (v1). On startup the app applies migrations in src/db/schema.js to the current version. Do not treat this file as a complete migration or restore script.
-- Copyright (c) 2026 Miloš Petrović (Trench Logic Studio) · SPDX-License-Identifier: MIT
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
