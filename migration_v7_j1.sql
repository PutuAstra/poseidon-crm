-- ─────────────────────────────────────────────────────────────────────────────
-- POSEIDON CRM — Migration v7 (J1 Program, Phase 1a)
--
-- ADDITIVE-only foundation for the J1 Program workspace per docs/j1-program-
-- design.md. New tables, ALTER ADD COLUMNs, and program_settings defaults.
-- NO destructive table rebuilds in this file — those land in
-- migration_v7b_j1_destructive.sql after you snapshot prod and approve diff.
--
-- Run via: Cloudflare Dashboard → D1 → poseidon-db → Console (one block at a time).
-- SAFE TO RE-RUN. Blocks may report `duplicate column name: …` if a prior run
-- already applied a column — expected, skip and continue.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Block 1: partner_batches (bulk-import job header) ─────────────────────────
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
CREATE UNIQUE INDEX IF NOT EXISTS uq_partner_batch_tag ON partner_batches(batch_tag);
CREATE INDEX IF NOT EXISTS idx_partner_batches_partner ON partner_batches(partner_name, imported_at DESC);

-- ── Block 2: j1_enrollments (one row per program cycle — fixes re-deployment) ─
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
CREATE INDEX IF NOT EXISTS idx_j1_enrollments_cand ON j1_enrollments(candidate_id, cycle_number);
CREATE UNIQUE INDEX IF NOT EXISTS uq_j1_enrollment_active
  ON j1_enrollments(candidate_id) WHERE status='ACTIVE';

-- ── Block 3: import_rows (per-row outcome from a bulk import) ────────────────
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
CREATE UNIQUE INDEX IF NOT EXISTS uq_import_row_key ON import_rows(batch_id, external_row_key);
CREATE INDEX IF NOT EXISTS idx_import_rows_status  ON import_rows(batch_id, status);

-- ── Block 4: j1_payments (append-only ledger; SEVIS/embassy as EXTERNAL) ─────
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

-- ── Block 5: document_issuance (DS-7002 / DS-2019 / SEVIS / visa stamp) ──────
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
CREATE INDEX IF NOT EXISTS idx_doc_issuance_candidate ON document_issuance(candidate_id, doc_type);
CREATE INDEX IF NOT EXISTS idx_doc_issuance_status    ON document_issuance(status, doc_type);
CREATE UNIQUE INDEX IF NOT EXISTS uq_doc_issuance_active
  ON document_issuance(candidate_id, enrollment_id, doc_type) WHERE status NOT IN ('REJECTED');

-- ── Block 6: j1_placements (final deployed-state ledger) ─────────────────────
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

-- ── Block 7: j1_eligibility_decisions (per-enrollment audit) ─────────────────
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

-- ── Block 8: j1_sponsor_submissions ──────────────────────────────────────────
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

-- ── Block 9: whatsapp_groups + whatsapp_group_members ────────────────────────
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

-- ── Block 10: program_alerts (DS-2019 / visa / payment / SLA triggers) ──────
-- NOTE: the existing `notifications` table is for outbound email/in-app messages.
-- This table is for scheduled-trigger alerts (SLA, expiry, overdue payment).
-- Different concept, different name.
CREATE TABLE IF NOT EXISTS program_alerts (
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
CREATE INDEX IF NOT EXISTS idx_program_alerts_due  ON program_alerts(due_at, fired_at);
CREATE INDEX IF NOT EXISTS idx_program_alerts_cand ON program_alerts(candidate_id, kind);

-- ── Block 11: candidates ADD COLUMN (skip if 'duplicate column name' fires) ──
ALTER TABLE candidates ADD COLUMN partner_batch_id TEXT REFERENCES partner_batches(id);

-- ── Block 12 ────────────────────────────────────────────────────────────────
ALTER TABLE candidates ADD COLUMN current_enrollment_id TEXT REFERENCES j1_enrollments(id);

-- ── Block 13 ────────────────────────────────────────────────────────────────
ALTER TABLE candidates ADD COLUMN version INTEGER NOT NULL DEFAULT 1;

-- ── Block 14: candidates index for partner_batch lookup ─────────────────────
CREATE INDEX IF NOT EXISTS idx_candidates_partner_batch ON candidates(partner_batch_id);

-- ── Block 15: program_settings defaults for J1 ─────────────────────────────
INSERT OR IGNORE INTO program_settings (pipeline, setting_key, setting_value) VALUES
  ('J1_PROGRAM', 'stage1_amount', '150'),
  ('J1_PROGRAM', 'stage2_amount', '350'),
  ('J1_PROGRAM', 'stage3_amount', '500'),
  ('J1_PROGRAM', 'stage4_amount', '500'),
  ('J1_PROGRAM', 'eligibility_review_sla_days', '5'),
  ('J1_PROGRAM', 'flag_phase_1', '1'),
  ('J1_PROGRAM', 'flag_phase_2', '0'),
  ('J1_PROGRAM', 'flag_phase_3', '0'),
  ('J1_PROGRAM', 'flag_phase_4', '0');

-- ── Block 16: BACKFILL — every existing J1 candidate gets enrollment cycle 1 ─
INSERT OR IGNORE INTO j1_enrollments (id, candidate_id, cycle_number, status, started_at)
SELECT lower(hex(randomblob(12))), id, 1, 'ACTIVE', COALESCE(updated_at, datetime('now'))
  FROM candidates
 WHERE pipeline = 'J1_PROGRAM';

-- ── Block 17: link candidates.current_enrollment_id to that ACTIVE row ──────
UPDATE candidates
   SET current_enrollment_id = (
     SELECT e.id FROM j1_enrollments e
      WHERE e.candidate_id = candidates.id AND e.status = 'ACTIVE'
      LIMIT 1
   )
 WHERE pipeline = 'J1_PROGRAM' AND current_enrollment_id IS NULL;
