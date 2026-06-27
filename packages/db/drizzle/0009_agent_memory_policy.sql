-- Add memory_policy column to agent table.
-- The TS schema declares this as NOT NULL with a default (write_scope_default:
-- workspace, read_scopes: [workspace, agent], sensitive_categories: []).
-- Back-fill existing rows with the default so the NOT NULL constraint is safe.
ALTER TABLE "agent"
  ADD COLUMN IF NOT EXISTS "memory_policy" jsonb
    NOT NULL
    DEFAULT '{"write_scope_default":"workspace","read_scopes":["workspace","agent"],"sensitive_categories":[]}'::jsonb;
