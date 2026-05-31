# J1-Program Pipeline â€” Architecture Design

## Executive summary

- **J1 ships as a peer to Sea-Based**, reusing the proven patterns: per-transition `env.DB.batch([...])` atomicity, OneDrive direct-PUT for all files, KV-cached Graph tokens, multi-party endorsements via partial unique indexes, and `pipeline_stage_history` written on every status change.
- **State machine adds 7 J1-only statuses** (`ELIGIBILITY_REVIEW`, `CONSULTATION_CALL`, `J1_STAGE_1..4`, `J1_VISA`) with **compare-and-swap (CAS) enforcement** on every transition: `UPDATE candidates SET status=? WHERE id=? AND status=?` must return `rowsAffected=1` or the request returns 409. This is the fix for the concurrency holes reviewers caught.
- **Payments are an append-only ledger** (`j1_payments`). Stage entry guards use `SUM(amount) WHERE voided_at IS NULL >= threshold` (split-payment-aware). Sequencing is enforced transitively: each stage's guard checks all prior stages are funded. SEVIS and embassy fees are explicit non-CTI ledger entries with `method='EXTERNAL'`, never booleans.
- **Schema drift in `j1_profiles` is reconciled via full table rebuild** (recreate-and-copy), not ALTER ADD COLUMN, because SQLite cannot ALTER a PRIMARY KEY and the worker currently writes a non-existent `id`. The same rebuild pattern is also applied to `clients.type` and `client_endorsements` UNIQUE.
- **Schema additions:** `j1_payments`, `document_issuance`, `partner_batches`, `import_rows`, `j1_eligibility_decisions`, `j1_sponsor_submissions`, `j1_placements`, `whatsapp_groups`, `whatsapp_group_members`, `j1_enrollments` (the new entity that fixes re-deployment), plus `notifications` for DS-2019/visa expiry alerts.
- **DS-7002 / DS-2019 / SEVIS workflow is explicitly manual upload** by Onboarding (sponsors and hosts are third parties with no POSEIDON login). Stage 3 payment is the gate before any issuance row is created.
- **Phased delivery mirrors the Sea-Based rollout:** Phase 1 schema + migrations, Phase 2 state machine + payments, Phase 3 documents + visa, Phase 4 imports + WhatsApp + alerts. Each phase ships behind a feature flag and is independently approvable.

---

## State machine blueprint

### States

`NEW_SUBMISSION` (KEEP), `ELIGIBILITY_REVIEW` (ADD), `CONSULTATION_CALL` (CHANGE: writable), `J1_STAGE_1` (CHANGE: writable), `J1_STAGE_2` (CHANGE), `FINAL_INTERVIEW` (KEEP), `J1_STAGE_3` (CHANGE), `J1_VISA` (CHANGE), `J1_STAGE_4` (CHANGE), `DEPLOYED` (KEEP), `ARCHIVED` (KEEP).

`OFFER_LETTER` and `ONBOARDING` are intentionally NOT used in J1. Offer-letter signing is an event captured on `FINAL_INTERVIEW`; onboarding lives inside `J1_STAGE_4`.

### CAS pattern (non-negotiable, applied to every row below)

```js
const upd = await env.DB.prepare(
  `UPDATE candidates SET status=?, updated_at=datetime('now')
   WHERE id=? AND status=? AND pipeline='J1_PROGRAM'`
).bind(toStatus, candidateId, expectedFromStatus).run();
if (upd.meta.changes !== 1) return err(409, 'GATE_VIOLATION: status changed since read');
```

The `UPDATE...WHERE status=?` IS the lock. No separate read-then-write. The status update and the `pipeline_stage_history` insert are bundled in the same `env.DB.batch([...])`.

### Transition table

