-- packages/db/migrations/0049_org_primitive.sql
--
-- Introduce the `org` tenancy primitive — additive, zero-break.
--
-- WHY THIS MIGRATION EXISTS:
--   Cross-workspace consolidation (designed in v2 spec §11 → its
--   own doc 2026-05-30-cross-workspace-consolidation-design.md)
--   requires an org boundary above `workspace`. The clean path is
--   to introduce it as ADDITIVE infrastructure:
--
--     1. Every existing workspace gets its own personal org (1:1).
--        Nothing changes operationally — workspaces remain the unit
--        of UI / billing / RLS.
--     2. A future product change can MERGE multiple workspaces into
--        a shared org for the cross-workspace flows that need it.
--        That merge is a routine app-level UPDATE, not a migration.
--
-- INVARIANTS PRESERVED:
--   - Every workspace.org_id is NOT NULL post-migration (backfill is
--     atomic in this transaction).
--   - One row per (workspace) ↔ (org) — current 1:1 personal-org
--     mapping. Cross-workspace orgs in the future will violate this
--     1:1 (multiple workspaces share one org); the index does NOT
--     enforce uniqueness on org_id by design.
--   - No existing FK / index / RLS policy on `workspace` changes.

-- ── 1. Create `org` table ────────────────────────────────────────────────────
--
-- Minimal shape — name + audit timestamps. Billing / quotas / SSO
-- columns get added in follow-up migrations as features land.
CREATE TABLE IF NOT EXISTS org (
  id          text PRIMARY KEY,
  name        text NOT NULL,
  -- Free-text owner reference. NOT a FK to `user` because orgs may
  -- outlive specific users (ownership transfers, etc.); the join
  -- happens in app code with explicit NULL handling.
  owner_user_id text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- ── 2. workspace.org_id column ───────────────────────────────────────────────
--
-- Added nullable first; backfilled in the same transaction; then
-- NOT-NULLed and FK'd. The two-step inside one tx is non-blocking on
-- typical-size workspace tables (this column-add is metadata-only
-- until rows are written; ALTER TABLE ... SET NOT NULL after a full
-- backfill is a fast check on small / medium installs).
ALTER TABLE workspace
  ADD COLUMN IF NOT EXISTS org_id text;

-- ── 3. Backfill personal orgs (1:1 with existing workspaces) ─────────────────
--
-- Insert one org per workspace, keyed deterministically so re-running
-- the migration is idempotent. The id is `org_<workspaceId>` so
-- support engineers can `SELECT * FROM org WHERE id = 'org_<knownWsId>'`
-- without a join.
INSERT INTO org (id, name, owner_user_id, created_at, updated_at)
SELECT
  'org_' || w.id,
  COALESCE(w.name, w.slug, w.id),
  -- Pick the longest-tenured owner as the org owner if we have one.
  (SELECT m.user_id FROM workspace_member m
    WHERE m.workspace_id = w.id AND m.role = 'owner'
    ORDER BY m.created_at ASC LIMIT 1),
  w.created_at,
  w.created_at
FROM workspace w
ON CONFLICT (id) DO NOTHING;

UPDATE workspace
SET org_id = 'org_' || id
WHERE org_id IS NULL;

-- ── 4. NOT NULL + FK ─────────────────────────────────────────────────────────
ALTER TABLE workspace
  ALTER COLUMN org_id SET NOT NULL;

ALTER TABLE workspace
  ADD CONSTRAINT workspace_org_id_fkey
    FOREIGN KEY (org_id) REFERENCES org(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_workspace_org_id
  ON workspace (org_id);

-- ── 5. RLS on `org` ──────────────────────────────────────────────────────────
--
-- Mirror of `workspace`: enable + force, plus a member-membership
-- read policy. The default `app_user` role's GUC is `app.workspace_id`;
-- we extend the read policy to allow org rows reachable through a
-- workspace they have membership in.
ALTER TABLE org ENABLE ROW LEVEL SECURITY;
ALTER TABLE org FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS org_read_via_workspace_membership ON org;
CREATE POLICY org_read_via_workspace_membership ON org
  FOR SELECT
  USING (
    id IN (
      SELECT org_id FROM workspace
      WHERE id = current_setting('app.workspace_id', true)
    )
  );
