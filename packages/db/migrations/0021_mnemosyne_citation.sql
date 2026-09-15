-- packages/db/migrations/0021_mnemosyne_citation.sql
--
-- Provenance: every memory traces back to source messages + prompt version +
-- extractor model + judgment chain. Recursive proof trees via `mem_provenance`.

CREATE TABLE mnemo_citation (
  id                        text PRIMARY KEY,
  workspace_id              text NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  memory_kind               text NOT NULL CHECK (memory_kind IN ('fact','decision','entity','episode')),
  memory_id                 text NOT NULL,
  source_kind               text NOT NULL CHECK (source_kind IN
                              ('message','document','tool_call','llm_extraction','user_edit','agent_save','imported')),
  source_id                 text,
  extractor_model           text,
  extractor_prompt_version  text,
  judge_model               text,
  judge_relation_id         text REFERENCES mnemo_relation(id) ON DELETE SET NULL,
  evidence_excerpt          text,
  created_at                timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_mnemo_cit_memory ON mnemo_citation (workspace_id, memory_kind, memory_id);
CREATE INDEX idx_mnemo_cit_source ON mnemo_citation (workspace_id, source_kind, source_id);

ALTER TABLE mnemo_citation ENABLE ROW LEVEL SECURITY;
ALTER TABLE mnemo_citation FORCE  ROW LEVEL SECURITY;
SELECT apply_pattern_a('mnemo_citation');
