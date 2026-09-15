-- packages/db/migrations/0001_workspace_lifecycle.down.sql

ALTER TABLE workspace
  DROP CONSTRAINT IF EXISTS workspace_lifecycle_consistent,
  DROP CONSTRAINT IF EXISTS workspace_owner_must_be_member;

ALTER TABLE workspace
  DROP COLUMN IF EXISTS owner_user_id,
  DROP COLUMN IF EXISTS restore_token_consumed_at,
  DROP COLUMN IF EXISTS restore_token,
  DROP COLUMN IF EXISTS deleted_by_user_id,
  DROP COLUMN IF EXISTS delete_scheduled_at,
  DROP COLUMN IF EXISTS deleted_at,
  DROP COLUMN IF EXISTS suspended_by_user_id,
  DROP COLUMN IF EXISTS suspended_reason,
  DROP COLUMN IF EXISTS suspended_at,
  DROP COLUMN IF EXISTS status;

DROP INDEX IF EXISTS idx_workspace_owner;
DROP INDEX IF EXISTS idx_workspace_delete_scheduled;
DROP INDEX IF EXISTS idx_workspace_status;

DROP TYPE IF EXISTS workspace_status;
