-- packages/db/migrations/0039_mnemosyne_entity.sql
--
-- Mnemosyne v1.6 — the entity primitive. The 4th primitive alongside
-- fact, decision, episode. A canonical "thing" (person / organization /
-- project / concept / place / other) that facts can reference.
--
-- Today facts mention "@Lucas" in subject strings; the entity table
-- promotes that to a typed object with:
--   • aliases       — ["@lucas", "lucas mailland", "L.M."]
--   • kind          — person / organization / project / concept / place / other
--   • canonical_id  — self-reference for merge (entity X is the canonical
--                     version of entity Y); NULL = this row is canonical.
--
-- `mnemo_fact.entity_id` is added in the same migration so the
-- extraction pipeline can link a new fact to the (possibly newly-
-- created) entity in the same write path. The link is denormalised —
-- the entity row also carries a `mention_count` so the inspector can
-- sort by importance without scanning the fact table.
--
-- RLS+FORCE Pattern A — mirrors `mnemo_episode` (0034), `mnemo_summary`
-- (0028), `mnemo_health` (0031). Four policies gated on
-- `current_setting('app.workspace_id')`. Reads/writes go through
-- `withMnemoTx(workspaceId, …)` which downgrades the tx to `app_user`
-- (ADR-0010) so the BYPASSRLS bit on the session role can't leak rows
-- across tenants.

CREATE TABLE IF NOT EXISTS mnemo_entity (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  -- Canonical display name: "Lucas Mailland", "Acme Inc.", "Q2 launch".
  name text NOT NULL,
  -- 6-value cognitive vocabulary. CHECK constraint enforces it at the
  -- DB layer so a misbehaving caller can't smuggle "PERSON" or invent
  -- a new kind. The enum is intentionally small — broader taxonomies
  -- (employee / vendor / customer / …) belong on the host side, not in
  -- the cognitive primitive.
  kind text NOT NULL
    CHECK (kind IN ('person', 'organization', 'project', 'concept', 'place', 'other')),
  -- Alternate spellings / handles. The extraction pipeline uses these
  -- to dedupe ("@lucas" + "Lucas Mailland" point at the same row). GIN
  -- index below serves the alias lookup path.
  aliases text[] NOT NULL DEFAULT '{}',
  -- Self-reference for merge. When the inspector merges entity Y into
  -- entity X, Y's `canonical_id` is set to X.id and reads should
  -- transparently follow it. NULL = this row is itself canonical.
  canonical_id text,
  -- LLM-generated one-sentence description ("Engineer at Fichap, prefers
  -- TypeScript, leads the ATS team"). Nullable — heuristic-only
  -- extractions leave this empty until the LLM-assisted pass fills it.
  description text,
  metadata jsonb NOT NULL DEFAULT '{}',
  -- Lifecycle bookkeeping for the inspector UI:
  --   • first_seen_at   — when the entity was created.
  --   • last_seen_at    — most recent fact referenced it (set by the
  --                       extraction pipeline on each fact-link).
  --   • mention_count   — denormalised count of linked facts; cheap
  --                       sort key for "important entities".
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  mention_count integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- (workspace_id, name, kind) uniqueness guarantees `findOrCreate` is
  -- idempotent — a concurrent extract for the same name + kind won't
  -- produce two rows. The aliases column is intentionally NOT part of
  -- the key so distinct entities with overlapping aliases (a person
  -- and a project both nicknamed "QC") coexist.
  UNIQUE (workspace_id, name, kind)
);

-- Workspace scan path for the inspector listing. The (workspace_id,
-- kind) composite below covers the "list all persons in workspace W"
-- filter without a sort step; the bare workspace_id index serves the
-- count + unfiltered list paths.
CREATE INDEX IF NOT EXISTS idx_mnemo_entity_workspace ON mnemo_entity (workspace_id);

-- GIN on aliases so `WHERE $alias = ANY(aliases)` (the lookup-by-alias
-- path used by `findByAlias`) degenerates to a single index hop.
CREATE INDEX IF NOT EXISTS idx_mnemo_entity_aliases ON mnemo_entity USING gin (aliases);

-- (workspace_id, kind) composite — the inspector's "?kind=person"
-- filter would otherwise re-scan + filter under the workspace_id index.
CREATE INDEX IF NOT EXISTS idx_mnemo_entity_kind ON mnemo_entity (workspace_id, kind);

ALTER TABLE mnemo_entity ENABLE ROW LEVEL SECURITY;
ALTER TABLE mnemo_entity FORCE  ROW LEVEL SECURITY;

CREATE POLICY mnemo_entity_select ON mnemo_entity FOR SELECT
  USING (workspace_id = current_setting('app.workspace_id', true)::text);

CREATE POLICY mnemo_entity_insert ON mnemo_entity FOR INSERT
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::text);

CREATE POLICY mnemo_entity_update ON mnemo_entity FOR UPDATE
  USING (workspace_id = current_setting('app.workspace_id', true)::text)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::text);

CREATE POLICY mnemo_entity_delete ON mnemo_entity FOR DELETE
  USING (workspace_id = current_setting('app.workspace_id', true)::text);

-- Explicit grant for app_user (the role `withMnemoTx` downgrades to).
GRANT SELECT, INSERT, UPDATE, DELETE ON mnemo_entity TO app_user;

-- ── mnemo_fact link to mnemo_entity ────────────────────────────────────
-- The fact carries a pointer to the entity it's primarily about. NULL =
-- workspace-shared / no resolved entity (current behaviour preserved).
-- The extraction pipeline populates this when it can disambiguate.
ALTER TABLE mnemo_fact
  ADD COLUMN IF NOT EXISTS entity_id text;

-- Partial index covers the dominant filter ("facts linked to entity E
-- in workspace W"), skips the NULL rows (which dominate the table).
CREATE INDEX IF NOT EXISTS idx_mnemo_fact_entity
  ON mnemo_fact (workspace_id, entity_id)
  WHERE entity_id IS NOT NULL;
