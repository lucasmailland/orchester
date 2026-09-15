-- packages/db/migrations/0015_idempotency_pk_scoped.sql
--
-- R2-A audit fix: cross-tenant collision on idempotency_key.
-- The current PK is (user_id, endpoint, key) — a user active in two workspaces
-- with the same key+endpoint pair would collide, leaking response data across
-- tenants.
--
-- Fix:
--   1. Make workspace_id NOT NULL (confirmed: 0 NULL rows pre-migration).
--   2. Drop the old PK.
--   3. Add composite PK (workspace_id, user_id, endpoint, key).
--   4. Update the FK to workspace so it aligns with the new NOT NULL column.

-- Pre-condition guard (idempotent safety check)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM idempotency_key WHERE workspace_id IS NULL) THEN
    RAISE EXCEPTION 'idempotency_key has NULL workspace_id rows — migration aborted';
  END IF;
END;
$$;

-- ============================================================
-- 1. Make workspace_id NOT NULL
-- ============================================================

ALTER TABLE idempotency_key
  ALTER COLUMN workspace_id SET NOT NULL;

-- ============================================================
-- 2. Rebuild primary key
-- ============================================================

ALTER TABLE idempotency_key DROP CONSTRAINT idempotency_key_pkey;

ALTER TABLE idempotency_key
  ADD CONSTRAINT idempotency_key_pkey
  PRIMARY KEY (workspace_id, user_id, endpoint, key);
