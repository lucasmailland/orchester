-- packages/db/migrations/0062_flow_kind.sql
--
-- Flow labelling. `kind` separates top-level flows ('pipeline') from reusable
-- building blocks ('action'). `external_callers` lists callers that live
-- outside the product (for example a script calling run_flow by id): the
-- in-product reference check cannot see them, so the list blocks deletion
-- until it is cleared. Shape: [{ "name": text, "note"?: text }], max 10
-- entries; the application validates it.
--
-- Both columns carry a default, so existing rows become 'pipeline' with no
-- external callers and the migration is safe to apply before the application
-- that reads them starts. One ALTER per column so the migration audit can see
-- each of them. `flow` already has FORCE ROW LEVEL SECURITY keyed on
-- workspace_id; new columns are covered by the existing policy.
ALTER TABLE "flow" ADD COLUMN IF NOT EXISTS "kind" text NOT NULL DEFAULT 'pipeline' CHECK ("kind" IN ('pipeline', 'action'));
ALTER TABLE "flow" ADD COLUMN IF NOT EXISTS "external_callers" jsonb NOT NULL DEFAULT '[]'::jsonb;