| # | From | To | Endpoint | Guard (all must pass before CAS) | Role | Side effects | Mode |
|---|---|---|---|---|---|---|---|
| 1 | `NEW_SUBMISSION` | `ELIGIBILITY_REVIEW` | `POST /api/v1/candidates/:id/j1/move-forward` (ADD; J1-specific, not the Sea/Land `move-forward`) | pipeline=J1_PROGRAM | RECRUITER+ | history | Manual |
| 2 | `ELIGIBILITY_REVIEW` | `CONSULTATION_CALL` | `POST /j1/eligibility` (verdict=PASS) | latest `j1_eligibility_decisions.verdict='PASS'` | RECRUITER+ | INSERT decision; history | Manual |
| 3 | `ELIGIBILITY_REVIEW` | `ARCHIVED` | `POST /j1/eligibility` (verdict=FAIL) | reason required | RECRUITER+ | archive_reason='ELIGIBILITY_FAIL'; history | Manual |
| 4 | `CONSULTATION_CALL` | `J1_STAGE_1` | `POST /j1/consultation` (outcome=APPROVED) | SUM(STAGE_1 active payments) >= setting `stage1_amount` | RECRUITER+ | UPDATE `j1_profiles.consultation_*`; history | Manual (record payment FIRST via `/j1/payments`, then call this) |
| 5 | `CONSULTATION_CALL` | `ARCHIVED` | `POST /j1/consultation` (outcome=REJECTED) | reason required | RECRUITER+ | archive_reason='CONSULTATION_REJECT'; history | Manual |
| 6 | `J1_STAGE_1` | `J1_STAGE_2` | `POST /j1/sponsor-submit` | Stage 1 paid AND Stage 2 paid AND sponsor_client_id set AND clients.type='J1_SPONSOR' | ONBOARDING_TEAM+ | INSERT `j1_sponsor_submissions`; history | Manual |
| 7 | `J1_STAGE_2` | `FINAL_INTERVIEW` | `POST /j1/host-final-interview` (action=SCHEDULE) | Stage 1+2 paid AND â‰¥1 ACTIVE `client_endorsements` row with `endorsement_role='HOST_PLACEMENT'` and `status='SCHEDULED'` | RECRUITER+ | UPDATE endorsement.scheduled_at; history | Manual |
| 8 | `FINAL_INTERVIEW` | `J1_STAGE_3` | `POST /j1/offer-signed` | endorsement.status='APPROVED' for that host AND offer_letter doc VERIFIED AND Stage 1+2+3 paid | RECRUITER+ | INSERT 3 `document_issuance` placeholders (DS_7002, DS_2019, SEVIS_RECEIPT); history | Manual |
| 9 | `FINAL_INTERVIEW` | `ARCHIVED` | `POST /transitions/client-rejected` (KEEP, extend J1) | all active HOST_PLACEMENT endorsements REJECTED | RECRUITER+ | history | Manual |
| 10 | `J1_STAGE_3` | `J1_VISA` | `POST /j1/documents/:type` (CONFIRM_UPLOAD) â€” auto-fires when all three docs reach VERIFIED | DS_7002, DS_2019, SEVIS_RECEIPT all `document_issuance.status='VERIFIED'` | ONBOARDING_TEAM+ | history | Auto (CAS-guarded; double-fire returns 409 idempotently) |
| 11 | `J1_VISA` | `J1_STAGE_4` | `POST /j1/visa-result` (result=APPROVED) | visa stamp doc VERIFIED AND Stage 1+2+3+4 paid | ONBOARDING_TEAM+ | UPDATE `j1_profiles.visa_*`; history | Manual |
| 12 | `J1_VISA` | `J1_VISA` (retry) | `POST /j1/visa-result` (result=DENIED, retry=true) | reason required; retry flag set | ONBOARDING_TEAM+ | INSERT denial record; no status change | Manual (see Open Q1) |
| 13 | `J1_VISA` | `ARCHIVED` | `POST /j1/visa-result` (result=DENIED, retry=false) | reason required | ONBOARDING_TEAM+ | archive_reason='VISA_DENIED'; history | Manual |
| 14 | `J1_STAGE_4` | `DEPLOYED` | `POST /j1/depart` | flight + housing fields populated AND departure_briefing_done=1 | ONBOARDING_TEAM+ | INSERT `j1_placements`; close current `j1_enrollments` row as ACTIVEâ†’COMPLETED on program_end; history | Manual |
| 15 | any | `ARCHIVED` | `POST /transitions/archive` (KEEP) | reason required | ADMIN+ | history | Manual |
| 16 | `ARCHIVED` | any J1 status | `POST /transitions/restore` (CHANGE: extend allowlist) | restore target âˆˆ {NEW_SUBMISSION, ELIGIBILITY_REVIEW, CONSULTATION_CALL, J1_STAGE_1..4, FINAL_INTERVIEW, J1_VISA} | SUPER_ADMIN | history | Manual |
| 17 | n/a | n/a | `POST /j1/payments` | amount>0, valid stage, paidAt parseable | ONBOARDING_TEAM+ | INSERT `j1_payments`; **no** status change | Manual |
| 18 | n/a | n/a | `POST /j1/payments/:id/void` | reason required; CAS-checked sum-after-void vs current-stage threshold | ADMIN+ | UPDATE `voided_at`; or 409 if gate violated and no `?force=1` | Manual |
| 19 | n/a | n/a | `POST /j1/payments/refund` | original payment exists | ADMIN+ | INSERT negative-amount counter-entry (CHECK adjusted, see schema) | Manual |
| 20 | `DEPLOYED` | new `J1_STAGE_1` cycle | `POST /j1/re-enroll` | prior `j1_enrollments.status='COMPLETED'`; ADMIN+ | ADMIN+ | INSERT new `j1_enrollments`; CAS reset `candidates.status='J1_STAGE_1'`; history | Manual |

**Payment gates are transitive.** Each stage guard explicitly checks all earlier stages, e.g.:

```sql
WITH s AS (
  SELECT stage, SUM(amount) AS total FROM j1_payments
  WHERE candidate_id=? AND voided_at IS NULL GROUP BY stage
)
SELECT
  (SELECT COALESCE(total,0) FROM s WHERE stage='STAGE_1') AS s1,
  (SELECT COALESCE(total,0) FROM s WHERE stage='STAGE_2') AS s2,
  (SELECT COALESCE(total,0) FROM s WHERE stage='STAGE_3') AS s3,
  (SELECT COALESCE(total,0) FROM s WHERE stage='STAGE_4') AS s4
```

â€¦compared in the worker against `program_settings` thresholds (correct column names below).

---

## Schema additions

### Reconcile `j1_profiles` â€” full table rebuild (CHANGE)

ALTER TABLE cannot add a PRIMARY KEY or change one in SQLite. Rebuild-and-copy:

```sql
-- migration_v7_j1.sql
BEGIN TRANSACTION;

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

INSERT INTO j1_profiles_new
  (id, candidate_id, sponsor_name, exchange_visitor_category,
   program_start_date, program_end_date, ds2019_number, ds2019_expiry_date,
   created_at)
SELECT
  lower(hex(randomblob(12))), candidate_id, sponsor_name, exchange_visitor_category,
  program_start_date, program_end_date, ds2019_number, ds2019_expiry_date,
  COALESCE(created_at, datetime('now'))
FROM j1_profiles;

DROP TABLE j1_profiles;
ALTER TABLE j1_profiles_new RENAME TO j1_profiles;

CREATE INDEX idx_j1_profiles_status   ON j1_profiles(j1_application_status);
CREATE INDEX idx_j1_profiles_sponsor  ON j1_profiles(sponsor_client_id);
CREATE INDEX idx_j1_profiles_host     ON j1_profiles(host_company_id);
CREATE INDEX idx_j1_profiles_window   ON j1_profiles(program_start_date, program_end_date);
CREATE INDEX idx_j1_profiles_ds2019   ON j1_profiles(ds2019_expiry_date);
CREATE INDEX idx_j1_profiles_batch    ON j1_profiles(partner_batch_id);

COMMIT;
```

