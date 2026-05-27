-- ─────────────────────────────────────────────────────────────────────────────
-- POSEIDON CRM — Cloudflare D1 Schema (SQLite)
-- Run via: Cloudflare Dashboard → D1 → poseidon-db → Console → paste & execute
-- ─────────────────────────────────────────────────────────────────────────────

PRAGMA journal_mode = WAL;

-- ── USERS ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS users (
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

-- ── CANDIDATES ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS candidates (
  id                       TEXT PRIMARY KEY,
  user_id                  TEXT UNIQUE REFERENCES users(id),
  first_name               TEXT NOT NULL,
  last_name                TEXT NOT NULL,
  middle_name              TEXT,
  email                    TEXT NOT NULL UNIQUE COLLATE NOCASE,
  phone                    TEXT,
  date_of_birth            TEXT,
  nationality              TEXT,
  address                  TEXT,  -- JSON: { street, city, province, country, postalCode }
  pipeline                 TEXT NOT NULL CHECK(pipeline IN ('SEA_BASED','LAND_BASED','J1_PROGRAM')),
  status                   TEXT NOT NULL DEFAULT 'NEW_SUBMISSION',
  assigned_recruiter_id    TEXT REFERENCES users(id),
  submission_id            TEXT UNIQUE,
  profile_photo_url        TEXT,
  resume_onedrive_file_id  TEXT,
  resume_onedrive_url      TEXT,
  resume_file_name         TEXT,
  internal_notes           TEXT,
  tags                     TEXT,  -- JSON array
  portal_activated_at      TEXT,
  created_at               TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at               TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_candidates_status    ON candidates(status);
CREATE INDEX IF NOT EXISTS idx_candidates_pipeline  ON candidates(pipeline);
CREATE INDEX IF NOT EXISTS idx_candidates_recruiter ON candidates(assigned_recruiter_id);
CREATE INDEX IF NOT EXISTS idx_candidates_email     ON candidates(email);

-- Analytics composite indexes (v5) — per-workspace dashboards + master roll-up
CREATE INDEX IF NOT EXISTS idx_candidates_pipeline_status    ON candidates(pipeline, status);
CREATE INDEX IF NOT EXISTS idx_candidates_pipeline_recruiter ON candidates(pipeline, assigned_recruiter_id);
CREATE INDEX IF NOT EXISTS idx_candidates_pipeline_created   ON candidates(pipeline, created_at);

-- ── SUBMISSION FORMS ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS submission_forms (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  pipeline    TEXT CHECK(pipeline IN ('SEA_BASED','LAND_BASED','J1_PROGRAM')),
  is_active   INTEGER NOT NULL DEFAULT 0,
  is_default  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS form_fields (
  id              TEXT PRIMARY KEY,
  form_id         TEXT NOT NULL REFERENCES submission_forms(id) ON DELETE CASCADE,
  label           TEXT NOT NULL,
  field_key       TEXT NOT NULL,
  field_type      TEXT NOT NULL,  -- text|email|phone|date|select|multiselect|file|textarea|checkbox|number
  placeholder     TEXT,
  help_text       TEXT,
  is_required     INTEGER NOT NULL DEFAULT 0,
  options         TEXT,           -- JSON: [{ label, value }]
  file_types      TEXT,           -- JSON: ["pdf","jpg"]
  max_file_size_mb INTEGER,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  is_active       INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(form_id, field_key)
);

CREATE INDEX IF NOT EXISTS idx_form_fields_form ON form_fields(form_id, sort_order);

-- ── SUBMISSIONS ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS submissions (
  id                         TEXT PRIMARY KEY,
  form_id                    TEXT NOT NULL REFERENCES submission_forms(id),
  pipeline                   TEXT NOT NULL CHECK(pipeline IN ('SEA_BASED','LAND_BASED','J1_PROGRAM')),
  data                       TEXT NOT NULL,  -- JSON of submitted field values
  ip_address                 TEXT,
  user_agent                 TEXT,
  is_duplicate               INTEGER NOT NULL DEFAULT 0,
  duplicate_of_candidate_id  TEXT REFERENCES candidates(id),
  reviewed_by_id             TEXT REFERENCES users(id),
  reviewed_at                TEXT,
  review_notes               TEXT,
  created_at                 TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_submissions_pipeline ON submissions(pipeline);
CREATE INDEX IF NOT EXISTS idx_submissions_created  ON submissions(created_at);
CREATE INDEX IF NOT EXISTS idx_submissions_reviewed ON submissions(reviewed_at);

-- ── INTERVIEWS ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS interviews (
  id              TEXT PRIMARY KEY,
  type            TEXT NOT NULL CHECK(type IN ('ONE_WAY','TWO_WAY','BOOKING','CLIENT_FINAL')),
  title           TEXT NOT NULL,
  description     TEXT,
  created_by_id   TEXT NOT NULL REFERENCES users(id),
  questions       TEXT,        -- JSON: [{ id, text, timeLimitSecs, type: "video"|"text" }]
  booking_config  TEXT,        -- JSON: { durationMinutes, bufferMinutes, timezone, advanceNoticeHours, ... }
  is_active       INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS candidate_interviews (
  id              TEXT PRIMARY KEY,
  candidate_id    TEXT NOT NULL REFERENCES candidates(id),
  interview_id    TEXT NOT NULL REFERENCES interviews(id),
  status          TEXT NOT NULL DEFAULT 'INVITED',
  invited_at      TEXT NOT NULL DEFAULT (datetime('now')),
  scheduled_at    TEXT,
  completed_at    TEXT,
  expires_at      TEXT,
  meeting_url     TEXT,
  booking_slot_id TEXT,
  responses       TEXT,        -- JSON: [{ questionId, responseText, videoUrl }]
  score           INTEGER,
  passed          INTEGER,     -- 0|1
  recruiter_notes TEXT,
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ci_candidate ON candidate_interviews(candidate_id);
CREATE INDEX IF NOT EXISTS idx_ci_interview ON candidate_interviews(interview_id);
CREATE INDEX IF NOT EXISTS idx_ci_status    ON candidate_interviews(status);

CREATE TABLE IF NOT EXISTS booking_slots (
  id           TEXT PRIMARY KEY,
  interview_id TEXT NOT NULL REFERENCES interviews(id) ON DELETE CASCADE,
  start_time   TEXT NOT NULL,
  end_time     TEXT NOT NULL,
  is_booked    INTEGER NOT NULL DEFAULT 0,
  is_blocked   INTEGER NOT NULL DEFAULT 0,
  block_reason TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_slots_interview    ON booking_slots(interview_id, start_time);
CREATE INDEX IF NOT EXISTS idx_slots_availability ON booking_slots(is_booked, is_blocked, start_time);

-- ── CLIENTS & ENDORSEMENTS ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS clients (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  type          TEXT NOT NULL CHECK(type IN ('CRUISE_LINE','LAND_BASED','J1_SPONSOR')),
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

CREATE INDEX IF NOT EXISTS idx_clients_type ON clients(type, is_active);

CREATE TABLE IF NOT EXISTS client_contacts (
  id         TEXT PRIMARY KEY,
  client_id  TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL UNIQUE REFERENCES users(id),
  title      TEXT,
  is_primary INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS client_endorsements (
  id             TEXT PRIMARY KEY,
  candidate_id   TEXT NOT NULL REFERENCES candidates(id),
  client_id      TEXT NOT NULL REFERENCES clients(id),
  status         TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','SCHEDULED','COMPLETED','REJECTED','APPROVED','WITHDRAWN')),
  endorsed_at    TEXT NOT NULL DEFAULT (datetime('now')),
  scheduled_at   TEXT,
  decided_at     TEXT,
  decision_notes TEXT,
  interview_url  TEXT,
  updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(candidate_id, client_id)
);

CREATE INDEX IF NOT EXISTS idx_endorsements_client    ON client_endorsements(client_id, status);
CREATE INDEX IF NOT EXISTS idx_endorsements_candidate ON client_endorsements(candidate_id, status);

-- ── DOCUMENTS ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS documents (
  id                TEXT PRIMARY KEY,
  candidate_id      TEXT NOT NULL REFERENCES candidates(id),
  type              TEXT NOT NULL,
  label             TEXT NOT NULL,
  document_number   TEXT,
  issuance_date     TEXT,
  expiration_date   TEXT,
  onedrive_file_id  TEXT UNIQUE,
  onedrive_url      TEXT,
  onedrive_path     TEXT,
  file_name         TEXT,
  file_size_bytes   INTEGER,
  mime_type         TEXT,
  uploaded_by       TEXT NOT NULL DEFAULT 'ADMIN',
  is_verified       INTEGER NOT NULL DEFAULT 0,
  verified_at       TEXT,
  verified_by_id    TEXT REFERENCES users(id),
  notes             TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_documents_candidate ON documents(candidate_id, type);
CREATE INDEX IF NOT EXISTS idx_documents_expiry    ON documents(expiration_date);
CREATE INDEX IF NOT EXISTS idx_documents_type_expiry ON documents(type, expiration_date);  -- v5: compliance by type+expiry

-- ── PIPELINE AUDIT LOG ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS pipeline_stage_history (
  id              TEXT PRIMARY KEY,
  candidate_id    TEXT NOT NULL REFERENCES candidates(id),
  from_status     TEXT,
  to_status       TEXT NOT NULL,
  triggered_by_id TEXT REFERENCES users(id),
  reason          TEXT,
  metadata        TEXT,  -- JSON
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_history_candidate ON pipeline_stage_history(candidate_id, created_at);

-- ── J1 TRAINING PLANS ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS j1_training_plans (
  id                   TEXT PRIMARY KEY,
  candidate_id         TEXT NOT NULL UNIQUE REFERENCES candidates(id),
  ds2019_number        TEXT,
  sevis_id             TEXT,
  program_start        TEXT,
  program_end          TEXT,
  host_organization    TEXT,
  host_address         TEXT,  -- JSON
  supervisor_name      TEXT,
  supervisor_email     TEXT,
  supervisor_phone     TEXT,
  occupational_category TEXT,
  training_phases      TEXT,  -- JSON
  dos_submitted_at     TEXT,
  dos_approved_at      TEXT,
  dos_notes            TEXT,
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── NOTIFICATIONS ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS notifications (
  id           TEXT PRIMARY KEY,
  user_id      TEXT REFERENCES users(id),
  candidate_id TEXT REFERENCES candidates(id),
  channel      TEXT NOT NULL CHECK(channel IN ('EMAIL','IN_APP')),
  type         TEXT NOT NULL,
  subject      TEXT,
  body         TEXT NOT NULL,
  is_read      INTEGER NOT NULL DEFAULT 0,
  sent_at      TEXT,
  failed_at    TEXT,
  fail_reason  TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_notifications_user      ON notifications(user_id, is_read);
CREATE INDEX IF NOT EXISTS idx_notifications_candidate ON notifications(candidate_id);

-- ── J1 PROGRAM EXTENSION TABLE ───────────────────────────────────────────────

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

-- ── SEA-BASED EXTENSION TABLE ─────────────────────────────────────────────────

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

-- ── LAND-BASED EXTENSION TABLE ────────────────────────────────────────────────

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

-- ── STAGE FIELD CONFIGURATIONS ────────────────────────────────────────────────

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

-- ── PROGRAM LOCAL SETTINGS ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS program_settings (
  pipeline      TEXT NOT NULL,
  setting_key   TEXT NOT NULL,
  setting_value TEXT,
  updated_by_id TEXT REFERENCES users(id),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (pipeline, setting_key)
);
