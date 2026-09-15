-- packages/db/migrations/0041_mnemosyne_protocol_v12_tagging.sql
--
-- Mnemosyne v1.6 — protocol version tagging on `mnemo_fact`.
--
-- The Memory Protocol (the system-prompt artifact every agent runtime
-- injects, see `packages/mnemosyne/src/protocol/v1.ts`) ships with a
-- semver. v1.6 bumps the protocol to v1.2 to add:
--   • per-user privacy ("if asked about Alice when speaking to Bob,
--     redact unless workspace-scoped")
--   • entity awareness ("when discussing a known entity, prefer
--     entity-linked facts")
--
-- Existing extractions stay tagged 'v1.1' (the SQL DEFAULT preserves
-- the row shape for every legacy row + every Mode A workspace that
-- doesn't extract). New extractions explicitly tag 'v1.2' at the
-- application layer (`extract-job.ts`). Future bumps can re-tag
-- selectively via a one-shot script — we deliberately do NOT auto-
-- migrate older rows because the older protocol's classification
-- decisions (e.g. which facts to save) shouldn't retroactively be
-- treated as v1.2-classified.
--
-- The composite index serves the typical "facts in workspace W with
-- protocol_version = ?" query used by:
--   • recall-quality dashboards (compare v1.1 vs v1.2 hit rate)
--   • extraction replay jobs (re-classify all v1.1 rows with the
--     v1.2 extractor in batch)
--   • the inspector's "show me rows that pre-date the current protocol"
--     filter once that ships.

ALTER TABLE mnemo_fact
  ADD COLUMN IF NOT EXISTS protocol_version text NOT NULL DEFAULT 'v1.1';

CREATE INDEX IF NOT EXISTS idx_mnemo_fact_protocol_version
  ON mnemo_fact (workspace_id, protocol_version);
