-- packages/db/migrations/0024_brain_to_mnemo_backfill.sql
--
-- Backfill brain_fact → mnemo_fact + brain_extraction_job → mnemo_extraction_job.
-- Idempotent via ON CONFLICT DO NOTHING. Safe to run multiple times.
--
-- ID mapping: `bfact_<cuid>` → `mfact_<cuid>` (rewrite prefix only).
-- Embedding columns that exist in mnemo_fact but not brain_fact
-- (embedding_model, embedding_version, attributed_to, linked_memory_ids,
-- valid_from, valid_to) take their schema defaults — brain rows did not
-- carry these fields.

INSERT INTO mnemo_fact (
  id, workspace_id, agent_id, scope, scope_ref, kind, subject, statement,
  confidence, pinned, relevance, hit_count, last_recalled_at, source_message_ids,
  embedding, metadata, status, merged_into_id, created_at, updated_at
)
SELECT
  'mfact_' || substring(id from 7),  -- replace 'bfact_' prefix with 'mfact_'
  workspace_id, agent_id, scope, scope_ref, kind, subject, statement,
  confidence, pinned, relevance, hit_count, last_recalled_at, source_message_ids,
  embedding, metadata, status, merged_into_id, created_at, updated_at
FROM brain_fact
WHERE id LIKE 'bfact_%'
ON CONFLICT (id) DO NOTHING;

INSERT INTO mnemo_extraction_job (
  id, workspace_id, conversation_id, state, message_count, facts_produced,
  error, started_at, completed_at, created_at
)
SELECT
  'mext_' || substring(id from 6),
  workspace_id, conversation_id, state, message_count, facts_produced,
  error, started_at, completed_at, created_at
FROM brain_extraction_job
WHERE id LIKE 'bext_%'
ON CONFLICT (id) DO NOTHING;

-- Report row counts for verification
DO $$
DECLARE
  v_fact_count int;
  v_job_count int;
BEGIN
  SELECT count(*) INTO v_fact_count FROM mnemo_fact;
  SELECT count(*) INTO v_job_count FROM mnemo_extraction_job;
  RAISE NOTICE 'Backfill complete: % facts, % extraction jobs in mnemo_*', v_fact_count, v_job_count;
END $$;
