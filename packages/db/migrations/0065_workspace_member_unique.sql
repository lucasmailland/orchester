-- packages/db/migrations/0065_workspace_member_unique.sql
--
-- One membership row per (workspace, user). Without it, accepting the same
-- invite twice, or two invites to the same person, leaves two rows with
-- different roles, and which one a check reads is undefined.
--
-- Existing duplicates are collapsed first, keeping the highest-privilege row;
-- ties keep the earliest created_at.
DELETE FROM "workspace_member" a
USING "workspace_member" b
WHERE a."workspace_id" = b."workspace_id"
  AND a."user_id" = b."user_id"
  AND a."id" <> b."id"
  AND (
    array_position(ARRAY['owner','admin','editor','viewer'], a."role"::text)
      > array_position(ARRAY['owner','admin','editor','viewer'], b."role"::text)
    OR (a."role" = b."role" AND a."created_at" > b."created_at")
    OR (a."role" = b."role" AND a."created_at" = b."created_at" AND a."id" > b."id")
  );
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_workspace_member"
  ON "workspace_member" ("workspace_id", "user_id");
