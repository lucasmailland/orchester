-- packages/db/migrations/0061_flow_step_trace.sql
--
-- Per-step traceability of AI work in flow runs: which agent ran, which model
-- actually answered, and what it cost. Recorded on the step itself because the
-- flow graph can be edited after the run, so it cannot be used to reconstruct
-- this later.
--
-- All columns are nullable, so the migration is safe to apply before the
-- application that writes them starts. One ALTER per column so the migration
-- audit can see each of them.
--
-- agent_id is ON DELETE SET NULL and agent_name is a snapshot: the trail must
-- survive an agent being renamed or deleted.
ALTER TABLE "flow_run_step" ADD COLUMN IF NOT EXISTS "agent_id" text REFERENCES "agent"("id") ON DELETE SET NULL;
ALTER TABLE "flow_run_step" ADD COLUMN IF NOT EXISTS "agent_name" text;
ALTER TABLE "flow_run_step" ADD COLUMN IF NOT EXISTS "model" text;
ALTER TABLE "flow_run_step" ADD COLUMN IF NOT EXISTS "tokens_used" integer;
ALTER TABLE "flow_run_step" ADD COLUMN IF NOT EXISTS "cost_usd" numeric(10,6);
