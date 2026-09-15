-- packages/db/migrations/0014_workspace_owner_trigger.down.sql

DROP TRIGGER IF EXISTS workspace_owner_must_be_member ON workspace;
DROP FUNCTION IF EXISTS check_workspace_owner_is_member();

-- Restore the original (NOT NULL only) CHECK constraint
ALTER TABLE workspace
  ADD CONSTRAINT workspace_owner_must_be_member
  CHECK (owner_user_id IS NOT NULL);
