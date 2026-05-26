-- ─────────────────────────────────────────────────────────────────────────────
-- POSEIDON CRM — v3 Migration: Add ONBOARDING_TEAM role to users CHECK constraint
-- Run ONE STATEMENT AT A TIME in:
--   Cloudflare Dashboard → D1 → poseidon-db → Console
-- ─────────────────────────────────────────────────────────────────────────────

-- ── STEP 1: Create replacement table with updated CHECK constraint ────────────
CREATE TABLE users_v3 (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT,
  role          TEXT NOT NULL CHECK(role IN ('SUPER_ADMIN','ADMIN','RECRUITER','CLIENT_CONTACT','CANDIDATE','ONBOARDING_TEAM')),
  first_name    TEXT NOT NULL,
  last_name     TEXT NOT NULL,
  avatar_url    TEXT,
  is_active     INTEGER NOT NULL DEFAULT 1,
  last_login_at TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── STEP 2: Copy all existing users into the new table ───────────────────────
INSERT INTO users_v3 SELECT * FROM users;

-- ── STEP 3: Drop the old table ───────────────────────────────────────────────
DROP TABLE users;

-- ── STEP 4: Rename new table to users ────────────────────────────────────────
ALTER TABLE users_v3 RENAME TO users;

-- ── VERIFY ───────────────────────────────────────────────────────────────────
-- SELECT id, email, role FROM users;
