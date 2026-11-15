-- packages/db/migrations/0067_agent_version_full_snapshot.sql
--
-- An agent version stored only part of the agent: restoring it silently
-- dropped the tools, variables, response format and output schema. These
-- columns make the snapshot lossless. Versions saved before this restore with
-- the defaults, which is what they restored to before.
ALTER TABLE "agent_version" ADD COLUMN IF NOT EXISTS "tools" jsonb DEFAULT '[]'::jsonb;
ALTER TABLE "agent_version" ADD COLUMN IF NOT EXISTS "variables" jsonb DEFAULT '{}'::jsonb;
ALTER TABLE "agent_version" ADD COLUMN IF NOT EXISTS "response_format" "agent_response_format" NOT NULL DEFAULT 'text';
ALTER TABLE "agent_version" ADD COLUMN IF NOT EXISTS "output_schema" jsonb;
