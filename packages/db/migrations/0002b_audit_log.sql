-- packages/db/migrations/0002b_audit_log.sql
--
-- Tenant Hardening Sub-spec 1, Phase A — Task A.3.
--
-- New `audit_log` table with hash chain (sha256), inet actor IP, and
-- canonical actor/target split. Pre-chain legacy rows live in
-- `audit_log_legacy` (renamed in 0002a) and are bulk-migrated into this
-- table by 0002c with placeholder zero hashes + `legacy.` action prefix
-- so the chain verifier (Task A.19) excludes them.
--
-- Note: REVOKE clauses live in Task A.10 (Postgres roles migration).

CREATE TABLE audit_log (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  seq bigint NOT NULL,
  prev_hash char(64),
  payload_hash char(64) NOT NULL,
  chain_hash char(64) NOT NULL,
  action text NOT NULL,
  actor_user_id text REFERENCES "user"(id),
  actor_kind text NOT NULL,
  actor_ip inet,
  actor_user_agent text,
  target_type text NOT NULL,
  target_id text NOT NULL,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, seq)
);

CREATE INDEX idx_audit_workspace_seq ON audit_log(workspace_id, seq DESC);
CREATE INDEX idx_audit_workspace_action ON audit_log(workspace_id, action, created_at DESC);
CREATE INDEX idx_audit_actor ON audit_log(actor_user_id, created_at DESC)
  WHERE actor_user_id IS NOT NULL;
CREATE INDEX idx_audit_target ON audit_log(target_type, target_id, created_at DESC);
