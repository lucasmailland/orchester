-- packages/db/migrations/0003_feature_flags.sql

CREATE TABLE feature_flag (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  flag_key text NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  rolled_out_at timestamptz,
  set_by_user_id text REFERENCES "user"(id),
  meta jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, flag_key)
);

CREATE INDEX idx_feature_flag_workspace ON feature_flag(workspace_id);
CREATE INDEX idx_feature_flag_enabled ON feature_flag(workspace_id, flag_key) WHERE enabled = true;
