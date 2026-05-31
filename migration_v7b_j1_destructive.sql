-- ─────────────────────────────────────────────────────────────────────────────
-- POSEIDON CRM — Migration v7b (J1 Program, Phase 1b — DESTRUCTIVE REBUILDS)
--
-- !! READ BEFORE RUNNING !!
--
-- This migration rebuilds three tables (j1_profiles, clients, client_endorsements)
-- to add columns SQLite cannot ALTER in place (new PRIMARY KEY, new CHECK constraint,
-- new column inside a multi-column UNIQUE). Each rebuild follows a safe pattern:
--
--    A. SNAPSHOT — copy current table to <table>_legacy_v7b before any destruction.
--    B. CREATE NEW — build the target shape as <table>_new.
--    C. COPY — INSERT INTO <table>_new SELECT FROM <table> with explicit column map.
--    D. VERIFY — paste the SELECT block, eyeball row counts match (you do this).
--    E. SWAP — DROP <table>; ALTER <table>_new RENAME TO <table>; CREATE indexes.
--
-- Run via: Cloudflare Dashboard → D1 → poseidon-db → Console.
-- !! STOP at each "VERIFY" block. Re-paste it, compare row counts, then continue.
-- !! Backups (<table>_legacy_v7b) remain after the run. Drop them only after the
--    worker is redeployed and a fresh PUT /j1-profile + GET /candidates/:id work.
--
-- Rollback (if a SWAP block fails or post-deploy testing finds a regression):
--    DROP TABLE <table>;
--    ALTER TABLE <table>_legacy_v7b RENAME TO <table>;
--    (then re-create indexes — original index DDL preserved in schema.sql history)
-- ─────────────────────────────────────────────────────────────────────────────


-- ═════════════════════════════════════════════════════════════════════════════
-- PRE-FLIGHT — SNAPSHOTS (Block 1: backup all three tables)
-- ═════════════════════════════════════════════════════════════════════════════

CREATE TABLE j1_profiles_legacy_v7b AS SELECT * FROM j1_profiles;
CREATE TABLE clients_legacy_v7b AS SELECT * FROM clients;
CREATE TABLE client_endorsements_legacy_v7b AS SELECT * FROM client_endorsements;


-- ═════════════════════════════════════════════════════════════════════════════
-- PRE-FLIGHT VERIFY (Block 2: confirm snapshot rows match originals)
-- ═════════════════════════════════════════════════════════════════════════════
-- Paste this; expect three rows each showing original_count = snapshot_count.

SELECT 'j1_profiles' AS tbl,
       (SELECT COUNT(*) FROM j1_profiles)             AS original_count,
       (SELECT COUNT(*) FROM j1_profiles_legacy_v7b)  AS snapshot_count
UNION ALL
SELECT 'clients',
       (SELECT COUNT(*) FROM clients),
       (SELECT COUNT(*) FROM clients_legacy_v7b)
UNION ALL
SELECT 'client_endorsements',
       (SELECT COUNT(*) FROM client_endorsements),
       (SELECT COUNT(*) FROM client_endorsements_legacy_v7b);


-- ═════════════════════════════════════════════════════════════════════════════
-- REBUILD #1 — j1_profiles  (Block 3: CREATE j1_profiles_new)
-- ═════════════════════════════════════════════════════════════════════════════

CREATE TABLE j1_profiles_new (
  id                                TEXT PRIMARY KEY,
  candidate_id                      TEXT NOT NULL UNIQUE REFERENCES candidates(id) ON DELETE CASCADE,
  partner_batch_id                  TEXT REFERENCES partner_batches(id),
  j1_application_status             TEXT,
  j1_program_sources                TEXT,
  cti_usa_review                    TEXT,
  eligible_programs                 TEXT,
  sponsor_name                      TEXT,
  sponsor_client_id                 TEXT REFERENCES clients(id),
  processing_sponsor                TEXT,
  exchange_visitor_category         TEXT,
  program_start_date                TEXT,
  program_end_date                  TEXT,
  ds2019_number                     TEXT,
  ds2019_expiry_date                TEXT,
  hosting_company                   TEXT,
  host_company_id                   TEXT REFERENCES clients(id),
  selected_job                      TEXT,
  occupational_fields               TEXT,
  consultation_call_date            TEXT,
  consultation_call_by              TEXT,
  consultation_call_notes           TEXT,
  consultation_call_status          TEXT,
  english_assessment                TEXT,
  participant_rating                TEXT,
  attendance                        TEXT,
  ticket_pricing                    REAL,
  housing_landlord                  TEXT,
  housing_address                   TEXT,
  program_sponsor_invoice_status    TEXT,
  application_withdrawal_reason     TEXT,
  withdrawal_date                   TEXT,
  archive_reason                    TEXT CHECK(archive_reason IS NULL OR archive_reason IN
                                       ('ELIGIBILITY_FAIL','CONSULTATION_REJECT','VISA_DENIED',
                                        'HOST_REJECTED','WITHDRAWN','OTHER')),
  medical_exam_date                 TEXT,
  medical_exam_cleared              INTEGER DEFAULT 0,
  visa_interview_date               TEXT,
  visa_interview_consulate          TEXT,
  visa_interview_result             TEXT,
  visa_briefing_done                INTEGER DEFAULT 0,
  departure_briefing_done           INTEGER DEFAULT 0,
  flight_ticket_ref                 TEXT,
  flight_departure_date             TEXT,
  arrival_date_usa                  TEXT,
  sevis_validated_date              TEXT,
  program_completion_date           TEXT,
  home_residency_required           INTEGER DEFAULT 0,
  updated_at                        TEXT NOT NULL DEFAULT (datetime('now')),
  version                           INTEGER NOT NULL DEFAULT 1,
  created_at                        TEXT NOT NULL DEFAULT (datetime('now'))
);