The four legacy `stageN_investment` columns are **dropped**. Any caller reading them migrates to `GET /api/v1/candidates/:id/j1/payments/rollup` (see API section).

### `clients.type` rebuild (CHANGE)

Same recreate-and-copy pattern as v6. New CHECK:

```sql
type CHECK(type IN ('CRUISE_LINE','LAND_BASED','J1_SPONSOR','J1_HOST_COMPANY'))
```

### `client_endorsements` rebuild (CHANGE)

Table-level UNIQUE cannot be dropped. Rebuild:

```sql
CREATE TABLE client_endorsements_new (
  id                  TEXT PRIMARY KEY,
  candidate_id        TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  client_id           TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  endorsement_role    TEXT NOT NULL CHECK(endorsement_role IN
                        ('CRUISE_LINE','LAND_BASED','SPONSOR_MATCH','HOST_PLACEMENT')),
  status              TEXT NOT NULL CHECK(status IN ('PENDING','SCHEDULED','APPROVED','REJECTED')),
  scheduled_at        TEXT,
  decided_at          TEXT,
  created_by_id       TEXT NOT NULL REFERENCES users(id),
  notes               TEXT,
  created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO client_endorsements_new
  (id, candidate_id, client_id, endorsement_role, status, scheduled_at, decided_at, created_by_id, notes, created_at)
SELECT id, candidate_id, client_id, 'CRUISE_LINE', status, scheduled_at, decided_at, created_by_id, notes, created_at
FROM client_endorsements;

DROP TABLE client_endorsements;
ALTER TABLE client_endorsements_new RENAME TO client_endorsements;

CREATE UNIQUE INDEX uq_endorsement_active
  ON client_endorsements(candidate_id, client_id, endorsement_role)
  WHERE status IN ('PENDING','SCHEDULED');
CREATE INDEX idx_endorsements_role
  ON client_endorsements(candidate_id, endorsement_role, status);
```

### `j1_payments` ledger (ADD)

```sql
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
  is_cti_revenue  INTEGER NOT NULL DEFAULT 1,   -- 0 for SEVIS_FEE/EMBASSY_FEE/EXTERNAL
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
```

SEVIS and embassy fees are recorded with `is_cti_revenue=0` and `method='EXTERNAL'` â€” auditable, excluded from CTI revenue rollups, supersedes the previous boolean-flag idea.

### `document_issuance` (ADD)

```sql
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
```

### `j1_enrollments` â€” fixes re-deployment (ADD)

```sql
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
```

Re-deployment after `DEPLOYED`: close current enrollment, open a new one with `cycle_number+1`, CAS-reset `candidates.status='J1_STAGE_1'`. All payments, endorsements, and documents from the prior cycle remain tied to their `enrollment_id`.

### `j1_placements`, `j1_eligibility_decisions`, `j1_sponsor_submissions` (ADD)

```sql
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
  id              TEXT PRIMARY KEY,
  candidate_id    TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  enrollment_id   TEXT REFERENCES j1_enrollments(id),
  verdict         TEXT NOT NULL CHECK(verdict IN ('PASS','FAIL')),
  age_ok          INTEGER, education_ok INTEGER, work_experience_ok INTEGER,
  reason          TEXT,
  decided_by_id   TEXT NOT NULL REFERENCES users(id),
  decided_at      TEXT NOT NULL DEFAULT (datetime('now'))
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
```

Guard query for transition #2 reads `MAX(decided_at)` row.

### `partner_batches` + `import_rows` (ADD)

```sql
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
```

### `whatsapp_groups` + `whatsapp_group_members` (ADD)

```sql
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
  phone_last4     TEXT,        -- only last 4 digits stored by default; full phone optional, ADMIN+ to read
  phone_encrypted TEXT,        -- nullable AES-GCM blob, only readable via /whatsapp/groups/:id/members/:mid/phone (ADMIN+, audit-logged)
  added_at        TEXT NOT NULL DEFAULT (datetime('now')),
  removed_at      TEXT,
  notes           TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_wa_member_active
  ON whatsapp_group_members(group_id, candidate_id, member_role) WHERE removed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_wa_member_candidate ON whatsapp_group_members(candidate_id);
```

### `notifications` (ADD) â€” drives DS-2019/visa expiry alerts

```sql
CREATE TABLE IF NOT EXISTS notifications (
  id              TEXT PRIMARY KEY,
  kind            TEXT NOT NULL CHECK(kind IN
                    ('DS2019_EXPIRY_30','DS2019_EXPIRY_7','VISA_INTERVIEW_DUE',
                     'STAGE_PAYMENT_OVERDUE','ELIGIBILITY_REVIEW_SLA','DOC_VERIFICATION_PENDING')),
  candidate_id    TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  due_at          TEXT NOT NULL,
  fired_at        TEXT,
  acked_at        TEXT,
  acked_by_id     TEXT REFERENCES users(id),
  payload         TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_notif_due ON notifications(due_at, fired_at);
CREATE INDEX IF NOT EXISTS idx_notif_cand ON notifications(candidate_id, kind);
```

A Cloudflare cron worker scans every 6 hours, INSERTs missing notification rows (idempotent on `(candidate_id, kind, due_at)`), and fires Graph email to assigned recruiter.

### `candidates` (CHANGE)

```sql
ALTER TABLE candidates ADD COLUMN partner_batch_id TEXT REFERENCES partner_batches(id);
ALTER TABLE candidates ADD COLUMN current_enrollment_id TEXT REFERENCES j1_enrollments(id);
ALTER TABLE candidates ADD COLUMN updated_at TEXT NOT NULL DEFAULT (datetime('now'));
ALTER TABLE candidates ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
CREATE INDEX IF NOT EXISTS idx_candidates_partner_batch ON candidates(partner_batch_id);
```

