-- packages/db/migrations/0016_brain_core.sql
--
-- Brain Core (sub-spec 2): tenant-isolated, semantically-searchable
-- fact store. Replaces naive agent_memory key/value with structured
-- facts + decay + audit + GDPR.
--
-- Tables:
--   brain_fact            — the facts themselves with embedding vector(1536)
--   brain_extraction_job  — observability for the async extraction pipeline
--
-- Both tables get RLS + FORCE from day 1. We have the GUC discipline
-- from sub-spec 1; no reason to ship Brain Core with weaker isolation.

BEGIN;

CREATE TABLE brain_fact (
  id                  text PRIMARY KEY,
  workspace_id        text NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  agent_id            text REFERENCES agent(id) ON DELETE SET NULL,
  scope               text NOT NULL CHECK (scope IN ('global','conversation','employee','team')),
  scope_ref           text,
  kind                text NOT NULL CHECK (kind IN ('preference','trait','event','relationship','skill','concern','other')),
  subject             text NOT NULL,
  statement           text NOT NULL,
  confidence          real NOT NULL CHECK (confidence BETWEEN 0 AND 1) DEFAULT 0.7,
  pinned              boolean NOT NULL DEFAULT false,
  relevance           real NOT NULL CHECK (relevance BETWEEN 0 AND 1) DEFAULT 1.0,
  hit_count           integer NOT NULL DEFAULT 0,
  last_recalled_at    timestamptz,
  source_message_ids  text[] NOT NULL DEFAULT '{}',
  embedding           vector(1536),
  metadata            jsonb NOT NULL DEFAULT '{}',
  status              text NOT NULL CHECK (status IN ('active','merged','forgotten')) DEFAULT 'active',
  merged_into_id      text REFERENCES brain_fact(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- Hot-path indexes: workspace+status (active fact list), workspace+scope+ref
-- (conversation/employee/team views), workspace+subject (subject grouping)
CREATE INDEX idx_brain_fact_workspace_status ON brain_fact (workspace_id, status);
CREATE INDEX idx_brain_fact_workspace_scope ON brain_fact (workspace_id, scope, scope_ref);
CREATE INDEX idx_brain_fact_workspace_subject ON brain_fact (workspace_id, subject);

-- HNSW for fast cosine search. m=16 / ef_construction=64 mirrors the
-- knowledge_chunk index (proven well-balanced for our shapes).
CREATE INDEX idx_brain_fact_embedding_hnsw
  ON brain_fact USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- Dedup guard: same (workspace, scope, scope_ref, subject, normalized statement)
-- can only exist once in active state. Partial index on status='active' so
-- forgotten/merged duplicates don't block new inserts.
CREATE UNIQUE INDEX uniq_brain_fact_workspace_dedup
  ON brain_fact (workspace_id, scope, COALESCE(scope_ref, ''), subject, md5(statement))
  WHERE status = 'active';

-- Updated_at trigger so app code doesn't have to remember
CREATE OR REPLACE FUNCTION brain_fact_set_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER brain_fact_updated_at
  BEFORE UPDATE ON brain_fact
  FOR EACH ROW EXECUTE FUNCTION brain_fact_set_updated_at();

-- ─────────────────────────────────────────────────────────────────

CREATE TABLE brain_extraction_job (
  id              text PRIMARY KEY,
  workspace_id    text NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  conversation_id text NOT NULL REFERENCES conversation(id) ON DELETE CASCADE,
  state           text NOT NULL CHECK (state IN ('pending','running','done','failed')) DEFAULT 'pending',
  message_count   integer NOT NULL,
  facts_produced  integer NOT NULL DEFAULT 0,
  error           text,
  started_at      timestamptz,
  completed_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_brain_extract_job_workspace_state
  ON brain_extraction_job (workspace_id, state, created_at DESC);

-- ─────────────────────────────────────────────────────────────────
-- RLS: Pattern A on both, FORCED from day 1.
-- ─────────────────────────────────────────────────────────────────

ALTER TABLE brain_fact ENABLE ROW LEVEL SECURITY;
ALTER TABLE brain_fact FORCE ROW LEVEL SECURITY;
SELECT apply_pattern_a('brain_fact');

ALTER TABLE brain_extraction_job ENABLE ROW LEVEL SECURITY;
ALTER TABLE brain_extraction_job FORCE ROW LEVEL SECURITY;
SELECT apply_pattern_a('brain_extraction_job');

COMMIT;
