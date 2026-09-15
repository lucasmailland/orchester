-- packages/db/migrations/0001_workspace_lifecycle.sql

CREATE TYPE workspace_status AS ENUM ('active', 'suspended', 'deleted');

ALTER TABLE workspace
  ADD COLUMN status workspace_status NOT NULL DEFAULT 'active',
  ADD COLUMN suspended_at timestamp,
  ADD COLUMN suspended_reason text,
  ADD COLUMN suspended_by_user_id text REFERENCES "user"(id),
  ADD COLUMN deleted_at timestamp,
  ADD COLUMN delete_scheduled_at timestamp,
  ADD COLUMN deleted_by_user_id text REFERENCES "user"(id),
  ADD COLUMN restore_token text UNIQUE,
  ADD COLUMN restore_token_consumed_at timestamp,
  ADD COLUMN owner_user_id text REFERENCES "user"(id);

CREATE INDEX idx_workspace_status ON workspace(status) WHERE status != 'active';
CREATE INDEX idx_workspace_delete_scheduled ON workspace(delete_scheduled_at)
  WHERE delete_scheduled_at IS NOT NULL;
CREATE INDEX idx_workspace_owner ON workspace(owner_user_id);

-- Backfill owner_user_id from workspace_member.role='owner'
UPDATE workspace w SET owner_user_id = (
  SELECT m.user_id FROM workspace_member m
  WHERE m.workspace_id = w.id AND m.role = 'owner'
  ORDER BY m.created_at ASC LIMIT 1
);

ALTER TABLE workspace
  ADD CONSTRAINT workspace_owner_must_be_member CHECK (owner_user_id IS NOT NULL),
  ADD CONSTRAINT workspace_lifecycle_consistent CHECK (
    (status = 'active' AND deleted_at IS NULL AND suspended_at IS NULL) OR
    (status = 'suspended' AND deleted_at IS NULL AND suspended_at IS NOT NULL) OR
    (status = 'deleted' AND deleted_at IS NOT NULL AND delete_scheduled_at IS NOT NULL)
  );
