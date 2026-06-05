-- packages/db/migrations/0047_mnemo_unresolved_mention.sql
--
-- Mnemosyne v1.1 #22 — Unresolved-mention queue.
--
-- CRM-style precision: when the extraction pipeline identifies an entity
-- mention but cannot resolve it to a known `mnemo_entity` row (e.g.
-- ambiguous alias, insufficient context, or confidence below threshold),
-- it pushes a row here instead of (or alongside) creating a new entity.
--
-- A human reviewer (or a background resolution cron) can later:
--   • Resolve → link to an existing `mnemo_entity.id`.
--   • Dismiss → mark as irrelevant / noise.
--   • Let it age → periodic sweeper will dismiss stale (> 30d) mentions.
--
-- Design notes:
--   • No FK on `source_fact_id` / `suggested_entity_id` / `resolved_entity_id`
--     — referenced rows may be soft-deleted or merged without cascading
--     orphan deletes here. The application layer handles the "gone" case.
--   • `confidence` is the extractor-supplied certainty [0,1] that THIS
--     raw_name genuinely refers to an external entity (vs. common noun).
--   • `status` is TEXT (not enum) so it's easy to add values later without
--     a type migration.
--   • Dedup constraint: a workspace may not have two PENDING mentions of
--     the same raw_name at the same time (exact-match). The caller supplies
--     context, so an "Alice Smith" mention from two different conversations
--     is collapsed into one queue item. The extractor increments
--     `mention_count` on a conflict instead of inserting a duplicate.
--   • RLS: follows the workspace_id = current_setting('app.workspace_id')
--     FORCE pattern used by every other mnemo_* table.
--   • Idempotent: all DDL guarded by IF NOT EXISTS / IF EXISTS.

-- ── Table ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS mnemo_unresolved_mention (
  id                  TEXT        NOT NULL PRIMARY KEY,

  workspace_id        TEXT        NOT NULL
                      REFERENCES workspace(id) ON DELETE CASCADE,

  -- The raw string the extractor saw ("the CEO", "Alice", "Acme Corp").
  raw_name            TEXT        NOT NULL,

  -- Surrounding text used for disambiguation by a human or future resolver.
  context             TEXT,

  -- Fact this mention was extracted from (soft reference, no FK).
  source_fact_id      TEXT,

  -- Extractor confidence that raw_name is a genuine named entity [0,1].
  confidence          REAL        NOT NULL DEFAULT 0.0,

  -- Best-guess entity the extractor thought it might be (soft reference).
  suggested_entity_id TEXT,

  -- How many times this raw_name was encountered since last pending.
  -- Incremented on UPSERT conflict instead of creating duplicate rows.
  mention_count       INTEGER     NOT NULL DEFAULT 1,

  -- pending → resolved | dismissed (single terminal transition).
  status              TEXT        NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'resolved', 'dismissed')),

  -- Set when status = 'resolved'; the entity this mention maps to.
  resolved_entity_id  TEXT,

  -- Timestamp of the status transition.
  resolved_at         TIMESTAMPTZ,

  -- Extractor-specific data (model name, prompt version, etc.).
  metadata            JSONB       NOT NULL DEFAULT '{}',

  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Indexes ──────────────────────────────────────────────────────────────────

-- Primary access pattern: "give me pending mentions for this workspace."
CREATE INDEX IF NOT EXISTS idx_mnemo_unresolved_mention_pending
  ON mnemo_unresolved_mention (workspace_id, status, created_at DESC)
  WHERE status = 'pending';

-- Dedup check: "is there already a pending mention for this raw_name?"
-- Partial index on pending rows keeps the scan tight.
CREATE UNIQUE INDEX IF NOT EXISTS idx_mnemo_unresolved_mention_raw_pending
  ON mnemo_unresolved_mention (workspace_id, raw_name)
  WHERE status = 'pending';

-- Resolution lookup: "which mentions resolved to entity X?"
CREATE INDEX IF NOT EXISTS idx_mnemo_unresolved_mention_resolved_entity
  ON mnemo_unresolved_mention (workspace_id, resolved_entity_id)
  WHERE resolved_entity_id IS NOT NULL;

-- ── RLS ──────────────────────────────────────────────────────────────────────

ALTER TABLE mnemo_unresolved_mention ENABLE ROW LEVEL SECURITY;

-- Read + write restricted to the current workspace (Pattern A — FORCE).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'mnemo_unresolved_mention'
      AND policyname = 'mnemo_unresolved_mention_workspace'
  ) THEN
    EXECUTE $pol$
      CREATE POLICY mnemo_unresolved_mention_workspace
        ON mnemo_unresolved_mention
        USING (workspace_id = current_setting('app.workspace_id', true))
        WITH CHECK (workspace_id = current_setting('app.workspace_id', true))
    $pol$;
  END IF;
END;
$$;
