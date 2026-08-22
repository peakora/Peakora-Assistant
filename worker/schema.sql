-- Peakora D1 schema — shared backend database for all repos.
-- Run: npx wrangler d1 execute peakora-db --file=worker/schema.sql

-- Subscriptions (Dodo webhook writes here, frontend reads status from here)
CREATE TABLE IF NOT EXISTS subscriptions (
  email         TEXT PRIMARY KEY,
  status        TEXT NOT NULL DEFAULT 'free',
  plan          TEXT NOT NULL DEFAULT 'monthly',
  transaction_id TEXT,
  event_type    TEXT,
  method        TEXT DEFAULT 'Dodo Payments',
  product_id    TEXT,
  updated_at    TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Email newsletter subscribers
CREATE TABLE IF NOT EXISTS subscribers (
  email         TEXT PRIMARY KEY,
  source        TEXT DEFAULT 'app',
  consent       INTEGER DEFAULT 1,
  sequence      TEXT DEFAULT 'welcome-3',
  subscribed_at TEXT NOT NULL,
  last_seen_at  TEXT
);

-- User feedback
CREATE TABLE IF NOT EXISTS feedback (
  id        TEXT PRIMARY KEY,
  message   TEXT,
  rating    INTEGER,
  page      TEXT,
  email     TEXT,
  timestamp TEXT NOT NULL
);

-- Usage telemetry
CREATE TABLE IF NOT EXISTS events (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  action    TEXT NOT NULL,
  details   TEXT,
  timestamp TEXT NOT NULL
);

-- Web push subscriptions
CREATE TABLE IF NOT EXISTS push_subscriptions (
  endpoint  TEXT PRIMARY KEY,
  keys      TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Users (for future shared auth across all repos)
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  display_name  TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status);
CREATE INDEX IF NOT EXISTS idx_events_action ON events(action);
CREATE INDEX IF NOT EXISTS idx_feedback_timestamp ON feedback(timestamp);
