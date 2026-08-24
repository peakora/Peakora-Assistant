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

-- ===========================================================================
-- AFFILIATE PROGRAM ENGINE
-- Tracks referral attribution, commission accrual, and payout lifecycle.
-- Commission is calculated server-side inside the payment webhook (see
-- worker/src/index.js processAffiliateAttribution) so it is always tied to a
-- verified payment event, never client-trustable.
-- ===========================================================================

-- Affiliates (approved partners). One row per approved partner.
CREATE TABLE IF NOT EXISTS affiliates (
  id              TEXT PRIMARY KEY,        -- aff_<random>
  user_email      TEXT UNIQUE NOT NULL,     -- login identity + payout contact
  display_name    TEXT,
  referral_code   TEXT UNIQUE NOT NULL,    -- short code used in ?via=/&ref= links
  -- Commission model: 'percentage' (recurring % of each payment) or 'flat'
  -- (fixed $ per qualifying conversion). Default recurring percentage.
  commission_type TEXT NOT NULL DEFAULT 'percentage',
  commission_rate REAL NOT NULL DEFAULT 0.30,  -- 0.30 = 30%
  status          TEXT NOT NULL DEFAULT 'pending',  -- pending|active|suspended
  -- JSON: { method: 'paypal'|'wise'|'bank'|'usdc', details: {...} }
  payout_method   TEXT,
  payout_details  TEXT,
  -- Tier breakpoints (active referrals) for auto-escalation. JSON array.
  tier_config     TEXT,
  cookie_days     INTEGER NOT NULL DEFAULT 90,
  payout_min      REAL NOT NULL DEFAULT 50.0,
  -- Legacy payout schedule: 'monthly'|'weekly'. Elite => weekly.
  payout_schedule TEXT NOT NULL DEFAULT 'monthly',
  applied_at      TEXT NOT NULL DEFAULT (datetime('now')),
  approved_at     TEXT,
  suspended_at    TEXT,
  notes           TEXT
);

-- Raw referral clicks. One row per inbound click on an affiliate link.
-- ip_hash is a SHA-256 hash (never the raw IP) used for self-referral +
-- fraud detection. landing_page + referrer_url aid attribution audits.
CREATE TABLE IF NOT EXISTS referral_clicks (
  id            TEXT PRIMARY KEY,          -- clk_<random>
  affiliate_id  TEXT NOT NULL,
  referral_code TEXT NOT NULL,
  ip_hash       TEXT,
  user_agent    TEXT,
  landing_page  TEXT,
  referrer_url  TEXT,
  -- Stored at click time so a later conversion can be attributed even if the
  -- client cookie was cleared (last-click-wins attribution window).
  clicked_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Commissions. One row per qualifying payment that earned commission.
-- status lifecycle: pending -> approved -> paid  (or pending -> refunded).
-- hold_until_date enforces the 30-day payout hold before approval.
CREATE TABLE IF NOT EXISTS commissions (
  id                 TEXT PRIMARY KEY,     -- com_<random>
  affiliate_id       TEXT NOT NULL,
  customer_email     TEXT NOT NULL,        -- the referred subscriber's email
  transaction_id     TEXT NOT NULL,        -- links to subscriptions.transaction_id
  gross_amount       REAL NOT NULL,        -- gross payment the customer paid
  commission_amount  REAL NOT NULL,        -- calculated payout to affiliate
  commission_rate    REAL NOT NULL,         -- rate snapshot at calc time
  status             TEXT NOT NULL DEFAULT 'pending',  -- pending|approved|paid|refunded
  plan               TEXT,
  hold_until_date    TEXT,                  -- ISO date; approved auto after this
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  paid_at            TEXT,
  payout_id          TEXT                   -- links to payouts.id when paid
);

-- Payouts. One row per batch payout to an affiliate.
CREATE TABLE IF NOT EXISTS payouts (
  id                  TEXT PRIMARY KEY,     -- pay_<random>
  affiliate_id        TEXT NOT NULL,
  amount              REAL NOT NULL,        -- sum of approved commissions
  status              TEXT NOT NULL DEFAULT 'pending',  -- pending|sent|failed
  payout_method       TEXT,
  transaction_reference TEXT,               -- provider txn id / confirmation
  processed_at        TEXT,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  notes               TEXT
);

-- Affiliate-indexed views for common queries (portal dashboard).
CREATE INDEX IF NOT EXISTS idx_affiliates_code ON affiliates(referral_code);
CREATE INDEX IF NOT EXISTS idx_affiliates_status ON affiliates(status);
CREATE INDEX IF NOT EXISTS idx_clicks_affiliate ON referral_clicks(affiliate_id);
CREATE INDEX IF NOT EXISTS idx_clicks_code_time ON referral_clicks(referral_code, clicked_at);
CREATE INDEX IF NOT EXISTS idx_commissions_affiliate ON commissions(affiliate_id);
CREATE INDEX IF NOT EXISTS idx_commissions_status ON commissions(status);
CREATE INDEX IF NOT EXISTS idx_commissions_customer ON commissions(customer_email);
CREATE INDEX IF NOT EXISTS idx_commissions_transaction ON commissions(transaction_id);
CREATE INDEX IF NOT EXISTS idx_commissions_hold ON commissions(status, hold_until_date);
CREATE INDEX IF NOT EXISTS idx_payouts_affiliate ON payouts(affiliate_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_txn ON subscriptions(transaction_id);