`updated_at` + `version` enable optimistic locking on profile edits (Open Q3 â€” recommended default below).

### `program_settings` (KEEP, populate)

Real columns are `setting_key` and `setting_value` (per `worker.js`). All guard queries use those names:

```sql
INSERT OR IGNORE INTO program_settings (id, pipeline, setting_key, setting_value) VALUES
  (lower(hex(randomblob(12))), 'J1_PROGRAM', 'stage1_amount', '150'),
  (lower(hex(randomblob(12))), 'J1_PROGRAM', 'stage2_amount', '350'),
  (lower(hex(randomblob(12))), 'J1_PROGRAM', 'stage3_amount', '500'),
  (lower(hex(randomblob(12))), 'J1_PROGRAM', 'stage4_amount', '500'),
  (lower(hex(randomblob(12))), 'J1_PROGRAM', 'eligibility_review_sla_days', '5');
```

### `transitions/restore` and `force-override stage` allowlists (CHANGE)

In `worker.js:445` extend `VALID_STATES` to include the seven new J1 statuses. In `worker.js:636` extend the restore allowlist to include all J1 statuses except `DEPLOYED`.

---

## API endpoint outlines

All endpoints follow `worker.js` skeleton: `auth â†’ role â†’ validate â†’ guard reads â†’ env.DB.batch([...]) with CAS UPDATE â†’ json`. A single helper `j1PaymentRollup(env, candidateId)` returns `{s1,s2,s3,s4}` sums and is reused by every gate.

### `POST /api/v1/j1/imports`
- **Role:** SUPER_ADMIN, ADMIN.
- **Body:** `{ batchTag, partnerName, oneDriveFolder?, masterExcelDocId?, defaultRecruiterId?, rows: [{rowIndex, firstName, lastName, email, phone?, dateOfBirth?, nationality?, gender?, positionApplied?, cvFileName?, cvMimeType?, cvFileSize?, j1Profile?:{...}}] }`.
- **Ops:** see Bulk Import section below.
- **Response:** `201 { batchId, summary:{submitted,created,skippedDuplicate,errored,duplicatedAcrossBatches}, results:[...] }`.
- **Side effects:** `partner_batches` + `import_rows` + `candidates` + `j1_profiles` + `j1_enrollments`(cycle=1) + `pipeline_stage_history` + optional CV upload sessions.

### `GET /api/v1/j1/imports/:id`
- **Role:** SUPER_ADMIN, ADMIN, RECRUITER (read).
- **Response:** batch + paginated rows joined to candidates.

### `POST /api/v1/candidates/:id/j1/move-forward`
- **Role:** RECRUITER+.
- **Body:** `{ notes? }`.
- **Ops:** CAS `NEW_SUBMISSION â†’ ELIGIBILITY_REVIEW`; history; INSERT `notifications(kind='ELIGIBILITY_REVIEW_SLA', due_at=+5d)`.
- **Response:** updated candidate.

### `POST /api/v1/candidates/:id/j1/eligibility`
- **Role:** RECRUITER+.
- **Body:** `{ verdict:'PASS'|'FAIL', ageOk, educationOk, workExperienceOk, reason? }`.
- **Ops (batch):** INSERT `j1_eligibility_decisions`; CAS `ELIGIBILITY_REVIEW â†’ CONSULTATION_CALL` (PASS) or `â†’ ARCHIVED` with `archive_reason='ELIGIBILITY_FAIL'` (FAIL); history.

### `POST /api/v1/candidates/:id/j1/consultation`
- **Role:** RECRUITER+.
- **Body:** `{ action:'SCHEDULE'|'RECORD', date?, by?, englishAssessment?, participantRating?, outcome?:'APPROVED'|'REJECTED'|'PENDING', notes? }`.
- **Guards (RECORD+APPROVED):** `rollup.s1 >= setting.stage1_amount`.
- **Ops:** UPDATE `j1_profiles.consultation_*` columns; if outcome=APPROVED CAS `CONSULTATION_CALL â†’ J1_STAGE_1`; if REJECTED CAS `â†’ ARCHIVED`.

### `POST /api/v1/candidates/:id/j1/payments`
- **Role:** ONBOARDING_TEAM+.
- **Body:** `{ stage, amount, currency='USD', paidAt, method, reference?, receiptDocId?, notes?, isCtiRevenue? (default by stage) }`.
- **Validation:** amount>0 (or <0 only if `stage='REFUND'` and `refundOfId` provided); SEVIS_FEE/EMBASSY_FEE force `is_cti_revenue=0, method='EXTERNAL'`.
- **Ops:** INSERT `j1_payments` (single row). No status change. Returns rollup.

### `POST /api/v1/candidates/:id/j1/payments/:paymentId/void`
- **Role:** ADMIN+.
- **Body:** `{ reason, force?:boolean }`.
- **Ops:** Atomic UPDATE that re-checks threshold in WHERE:
  ```sql
  UPDATE j1_payments SET voided_at=datetime('now'), voided_by_id=?, void_reason=?
  WHERE id=? AND voided_at IS NULL
    AND (?=1  -- force
         OR NOT EXISTS (
           SELECT 1 FROM candidates c
           WHERE c.id=? AND c.status IN ('J1_STAGE_1','J1_STAGE_2','J1_STAGE_3','J1_STAGE_4','J1_VISA','DEPLOYED')
             AND (
               SELECT COALESCE(SUM(amount),0) FROM j1_payments
               WHERE candidate_id=c.id AND stage=? AND voided_at IS NULL AND id != ?
             ) < (SELECT CAST(setting_value AS REAL) FROM program_settings
                  WHERE pipeline='J1_PROGRAM' AND setting_key = ?)
         ))
  ```
  `meta.changes=0` â†’ return `409 GATE_VIOLATION`.

### `POST /api/v1/candidates/:id/j1/payments/refund`
- **Role:** ADMIN+.
- **Body:** `{ refundOfId, amount, reason, paidAt }` (amount stored as negative).
- **Ops:** INSERT counter-entry with `stage='REFUND'`, `refund_of_id` set.

