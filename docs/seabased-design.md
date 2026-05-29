# Sea-Based Pipeline â€” Architecture Design

## Executive summary

- The Sea-Based pipeline canonicalizes seven candidate states (`NEW_SUBMISSION`, `CANDIDATES`, `FINAL_INTERVIEW`, `OFFER_LETTER`, `ONBOARDING`, `READY_TO_DEPLOY`, `DEPLOYED`, plus `ARCHIVED`) and renames the in-code `OFFER_LETTER_SIGNED` to `OFFER_LETTER` to match what `migration_v4.sql:122-125` already wrote to D1.
- Adds a new `DEPLOYED` candidate state (revised from the draft's "rewind to ONBOARDING") to resolve the re-deployment soundness gap; the master row stays as `DEPLOYED` while a `deployments` ledger row records each contract, and re-deployment is gated on the active deployment closing.
- Two new external integrations are wired in: ZeusHire one-way + two-way interviews (HMAC webhook back), and the existing e-signature confirmation webhook (rename-aligned).
- Multi-client endorsement is supported via existing `client_endorsements` table; `candidates.endorsed_client_id` becomes a *cached pointer set only on APPROVED* with strict concurrency guards to prevent two clients from both "owning" a candidate.
- Marlins gate is implemented as a per-attempt log (`marlins_tests`) plus a passed-at marker on `seafarer_profiles`; contract send for SEA_BASED is blocked until `marlins_passed_at IS NOT NULL`.
- Schema-drift cleanup for `seafarer_profiles` / `seafarer_certificates` / `offer_letters` is folded into this migration (`migration_v6_sea_based.sql`) rather than deferred, because Â§3.1 ALTERs depend on those tables actually existing.

## State machine blueprint

### States

| State | Notes |
|---|---|
| `NEW_SUBMISSION` | Applicant entity. One-way screening happens here as a side-channel (does not change status). |
| `CANDIDATES` | Post one-way pass. Two-way scheduling happens here as a side-channel. |
| `FINAL_INTERVIEW` | One or more `client_endorsements` in `PENDING`/`SCHEDULED`. `candidates.endorsed_client_id` is NULL. |
| `OFFER_LETTER` | A single APPROVED endorsement exists. Siblings auto-withdrawn. Marlins + contract-send happen here. |
| `ONBOARDING` | Contract signed via e-sign webhook. Documents being collected. |
| `READY_TO_DEPLOY` | All required SEA_BASED documents present + unexpired. Awaiting vessel assignment. |
| `DEPLOYED` | An `ACTIVE` row exists in `deployments`. Master stays here for the contract's duration. |
| `ARCHIVED` | Terminal-but-restorable. `archive_sub_stage` captures the sub-state at archive time. |

### Transition table

All transitions write `pipeline_stage_history`. "Auto" rows have `triggered_by_id=NULL`. Side-channel events (one-way completion, two-way completion, marlins attempt) record history with `from_status = to_status` and a metadata `event` key.

| # | From | To | Endpoint | Guard | Role | Mode |
|---|---|---|---|---|---|---|
| 1 | (NULL) | `NEW_SUBMISSION` | `POST /api/v1/candidates` | pipeline in valid set | SUPER_ADMIN, ADMIN, RECRUITER | Manual |
| 2 | `NEW_SUBMISSION` | (same) | `POST /api/v1/sea/interviews/one-way` | pipeline=SEA_BASED; first_name+last_name+email present | SUPER_ADMIN, ADMIN, RECRUITER | Manual |
| 3 | `NEW_SUBMISSION` | (same) | `POST /api/v1/webhooks/zeushire` (`one_way.completed`) | HMAC valid; row not already COMPLETED; candidate not archived | unauth (HMAC) | Auto |
| 4 | `NEW_SUBMISSION` | `CANDIDATES` | `POST /api/v1/candidates/:id/transitions/move-forward` | for SEA_BASED: at least one ONE_WAY row with `status='COMPLETED'` | SUPER_ADMIN, ADMIN, RECRUITER | Manual |
| 5 | `NEW_SUBMISSION` | `ARCHIVED` | `POST /api/v1/candidates/:id/transitions/not-moving-forward` | reason required | SUPER_ADMIN, ADMIN, RECRUITER | Manual |
| 6 | `CANDIDATES` | (same) | `POST /api/v1/sea/interviews/two-way` | pipeline=SEA_BASED; scheduledAt > now | SUPER_ADMIN, ADMIN, RECRUITER | Manual |
| 7 | `CANDIDATES` | (same) | `POST /api/v1/webhooks/zeushire` (`two_way.completed`) | HMAC valid; candidate not archived | unauth (HMAC) | Auto |
| 8 | `CANDIDATES` | `ARCHIVED` | `POST /api/v1/candidates/:id/transitions/not-moving-forward` | reason required | SUPER_ADMIN, ADMIN, RECRUITER | Manual |
| 9 | `CANDIDATES` | `FINAL_INTERVIEW` | `POST /api/v1/candidates/:id/endorse` | pipeline=SEA_BASED requires latest `TWO_WAY` row COMPLETED+passed=1; clientIds non-empty; all clients active | SUPER_ADMIN, ADMIN, RECRUITER | Manual |
| 10 | `FINAL_INTERVIEW` | `FINAL_INTERVIEW` or `CANDIDATES` | `POST /api/v1/endorsements/:id/decision` (REJECTED) | scope check; candidate status=FINAL_INTERVIEW | SUPER_ADMIN, ADMIN, CLIENT_CONTACT | Manual |
| 10b | `FINAL_INTERVIEW` | (same) | `POST /api/v1/endorsements/:id/schedule` | scope check; SCHEDULED transition for two-way client interview | SUPER_ADMIN, ADMIN, CLIENT_CONTACT | Manual |
| 11 | `FINAL_INTERVIEW` | `OFFER_LETTER` | `POST /api/v1/endorsements/:id/decision` (APPROVED) | scope check; candidate.status=FINAL_INTERVIEW AND no sibling already APPROVED | SUPER_ADMIN, ADMIN, CLIENT_CONTACT | Manual |
| 12 | `OFFER_LETTER` | (same) | `POST /api/v1/sea/marlins` | pipeline=SEA_BASED; score in [0,100] | SUPER_ADMIN, ADMIN, RECRUITER | Manual |
| 13 | `OFFER_LETTER` | (same) | `POST /api/v1/offer-letters/:id/send` | pipeline=SEA_BASED requires `seafarer_profiles.marlins_passed_at IS NOT NULL` | SUPER_ADMIN, ADMIN | Manual |
| 14 | `OFFER_LETTER` | `ONBOARDING` | `POST /api/v1/webhooks/signature-confirmed` | HMAC valid; offer letter row exists | unauth (HMAC) | Auto |
| 15 | `ONBOARDING` | `READY_TO_DEPLOY` | `POST /api/v1/sea/onboarding/:candidateId/ready` | pipeline=SEA_BASED; required documents present+unexpired | SUPER_ADMIN, ADMIN, RECRUITER | Manual |
| 16 | `READY_TO_DEPLOY` | `DEPLOYED` | `POST /api/v1/sea/deployments` | no existing ACTIVE deployment row; endorsed_client_id present | SUPER_ADMIN, ADMIN | Manual |
| 17 | `DEPLOYED` | `ONBOARDING` | `POST /api/v1/sea/deployments/:id/close` | deployment row exists in ACTIVE | SUPER_ADMIN, ADMIN | Manual |
| 18 | ANY | `ARCHIVED` | `POST /api/v1/candidates/:id/transitions/not-moving-forward` | reason required; computes `archive_sub_stage` | SUPER_ADMIN, ADMIN, RECRUITER | Manual |
| 19 | `ARCHIVED` | non-terminal | `POST /api/v1/candidates/:id/restore` | restore target in {NEW_SUBMISSION, CANDIDATES, FINAL_INTERVIEW, OFFER_LETTER, ONBOARDING}; restore to READY_TO_DEPLOY/DEPLOYED forbidden â€” must restore to ONBOARDING and re-run #15 | SUPER_ADMIN | Manual |

**Deprecate/remove:**
- The legacy `POST /api/v1/candidates/:id/endorse` body at `worker.js:1035-1051` â€” replaced by Â§2.4 below.
- The inline approve/reject branches at `worker.js:507-543` â€” replaced by Â§2.5 `/decision` endpoint (these were the routes that scoped CLIENT_CONTACT via `c.endorsed_client_id`, which is now NULL during FINAL_INTERVIEW and must be rewritten).
- The `ENDORSED â†’ CLIENT_APPROVED` dead branch at `worker.js:1074-1081` only; the surrounding `PATCH /api/v1/endorsements/:id` route is KEPT for the SCHEDULED flow (#10b) â€” see Â§2.5b.
- The generic `POST /api/v1/candidates/:id/stage` no-guard setter at `worker.js:435-453` â€” narrow to SUPER_ADMIN + `force=true` query param, and emit a `pipeline_stage_history` entry with `reason='FORCE_OVERRIDE'` and metadata listing the bypassed guards.

**Rename sweep (`OFFER_LETTER_SIGNED â†’ OFFER_LETTER`):** `worker.js:439, 519, 523, 563, 589, 625, 627, 628, 660, 1711`. All write-sites must be updated in the same PR as `migration_v6` or the rename drifts back.

## Schema additions

`migration_v6_sea_based.sql`. All statements idempotent (`IF NOT EXISTS` / column-existence-tolerant pattern via try-catch in the migration runner, since SQLite has no `ADD COLUMN IF NOT EXISTS`).

### Pre-flight: declare missing tables the worker already uses (CHANGE â€” fixes schema drift)

```sql
-- Tables referenced by worker.js but never declared in schema.sql.
-- Declared here so subsequent ALTERs in this migration don't blow up
-- on fresh D1 instances.

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
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_seafarer_candidate ON seafarer_profiles(candidate_id);

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
CREATE INDEX IF NOT EXISTS idx_seacert_candidate ON seafarer_certificates(candidate_id);

CREATE TABLE IF NOT EXISTS offer_letters (
  id              TEXT PRIMARY KEY,
  candidate_id    TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  client_id       TEXT REFERENCES clients(id),
  template_id     TEXT,
  content         TEXT,
  status          TEXT NOT NULL DEFAULT 'DRAFT'
                    CHECK (status IN ('DRAFT','SENT','SIGNED','EXPIRED','REVOKED')),
  sent_at         TEXT,
  signed_at       TEXT,
  signature_token TEXT,
  created_by_id   TEXT REFERENCES users(id),
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_offer_candidate ON offer_letters(candidate_id);
CREATE INDEX IF NOT EXISTS idx_offer_token     ON offer_letters(signature_token);
```

### Column additions (CHANGE)

```sql
-- candidates: archive sub-stage + ensure archive/endorsed columns are present
-- (worker.js writes these, schema.sql doesn't declare them)
ALTER TABLE candidates ADD COLUMN archive_reason         TEXT;
ALTER TABLE candidates ADD COLUMN archive_sub_stage      TEXT;
ALTER TABLE candidates ADD COLUMN archived_at            TEXT;
ALTER TABLE candidates ADD COLUMN archived_by_id         TEXT REFERENCES users(id);
ALTER TABLE candidates ADD COLUMN endorsed_client_id     TEXT REFERENCES clients(id);
ALTER TABLE candidates ADD COLUMN endorsed_client_name   TEXT;
-- Re-run safety: D1 migration runner catches "duplicate column name" and continues.

-- candidate_interviews: external provider wiring + ordering helpers
ALTER TABLE candidate_interviews ADD COLUMN type                 TEXT;  -- 'ONE_WAY'|'TWO_WAY'
ALTER TABLE candidate_interviews ADD COLUMN passed               INTEGER; -- 0/1/NULL
ALTER TABLE candidate_interviews ADD COLUMN external_provider    TEXT;
ALTER TABLE candidate_interviews ADD COLUMN external_session_id  TEXT;
ALTER TABLE candidate_interviews ADD COLUMN external_token_hash  TEXT;
ALTER TABLE candidate_interviews ADD COLUMN recording_url        TEXT;
ALTER TABLE candidate_interviews ADD COLUMN scheduled_at         TEXT;
ALTER TABLE candidate_interviews ADD COLUMN meeting_url          TEXT;
ALTER TABLE candidate_interviews ADD COLUMN expires_at           TEXT;
ALTER TABLE candidate_interviews ADD COLUMN completed_at         TEXT;
CREATE INDEX IF NOT EXISTS idx_ci_external_session ON candidate_interviews(external_session_id);
CREATE INDEX IF NOT EXISTS idx_ci_external_token   ON candidate_interviews(external_token_hash);
CREATE INDEX IF NOT EXISTS idx_ci_cand_type_order  ON candidate_interviews(
    candidate_id, type, completed_at, scheduled_at, invited_at);

-- seafarer_profiles: marlins gate columns + UNIQUE for upsert
-- (UNIQUE(candidate_id) declared above on the CREATE; safe.)
ALTER TABLE seafarer_profiles ADD COLUMN marlins_passed_at TEXT;
ALTER TABLE seafarer_profiles ADD COLUMN marlins_attempts  INTEGER NOT NULL DEFAULT 0;

-- client_endorsements: track who endorsed
ALTER TABLE client_endorsements ADD COLUMN endorsed_by_id   TEXT REFERENCES users(id);
ALTER TABLE client_endorsements ADD COLUMN decision_notes   TEXT;
ALTER TABLE client_endorsements ADD COLUMN decided_at       TEXT;
```

### New tables (ADD)

```sql
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

-- Critical concurrency guard: at most one ACTIVE deployment per candidate.
CREATE UNIQUE INDEX IF NOT EXISTS uq_deploy_one_active
  ON deployments(candidate_id) WHERE status = 'ACTIVE';
```

### Data backfill (CHANGE)

```sql
-- Normalize legacy document.type values so the Â§2.8 completeness check works.
UPDATE documents SET type = UPPER(REPLACE(type, '-', '_'))
 WHERE type IS NOT NULL
   AND type != UPPER(REPLACE(type, '-', '_'));

-- Re-apply the v4 status rename in case any worker write-sites re-introduced
-- 'OFFER_LETTER_SIGNED' since v4 ran.
UPDATE candidates SET status='OFFER_LETTER' WHERE status='OFFER_LETTER_SIGNED';
```

## API endpoint outlines

### 2.1 `POST /api/v1/sea/interviews/one-way` (ADD)

- **Role:** SUPER_ADMIN, ADMIN, RECRUITER
- **Body:** `{ candidateId, zeushireInterviewId, expiresInHours?: number /* default 168 */ }`
- **Ops:**
  1. `SELECT id, first_name, last_name, email, pipeline, status, archived_at FROM candidates WHERE id=?`
  2. Validate: not archived, `pipeline='SEA_BASED'`, `status='NEW_SUBMISSION'`, first_name+last_name+email all non-empty, `env.ZEUSHIRE_API_KEY` set.
  3. **Side-effect:** `fetch(env.ZEUSHIRE_API_URL + '/api/interview/' + zeushireInterviewId + '/sessions', { method:'POST', headers:{ 'X-Admin-Key': env.ZEUSHIRE_API_KEY, 'content-type':'application/json' }, body: JSON.stringify({ candidateFirstName, candidateLastName, candidateEmail, expiresInHours }) })`. Capture `{sessionId, token, takeUrl}`. On non-2xx â†’ return 502 without DB writes.
  4. `INSERT INTO candidate_interviews (id, candidate_id, type, status, invited_at, expires_at, external_provider, external_session_id, external_token_hash) VALUES (?, ?, 'ONE_WAY', 'INVITED', datetime('now'), ?, 'ZEUSHIRE', ?, ?)`
  5. `INSERT INTO pipeline_stage_history (id, candidate_id, from_status, to_status, triggered_by_id, reason, metadata) VALUES (?, ?, 'NEW_SUBMISSION', 'NEW_SUBMISSION', ?, 'One-way interview dispatched', json(?))`
  6. KV: `env.KV.put('zh:ow:' + tokenHash, JSON.stringify({candidateId, candidateInterviewId}), { expirationTtl: expiresInHours*3600 })`
- **Response:** `{ ok:true, candidateInterviewId, takeUrl }`
- **Failure compensation:** if step 4 fails after step 3 succeeds, best-effort `fetch(... + '/api/interview/sessions/' + sessionId, { method:'DELETE' })`; if that also fails, log and return 500. Webhook (Â§2.2) handles the orphan case by creating the row lazily.

### 2.2 `POST /api/v1/webhooks/zeushire` (ADD)

- **Role:** none. HMAC: header `X-ZeusHire-Signature: sha256=<hex>` over the raw request body using `env.ZEUSHIRE_WEBHOOK_SECRET`. Reuse `verifyHmac` pattern from `worker.js:642-647`.
- **Body:** `{ event: 'one_way.completed' | 'two_way.completed', sessionId, tokenHash?, score?, passed?, completedAt, recordingUrl? }`
- **Ops:**
  1. Verify HMAC; on mismatch â†’ 401.
  2. `SELECT ci.id, ci.candidate_id, ci.type, ci.status, c.archived_at FROM candidate_interviews ci JOIN candidates c ON c.id=ci.candidate_id WHERE ci.external_session_id=?`
  3. If row missing **and** `event='one_way.completed'` and `tokenHash` resolves a `zh:ow:<hash>` KV entry â†’ lazy-create the row (orphan recovery from Â§2.1 compensation failure): `INSERT INTO candidate_interviews (... type='ONE_WAY', status='COMPLETED', invited_at=datetime('now'), completed_at=?, external_session_id=?, external_token_hash=?, score=?, passed=?, recording_url=?)`. Continue to step 6.
  4. If row missing and no KV match â†’ 200 with `{ok:true, dropped:'unknown_session'}` (do not 4xx â€” ZeusHire would retry).
  5. If `c.archived_at IS NOT NULL` â†’ 200 `{ok:true, dropped:'candidate_archived'}` (don't leak interview events into an archived timeline).
  6. If row already `COMPLETED` â†’ 200 `{ok:true, already:true}` (idempotency).
  7. `UPDATE candidate_interviews SET status='COMPLETED', score=?, passed=?, completed_at=?, recording_url=?, updated_at=datetime('now') WHERE id=?`
  8. `INSERT INTO pipeline_stage_history (id, candidate_id, from_status, to_status, triggered_by_id, reason, metadata) VALUES (?, ?, status, status, NULL, 'ZeusHire interview completed', json(?))` â€” metadata includes `{event, type, score, passed, session_id}`.
  9. KV: `env.KV.delete('zh:ow:' + tokenHash)` (best-effort).
- **Response:** `{ ok:true }`

### 2.3 `POST /api/v1/sea/interviews/two-way` (ADD)

- **Role:** SUPER_ADMIN, ADMIN, RECRUITER
- **Body:** `{ candidateId, zeushireInterviewId, scheduledAt, durationMinutes, position?, autoMeeting?, notes? }`
- **Ops:**
  1. `SELECT id, first_name, last_name, email, pipeline, status, archived_at FROM candidates WHERE id=?`
  2. Validate: not archived, `pipeline='SEA_BASED'`, `status='CANDIDATES'`, `scheduledAt > datetime('now')`.
  3. **Side-effect:** POST to `env.ZEUSHIRE_API_URL + '/api/tw-sessions'` with full name+email+scheduledAt+duration+autoMeeting. Capture `{sessionId, meetingLink}`.
  4. `INSERT INTO candidate_interviews (... type='TWO_WAY', status='SCHEDULED', scheduled_at=?, meeting_url=?, external_provider='ZEUSHIRE', external_session_id=?)`
  5. `INSERT INTO pipeline_stage_history (... from_status='CANDIDATES', to_status='CANDIDATES', reason='Two-way interview scheduled')`
- **Response:** `{ ok:true, candidateInterviewId, meetingUrl }`

### 2.4 `POST /api/v1/candidates/:id/endorse` (CHANGE â€” replaces `worker.js:1035-1051`)

- **Role:** SUPER_ADMIN, ADMIN, RECRUITER
- **Body:** `{ clientIds: string[], notes? }`
- **Ops:**
  1. `SELECT id, status, pipeline FROM candidates WHERE id=?` â€” require `status='CANDIDATES'`. (Explicitly forbids extending the slate after entering FINAL_INTERVIEW; if the recruiter needs to widen the slate later, archive + restore.)
  2. Validate `clientIds.length BETWEEN 1 AND 10`.
  3. `SELECT id, name FROM clients WHERE id IN (?,?,...) AND is_active=1` â€” all clientIds must resolve.
  4. **Pipeline-conditional guard:** if `pipeline='SEA_BASED'`, run:
     ```sql
     SELECT id, status, passed FROM candidate_interviews
      WHERE candidate_id=? AND type='TWO_WAY'
      ORDER BY COALESCE(completed_at, scheduled_at, invited_at) DESC LIMIT 1
     ```
     Require the row exists, `status='COMPLETED'`, `passed=1`. For non-SEA_BASED pipelines this guard is skipped.
  5. Batch:
     - For each clientId: `INSERT INTO client_endorsements (id, candidate_id, client_id, status, endorsed_by_id, endorsed_at, decision_notes) VALUES (?,?,?,'PENDING',?,datetime('now'),?) ON CONFLICT(candidate_id, client_id) DO UPDATE SET status='PENDING', endorsed_by_id=excluded.endorsed_by_id, endorsed_at=excluded.endorsed_at, decided_at=NULL, decision_notes=excluded.decision_notes`
     - `UPDATE candidates SET status='FINAL_INTERVIEW', endorsed_client_id=NULL, endorsed_client_name=NULL, updated_at=datetime('now') WHERE id=? AND status='CANDIDATES'` â€” the `AND status='CANDIDATES'` is a CAS guard.
     - `INSERT INTO pipeline_stage_history (... from_status='CANDIDATES', to_status='FINAL_INTERVIEW', metadata=json('{"clientIds":[...]}'))`
  6. If the UPDATE reported `meta.changes !== 1` â†’ 409 `{error:'Candidate moved by another request'}`.
- **Response:** `{ ok:true, endorsements:[...] }`

### 2.5 `POST /api/v1/endorsements/:id/decision` (ADD â€” replaces inline logic at `worker.js:507-543`)

- **Role:** SUPER_ADMIN, ADMIN, CLIENT_CONTACT
- **Body:** `{ decision: 'APPROVED' | 'REJECTED', notes? }`
- **Scope check (the audit-flagged fix):** load endorsement row first, then scope CLIENT_CONTACT by `cc.client_id === endorsement.client_id` â€” **not** by `c.endorsed_client_id` (which is NULL during FINAL_INTERVIEW under the new multi-client model).

**REJECTED ops:**
1. `SELECT e.id, e.candidate_id, e.client_id, e.status, c.status AS cand_status FROM client_endorsements e JOIN candidates c ON c.id=e.candidate_id WHERE e.id=?`
2. Validate `cand_status='FINAL_INTERVIEW'`, endorsement not already terminal.
3. `UPDATE client_endorsements SET status='REJECTED', decided_at=datetime('now'), decision_notes=? WHERE id=? AND status NOT IN ('APPROVED','REJECTED','WITHDRAWN')`. If `meta.changes !== 1` â†’ 409.
4. `SELECT COUNT(*) AS n FROM client_endorsements WHERE candidate_id=? AND status IN ('PENDING','SCHEDULED')` â€” note the active set is **PENDING+SCHEDULED only**; an APPROVED sibling at this point would be a consistency violation since the candidate would already be in OFFER_LETTER.
5. If `n=0`: `UPDATE candidates SET status='CANDIDATES', updated_at=datetime('now') WHERE id=? AND status='FINAL_INTERVIEW'` + history `FINAL_INTERVIEW â†’ CANDIDATES, reason='All endorsements declined; returned to Candidates'`. If `n>0`: history-only row, no status change.

**APPROVED ops (single batch with CAS guards):**
1. Load endorsement + candidate as above.
2. `SELECT COUNT(*) AS n FROM client_endorsements WHERE candidate_id=? AND status='APPROVED'` â€” must be 0 or 409 `{error:'Candidate already approved by another client'}`. This is the race guard.
3. Batch:
   - `UPDATE client_endorsements SET status='APPROVED', decided_at=datetime('now'), decision_notes=? WHERE id=? AND status NOT IN ('APPROVED','REJECTED','WITHDRAWN')`
   - `UPDATE client_endorsements SET status='WITHDRAWN', decided_at=datetime('now'), decision_notes='Auto-withdrawn: candidate approved by another client' WHERE candidate_id=? AND id != ? AND status IN ('PENDING','SCHEDULED')`
   - `UPDATE candidates SET status='OFFER_LETTER', endorsed_client_id=?, endorsed_client_name=?, updated_at=datetime('now') WHERE id=? AND status='FINAL_INTERVIEW'`
   - `INSERT INTO pipeline_stage_history (... from_status='FINAL_INTERVIEW', to_status='OFFER_LETTER', metadata=json('{"approved_client_id":"..."}'))`
4. After batch, check the candidate UPDATE's `changes` â€” if 0, roll back conceptually by issuing a compensating `UPDATE client_endorsements SET status='PENDING', decided_at=NULL WHERE id=?` and return 409. (D1 batches are atomic per-batch; the CAS guards make double-approval impossible across batches.)

### 2.5b `PATCH /api/v1/endorsements/:id` (KEEP, narrowed)

Keep the existing route at `worker.js:1059-1085` for the SCHEDULED flow (transition #10b) â€” CLIENT_CONTACT sets `interview_url` and `scheduled_at` and bumps status `PENDING â†’ SCHEDULED`. **Delete** the `ENDORSED â†’ CLIENT_APPROVED` branch at `worker.js:1074-1081` only. The `/decision` endpoint (Â§2.5) handles APPROVED and REJECTED exclusively.

### 2.6 `POST /api/v1/sea/marlins` (ADD)

- **Role:** SUPER_ADMIN, ADMIN, RECRUITER
- **Body:** `{ candidateId, score, durationSeconds?, code?, takenAt? }`
- **Ops:**
  1. `SELECT id, status, pipeline FROM candidates WHERE id=?` â€” require `status='OFFER_LETTER'`, `pipeline='SEA_BASED'`.
  2. `INSERT INTO seafarer_profiles (id, candidate_id, marlins_attempts) VALUES (?, ?, 0) ON CONFLICT(candidate_id) DO NOTHING` â€” guarantees a row exists (the UNIQUE on `candidate_id` declared above enables this).
  3. Batch:
     - `INSERT INTO marlins_tests (id, candidate_id, score, duration_seconds, code, result, taken_at, recorded_by_id) VALUES (?,?,?,?,?, CASE WHEN ?>=? THEN 'PASS' ELSE 'FAIL' END, COALESCE(?, datetime('now')), ?)`
     - `UPDATE seafarer_profiles SET marlins_attempts = marlins_attempts+1, marlins_passed_at = CASE WHEN ?>=? AND marlins_passed_at IS NULL THEN datetime('now') ELSE marlins_passed_at END, updated_at=datetime('now') WHERE candidate_id=?`
     - `INSERT INTO pipeline_stage_history (... from_status='OFFER_LETTER', to_status='OFFER_LETTER', metadata=json(?))` with `{event:'marlins', result, score, attempt}`.
- **Threshold:** `env.MARLINS_PASS_THRESHOLD` (default `70`).
- **Response:** `{ ok:true, result, attempt, unlocked: score>=threshold }`

### 2.7 `POST /api/v1/offer-letters/:id/send` (CHANGE â€” adds SEA_BASED Marlins gate)

KEEP existing behavior at `worker.js:584-633`. ADD preflight for SEA_BASED:

```sql
SELECT c.pipeline, sp.marlins_passed_at
  FROM candidates c
  LEFT JOIN seafarer_profiles sp ON sp.candidate_id = c.id
 WHERE c.id = ?
```

If `pipeline='SEA_BASED' AND marlins_passed_at IS NULL` â†’ 422 `{error:'Marlins test not passed'}`.

### 2.8 `POST /api/v1/sea/onboarding/:candidateId/ready` (ADD)

- **Role:** SUPER_ADMIN, ADMIN, RECRUITER
- **Body:** `{}`
- **Ops:**
  1. Validate `status='ONBOARDING'`, `pipeline='SEA_BASED'`.
  2. Required types (normalized â€” the migration ran the UPPER+`_` backfill): `PASSPORT, SEAMAN_BOOK, STCW_BASIC, MEDICAL_CERT, YELLOW_FEVER, C1D_VISA`. `SELECT UPPER(REPLACE(type,'-','_')) AS type, expiration_date, is_verified FROM documents WHERE candidate_id=?`
  3. Compute `missing` (required types with no row) and `expired` (rows where `expiration_date IS NOT NULL AND expiration_date <= date('now')`).
  4. If either set non-empty â†’ 422 `{error:'Required documents missing or expired', missing, expired}`.
  5. `UPDATE candidates SET status='READY_TO_DEPLOY', updated_at=datetime('now') WHERE id=? AND status='ONBOARDING'` (CAS).
  6. History row.
- **Response:** `{ ok:true, verified_types:[...] }`

### 2.9 `POST /api/v1/sea/deployments` (ADD â€” see clone routine below)

- **Role:** SUPER_ADMIN, ADMIN
- **Body:** `{ candidateId, vesselName, signOnDate, contractDurationMonths, signOnPort?, position?, notes? }`
- **Result of #16:** candidate moves `READY_TO_DEPLOY â†’ DEPLOYED`.

### 2.10 `POST /api/v1/sea/deployments/:id/close` (ADD)

- **Role:** SUPER_ADMIN, ADMIN
- **Body:** `{ status: 'COMPLETED' | 'TERMINATED' | 'CANCELLED', signOffDate, signOffReason? }`
- **Ops:**
  1. `SELECT id, candidate_id, status FROM deployments WHERE id=?` â€” require `status='ACTIVE'`.
  2. Batch:
     - `UPDATE deployments SET status=?, sign_off_date=?, sign_off_reason=?, closed_by_id=?, updated_at=datetime('now') WHERE id=? AND status='ACTIVE'`
     - `UPDATE candidates SET status='ONBOARDING', updated_at=datetime('now') WHERE id=? AND status='DEPLOYED'`
     - `INSERT INTO pipeline_stage_history (... from_status='DEPLOYED', to_status='ONBOARDING', reason='Deployment closed; candidate available for re-deployment', metadata=json('{"deployment_id":"..."}'))`
- **Response:** `{ ok:true }`

The closed-state release explicitly re-runs document verification (#15) before the next deployment: when the candidate is in `ONBOARDING` post-close, the recruiter must call `/onboarding/:id/ready` again, which re-checks expirations. Long contracts at sea routinely expire passports and medicals, so this is the correct invariant.

### 2.11 Restore (CHANGE â€” `worker.js:560-574`)

Update the allowed-targets list: `{NEW_SUBMISSION, CANDIDATES, FINAL_INTERVIEW, OFFER_LETTER, ONBOARDING}`. Explicitly **forbid** restoring to `READY_TO_DEPLOY` or `DEPLOYED`. Also fix the `OFFER_LETTER_SIGNED` â†’ `OFFER_LETTER` rename at line 563.

## Deployments clone routine

```js
R.post('/api/v1/sea/deployments', async (req, env, params) => {
  const u = await auth(req, env); if (!u) return err(401);
  if (!role(u, 'SUPER_ADMIN', 'ADMIN')) return err(403);

  const b = await req.json().catch(() => ({}));
  const { candidateId, vesselName, signOnDate, contractDurationMonths,
          signOnPort, position, notes } = b || {};
  if (!candidateId || !vesselName || !signOnDate || !contractDurationMonths) {
    return err(400, 'candidateId, vesselName, signOnDate, contractDurationMonths required');
  }
  if (contractDurationMonths < 1 || contractDurationMonths > 24) {
    return err(400, 'contractDurationMonths must be between 1 and 24');
  }

  // Preflight: candidate state + active-deployment guard.
  const c = await env.DB.prepare(
    `SELECT c.id, c.first_name, c.last_name, c.status, c.pipeline,
            c.endorsed_client_id, cl.name AS client_name,
            (SELECT id FROM deployments
              WHERE candidate_id = c.id AND status = 'ACTIVE'
              LIMIT 1) AS active_deployment_id
       FROM candidates c
       LEFT JOIN clients cl ON cl.id = c.endorsed_client_id
      WHERE c.id = ?`
  ).bind(candidateId).first();

  if (!c) return err(404, 'Candidate not found');
  if (c.pipeline !== 'SEA_BASED') return err(422, 'Not a Sea-Based candidate');
  if (c.status !== 'READY_TO_DEPLOY') {
    return err(422, `Candidate must be READY_TO_DEPLOY (is ${c.status})`);
  }
  if (!c.endorsed_client_id) return err(422, 'No active client on candidate');
  if (c.active_deployment_id) {
    return err(409, 'Candidate already has an ACTIVE deployment',
                    { deployment_id: c.active_deployment_id });
  }

  const deploymentId = crypto.randomUUID();
  const fullName     = [c.first_name, c.last_name].filter(Boolean).join(' ');
  const historyId    = crypto.randomUUID();
  const metadata     = JSON.stringify({
    deployment_id: deploymentId,
    vessel: vesselName,
    sign_on_date: signOnDate,
    duration_months: contractDurationMonths,
  });

  // Atomic batch. The partial-unique index uq_deploy_one_active and the
  // candidate CAS (status='READY_TO_DEPLOY') together prevent double-deploy
  // even under concurrent requests.
  const results = await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO deployments
         (id, candidate_id, candidate_full_name, client_id, client_name,
          vessel_name, sign_on_date, contract_duration_months,
          sign_on_port, position, status, notes, created_by_id)
       VALUES (?,?,?,?,?,?,?,?,?,?, 'ACTIVE', ?, ?)`
    ).bind(deploymentId, candidateId, fullName,
           c.endorsed_client_id, c.client_name,
           vesselName, signOnDate, contractDurationMonths,
           signOnPort || null, position || null, notes || null, u.id),

    env.DB.prepare(
      `UPDATE candidates
          SET status = 'DEPLOYED', updated_at = datetime('now')
        WHERE id = ? AND status = 'READY_TO_DEPLOY'`
    ).bind(candidateId),

    env.DB.prepare(
      `INSERT INTO pipeline_stage_history
         (id, candidate_id, from_status, to_status, triggered_by_id, reason, metadata)
       VALUES (?, ?, 'READY_TO_DEPLOY', 'DEPLOYED', ?,
               'Deployment created', json(?))`
    ).bind(historyId, candidateId, u.id, metadata),
  ]);

  // CAS check: if the candidate UPDATE didn't move exactly one row, a
  // concurrent request beat us. The INSERT will have succeeded though
  // (uq_deploy_one_active blocks the second insert), so reaching here
  // with changes=0 means someone else raced past READY_TO_DEPLOY.
  const candUpdate = results[1];
  if (!candUpdate || candUpdate.meta.changes !== 1) {
    // Compensate: mark the just-created deployment as CANCELLED.
    await env.DB.prepare(
      `UPDATE deployments SET status='CANCELLED',
              sign_off_reason='Concurrent state change',
              updated_at=datetime('now')
        WHERE id = ?`
    ).bind(deploymentId).run();
    return err(409, 'Candidate state changed during deployment creation');
  }

  return json({ ok: true, deploymentId });
});
```

## Webhook security

Both webhooks share the same HMAC pattern already in use at `worker.js:642-647`.

```js
async function verifyHmac(req, secret) {
  const sig = req.headers.get('x-zeushire-signature') ||
              req.headers.get('x-signature') || '';
  const m = /^sha256=([a-f0-9]+)$/i.exec(sig);
  if (!m) return { ok:false, raw:null };
  const raw = await req.text();                   // consume once; caller re-parses
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name:'HMAC', hash:'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(raw));
  const hex = [...new Uint8Array(mac)].map(b => b.toString(16).padStart(2,'0')).join('');
  // constant-time compare
  const a = hex, bExp = m[1].toLowerCase();
  if (a.length !== bExp.length) return { ok:false, raw };
  let diff = 0; for (let i=0;i<a.length;i++) diff |= a.charCodeAt(i)^bExp.charCodeAt(i);
  return { ok: diff === 0, raw };
}
```

- **ZeusHire webhook** (`/api/v1/webhooks/zeushire`) uses `env.ZEUSHIRE_WEBHOOK_SECRET`. Idempotency key is `external_session_id`. Late-delivery handling: archived candidates drop the event (200, `dropped:'candidate_archived'`); unknown sessions drop with 200 (`dropped:'unknown_session'`) to prevent retry storms; orphan-session recovery via the KV `zh:ow:<hash>` lookup creates the row lazily.
- **E-signature webhook** (`/api/v1/webhooks/signature-confirmed`) â€” KEEP `worker.js:637-668` using `env.SIGNING_WEBHOOK_SECRET`. Only change: candidate-status filter becomes `('OFFER_LETTER', 'FINAL_INTERVIEW')` to match the rename.
- Replay protection: both webhooks rely on row-level idempotency (already-COMPLETED rows return 200 no-op). A 5-minute timestamp tolerance is recommended on top â€” if the provider sends `completedAt` more than 24 hours old, log + 200 drop with `dropped:'stale'`.
- Secrets are kept in Cloudflare Worker secrets, not `wrangler.toml`.

## Open questions

1. **Marlins fail policy â€” terminal disposition.** The state machine allows unbounded retakes today. *Recommended default: 3 attempts, then auto-archive with `archive_sub_stage='Offer Letter - Marlins Failed'`.* Implementation would add an attempt-count check in Â§2.6 step 3 and a separate archive path. Awaiting product call.

2. **Re-deployment doc re-verification.** When a `DEPLOYED` candidate signs off and returns to `ONBOARDING` (via Â§2.10), do we require the recruiter to re-upload documents that expired during the contract, or just re-run the existing matrix? *Recommended default: re-run the existing matrix on `/onboarding/:id/ready`; the expiration check at Â§2.8 step 3 will naturally surface anything that expired at sea, and the recruiter can replace documents in-place before re-firing the transition.* No code change needed beyond what's specified.

3. **Endorsement slate widening.** Â§2.4 forbids adding endorsements after entering FINAL_INTERVIEW. *Recommended default: keep the restriction; if recruiters need to widen the slate, they can ask all currently-pending clients to decline (auto-fallback to CANDIDATES at Â§2.5 step 5), then re-endorse with the full new slate.* If product disagrees, we'd add a `POST /api/v1/candidates/:id/endorse/extend` endpoint that only INSERTs new rows without touching candidate.status.

4. **ZeusHire orphan-session reconciliation.** If Â§2.1's compensating DELETE fails after a DB failure, the ZeusHire session lives but POSEIDON has no row. The webhook lazy-create path (Â§2.2 step 3) recovers it on completion, but candidates who never finish the test stay orphaned in ZeusHire. *Recommended default: nightly Cron Trigger that calls `GET /api/interview/sessions?status=expired` on ZeusHire and reconciles. Out of scope for this design.*

5. **Document type taxonomy.** The required-set for SEA_BASED is hardcoded in Â§2.8. *Recommended default: keep as worker constant for v1, promote to a `program_settings` row in v2 once Land-Based and J1 need their own matrices.* Migration normalizes existing rows to `UPPER_SNAKE` so future case/dash variations don't break the check.

6. **Force-override audit visibility.** Â§2's "deprecate/remove" list narrows the generic stage setter to SUPER_ADMIN + `force=true` with a distinct history entry. *Recommended default: also surface `FORCE_OVERRIDE` history entries in the candidate detail timeline with a visible "admin override" badge, so they're not invisible in normal review.* UI-side work in admin.js, not specified in this design.

7. **CLIENT_CONTACT scope for the new `/decision` endpoint.** Â§2.5 scopes by `endorsement.client_id`. *Recommended default: confirmed â€” this is the correct scope under multi-client.* The legacy routes at `worker.js:507-543` that scoped by `c.endorsed_client_id` are deprecated and must be removed in the same PR or CLIENT_CONTACT users will hit 403 on every endorsement decision once `endorsed_client_id` is NULL during FINAL_INTERVIEW.
