-- packages/db/migrations/0020_mnemosyne_relation.sql
--
-- Mnemosyne v1.0: mnemo_relation — ANY-to-ANY graph edges across the four
-- primitives (fact, decision, entity, episode). 9 locked relation verbs
-- (see packages/mnemosyne/src/graph/verbs.ts RELATION_VERB_VERSION=v1.0.0).
--
-- NOTE: NO UNIQUE on (source_kind, source_id, target_kind, target_id, relation).
-- Multi-actor disagreement is by design (spec §3, §38 enterprise note): two
-- judges can independently mark the same edge with different verbs. The
-- LLM-judge / supersede chain reconciles via `superseded_by_relation_id`.

CREATE TABLE mnemo_relation (
  id                          text PRIMARY KEY,
  workspace_id                text NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  source_kind                 text NOT NULL CHECK (source_kind IN ('fact','decision','entity','episode')),
  source_id                   text NOT NULL,
  target_kind                 text NOT NULL CHECK (target_kind IN ('fact','decision','entity','episode')),
  target_id                   text NOT NULL,
  relation                    text NOT NULL CHECK (relation IN (
    'related','compatible','scoped','conflicts_with','supersedes','not_conflict',
    'derived_from','part_of','member_of'
  )),
  judgment_status             text NOT NULL DEFAULT 'pending' CHECK (judgment_status IN ('pending','judged','dismissed')),
  reason                      text,
  evidence                    jsonb,
  confidence                  real CHECK (confidence BETWEEN 0 AND 1),
  marked_by_user_id           text REFERENCES "user"(id) ON DELETE SET NULL,
  marked_by_kind              text NOT NULL CHECK (marked_by_kind IN ('user','agent','system','llm_judge')),
  marked_by_model             text,
  marked_by_prompt_version    text,
  conversation_id             text REFERENCES conversation(id) ON DELETE SET NULL,
  superseded_by_relation_id   text REFERENCES mnemo_relation(id) ON DELETE SET NULL,
  valid_from                  timestamptz NOT NULL DEFAULT now(),
  valid_to                    timestamptz,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_mnemo_rel_source  ON mnemo_relation (workspace_id, source_kind, source_id);
CREATE INDEX idx_mnemo_rel_target  ON mnemo_relation (workspace_id, target_kind, target_id);
CREATE INDEX idx_mnemo_rel_pending ON mnemo_relation (workspace_id, judgment_status, created_at DESC)
  WHERE judgment_status = 'pending';

ALTER TABLE mnemo_relation ENABLE ROW LEVEL SECURITY;
ALTER TABLE mnemo_relation FORCE  ROW LEVEL SECURITY;
SELECT apply_pattern_a('mnemo_relation');
