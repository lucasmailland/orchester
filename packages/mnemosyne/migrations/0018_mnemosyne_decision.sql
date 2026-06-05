-- packages/db/migrations/0018_mnemosyne_decision.sql
--
-- Mnemosyne v1.0: mnemo_decision primitive.
-- Decision kinds: 'decision','architecture','policy','process','bugfix','learning','discovery','config'.
-- Topic key allows upsert semantics for evolving topics (e.g., 'billing/refund-policy').

CREATE TABLE mnemo_decision (
  id                  text PRIMARY KEY,
  workspace_id        text NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  agent_id            text REFERENCES agent(id) ON DELETE SET NULL,
  conversation_id     text REFERENCES conversation(id) ON DELETE SET NULL,
  kind                text NOT NULL CHECK (kind IN
                        ('decision','architecture','policy','process','bugfix','learning','discovery','config')),
  title               text NOT NULL,
  body                text NOT NULL,
  topic_key           text,
  revision_count      integer NOT NULL DEFAULT 1,
  normalized_hash     text NOT NULL,
  decided_by_user_id  text REFERENCES "user"(id) ON DELETE SET NULL,
  embedding           vector(1536),
  embedding_model     text,
  embedding_version   text,
  -- See 0017 for rationale: text_lemmatized is DB-owned. Postgres re-derives
  -- it whenever title/body change. GIN index over this column powers FTS in
  -- candidate-on-write loop and Mode A search.
  text_lemmatized     tsvector GENERATED ALWAYS AS (
                        to_tsvector('simple', coalesce(title,'') || ' ' || coalesce(body,''))
                      ) STORED,
  status              text NOT NULL CHECK (status IN ('active','superseded','withdrawn')) DEFAULT 'active',
  superseded_by_id    text REFERENCES mnemo_decision(id) ON DELETE SET NULL,
  metadata            jsonb NOT NULL DEFAULT '{}',
  valid_from          timestamptz NOT NULL DEFAULT now(),
  valid_to            timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_mnemo_dec_ws_status ON mnemo_decision (workspace_id, status);
CREATE INDEX idx_mnemo_dec_ws_kind   ON mnemo_decision (workspace_id, kind);
CREATE INDEX idx_mnemo_dec_ws_topic  ON mnemo_decision (workspace_id, topic_key) WHERE topic_key IS NOT NULL;
CREATE INDEX idx_mnemo_dec_embedding_hnsw ON mnemo_decision USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
CREATE INDEX idx_mnemo_dec_fts ON mnemo_decision USING gin (text_lemmatized);

CREATE UNIQUE INDEX uniq_mnemo_decision_topic
  ON mnemo_decision (workspace_id, topic_key)
  WHERE topic_key IS NOT NULL AND status = 'active' AND valid_to IS NULL;

CREATE OR REPLACE FUNCTION mnemo_decision_set_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER mnemo_decision_updated_at
  BEFORE UPDATE ON mnemo_decision
  FOR EACH ROW EXECUTE FUNCTION mnemo_decision_set_updated_at();

ALTER TABLE mnemo_decision ENABLE ROW LEVEL SECURITY;
ALTER TABLE mnemo_decision FORCE  ROW LEVEL SECURITY;
SELECT apply_pattern_a('mnemo_decision');
