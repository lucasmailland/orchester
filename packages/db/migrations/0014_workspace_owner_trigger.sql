-- packages/db/migrations/0014_workspace_owner_trigger.sql
--
-- R2-A audit fix: replace misleadingly-named CHECK constraint
-- `workspace_owner_must_be_member` (which only enforces NOT NULL, not actual
-- membership) with a DEFERRABLE trigger that validates owner_user_id exists in
-- workspace_member for the same workspace.
--
-- INITIALLY DEFERRED: workspace and its first member row can be inserted in the
-- same transaction without ordering constraints — the check fires at COMMIT.

-- ============================================================
-- 1. Drop the vestigial NOT NULL check
-- ============================================================

ALTER TABLE workspace DROP CONSTRAINT IF EXISTS workspace_owner_must_be_member;

-- ============================================================
-- 2. Trigger function
-- ============================================================

CREATE OR REPLACE FUNCTION check_workspace_owner_is_member()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Only enforce when owner_user_id is set
  IF NEW.owner_user_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM workspace_member
    WHERE workspace_id = NEW.id
      AND user_id = NEW.owner_user_id
  ) THEN
    RAISE EXCEPTION
      'workspace owner (%) must be a member of workspace (%)',
      NEW.owner_user_id, NEW.id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  RETURN NEW;
END;
$$;

-- ============================================================
-- 3. DEFERRABLE trigger
-- ============================================================

CREATE CONSTRAINT TRIGGER workspace_owner_must_be_member
  AFTER INSERT OR UPDATE OF owner_user_id
  ON workspace
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION check_workspace_owner_is_member();
