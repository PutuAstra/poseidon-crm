-- ─────────────────────────────────────────────────────────────────────────────
-- POSEIDON CRM — Migration v8 (Pure CRM pivot)
--
-- Poseidon no longer owns the pre-hire ATS pipeline (application intake,
-- interview scheduling, client endorsements, offer letters) — that is now
-- entirely ZeusHire's job. Poseidon becomes a pure onboarding CRM: candidates
-- only enter Poseidon once ZeusHire marks them Hired and a Super Admin pushes
-- them over (see /api/v1/webhooks/zeushire-hired in worker.js).
--
-- All existing data in this database is dummy/test data — this migration
-- drops the ATS-owned tables outright rather than archiving them.
--
-- Run via: Cloudflare Dashboard → D1 → poseidon-db → Console → paste & execute.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Drop ATS-owned tables ──────────────────────────────────────────────────

DROP TABLE IF EXISTS submission_forms;
DROP TABLE IF EXISTS form_fields;
DROP TABLE IF EXISTS submissions;
DROP TABLE IF EXISTS interviews;
DROP TABLE IF EXISTS candidate_interviews;
DROP TABLE IF EXISTS booking_slots;
DROP TABLE IF EXISTS client_endorsements;
DROP TABLE IF EXISTS offer_letters;
DROP TABLE IF EXISTS marlins_tests;
DROP TABLE IF EXISTS j1_eligibility_decisions;
DROP TABLE IF EXISTS j1_sponsor_submissions;

-- Legacy destructive-migration backup tables from earlier ATS work — no
-- longer needed now that the ATS tables themselves are gone.
DROP TABLE IF EXISTS j1_profiles_legacy_v7b;
DROP TABLE IF EXISTS clients_legacy_v7b;
DROP TABLE IF EXISTS client_endorsements_legacy_v7b;

-- ── Wipe existing (dummy) candidate + dependent data ───────────────────────
-- Every current candidate was created through the retired ATS flow, so none
-- of them carry a zeushire_candidate_id. Clearing them out means every
-- candidate going forward arrives exclusively via the new ingestion endpoint.

DELETE FROM pipeline_stage_history;
DELETE FROM documents;
DELETE FROM j1_training_plans;
DELETE FROM sea_profiles;
DELETE FROM seafarer_profiles;
DELETE FROM seafarer_certificates;
DELETE FROM land_profiles;
DELETE FROM j1_profiles;
DELETE FROM deployments;
DELETE FROM candidates;

-- ── New columns to receive a ZeusHire "hired" push ─────────────────────────

ALTER TABLE candidates ADD COLUMN zeushire_candidate_id TEXT;
ALTER TABLE candidates ADD COLUMN zeushire_snapshot      TEXT;  -- JSON, read-only ATS history for the Interview tab
ALTER TABLE candidates ADD COLUMN zeushire_pushed_by     TEXT;  -- email of the Super Admin who triggered the push
ALTER TABLE candidates ADD COLUMN zeushire_pushed_at     TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_candidates_zeushire_id ON candidates(zeushire_candidate_id);
