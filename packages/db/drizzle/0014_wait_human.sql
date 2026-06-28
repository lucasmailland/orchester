-- ORCH-3: add "waiting" to flow_run_status enum; add resume_token + pending_node_id to flow_run

ALTER TYPE "flow_run_status" ADD VALUE IF NOT EXISTS 'waiting';

ALTER TABLE "flow_run"
  ADD COLUMN IF NOT EXISTS "resume_token" text,
  ADD COLUMN IF NOT EXISTS "pending_node_id" text;
