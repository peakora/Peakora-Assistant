-- One-time column additions to the existing affiliates table.
-- SQLite/D1 has no ADD COLUMN IF NOT EXISTS, so each statement errors if the
-- column already exists. Run with the deploy helper that tolerates per-statement
-- errors (a duplicate column must NOT abort the rest of the schema).

ALTER TABLE affiliates ADD COLUMN password_hash TEXT;
ALTER TABLE affiliates ADD COLUMN google_sub TEXT;
ALTER TABLE affiliates ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0;

-- Mark the program owner as admin. Idempotent on every deploy.
UPDATE affiliates SET is_admin = 1 WHERE user_email = 'peakora.network@gmail.com';