### `GET /api/v1/candidates/:id/j1/payments/rollup`
- **Role:** RECRUITER+.
- **Response:** `{ s1, s2, s3, s4, sevis, embassy, refunds, netCtiRevenue, thresholds:{...} }`.

### `POST /api/v1/candidates/:id/j1/sponsor-submit`
- **Role:** ONBOARDING_TEAM+.
- **Body:** `{ sponsorClientId, externalReference?, notes? }`.
- **Guards:** rollup.s1+s2 funded; `clients.type='J1_SPONSOR'`.
- **Ops:** UPDATE `j1_profiles.sponsor_client_id`; INSERT `j1_sponsor_submissions`; CAS `J1_STAGE_1 â†’ J1_STAGE_2`.

### `POST /api/v1/candidates/:id/j1/host-final-interview`
- **Role:** RECRUITER+.
- **Body:** `{ action:'ENDORSE'|'SCHEDULE'|'RESULT', hostClientId, scheduledAt?, result?, interviewUrl?, notes? }`.
- **Note:** Host interviews happen on external tools (Zoom/Teams). `interviewUrl` is free-text. POSEIDON records the schedule and result only; **no ZeusHire integration**.
- **Ops:** ENDORSEâ†’INSERT `client_endorsements(role='HOST_PLACEMENT', status='PENDING')`. SCHEDULEâ†’UPDATE to SCHEDULED, CAS `J1_STAGE_2 â†’ FINAL_INTERVIEW`. RESULT=APPROVEDâ†’INSERT `document_issuance(doc_type='OFFER_LETTER_J1', status='REQUESTED', issuing_party='HOST')`; status remains `FINAL_INTERVIEW`. RESULT=REJECTEDâ†’endorsement REJECTED; if all rejected, archive permitted.

### `POST /api/v1/candidates/:id/j1/offer-signed`
- **Role:** RECRUITER+, ONBOARDING_TEAM+.
- **Body:** `{ offerLetterDocId, hostClientId, signedAt }`.
- **Guards:** endorsement APPROVED; rollup.s1+s2+s3 funded; doc belongs to candidate.
- **Ops (batch):** UPDATE `document_issuance` OFFER_LETTER_J1 to VERIFIED; INSERT three placeholders (DS_7002 HOST, DS_2019 SPONSOR, SEVIS_RECEIPT SEVIS); CAS `FINAL_INTERVIEW â†’ J1_STAGE_3`.

### `POST /api/v1/candidates/:id/j1/documents/:type`
- **Role:** ONBOARDING_TEAM+ (manual upload â€” sponsors/hosts have no POSEIDON login).
- **Body:** `{ action:'REQUEST'|'CONFIRM_UPLOAD'|'VERIFY'|'REJECT', documentId?, issuedAt?, notes? }`.
- **REQUEST:** UPDATE `document_issuance.status='REQUESTED', requested_at=now`.
- **CONFIRM_UPLOAD:** triggered after the worker mints an OneDrive upload session and the browser PUTs the file; UPDATE to `RECEIVED, document_id=?, received_at=now`.
- **VERIFY:** UPDATE to `VERIFIED`; if `doc_type` is the last of (DS_7002, DS_2019, SEVIS_RECEIPT) to verify, attempt CAS `J1_STAGE_3 â†’ J1_VISA` (silent 409 if already advanced â€” idempotent).
- **Auto-transition idempotency:** the CAS itself guarantees only one writer succeeds.

### `POST /api/v1/candidates/:id/j1/visa-result`
- **Role:** ONBOARDING_TEAM+.
- **Body:** `{ result:'APPROVED'|'DENIED'|'RESCHEDULED', interviewDate, consulate, visaStampDocId?, retry?:boolean, reason? }`.
- **Ops:** UPDATE `j1_profiles.visa_*`; APPROVED + rollup.s1..s4 funded â†’ CAS `J1_VISA â†’ J1_STAGE_4`; DENIED+retry=true â†’ stay in `J1_VISA`, INSERT denial record (logged in `pipeline_stage_history` with `from=to=J1_VISA`); DENIED+retry=false â†’ CAS `â†’ ARCHIVED`; RESCHEDULED â†’ no status change, update date only.

### `POST /api/v1/candidates/:id/j1/depart`
- **Role:** ONBOARDING_TEAM+.
- **Body:** `{ flightDepartureDate, flightTicketRef, housingLandlord, housingAddress, departureBriefingDone:true }`.
- **Guards:** all departure fields present.
- **Ops (batch):** UPDATE `j1_profiles`; INSERT `j1_placements`; UPDATE `j1_enrollments` (active row) `status='COMPLETED', closed_at=now`; CAS `J1_STAGE_4 â†’ DEPLOYED`.

### `POST /api/v1/candidates/:id/j1/re-enroll`
- **Role:** ADMIN+.
- **Body:** `{ reason, partnerBatchId? }`.
- **Guards:** candidate.status='DEPLOYED'; current `j1_enrollments.status='COMPLETED'`.
- **Ops (batch):** INSERT new `j1_enrollments` with `cycle_number=prev+1, status='ACTIVE'`; UPDATE `candidates.current_enrollment_id`; CAS `DEPLOYED â†’ J1_STAGE_1`; history with reason.

### `POST /api/v1/whatsapp/groups` + members endpoints
As specified in original Â§5.2. Phone numbers stored as `phone_last4` by default; full number AES-GCM encrypted via Worker secret, readable only via dedicated audit-logged endpoint (ADMIN+).

### `GET /api/v1/notifications?status=pending`
- **Role:** RECRUITER+ (filtered to assigned).
- Lists firing/upcoming notifications for the user's candidates.

---

## Bulk import routine