-- Block 4: COPY rows — preserves every legacy column that has a target home.
-- Legacy columns dropped on purpose: sponsor_ein (unused), training_plan_url
-- (now document_issuance.document_id where doc_type='TRAINING_PLAN'),
-- ds2019_issued_date (use document_issuance.issued_at), ds2019_onedrive_id
-- (use document_issuance.document_id), j1_visa_number/issued_date/expiry_date
-- (now document_issuance(J1_VISA_STAMP)), sevis_id/fee_paid/fee_paid_date
-- (now j1_payments with stage='SEVIS_FEE'), stage_data (JSON blob), all four
-- stageN_investment (now j1_payments by stage).

INSERT INTO j1_profiles_new (
  id, candidate_id,
  sponsor_name,
  exchange_visitor_category,
  program_start_date, program_end_date,
  ds2019_number, ds2019_expiry_date,
  visa_interview_consulate,
  updated_at,
  created_at
)
SELECT
  lower(hex(randomblob(12))), candidate_id,
  sponsor_name,
  exchange_visitor_category,
  program_start_date, program_end_date,
  ds2019_number, ds2019_expiry_date,
  j1_visa_consulate,
  COALESCE(updated_at, datetime('now')),
  datetime('now')
FROM j1_profiles;


-- Block 5: VERIFY — counts must match snapshot.
SELECT 'j1_profiles_check' AS tbl,
       (SELECT COUNT(*) FROM j1_profiles_legacy_v7b) AS snapshot_count,
       (SELECT COUNT(*) FROM j1_profiles_new)        AS new_count;


-- Block 6: SWAP — only paste AFTER Block 5 shows matching counts.
DROP TABLE j1_profiles;
ALTER TABLE j1_profiles_new RENAME TO j1_profiles;
CREATE INDEX IF NOT EXISTS idx_j1_profiles_status  ON j1_profiles(j1_application_status);
CREATE INDEX IF NOT EXISTS idx_j1_profiles_sponsor ON j1_profiles(sponsor_client_id);
CREATE INDEX IF NOT EXISTS idx_j1_profiles_host    ON j1_profiles(host_company_id);
CREATE INDEX IF NOT EXISTS idx_j1_profiles_window  ON j1_profiles(program_start_date, program_end_date);
CREATE INDEX IF NOT EXISTS idx_j1_profiles_ds2019  ON j1_profiles(ds2019_expiry_date);
CREATE INDEX IF NOT EXISTS idx_j1_profiles_batch   ON j1_profiles(partner_batch_id);


-- ═════════════════════════════════════════════════════════════════════════════
-- REBUILD #2 — clients.type  (Block 7: CREATE clients_new with extended CHECK)
-- ═════════════════════════════════════════════════════════════════════════════

CREATE TABLE clients_new (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  type          TEXT NOT NULL CHECK(type IN ('CRUISE_LINE','LAND_BASED','J1_SPONSOR','J1_HOST_COMPANY')),
  country       TEXT,
  website       TEXT,
  logo_url      TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  notes         TEXT,
  is_active     INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);


-- Block 8: COPY rows.
INSERT INTO clients_new (id, name, type, country, website, logo_url, contact_email, contact_phone, notes, is_active, created_at, updated_at)
SELECT id, name, type, country, website, logo_url, contact_email, contact_phone, notes, is_active, created_at, updated_at
  FROM clients;


-- Block 9: VERIFY.
SELECT 'clients_check' AS tbl,
       (SELECT COUNT(*) FROM clients_legacy_v7b) AS snapshot_count,
       (SELECT COUNT(*) FROM clients_new)        AS new_count;


