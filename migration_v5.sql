-- ─────────────────────────────────────────────────────────────────────────────
-- POSEIDON CRM — Migration v5: Analytics composite indexes
-- Safe, non-breaking. Speeds up per-workspace dashboards + master roll-up.
-- Run via: Cloudflare Dashboard → D1 → poseidon-db → Console (one block at a time)
-- ─────────────────────────────────────────────────────────────────────────────

-- Block 1 — core workspace scoping (WHERE pipeline=? GROUP BY status)
CREATE INDEX IF NOT EXISTS idx_candidates_pipeline_status
  ON candidates(pipeline, status);

-- Block 2 — recruiter capacity, scoped per workspace
CREATE INDEX IF NOT EXISTS idx_candidates_pipeline_recruiter
  ON candidates(pipeline, assigned_recruiter_id);

-- Block 3 — time-windowed intake counts per workspace
CREATE INDEX IF NOT EXISTS idx_candidates_pipeline_created
  ON candidates(pipeline, created_at);

-- Block 4 — compliance: find expiring documents by type quickly
CREATE INDEX IF NOT EXISTS idx_documents_type_expiry
  ON documents(type, expiration_date);