```js
R.post('/api/v1/j1/imports', async (req, env) => {
  const u = await auth(req, env); if (!role(u, 'SUPER_ADMIN', 'ADMIN')) return err(401);
  const body = await req.json().catch(() => ({}));
  const { batchTag, partnerName, oneDriveFolder, masterExcelDocId, defaultRecruiterId, rows } = body;
  if (!batchTag || !partnerName || !Array.isArray(rows) || rows.length === 0) {
    return err(400, 'batchTag, partnerName, rows[] required');
  }

  // 1) Reserve the batch. UNIQUE(batch_tag) makes this idempotent across reruns.
  const batchId = cuid();
  let existingBatchId = null;
  try {
    await env.DB.prepare(
      `INSERT INTO partner_batches (id, batch_tag, partner_name, pipeline, onedrive_folder,
         master_excel_doc_id, imported_by_id, row_count, status)
       VALUES (?, ?, ?, 'J1_PROGRAM', ?, ?, ?, ?, 'PROCESSING')`
    ).bind(batchId, batchTag, partnerName, oneDriveFolder || null,
           masterExcelDocId || null, u.id, rows.length).run();
  } catch (e) {
    const existing = await env.DB.prepare(
      `SELECT id FROM partner_batches WHERE batch_tag = ?`
    ).bind(batchTag).first();
    if (!existing) return err(500, e.message);
    existingBatchId = existing.id;  // resume mode â€” same logic, same key lookups
  }
  const useBatchId = existingBatchId || batchId;

  const results = [];
  let created = 0, skipped = 0, errored = 0, dupedAcrossBatches = 0;

  for (const row of rows) {
    const result = { rowIndex: row.rowIndex };
    const emailLower = String(row.email || '').trim().toLowerCase();
    const rowKey = await sha256Hex(`${batchTag}|${emailLower}`);

    try {
      if (!row.firstName || !row.lastName || !emailLower) {
        throw new Error('firstName, lastName, email required');
      }

      // 2a) Resume: same batch + same key? Replay prior outcome.
      const prior = await env.DB.prepare(
        `SELECT candidate_id, status, duplicate_of_id, error FROM import_rows
         WHERE batch_id = ? AND external_row_key = ?`
      ).bind(useBatchId, rowKey).first();
      if (prior) {
        result.status = prior.status;
        if (prior.candidate_id) result.candidateId = prior.candidate_id;
        if (prior.duplicate_of_id) result.duplicateOfId = prior.duplicate_of_id;
        if (prior.error) result.error = prior.error;
        results.push(result);
        if (prior.status === 'CREATED') created++;
        else if (prior.status === 'SKIPPED_DUPLICATE') { skipped++; dupedAcrossBatches++; }
        else errored++;
        continue;
      }

      // 2b) Optimistic create. Rely on candidates.email UNIQUE COLLATE NOCASE
      //     as the arbiter â€” pre-check is advisory only.
      const cid = cuid();
      const jpid = cuid();
      const enrId = cuid();
      const ridOk = cuid();
      const j = row.j1Profile || {};
      const tagsJson = JSON.stringify(['partner_batch', batchTag]);

      try {
        await env.DB.batch([
          env.DB.prepare(
            `INSERT INTO candidates (id, first_name, last_name, email, phone, pipeline,
               status, origin, tags, assigned_recruiter_id, partner_batch_id, current_enrollment_id)
             VALUES (?, ?, ?, ?, ?, 'J1_PROGRAM', 'NEW_SUBMISSION', 'Partner Import', ?, ?, ?, ?)`
          ).bind(cid, row.firstName, row.lastName, row.email, row.phone || null,
                 tagsJson, defaultRecruiterId || null, useBatchId, enrId),
          env.DB.prepare(
            `INSERT INTO j1_enrollments (id, candidate_id, cycle_number, status, partner_batch_id)
             VALUES (?, ?, 1, 'ACTIVE', ?)`
          ).bind(enrId, cid, useBatchId),
          env.DB.prepare(
            `INSERT INTO j1_profiles (id, candidate_id, partner_batch_id, j1_application_status,
               sponsor_name, exchange_visitor_category, program_start_date, program_end_date,
               hosting_company, selected_job, processing_sponsor)
             VALUES (?, ?, ?, 'NEW_SUBMISSION', ?, ?, ?, ?, ?, ?, ?)`
          ).bind(jpid, cid, useBatchId, j.sponsorName || null, j.exchangeVisitorCategory || null,
                 j.programStartDate || null, j.programEndDate || null, j.hostingCompany || null,
                 j.selectedJob || null, j.processingSponsor || null),
          env.DB.prepare(
            `INSERT INTO pipeline_stage_history (id, candidate_id, from_status, to_status,
               changed_by_id, reason)
             VALUES (?, ?, NULL, 'NEW_SUBMISSION', ?, ?)`
          ).bind(cuid(), cid, u.id, `Imported from batch ${batchTag}`),
          env.DB.prepare(
            `INSERT INTO import_rows (id, batch_id, row_index, external_row_key, email_lower,
               candidate_id, status, raw_row)
             VALUES (?, ?, ?, ?, ?, ?, 'CREATED', ?)`
          ).bind(ridOk, useBatchId, row.rowIndex, rowKey, emailLower, cid, JSON.stringify(row))
        ]);

        if (row.cvFileName) {
          result.cvUploadSession = await mintCvUploadSession(
            env, cid, row.cvFileName, row.cvMimeType, row.cvFileSize, u
          );
        }
        result.status = 'CREATED';
        result.candidateId = cid;
        created++;
      } catch (insertErr) {
        // 2c) UNIQUE(email) collision = real duplicate. Record as SKIPPED, not ERROR.
        const msg = String(insertErr.message || insertErr);
        if (/UNIQUE/i.test(msg) && /email/i.test(msg)) {
          const dup = await env.DB.prepare(
            `SELECT id FROM candidates WHERE lower(email) = ?`
          ).bind(emailLower).first();
          await env.DB.prepare(
            `INSERT OR IGNORE INTO import_rows (id, batch_id, row_index, external_row_key,
               email_lower, candidate_id, status, duplicate_of_id, raw_row)
             VALUES (?, ?, ?, ?, ?, NULL, 'SKIPPED_DUPLICATE', ?, ?)`
          ).bind(cuid(), useBatchId, row.rowIndex, rowKey, emailLower,
                 dup ? dup.id : null, JSON.stringify(row)).run();
          result.status = 'SKIPPED_DUPLICATE';
          if (dup) result.duplicateOfId = dup.id;
          skipped++; dupedAcrossBatches++;
        } else {
          throw insertErr;
        }
      }
    } catch (e) {
      await env.DB.prepare(
        `INSERT OR IGNORE INTO import_rows (id, batch_id, row_index, external_row_key,
           email_lower, status, error, raw_row)
         VALUES (?, ?, ?, ?, ?, 'ERROR', ?, ?)`
      ).bind(cuid(), useBatchId, row.rowIndex, rowKey, emailLower,
             String(e.message || e), JSON.stringify(row)).run();
      result.status = 'ERROR';
      result.error = String(e.message || e);
      errored++;
    }
    results.push(result);
  }

  const finalStatus = errored === 0 ? 'COMPLETED' : (created > 0 ? 'PARTIAL' : 'FAILED');
  await env.DB.prepare(
    `UPDATE partner_batches SET created_count=?, skipped_count=?, error_count=?, status=?
     WHERE id=?`
  ).bind(created, skipped, errored, finalStatus, useBatchId).run();

  return json({
    batchId: useBatchId,
    resumed: !!existingBatchId,
    summary: { submitted: rows.length, created, skippedDuplicate: skipped, errored, duplicatedAcrossBatches: dupedAcrossBatches },
    results
  }, 201);
});

async function sha256Hex(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
}
```

