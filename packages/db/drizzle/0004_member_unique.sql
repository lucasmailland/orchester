-- SEC-3: de-duplicate then enforce one membership per (workspace_id, user_id).
-- Existing dupes (same user added twice with different roles) collapse to the
-- highest-privilege row; ties keep the earliest created_at.
DELETE FROM "workspace_member" a
USING "workspace_member" b
WHERE a."workspace_id" = b."workspace_id"
  AND a."user_id" = b."user_id"
  AND a."id" <> b."id"
  AND (
    array_position(ARRAY['owner','admin','editor','viewer'], a."role"::text)
      > array_position(ARRAY['owner','admin','editor','viewer'], b."role"::text)
    OR (a."role" = b."role" AND a."created_at" > b."created_at")
  );
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_workspace_member"
  ON "workspace_member" ("workspace_id", "user_id");
