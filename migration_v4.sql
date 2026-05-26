-- ─────────────────────────────────────────────────────────────────────────────
-- POSEIDON CRM — v4 Migration: Isolated Program Pipelines
-- Run ONE STATEMENT AT A TIME in:
--   Cloudflare Dashboard → D1 → poseidon-db → Console
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. J1 PROGRAM EXTENSION TABLE ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS j1_profiles (
  candidate_id                TEXT PRIMARY KEY REFERENCES candidates(id) ON DELETE CASCADE,
  sponsor_name                TEXT,
  sponsor_ein                 TEXT,
  exchange_visitor_category   TEXT,
  program_start_date          TEXT,
  program_end_date            TEXT,
  training_plan_url           TEXT,
  ds2019_number               TEXT UNIQUE,
  ds2019_issued_date          TEXT,
  ds2019_expiry_date          TEXT,
  ds2019_onedrive_id          TEXT,
  j1_visa_number              TEXT,
  j1_visa_issued_date         TEXT,
  j1_visa_expiry_date         TEXT,
  j1_visa_consulate           TEXT,
  sevis_id                    TEXT,
  sevis_fee_paid              INTEGER NOT NULL DEFAULT 0,
  sevis_fee_paid_date         TEXT,
  stage_data                  TEXT,
  updated_at                  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── 2. SEA-BASED EXTENSION TABLE ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sea_profiles (
  candidate_id                TEXT PRIMARY KEY REFERENCES candidates(id) ON DELETE CASCADE,
  seaman_book_number          TEXT,
  seaman_book_expiry          TEXT,
  stcw_certifications         TEXT,
  medical_cert_number         TEXT,
  medical_cert_expiry         TEXT,
  vessel_type                 TEXT,
  rank                        TEXT,
  department                  TEXT,
  preferred_cruise_line       TEXT,
  c1d_visa_number             TEXT,
  c1d_visa_issued_date        TEXT,
  c1d_visa_expiry_date        TEXT,
  c1d_visa_consulate          TEXT,
  c1d_appointment_date        TEXT,
  c1d_appointment_cost        REAL,
  offer_letter_id             TEXT,
  ship_name                   TEXT,
  sign_on_date                TEXT,
  sign_off_date               TEXT,
  sign_on_port                TEXT,
  stage_data                  TEXT,
  updated_at                  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── 3. LAND-BASED EXTENSION TABLE ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS land_profiles (
  candidate_id                TEXT PRIMARY KEY REFERENCES candidates(id) ON DELETE CASCADE,
  job_title                   TEXT,
  department                  TEXT,
  employer_name               TEXT,
  employer_country            TEXT,
  work_location               TEXT,
  contract_type               TEXT,
  contract_start_date         TEXT,
  contract_end_date           TEXT,
  salary_offered              TEXT,
  visa_type                   TEXT,
  visa_number                 TEXT,
  visa_issued_date            TEXT,
  visa_expiry_date            TEXT,
  visa_consulate              TEXT,
  work_permit_number          TEXT,
  work_permit_expiry          TEXT,
  bg_check_status             TEXT NOT NULL DEFAULT 'PENDING',
  bg_check_date               TEXT,
  bg_check_provider           TEXT,
  stage_data                  TEXT,
  updated_at                  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── 4. STAGE FIELD CONFIGURATIONS ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS stage_field_configs (
  id            TEXT PRIMARY KEY,
  pipeline      TEXT NOT NULL,
  stage         TEXT NOT NULL,
  field_key     TEXT NOT NULL,
  field_label   TEXT NOT NULL,
  field_type    TEXT NOT NULL DEFAULT 'text',
  is_required   INTEGER NOT NULL DEFAULT 0,
  is_visible    INTEGER NOT NULL DEFAULT 1,
  options       TEXT,
  placeholder   TEXT,
  help_text     TEXT,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(pipeline, stage, field_key)
);

CREATE INDEX IF NOT EXISTS idx_stage_fields_pipeline_stage
  ON stage_field_configs(pipeline, stage);

-- ── 5. PROGRAM LOCAL SETTINGS ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS program_settings (
  pipeline      TEXT NOT NULL,
  setting_key   TEXT NOT NULL,
  setting_value TEXT,
  updated_by_id TEXT REFERENCES users(id),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (pipeline, setting_key)
);

-- ── 6. REMAP J1 STATUS: CANDIDATES → CONSULTATION_CALL ───────────────────────
-- J1 candidates that were in CANDIDATES stage move to CONSULTATION_CALL
UPDATE candidates
  SET status = 'CONSULTATION_CALL'
  WHERE pipeline = 'J1_PROGRAM' AND status = 'CANDIDATES';

-- ── 7. RENAME OFFER_LETTER_SIGNED → OFFER_LETTER (Sea + Land) ────────────────
UPDATE candidates
  SET status = 'OFFER_LETTER'
  WHERE status = 'OFFER_LETTER_SIGNED';

-- ── VERIFY ────────────────────────────────────────────────────────────────────
-- SELECT pipeline, status, COUNT(*) cnt FROM candidates GROUP BY pipeline, status ORDER BY pipeline, status;
