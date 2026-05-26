-- packages/db/migrations/0040_mnemosyne_actor_isolation_policy.sql
--
-- Mnemosyne v1.6 — opt-in per-actor RLS enforcement on `mnemo_fact`.
--
-- The `actor_id` column (migration 0037) records WHICH end-user a fact
-- was learned from. NULL = workspace-shared (current behaviour). Today
-- nothing in Postgres enforces per-actor isolation — the app filter is
-- the only gate. This migration ships an opt-in layer.
--
-- When the GUC `app.enforce_actor_isolation = 'true'` is set inside a
-- transaction, the policy below restricts SELECT to rows where:
--   • actor_id IS NULL                          (workspace-shared), OR
--   • actor_id = current_setting('app.actor_id')(this actor's facts).
--
-- When the GUC is unset (the default), the policy collapses to
-- `true` and the per-actor gate is a no-op. This is layered ON TOP of
-- the existing workspace_id policy from migration 0017 — both must
-- pass for a row to be visible.
--
-- INSERT, UPDATE, DELETE are intentionally NOT gated by actor_id:
--   • INSERT — the extract pipeline sets actor_id explicitly per row.
--              Gating writes would force callers to set the GUC for
--              every save, which is more error-prone than the explicit
--              `actorId` parameter on `createFact`.
--   • UPDATE/DELETE — manual edits from the inspector are a tenant-
--              admin path; the workspace policy is sufficient.
--
-- Why FOR SELECT only:
--   Per-actor isolation is about read scopes ("Bob shouldn't see facts
--   contributed by Alice unless they're workspace-shared"). The write
--   path knows its own actor and doesn't need a gate; the read path
--   may serve mixed tenants (an agent runtime backing multiple end-
--   users on the same DB connection) and benefits from RLS as a
--   defence-in-depth.
--
-- Why this is non-breaking:
--   The GUC defaults to NULL when unset. `IS DISTINCT FROM 'true'`
--   evaluates to true when the value is NULL, so the policy short-
--   circuits to "no actor gate" and all existing callers keep seeing
--   every row their workspace policy already allowed.

-- RESTRICTIVE is critical: by default, multiple SELECT policies on the
-- same table are OR'd (permissive). We want this filter to AND with
-- the existing `mnemo_fact_tenant_select` policy from migration 0017
-- so both predicates must pass for a row to be visible. RESTRICTIVE
-- policies are AND'd with everything else, which is exactly the
-- defence-in-depth semantics the brief asks for.
CREATE POLICY mnemo_fact_actor_isolation_select ON mnemo_fact AS RESTRICTIVE FOR SELECT
  USING (
    -- GUC absent or explicitly set to anything other than the literal
    -- 'true' → policy collapses to "no actor gate" and every row that
    -- already passes the workspace policy is visible.
    current_setting('app.enforce_actor_isolation', true) IS DISTINCT FROM 'true'
    -- Workspace-shared facts (no actor attribution) are always visible
    -- regardless of the actor GUC. This preserves the legacy fact
    -- visibility behaviour for facts that predate the actor_id column.
    OR actor_id IS NULL
    -- This actor's own facts. The cast to text matches the column type
    -- and the GUC value (the `text_lemmatized` GIN already uses the
    -- same cast pattern, see migration 0017).
    OR actor_id = current_setting('app.actor_id', true)::text
  );
