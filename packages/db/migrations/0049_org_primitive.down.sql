-- Reverse migration 0049_org_primitive.sql
--
-- WARNING: Drops `org` table and the `workspace.org_id` column. Any
-- app-level orgs / cross-workspace consolidation state will be lost.
-- This reverse exists primarily for emergency rollback during the
-- v2 deployment window — once cross-workspace flows are in
-- production, do NOT run this down migration; write a forward fix.

DROP POLICY IF EXISTS org_read_via_workspace_membership ON org;
DROP INDEX IF EXISTS idx_workspace_org_id;
ALTER TABLE workspace DROP CONSTRAINT IF EXISTS workspace_org_id_fkey;
ALTER TABLE workspace DROP COLUMN IF EXISTS org_id;
DROP TABLE IF EXISTS org;
