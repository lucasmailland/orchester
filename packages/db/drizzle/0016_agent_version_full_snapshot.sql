-- ORCH-10: capture the full agent config in version snapshots so restore is
-- lossless (previously only system_prompt/model/temperature/max_tokens were
-- stored, silently dropping tools/variables/response_format/output_schema).
ALTER TABLE "agent_version" ADD COLUMN IF NOT EXISTS "tools" jsonb DEFAULT '[]'::jsonb;
ALTER TABLE "agent_version" ADD COLUMN IF NOT EXISTS "variables" jsonb DEFAULT '{}'::jsonb;
ALTER TABLE "agent_version" ADD COLUMN IF NOT EXISTS "response_format" "agent_response_format" NOT NULL DEFAULT 'text';
ALTER TABLE "agent_version" ADD COLUMN IF NOT EXISTS "output_schema" jsonb;
