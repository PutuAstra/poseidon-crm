-- ─────────────────────────────────────────────────────────────────────────────
-- POSEIDON CRM — Migration v6: Sea-Based pipeline foundation
-- Phase 1 of the Sea-Based architecture (docs/seabased-design.md):
--   • declare tables worker.js already writes to but schema.sql never declared
--   • add columns the new state machine + ZeusHire integration require
--   • new tables: marlins_tests, deployments (with partial UNIQUE on ACTIVE)
--   • backfill: documents.type normalization, OFFER_LETTER_SIGNED rename
--
-- Run via: Cloudflare Dashboard → D1 → poseidon-db → Console
--          (one block at a time)
--
-- SAFE TO RE-RUN. SQLite has no `ADD COLUMN IF NOT EXISTS`, so a block may
-- report `duplicate column name: …` if the column was already added by a
-- prior unscripted migration. That's expected — skip and continue.
-- ─────────────────────────────────────────────────────────────────────────────

-- Block 1 — seafarer_profiles (worker.js writes this, schema.sql never declared it)
CREATE TABLE IF NOT EXISTS seafarer_profiles (
  id                  TEXT PRIMARY KEY,
  candidate_id        TEXT NOT NULL UNIQUE REFERENCES candidates(id) ON DELETE CASCADE,
  rank                TEXT,
  vessel_type         TEXT,
  years_at_sea        INTEGER,
  passport_number     TEXT,
  passport_expiry     TEXT,
  seaman_book_number  TEXT,
  seaman_book_expiry  TEXT,
  marlins_passed_at   TEXT,
  marlins_attempts    INTEGER NOT NULL DEFAULT 0,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Block 2 — seafarer_certificates
CREATE TABLE IF NOT EXISTS seafarer_certificates (
  id              TEXT PRIMARY KEY,
  candidate_id    TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  cert_type       TEXT NOT NULL,
  cert_number     TEXT,
  issued_date     TEXT,
  expiry_date     TEXT,
  issuing_body    TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Block 3 — offer_letters (idempotent re-declare; matches migration_v2)
CREATE TABLE IF NOT EXISTS offer_letters (
  id                    TEXT PRIMARY KEY,
  candidate_id          TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  client_id             TEXT REFERENCES clients(id),
  template_id           TEXT,
  content               TEXT,
  status                TEXT NOT NULL DEFAULT 'DRAFT'
                          CHECK (status IN ('DRAFT','SENT','SIGNED','EXPIRED','REVOKED')),
  sent_at               TEXT,
  signed_at             TEXT,
  signed_blob           TEXT,
  signing_session_id    TEXT,
  signature_token       TEXT,
  webhook_verified      INTEGER NOT NULL DEFAULT 0,
  webhook_received_at   TEXT,
  created_by_id         TEXT REFERENCES users(id),
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Block 4 — indexes for the seafarer / offer tables
CREATE INDEX IF NOT EXISTS idx_seafarer_candidate ON seafarer_profiles(candidate_id);
CREATE INDEX IF NOT EXISTS idx_seacert_candidate  ON seafarer_certificates(candidate_id);
CREATE INDEX IF NOT EXISTS idx_offer_candidate    ON offer_letters(candidate_id);
CREATE INDEX IF NOT EXISTS idx_offer_session      ON offer_letters(signing_session_id);

-- ── Block 5–10: candidates extra columns (run individually; ignore duplicates) ──

-- Block 5
ALTER TABLE candidates ADD COLUMN archive_reason TEXT;

-- Block 6
ALTER TABLE candidates ADD COLUMN archive_sub_stage TEXT;

-- Block 7
ALTER TABLE candidates ADD COLUMN archived_at TEXT;

-- Block 8
ALTER TABLE candidates ADD COLUMN archived_by_id TEXT REFERENCES users(id);

-- Block 9
ALTER TABLE candidates ADD COLUMN endorsed_client_id TEXT REFERENCES clients(id);

-- Block 10
ALTER TABLE candidates ADD COLUMN endorsed_client_name TEXT;

-- ── Block 11–15: candidate_interviews ZeusHire wiring ───────────────────────────

-- Block 11
ALTER TABLE candidate_interviews ADD COLUMN type TEXT;
-- 'ONE_WAY' | 'TWO_WAY' (the existing interviews.type column targets the template, not the session)

-- Block 12
ALTER TABLE candidate_interviews ADD COLUMN external_provider TEXT;

-- Block 13
ALTER TABLE candidate_interviews ADD COLUMN external_session_id TEXT;

-- Block 14
ALTER TABLE candidate_interviews ADD COLUMN external_token_hash TEXT;

-- Block 15
ALTER TABLE candidate_interviews ADD COLUMN recording_url TEXT;

-- ── Block 16: candidate_interviews indexes ──────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_ci_external_session ON candidate_interviews(external_session_id);
CREATE INDEX IF NOT EXISTS idx_ci_external_token   ON candidate_interviews(external_token_hash);
CREATE INDEX IF NOT EXISTS idx_ci_cand_type_order
  ON candidate_interviews(candidate_id, type, completed_at, scheduled_at, invited_at);

-- ── Block 17: client_endorsements — who endorsed ────────────────────────────────

ALTER TABLE client_endorsements ADD COLUMN endorsed_by_id TEXT REFERENCES users(id);

-- ── Block 18: marlins_tests (per-attempt log) ───────────────────────────────────

CREATE TABLE IF NOT EXISTS marlins_tests (
  id                TEXT PRIMARY KEY,
  candidate_id      TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  score             REAL NOT NULL CHECK (score >= 0 AND score <= 100),
  duration_seconds  INTEGER,
  code              TEXT,
  result            TEXT NOT NULL CHECK (result IN ('PASS','FAIL')),
  taken_at          TEXT NOT NULL DEFAULT (datetime('now')),
  recorded_by_id    TEXT REFERENCES users(id),
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_marlins_candidate ON marlins_tests(candidate_id, taken_at DESC);

-- ── Block 19: deployments (active sea-duty ledger) ──────────────────────────────

CREATE TABLE IF NOT EXISTS deployments (
  id                        TEXT PRIMARY KEY,
  candidate_id              TEXT NOT NULL REFERENCES candidates(id) ON DELETE RESTRICT,
  candidate_full_name       TEXT NOT NULL,
  client_id                 TEXT NOT NULL REFERENCES clients(id),
  client_name               TEXT NOT NULL,
  vessel_name               TEXT NOT NULL,
  sign_on_date              TEXT NOT NULL,
  contract_duration_months  INTEGER NOT NULL CHECK (contract_duration_months BETWEEN 1 AND 24),
  sign_on_port              TEXT,
  position                  TEXT,
  status                    TEXT NOT NULL DEFAULT 'ACTIVE'
                              CHECK (status IN ('ACTIVE','COMPLETED','TERMINATED','CANCELLED')),
  sign_off_date             TEXT,
  sign_off_reason           TEXT,
  notes                     TEXT,
  created_by_id             TEXT REFERENCES users(id),
  closed_by_id              TEXT REFERENCES users(id),
  created_at                TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at                TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── Block 20: deployments indexes (partial UNIQUE enforces "one ACTIVE per candidate") ──

CREATE INDEX IF NOT EXISTS idx_deploy_candidate ON deployments(candidate_id, sign_on_date DESC);
CREATE INDEX IF NOT EXISTS idx_deploy_status    ON deployments(status, sign_on_date DESC);
CREATE INDEX IF NOT EXISTS idx_deploy_client    ON deployments(client_id, sign_on_date DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_deploy_one_active
  ON deployments(candidate_id) WHERE status = 'ACTIVE';

-- ── Block 21: backfill — normalize document.type ────────────────────────────────

UPDATE documents
   SET type = UPPER(REPLACE(type, '-', '_'))
 WHERE type IS NOT NULL
   AND type != UPPER(REPLACE(type, '-', '_'));

-- ── Block 22: backfill — repair any stragglers still on OFFER_LETTER_SIGNED ─────

UPDATE candidates
   SET status = 'OFFER_LETTER'
 WHERE status = 'OFFER_LETTER_SIGNED';
