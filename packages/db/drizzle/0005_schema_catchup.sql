-- 0005_schema_catchup.sql
-- Additive tables + columns that the TS schema declares but the journaled
-- baseline (0000–0004) lacks. A fresh `pnpm db:migrate` now produces a DB
-- matching the Drizzle schema exactly, enabling the RLS migrations that follow.
--
-- Recovered from the 2044d27-deleted migrations:
--   0001_workspace_lifecycle, 0004_gdpr_export_jobs,
--   0005_idempotency_security, 0049_org_primitive

-- ── org ─────────────────────────────────────────────────────────────────────
-- Must be created before workspace.org_id FK can be added.
CREATE TABLE IF NOT EXISTS "org" (
  "id" text PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "owner_user_id" text,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);--> statement-breakpoint

-- ── workspace_status enum ───────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE "workspace_status" AS ENUM ('active', 'suspended', 'deleted');
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

-- ── workspace lifecycle columns ─────────────────────────────────────────────
ALTER TABLE "workspace"
  ADD COLUMN IF NOT EXISTS "status" "workspace_status" DEFAULT 'active' NOT NULL,
  ADD COLUMN IF NOT EXISTS "suspended_at" timestamp,
  ADD COLUMN IF NOT EXISTS "suspended_reason" text,
  ADD COLUMN IF NOT EXISTS "suspended_by_user_id" text REFERENCES "user"(id),
  ADD COLUMN IF NOT EXISTS "deleted_at" timestamp,
  ADD COLUMN IF NOT EXISTS "delete_scheduled_at" timestamp,
  ADD COLUMN IF NOT EXISTS "deleted_by_user_id" text REFERENCES "user"(id),
  ADD COLUMN IF NOT EXISTS "restore_token" text UNIQUE,
  ADD COLUMN IF NOT EXISTS "restore_token_consumed_at" timestamp,
  ADD COLUMN IF NOT EXISTS "owner_user_id" text REFERENCES "user"(id);--> statement-breakpoint

-- Backfill a personal org for every existing workspace before adding the NOT NULL FK.
INSERT INTO "org" (id, name, owner_user_id, created_at, updated_at)
SELECT
  'org_' || w.id,
  COALESCE(w.name, w.slug, w.id),
  (SELECT m.user_id FROM "workspace_member" m
    WHERE m.workspace_id = w.id AND m.role = 'owner'
    ORDER BY m.created_at ASC LIMIT 1),
  w.created_at,
  w.created_at
FROM "workspace" w
ON CONFLICT (id) DO NOTHING;--> statement-breakpoint

ALTER TABLE "workspace"
  ADD COLUMN IF NOT EXISTS "org_id" text REFERENCES "org"(id) ON DELETE RESTRICT;--> statement-breakpoint

UPDATE "workspace" SET org_id = 'org_' || id WHERE org_id IS NULL;--> statement-breakpoint

-- Set NOT NULL after backfill; safe on fresh DBs (no rows) and existing ones (all backfilled).
ALTER TABLE "workspace" ALTER COLUMN "org_id" SET NOT NULL;--> statement-breakpoint

-- ── gdpr_export_state enum + gdpr_export_job ────────────────────────────────
DO $$ BEGIN
  CREATE TYPE "gdpr_export_state" AS ENUM (
    'pending', 'exporting', 'uploading', 'emailing', 'completed', 'failed'
  );
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "gdpr_export_job" (
  "id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL REFERENCES "workspace"(id) ON DELETE CASCADE,
  "requested_by_user_id" text NOT NULL REFERENCES "user"(id),
  "state" "gdpr_export_state" DEFAULT 'pending' NOT NULL,
  "progress" integer DEFAULT 0 NOT NULL,
  "format" text DEFAULT 'json+csv' NOT NULL,
  "storage_key" text,
  "signed_url" text,
  "signed_url_expires_at" timestamptz,
  "bytes_total" bigint,
  "error" text,
  "retry_count" integer DEFAULT 0 NOT NULL,
  "checkpoint" jsonb,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "started_at" timestamptz,
  "completed_at" timestamptz
);--> statement-breakpoint

-- ── security_event ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "security_event" (
  "id" text PRIMARY KEY NOT NULL,
  "workspace_id" text REFERENCES "workspace"(id) ON DELETE SET NULL,
  "event_type" text NOT NULL,
  "severity" text NOT NULL,
  "actor_user_id" text,
  "actor_ip" inet,
  "detail" jsonb NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);--> statement-breakpoint

-- ── idempotency_key ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "idempotency_key" (
  "key" text NOT NULL,
  "workspace_id" text REFERENCES "workspace"(id) ON DELETE CASCADE,
  "user_id" text NOT NULL REFERENCES "user"(id),
  "endpoint" text NOT NULL,
  "request_hash" char(64) NOT NULL,
  "response_status" integer,
  "response_body" jsonb,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "expires_at" timestamptz NOT NULL,
  PRIMARY KEY ("user_id", "endpoint", "key")
);--> statement-breakpoint

-- ── feature_flag ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "feature_flag" (
  "id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL REFERENCES "workspace"(id) ON DELETE CASCADE,
  "flag_key" text NOT NULL,
  "enabled" boolean DEFAULT false NOT NULL,
  "rolled_out_at" timestamptz,
  "set_by_user_id" text REFERENCES "user"(id),
  "meta" jsonb DEFAULT '{}'::jsonb,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "uniq_feature_flag_workspace_key"
  ON "feature_flag" ("workspace_id", "flag_key");