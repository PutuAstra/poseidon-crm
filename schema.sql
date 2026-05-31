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

-- Sea-Based pipeline fields (v6) — archive metadata + endorsement caching
-- (declared via ALTER TABLE in migration_v6 for live DBs)
-- ALTER TABLE candidates ADD COLUMN archive_reason       TEXT;
-- ALTER TABLE candidates ADD COLUMN archive_sub_stage    TEXT;
-- ALTER TABLE candidates ADD COLUMN archived_at          TEXT;
-- ALTER TABLE candidates ADD COLUMN archived_by_id       TEXT REFERENCES users(id);
-- ALTER TABLE candidates ADD COLUMN endorsed_client_id   TEXT REFERENCES clients(id);
-- ALTER TABLE candidates ADD COLUMN endorsed_client_name TEXT;

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

CREATE INDEX IF NOT EXISTS idx_clients_type ON clients(type, is_active);

CREATE TABLE IF NOT EXISTS client_contacts (
  id         TEXT PRIMARY KEY,
  client_id  TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL UNIQUE REFERENCES users(id),
  title      TEXT,
  is_primary INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS client_endorsements (
  id               TEXT PRIMARY KEY,
  candidate_id     TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  client_id        TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  endorsement_role TEXT NOT NULL CHECK(endorsement_role IN
                    ('CRUISE_LINE','LAND_BASED','SPONSOR_MATCH','HOST_PLACEMENT')),
  status           TEXT NOT NULL CHECK(status IN
                    ('PENDING','SCHEDULED','COMPLETED','REJECTED','APPROVED','WITHDRAWN')),
  endorsed_at      TEXT NOT NULL DEFAULT (datetime('now')),
  scheduled_at     TEXT,
  decided_at       TEXT,
  decision_notes   TEXT,
  interview_url    TEXT,
  endorsed_by_id   TEXT REFERENCES users(id),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_endorsement_active
  ON client_endorsements(candidate_id, client_id, endorsement_role)
  WHERE status IN ('PENDING','SCHEDULED');
CREATE INDEX IF NOT EXISTS idx_endorsements_client    ON client_endorsements(client_id, status);
CREATE INDEX IF NOT EXISTS idx_endorsements_candidate ON client_endorsements(candidate_id, status);
CREATE INDEX IF NOT EXISTS idx_endorsements_role      ON client_endorsements(candidate_id, endorsement_role, status);

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

-- v7b rebuild — id is PK, candidate_id is UNIQUE; legacy stageN_investment +
-- sevis_id/fee_paid columns moved to j1_payments and document_issuance ledgers.
CREATE TABLE IF NOT EXISTS j1_profiles (
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
CREATE INDEX IF NOT EXISTS idx_j1_profiles_status  ON j1_profiles(j1_application_status);
CREATE INDEX IF NOT EXISTS idx_j1_profiles_sponsor ON j1_profiles(sponsor_client_id);
CREATE INDEX IF NOT EXISTS idx_j1_profiles_host    ON j1_profiles(host_company_id);
CREATE INDEX IF NOT EXISTS idx_j1_profiles_window  ON j1_profiles(program_start_date, program_end_date);
CREATE INDEX IF NOT EXISTS idx_j1_profiles_ds2019  ON j1_profiles(ds2019_expiry_date);
CREATE INDEX IF NOT EXISTS idx_j1_profiles_batch   ON j1_profiles(partner_batch_id);

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

-- ── SEA-BASED PIPELINE TABLES (v6) ───────────────────────────────────────────

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
CREATE INDEX IF NOT EXISTS idx_seafarer_candidate ON seafarer_profiles(candidate_id);

CREATE TABLE IF NOT EXISTS seafarer_certificates (
  id            TEXT PRIMARY KEY,
  candidate_id  TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  cert_type     TEXT NOT NULL,
  cert_number   TEXT,
  issued_date   TEXT,
  expiry_date   TEXT,
  issuing_body  TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_seacert_candidate ON seafarer_certificates(candidate_id);

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
CREATE INDEX IF NOT EXISTS idx_offer_candidate ON offer_letters(candidate_id);
CREATE INDEX IF NOT EXISTS idx_offer_session   ON offer_letters(signing_session_id);

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
CREATE INDEX IF NOT EXISTS idx_deploy_candidate ON deployments(candidate_id, sign_on_date DESC);
CREATE INDEX IF NOT EXISTS idx_deploy_status    ON deployments(status, sign_on_date DESC);
CREATE INDEX IF NOT EXISTS idx_deploy_client    ON deployments(client_id, sign_on_date DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_deploy_one_active
  ON deployments(candidate_id) WHERE status = 'ACTIVE';

-- candidate_interviews v6 columns (declared via ALTER in migration_v6 for live DBs)
-- ALTER TABLE candidate_interviews ADD COLUMN type                 TEXT;
-- ALTER TABLE candidate_interviews ADD COLUMN external_provider    TEXT;
-- ALTER TABLE candidate_interviews ADD COLUMN external_session_id  TEXT;
-- ALTER TABLE candidate_interviews ADD COLUMN external_token_hash  TEXT;
-- ALTER TABLE candidate_interviews ADD COLUMN recording_url        TEXT;

-- client_endorsements v6 column
-- ALTER TABLE client_endorsements ADD COLUMN endorsed_by_id TEXT REFERENCES users(id);

-- ── J1 PROGRAM TABLES (v7 Phase 1a — additive only) ──────────────────────────

CREATE TABLE IF NOT EXISTS partner_batches (
  id                    TEXT PRIMARY KEY,
  batch_tag             TEXT NOT NULL,
  partner_name          TEXT NOT NULL,
  pipeline              TEXT NOT NULL DEFAULT 'J1_PROGRAM'
                          CHECK(pipeline IN ('SEA_BASED','LAND_BASED','J1_PROGRAM')),
  onedrive_folder       TEXT,
  master_excel_doc_id   TEXT REFERENCES documents(id),
  imported_by_id        TEXT NOT NULL REFERENCES users(id),
  imported_at           TEXT NOT NULL DEFAULT (datetime('now')),
  row_count             INTEGER NOT NULL DEFAULT 0,
  created_count         INTEGER NOT NULL DEFAULT 0,
  skipped_count         INTEGER NOT NULL DEFAULT 0,
  error_count           INTEGER NOT NULL DEFAULT 0,
  status                TEXT NOT NULL DEFAULT 'PROCESSING'
                          CHECK(status IN ('PROCESSING','COMPLETED','PARTIAL','FAILED','REVERTED')),
  notes                 TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_partner_batch_tag    ON partner_batches(batch_tag);
CREATE INDEX        IF NOT EXISTS idx_partner_batches_partner ON partner_batches(partner_name, imported_at DESC);

CREATE TABLE IF NOT EXISTS j1_enrollments (
  id                TEXT PRIMARY KEY,
  candidate_id      TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  cycle_number      INTEGER NOT NULL DEFAULT 1,
  status            TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','COMPLETED','WITHDRAWN','DENIED')),
  sponsor_client_id TEXT REFERENCES clients(id),
  host_client_id    TEXT REFERENCES clients(id),
  started_at        TEXT NOT NULL DEFAULT (datetime('now')),
  closed_at         TEXT,
  partner_batch_id  TEXT REFERENCES partner_batches(id),
  notes             TEXT
);
CREATE INDEX        IF NOT EXISTS idx_j1_enrollments_cand ON j1_enrollments(candidate_id, cycle_number);
CREATE UNIQUE INDEX IF NOT EXISTS uq_j1_enrollment_active ON j1_enrollments(candidate_id) WHERE status='ACTIVE';

CREATE TABLE IF NOT EXISTS import_rows (
  id                  TEXT PRIMARY KEY,
  batch_id            TEXT NOT NULL REFERENCES partner_batches(id) ON DELETE CASCADE,
  row_index           INTEGER NOT NULL,
  external_row_key    TEXT NOT NULL,
  email_lower         TEXT,
  candidate_id        TEXT REFERENCES candidates(id),
  status              TEXT NOT NULL CHECK(status IN ('CREATED','SKIPPED_DUPLICATE','ERROR')),
  duplicate_of_id     TEXT REFERENCES candidates(id),
  error               TEXT,
  raw_row             TEXT,
  created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_import_row_key   ON import_rows(batch_id, external_row_key);
CREATE INDEX        IF NOT EXISTS idx_import_rows_status ON import_rows(batch_id, status);

CREATE TABLE IF NOT EXISTS j1_payments (
  id              TEXT PRIMARY KEY,
  candidate_id    TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  enrollment_id   TEXT REFERENCES j1_enrollments(id),
  stage           TEXT NOT NULL CHECK(stage IN
                    ('STAGE_1','STAGE_2','STAGE_3','STAGE_4',
                     'SEVIS_FEE','EMBASSY_FEE','REFUND','OTHER')),
  amount          REAL NOT NULL CHECK(
                    (stage='REFUND' AND amount < 0) OR
                    (stage!='REFUND' AND amount > 0)
                  ),
  currency        TEXT NOT NULL DEFAULT 'USD',
  paid_at         TEXT NOT NULL,
  method          TEXT CHECK(method IN ('BANK_TRANSFER','CARD','CASH','WISE','EXTERNAL','OTHER')),
  is_cti_revenue  INTEGER NOT NULL DEFAULT 1,
  reference       TEXT,
  receipt_doc_id  TEXT REFERENCES documents(id),
  recorded_by_id  TEXT NOT NULL REFERENCES users(id),
  notes           TEXT,
  voided_at       TEXT,
  voided_by_id    TEXT REFERENCES users(id),
  void_reason     TEXT,
  refund_of_id    TEXT REFERENCES j1_payments(id),
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_j1_pay_candidate ON j1_payments(candidate_id, paid_at DESC);
CREATE INDEX IF NOT EXISTS idx_j1_pay_stage     ON j1_payments(stage, paid_at);
CREATE INDEX IF NOT EXISTS idx_j1_pay_active    ON j1_payments(candidate_id, stage) WHERE voided_at IS NULL;

CREATE TABLE IF NOT EXISTS document_issuance (
  id              TEXT PRIMARY KEY,
  candidate_id    TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  enrollment_id   TEXT REFERENCES j1_enrollments(id),
  doc_type        TEXT NOT NULL CHECK(doc_type IN
                    ('DS_7002','DS_2019','SEVIS_RECEIPT','J1_VISA_STAMP',
                     'OFFER_LETTER_J1','MEDICAL_EXAM','TRAINING_PLAN')),
  status          TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN
                    ('PENDING','REQUESTED','ISSUED','RECEIVED','VERIFIED','REJECTED')),
  issuing_party   TEXT CHECK(issuing_party IN ('HOST','SPONSOR','EMBASSY','SEVIS','PARTICIPANT','CTI')),
  document_id     TEXT REFERENCES documents(id),
  requested_at    TEXT,
  issued_at       TEXT,
  received_at     TEXT,
  verified_at     TEXT,
  verified_by_id  TEXT REFERENCES users(id),
  notes           TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX        IF NOT EXISTS idx_doc_issuance_candidate ON document_issuance(candidate_id, doc_type);
CREATE INDEX        IF NOT EXISTS idx_doc_issuance_status    ON document_issuance(status, doc_type);
CREATE UNIQUE INDEX IF NOT EXISTS uq_doc_issuance_active
  ON document_issuance(candidate_id, enrollment_id, doc_type) WHERE status NOT IN ('REJECTED');

CREATE TABLE IF NOT EXISTS j1_placements (
  id                TEXT PRIMARY KEY,
  candidate_id      TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  enrollment_id     TEXT NOT NULL REFERENCES j1_enrollments(id),
  host_client_id    TEXT NOT NULL REFERENCES clients(id),
  sponsor_client_id TEXT REFERENCES clients(id),
  ds2019_number     TEXT,
  program_start     TEXT NOT NULL,
  program_end       TEXT NOT NULL,
  arrival_date      TEXT,
  departure_date    TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_j1_placements_cand ON j1_placements(candidate_id, program_start DESC);
CREATE INDEX IF NOT EXISTS idx_j1_placements_host ON j1_placements(host_client_id);

CREATE TABLE IF NOT EXISTS j1_eligibility_decisions (
  id                 TEXT PRIMARY KEY,
  candidate_id       TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  enrollment_id      TEXT REFERENCES j1_enrollments(id),
  verdict            TEXT NOT NULL CHECK(verdict IN ('PASS','FAIL')),
  age_ok             INTEGER,
  education_ok       INTEGER,
  work_experience_ok INTEGER,
  reason             TEXT,
  decided_by_id      TEXT NOT NULL REFERENCES users(id),
  decided_at         TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_elig_cand ON j1_eligibility_decisions(candidate_id, decided_at DESC);

CREATE TABLE IF NOT EXISTS j1_sponsor_submissions (
  id                  TEXT PRIMARY KEY,
  candidate_id        TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  enrollment_id       TEXT REFERENCES j1_enrollments(id),
  sponsor_client_id   TEXT NOT NULL REFERENCES clients(id),
  external_reference  TEXT,
  status              TEXT NOT NULL DEFAULT 'SUBMITTED'
                        CHECK(status IN ('SUBMITTED','UNDER_REVIEW','APPROVED','REJECTED')),
  submitted_at        TEXT NOT NULL DEFAULT (datetime('now')),
  decided_at          TEXT,
  decided_by_id       TEXT REFERENCES users(id),
  notes               TEXT
);
CREATE INDEX IF NOT EXISTS idx_sponsor_sub_cand ON j1_sponsor_submissions(candidate_id, submitted_at DESC);

CREATE TABLE IF NOT EXISTS whatsapp_groups (
  id                TEXT PRIMARY KEY,
  host_client_id    TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  partner_batch_id  TEXT REFERENCES partner_batches(id),
  name              TEXT NOT NULL,
  invite_url        TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','ARCHIVED')),
  created_by_id     TEXT NOT NULL REFERENCES users(id),
  notes             TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  archived_at       TEXT
);
CREATE INDEX IF NOT EXISTS idx_wa_groups_host  ON whatsapp_groups(host_client_id, status);
CREATE INDEX IF NOT EXISTS idx_wa_groups_batch ON whatsapp_groups(partner_batch_id);

CREATE TABLE IF NOT EXISTS whatsapp_group_members (
  id              TEXT PRIMARY KEY,
  group_id        TEXT NOT NULL REFERENCES whatsapp_groups(id) ON DELETE CASCADE,
  candidate_id    TEXT REFERENCES candidates(id) ON DELETE CASCADE,
  member_role     TEXT NOT NULL CHECK(member_role IN ('PARTICIPANT','CTI_TEAM','PARTNER_REP','HOST_CONTACT')),
  display_name    TEXT NOT NULL,
  phone_last4     TEXT,
  phone_encrypted TEXT,
  added_at        TEXT NOT NULL DEFAULT (datetime('now')),
  removed_at      TEXT,
  notes           TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_wa_member_active
  ON whatsapp_group_members(group_id, candidate_id, member_role) WHERE removed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_wa_member_candidate ON whatsapp_group_members(candidate_id);

CREATE TABLE IF NOT EXISTS notifications (
  id              TEXT PRIMARY KEY,
  kind            TEXT NOT NULL CHECK(kind IN
                    ('DS2019_EXPIRY_30','DS2019_EXPIRY_7','VISA_INTERVIEW_DUE',
                     'STAGE_PAYMENT_OVERDUE','ELIGIBILITY_REVIEW_SLA','DOC_VERIFICATION_PENDING',
                     'ADMIN_REVIEW_REQUIRED')),
  candidate_id    TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  due_at          TEXT NOT NULL,
  fired_at        TEXT,
  acked_at        TEXT,
  acked_by_id     TEXT REFERENCES users(id),
  payload         TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_notif_due  ON notifications(due_at, fired_at);
CREATE INDEX IF NOT EXISTS idx_notif_cand ON notifications(candidate_id, kind);

-- candidates v7 columns (declared via ALTER in migration_v7_j1 for live DBs)
-- ALTER TABLE candidates ADD COLUMN partner_batch_id        TEXT REFERENCES partner_batches(id);
-- ALTER TABLE candidates ADD COLUMN current_enrollment_id   TEXT REFERENCES j1_enrollments(id);
-- ALTER TABLE candidates ADD COLUMN version                 INTEGER NOT NULL DEFAULT 1;
