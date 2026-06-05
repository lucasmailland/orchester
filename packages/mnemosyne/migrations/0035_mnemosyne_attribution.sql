-- packages/db/migrations/0035_mnemosyne_attribution.sql
--
-- Mnemosyne v1.4 — theory-of-mind attribution column on `mnemo_fact`.
--
-- Distinguishes WHERE a fact comes from at the cognitive level:
--   • user_stated     — the user explicitly said this (highest-trust).
--   • user_belief     — the user thinks this is true; may or may not be.
--   • objective_fact  — canonical / verifiable (e.g. timezone is UTC).
--   • inferred        — the extraction pipeline derived this without
--                       being told directly. Default for every legacy
--                       row + every v1.4 row whose extractor hasn't been
--                       updated to classify attribution yet.
--
-- No index needed at this layer — `attribution` is a discriminator the
-- recall layer uses for filtering (`AND attribution IN (...)`), not a
-- high-cardinality lookup key. The (workspace_id, status, valid_to)
-- subset is already covered by existing indexes; adding `attribution` to
-- those wouldn't move the needle (4-value enum, low selectivity).
--
-- RLS+FORCE Pattern A is unchanged — column-level adds don't touch the
-- policy graph. `app_user` already has SELECT/INSERT/UPDATE on the
-- table, so no additional grant is needed.

ALTER TABLE mnemo_fact
  ADD COLUMN IF NOT EXISTS attribution text NOT NULL DEFAULT 'inferred'
    CHECK (attribution IN ('user_stated', 'user_belief', 'objective_fact', 'inferred'));
