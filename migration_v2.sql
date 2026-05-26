-- ─────────────────────────────────────────────────────────────────────────────
-- POSEIDON CRM — v2 State Machine Migration
-- Run in: Cloudflare Dashboard → D1 → poseidon-db → Console
-- Safe to run multiple times (IF NOT EXISTS / IF column not exists guards)
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. NEW COLUMNS ON candidates ──────────────────────────────────────────────

ALTER TABLE candidates ADD COLUMN archive_reason      TEXT;
ALTER TABLE candidates ADD COLUMN archived_at         TEXT;
ALTER TABLE candidates ADD COLUMN archived_by_id      TEXT REFERENCES users(id);
ALTER TABLE candidates ADD COLUMN endorsed_client_id   TEXT REFERENCES clients(id);
ALTER TABLE candidates ADD COLUMN endorsed_client_name TEXT;

-- ── 2. OFFER LETTERS TABLE ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS offer_letters (
  id                   TEXT PRIMARY KEY,
  candidate_id         TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  generated_by_id      TEXT NOT NULL REFERENCES users(id),

  -- Document
  document_url         TEXT,
  notes                TEXT,
  generated_at         TEXT,

  -- Signing session
  signing_session_id   TEXT UNIQUE,
  signing_platform     TEXT NOT NULL DEFAULT 'MANUAL',
  sent_for_signing_at  TEXT,
  signing_url          TEXT,
  signing_expires_at   TEXT,

  -- Completion (auto-set by webhook)
  signed_at            TEXT,
  signed_blob          TEXT,
  webhook_verified     INTEGER NOT NULL DEFAULT 0,
  webhook_received_at  TEXT,

  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_offer_letters_candidate ON offer_letters(candidate_id);
CREATE INDEX IF NOT EXISTS idx_offer_letters_session   ON offer_letters(signing_session_id);
CREATE INDEX IF NOT EXISTS idx_offer_letters_verified  ON offer_letters(webhook_verified);

-- ── 3. COMPOSITE INDEX FOR SECTION-ISOLATED QUERIES ─────────────────────────

CREATE INDEX IF NOT EXISTS idx_candidates_status_pipeline
  ON candidates(status, pipeline);

-- ── 4. ADD ROLE TO users CHECK (adds ONBOARDING_TEAM) ───────────────────────
-- SQLite does not enforce CHECK after creation; safe to leave existing
-- The application layer already enforces VALID_ROLES.

-- ── 5. MIGRATE EXISTING STATUS VALUES TO NEW 6-STATE MACHINE ────────────────
-- Maps old granular statuses → new unified states

-- NEW_SUBMISSION stays unchanged
-- CANDIDATES bucket: any in-progress screening/interview statuses
UPDATE candidates SET status = 'CANDIDATES'
  WHERE status IN (
    'IN_REVIEW', 'SCREENING', 'AVAILABLE', 'ENGAGED', 'SHORTLISTED',
    'OWI_INVITED', 'OWI_SUBMITTED', 'OWI_REVIEWED',
    'TWI_SCHEDULED', 'TWI_COMPLETED',
    'BOOKING_INVITED', 'BOOKING_COMPLETED',
    'PRE_QUAL_APPROVED', 'CONSULTATION'
  );

-- FINAL_INTERVIEW bucket: endorsed/under client review
UPDATE candidates SET status = 'FINAL_INTERVIEW'
  WHERE status IN ('ENDORSED', 'CLIENT_INTERVIEW', 'CLIENT_PENDING', 'INTERVIEW');

-- OFFER_LETTER_SIGNED bucket: client approved, offer in flight
UPDATE candidates SET status = 'OFFER_LETTER_SIGNED'
  WHERE status IN ('CLIENT_APPROVED', 'OFFERED');

-- ONBOARDING bucket
UPDATE candidates SET status = 'ONBOARDING'
  WHERE status IN (
    'HIRED', 'ONBOARDING', 'DOCUMENT_REVIEW',
    'COMPLIANCE_HOLD', 'DEPLOYED', 'VISA_PROCESSING',
    'USA_ONBOARD', 'COMPLETED'
  );

-- ARCHIVED bucket
UPDATE candidates SET status = 'ARCHIVED'
  WHERE status IN ('REJECTED', 'WITHDRAWN');

-- ── 6. SEED ENDORSEMENT client_name CACHE ───────────────────────────────────
-- SQLite correlated subquery form (no UPDATE...FROM support)
UPDATE candidates
SET
  endorsed_client_id = (
    SELECT ce.client_id
    FROM client_endorsements ce
    WHERE ce.candidate_id = candidates.id
    ORDER BY ce.endorsed_at DESC
    LIMIT 1
  ),
  endorsed_client_name = (
    SELECT cl.name
    FROM client_endorsements ce
    JOIN clients cl ON cl.id = ce.client_id
    WHERE ce.candidate_id = candidates.id
    ORDER BY ce.endorsed_at DESC
    LIMIT 1
  )
WHERE EXISTS (
  SELECT 1 FROM client_endorsements WHERE candidate_id = candidates.id
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Done. Verify with:
-- SELECT status, COUNT(*) cnt FROM candidates GROUP BY status;
-- ─────────────────────────────────────────────────────────────────────────────
