-- packages/db/migrations/0017_mnemosyne_init.sql
--
-- Mnemosyne v0.1: rename brain_fact → mnemo_fact + brain_extraction_job → mnemo_extraction_job.
-- Schema is identical to brain_* (no functional changes); rename only.
-- Forward migration: create empty mnemo_* tables. Backfill happens in 0024.
-- Brain_* tables remain in place until grace period ends.
--
-- Same indexes + RLS+FORCE Pattern A + HNSW + GIN + dedup uniques.

CREATE TABLE mnemo_fact (
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
  attributed_to       text CHECK (attributed_to IN ('user','assistant','system')),
  linked_memory_ids   text[] NOT NULL DEFAULT '{}',
  embedding           vector(1536),
  embedding_model     text,
  embedding_version   text,
  -- text_lemmatized auto-populated by Postgres on every INSERT/UPDATE.
  -- GENERATED ALWAYS means we never write to it from app code — DB owns the
  -- column. Required for the GIN index used in Mode A FTS queries.
  text_lemmatized     tsvector GENERATED ALWAYS AS (
                        to_tsvector('simple', coalesce(subject,'') || ' ' || coalesce(statement,''))
                      ) STORED,
  metadata            jsonb NOT NULL DEFAULT '{}',
  status              text NOT NULL CHECK (status IN ('active','merged','forgotten')) DEFAULT 'active',
  merged_into_id      text REFERENCES mnemo_fact(id) ON DELETE SET NULL,
  valid_from          timestamptz NOT NULL DEFAULT now(),
  valid_to            timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_mnemo_fact_ws_status  ON mnemo_fact (workspace_id, status);
CREATE INDEX idx_mnemo_fact_ws_scope   ON mnemo_fact (workspace_id, scope, scope_ref);
CREATE INDEX idx_mnemo_fact_ws_subject ON mnemo_fact (workspace_id, subject);

CREATE INDEX idx_mnemo_fact_embedding_hnsw
  ON mnemo_fact USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

CREATE INDEX idx_mnemo_fact_fts ON mnemo_fact USING gin (text_lemmatized);

CREATE UNIQUE INDEX uniq_mnemo_fact_dedup
  ON mnemo_fact (workspace_id, scope, COALESCE(scope_ref, ''), subject, md5(statement))
  WHERE status = 'active' AND valid_to IS NULL;

CREATE OR REPLACE FUNCTION mnemo_fact_set_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER mnemo_fact_updated_at
  BEFORE UPDATE ON mnemo_fact
  FOR EACH ROW EXECUTE FUNCTION mnemo_fact_set_updated_at();

CREATE TABLE mnemo_extraction_job (
  id              text PRIMARY KEY,
  workspace_id    text NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  conversation_id text NOT NULL REFERENCES conversation(id) ON DELETE CASCADE,
  state           text NOT NULL CHECK (state IN ('pending','running','done','failed','skipped')) DEFAULT 'pending',
  message_count   integer NOT NULL,
  facts_produced  integer NOT NULL DEFAULT 0,
  skip_reason     text,
  error           text,
  started_at      timestamptz,
  completed_at    timestamptz,
  metadata        jsonb NOT NULL DEFAULT '{}',
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_mnemo_extract_job_workspace_state
  ON mnemo_extraction_job (workspace_id, state, created_at DESC);

ALTER TABLE mnemo_fact            ENABLE ROW LEVEL SECURITY;
ALTER TABLE mnemo_fact            FORCE  ROW LEVEL SECURITY;
SELECT apply_pattern_a('mnemo_fact');

ALTER TABLE mnemo_extraction_job  ENABLE ROW LEVEL SECURITY;
ALTER TABLE mnemo_extraction_job  FORCE  ROW LEVEL SECURITY;
SELECT apply_pattern_a('mnemo_extraction_job');