Properties:
- **Idempotent on rerun:** UNIQUE `batch_tag` triggers resume mode; UNIQUE `(batch_id, external_row_key)` replays prior outcomes verbatim.
- **TOCTOU-correct:** the `UNIQUE(email)` constraint on `candidates` is the arbiter. A losing concurrent insert is caught and recorded as `SKIPPED_DUPLICATE`, not `ERROR`.
- **Per-row atomicity:** each row is its own `env.DB.batch([...])` transaction; one bad row produces one `import_rows` ERROR.
- **No file bytes through Worker:** CV uploads return pre-signed OneDrive PUT URLs.
- **Counters reconcile:** `created + skipped + errored === row_count`.

---

## Document workflow (DS-7002 / DS-2019 / SEVIS)

**Principle:** sponsors and host companies are external parties with no POSEIDON accounts. All third-party documents are uploaded **manually by the Onboarding team** after receiving them via email/portal from the sponsor/host. No third-party API integration. No webhook from SEVIS.

**Gate:** Stage 3 payment is required before any of these issuance rows exist. Transition #8 (`offer-signed`) is what creates them â€” it cannot fire without `rollup.s3 >= setting.stage3_amount`.

**Lifecycle per document:**

| Doc | Issuing party | Created by | Status flow | Uploader |
|---|---|---|---|---|
| OFFER_LETTER_J1 | HOST | host-final-interview RESULT=APPROVED | REQUESTED â†’ RECEIVED â†’ VERIFIED | Onboarding uploads PDF sent by host |
| DS_7002 (Training Plan) | HOST | offer-signed | REQUESTED â†’ ISSUED â†’ RECEIVED â†’ VERIFIED | Onboarding uploads PDF returned by host |
| DS_2019 (Certificate of Eligibility) | SPONSOR | offer-signed | REQUESTED â†’ ISSUED â†’ RECEIVED â†’ VERIFIED | Onboarding uploads PDF returned by sponsor |
| SEVIS_RECEIPT | SEVIS | offer-signed | PENDING â†’ RECEIVED â†’ VERIFIED | Onboarding uploads I-901 receipt after participant pays |
| MEDICAL_EXAM | PARTICIPANT | manual (Onboarding) | REQUESTED â†’ RECEIVED â†’ VERIFIED | Onboarding uploads clinic report |
| J1_VISA_STAMP | EMBASSY | manual (Onboarding) | PENDING â†’ RECEIVED â†’ VERIFIED | Onboarding uploads passport-stamp photo after consular interview |

**Upload mechanics (KEEP):**
1. Onboarding clicks "Upload DS-2019" â†’ client calls `POST /j1/documents/DS_2019 { action:'REQUEST' }` to set `requested_at`.
2. Client calls existing `/documents/upload-session` to get OneDrive PUT URL.
3. Browser PUTs file to OneDrive directly.
4. Client calls `POST /j1/documents/DS_2019 { action:'CONFIRM_UPLOAD', documentId }` â†’ status `RECEIVED`.
5. Reviewer clicks "Verify" â†’ `POST /j1/documents/DS_2019 { action:'VERIFY' }` â†’ status `VERIFIED`. If this is the third VERIFIED of the trio, CAS auto-fires `J1_STAGE_3 â†’ J1_VISA`. Double-fire from two concurrent VERIFY clicks is harmless (only one CAS wins; the other gets `meta.changes=0` and the handler treats it as already-advanced).

**Rejection path:** `action:'REJECT'` â†’ status `REJECTED`. The partial unique index `uq_doc_issuance_active` permits a new issuance row of the same `doc_type` afterward.

---

## Phased implementation plan

Each phase ships behind a feature flag (`FLAG_J1_PHASE_1..4` in `program_settings`), demos to user, gets explicit approval, and is merged to main. Mirrors Sea-Based rollout.