-- Block 10: SWAP.
DROP TABLE clients;
ALTER TABLE clients_new RENAME TO clients;
CREATE INDEX IF NOT EXISTS idx_clients_type ON clients(type, is_active);


-- ═════════════════════════════════════════════════════════════════════════════
-- REBUILD #3 — client_endorsements  (Block 11: CREATE _new with endorsement_role)
-- ═════════════════════════════════════════════════════════════════════════════

CREATE TABLE client_endorsements_new (
  id                  TEXT PRIMARY KEY,
  candidate_id        TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  client_id           TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  endorsement_role    TEXT NOT NULL CHECK(endorsement_role IN
                        ('CRUISE_LINE','LAND_BASED','SPONSOR_MATCH','HOST_PLACEMENT')),
  status              TEXT NOT NULL CHECK(status IN
                        ('PENDING','SCHEDULED','APPROVED','REJECTED','WITHDRAWN','COMPLETED')),
  endorsed_at         TEXT NOT NULL DEFAULT (datetime('now')),
  scheduled_at        TEXT,
  decided_at          TEXT,
  decision_notes      TEXT,
  interview_url       TEXT,
  endorsed_by_id      TEXT REFERENCES users(id),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);


-- Block 12: COPY rows — every existing endorsement gets endorsement_role inferred
-- from the candidate's pipeline. SEA_BASED → 'CRUISE_LINE', LAND_BASED → 'LAND_BASED',
-- J1_PROGRAM → 'HOST_PLACEMENT' (closest match for pre-v7b J1 records).
INSERT INTO client_endorsements_new (
  id, candidate_id, client_id, endorsement_role, status,
  endorsed_at, scheduled_at, decided_at, decision_notes, interview_url,
  endorsed_by_id, updated_at
)
SELECT
  ce.id,
  ce.candidate_id,
  ce.client_id,
  CASE c.pipeline
    WHEN 'SEA_BASED'  THEN 'CRUISE_LINE'
    WHEN 'LAND_BASED' THEN 'LAND_BASED'
    WHEN 'J1_PROGRAM' THEN 'HOST_PLACEMENT'
    ELSE 'CRUISE_LINE'
  END,
  ce.status,
  ce.endorsed_at,
  ce.scheduled_at,
  ce.decided_at,
  ce.decision_notes,
  ce.interview_url,
  ce.endorsed_by_id,
  ce.updated_at
FROM client_endorsements ce
LEFT JOIN candidates c ON c.id = ce.candidate_id;


-- Block 13: VERIFY.
SELECT 'client_endorsements_check' AS tbl,
       (SELECT COUNT(*) FROM client_endorsements_legacy_v7b) AS snapshot_count,
       (SELECT COUNT(*) FROM client_endorsements_new)        AS new_count;


-- Block 14: SWAP.
DROP TABLE client_endorsements;
ALTER TABLE client_endorsements_new RENAME TO client_endorsements;
CREATE UNIQUE INDEX IF NOT EXISTS uq_endorsement_active
  ON client_endorsements(candidate_id, client_id, endorsement_role)
  WHERE status IN ('PENDING','SCHEDULED');
CREATE INDEX IF NOT EXISTS idx_endorsements_client
  ON client_endorsements(client_id, status);
CREATE INDEX IF NOT EXISTS idx_endorsements_candidate
  ON client_endorsements(candidate_id, status);
CREATE INDEX IF NOT EXISTS idx_endorsements_role
  ON client_endorsements(candidate_id, endorsement_role, status);


-- ═════════════════════════════════════════════════════════════════════════════
-- POST-FLIGHT — confirm everything reads back correctly  (Block 15)
-- ═════════════════════════════════════════════════════════════════════════════
-- Expect: row counts match the legacy_v7b snapshots, three table info rows show
-- the new column shapes, and no obvious nulls in mandatory fields.

SELECT 'j1_profiles' AS tbl, COUNT(*) AS rows FROM j1_profiles
UNION ALL SELECT 'clients',              COUNT(*) FROM clients
UNION ALL SELECT 'client_endorsements',  COUNT(*) FROM client_endorsements;


-- ═════════════════════════════════════════════════════════════════════════════
-- CLEANUP (Block 16) — only after you've redeployed the worker AND verified
-- the J1 profile endpoint + Sea/Land endorse flow still work end-to-end.
-- ═════════════════════════════════════════════════════════════════════════════
-- DROP TABLE j1_profiles_legacy_v7b;
-- DROP TABLE clients_legacy_v7b;
-- DROP TABLE client_endorsements_legacy_v7b;
