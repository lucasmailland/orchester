-- packages/db/migrations/0063_flow_groups.sql
--
-- Named groups of flow steps, drawn by the editor as one block ("Fetch
-- monitoring data", "Write the ticket note"). Presentation only: the engine,
-- the validators and the flow fact sheet read `nodes` and `edges`, never this
-- column, so a flow runs the same with or without groups. Shape:
-- [{ "id": text, "name": text, "description"?: text, "icon"?: text,
--    "nodeIds": [text] }], max 50 entries; the application validates it.
--
-- `flow_version` gets the same column so restoring a version brings back how
-- the flow read, not only what it ran. Both columns default to an empty list,
-- so existing rows read as "no groups" and the migration is safe to apply
-- before the application that reads them starts. One ALTER per column so the
-- migration audit can see each of them. Both tables already have FORCE ROW
-- LEVEL SECURITY keyed on workspace_id; new columns are covered by the
-- existing policies.
ALTER TABLE "flow" ADD COLUMN IF NOT EXISTS "groups" jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE "flow_version" ADD COLUMN IF NOT EXISTS "groups" jsonb NOT NULL DEFAULT '[]'::jsonb;