### Phase 1 â€” Foundations (schema + flags) [~3 days]
Deliverables:
- `migration_v7_j1.sql` with all table rebuilds (`j1_profiles`, `clients`, `client_endorsements`) and new tables (`j1_payments`, `document_issuance`, `partner_batches`, `import_rows`, `j1_enrollments`, `j1_placements`, `j1_eligibility_decisions`, `j1_sponsor_submissions`, `whatsapp_groups`, `whatsapp_group_members`, `notifications`).
- Pre-flight script that snapshots existing `j1_profiles` and `client_endorsements` to a CSV in OneDrive before destructive migration.
- Backfill: existing J1 candidates get a `j1_enrollments` row with `cycle_number=1, status='ACTIVE'`.
- Extend `VALID_STATES` in `worker.js:445` and restore allowlist at `worker.js:636`.
- Feature flag scaffolding.
- **Approval gate:** dry-run migration on prod snapshot, diff existing data, get user sign-off before applying to prod D1.

### Phase 2 â€” State machine + payments [~4 days]
Deliverables:
- All transition endpoints (`/j1/move-forward`, `/j1/eligibility`, `/j1/consultation`, `/j1/sponsor-submit`, `/j1/host-final-interview`).
- `/j1/payments`, `/j1/payments/:id/void`, `/j1/payments/refund`, `/j1/payments/rollup`.
- CAS helper + transitive payment-gate helper.
- Admin UI: J1 status kanban with stage entry buttons disabled until rollup met; payment ledger tab.
- Unit tests for every transition with happy + 409 paths.
- **Approval gate:** demo end-to-end recruiter walk from import â†’ ELIGIBILITY_REVIEW â†’ CONSULTATION_CALL â†’ J1_STAGE_1.

### Phase 3 â€” Documents + visa + departure [~4 days]
Deliverables:
- `/j1/offer-signed`, `/j1/documents/:type`, `/j1/visa-result`, `/j1/depart`, `/j1/re-enroll`.
- Auto-transition on third-doc VERIFY.
- Admin UI: document-issuance checklist on candidate detail; visa interview form; departure form.
- Stage 3+4 payment integration; offer-letter upload through existing OneDrive flow.
- **Approval gate:** demo end-to-end Onboarding walk from J1_STAGE_3 â†’ DEPLOYED, including a visa-denied-with-retry path.

### Phase 4 â€” Bulk import + WhatsApp + notifications [~3 days]
Deliverables:
- `/j1/imports` + `/j1/imports/:id` endpoints with the routine above.
- Admin UI: drag-drop Excel/CSV â†’ preview â†’ confirm â†’ results table.
- WhatsApp group endpoints + admin UI tab.
- Cron worker (every 6h) populating `notifications` for DS2019 expiry (30d / 7d), eligibility SLA, visa interview due.
- Email-send via existing Graph helper.
- **Approval gate:** import a real partner batch in staging, verify per-row outcomes and CV upload sessions.

Total: ~14 working days, single engineer, sequential phases.

---

## Open questions

**Q1. Visa-denied retry policy.**
214(b) refusals can sometimes be overcome on a second interview. Should `J1_VISA â†’ J1_VISA` retry be (a) unlimited, (b) capped at N attempts, or (c) require ADMIN escalation after the first denial?
**Recommended default:** unlimited self-service retries while DS-2019 is still valid, but the second denial auto-creates a `notifications(kind='ADMIN_REVIEW_REQUIRED')` for an admin to decide whether to continue. Captured in `pipeline_stage_history` as repeated `J1_VISA â†’ J1_VISA` rows with reason; no special state needed.

**Q2. Re-deployment after `DEPLOYED`.**
A returning J1 alumnus â€” do they (a) get a new candidates row (clean slate), or (b) reuse the existing row with a new `j1_enrollments` cycle (preserves history)?
**Recommended default (already baked in):** option (b) via `/j1/re-enroll`. Same candidates row, new enrollment, CAS reset to `J1_STAGE_1`. All historical payments/docs/placements stay tied to their original `enrollment_id`. Avoids the unique-email collision and preserves audit lineage.

**Q3. Optimistic locking on profile edits.**
`candidates` and `j1_profiles` get `updated_at` + `version` columns. Do we enforce `If-Match: <version>` headers on PATCH endpoints (rejecting stale writes with 409), or just expose `updated_at` for client-side warnings?
**Recommended default:** enforce. Worker reads `If-Match`, runs `UPDATE ... WHERE id=? AND version=?`, returns 409 on `changes=0`. Client retries with merge. This is the only way to avoid lost updates on the wide `j1_profiles` row.

**Q4. SEVIS / embassy fee in revenue rollups.**
Confirmed default: stored in `j1_payments` with `is_cti_revenue=0` and `method='EXTERNAL'`. They appear in audit reports and per-candidate ledgers but are excluded from any `SUM(amount) WHERE is_cti_revenue=1` revenue report. Confirm this matches finance's expectation.

**Q5. WhatsApp phone storage.**
Default: only `phone_last4` stored in plain text; full number encrypted (AES-GCM with Worker secret) and only retrievable via ADMIN+ endpoint that writes an audit log entry. Acceptable for PDP Law compliance, but confirm.

**Q6. Eligibility review SLA.**
Default `eligibility_review_sla_days=5` in `program_settings`. After 5 days in `ELIGIBILITY_REVIEW`, notification fires to assigned recruiter and ADMIN. Confirm the SLA window.

**Q7. Host final-interview tooling.**
Default: external (Zoom/Teams), `interviewUrl` is free-text, POSEIDON records schedule and outcome only. No ZeusHire integration for J1 Phase 1. Revisit in a later phase if hosts ask for one-way recording.

**Q8. Partner Excel column mapping.**
Default: design assumes a fixed schema (firstName, lastName, email, phone, dateOfBirth, nationality, gender, positionApplied + `j1Profile` nested object). If partners send heterogeneous Excel layouts, Phase 4 needs a column-mapping UI before `/j1/imports`. Confirm whether to budget for that now or treat as Phase 5.
