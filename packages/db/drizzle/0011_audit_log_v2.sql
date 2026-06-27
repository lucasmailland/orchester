-- 0011_audit_log_v2.sql
-- Renames the legacy audit_log (pre-hash-chain, schema from 0000_baseline)
-- to audit_log_legacy and creates the new audit_log with seq / chain columns.
-- Policies on audit_log_legacy keep their original names (table-scoped, no
-- conflict with the new table's policies).

-- ── 1. Rename existing table ───────────────────────────────────────────────
ALTER TABLE audit_log RENAME TO audit_log_legacy;--> statement-breakpoint

-- Rename the FK constraint so it reflects the new table name.
ALTER TABLE audit_log_legacy
  RENAME CONSTRAINT "audit_log_workspace_id_workspace_id_fk"
  TO "audit_log_legacy_workspace_id_fk";--> statement-breakpoint

-- ── 2. Create new audit_log ────────────────────────────────────────────────
CREATE TABLE "audit_log" (
  "id"              text        PRIMARY KEY NOT NULL,
  "workspace_id"    text        NOT NULL
    REFERENCES "workspace"("id") ON DELETE CASCADE,
  "seq"             bigint      NOT NULL,
  "prev_hash"       char(64),
  "payload_hash"    char(64)    NOT NULL,
  "chain_hash"      char(64)    NOT NULL,
  "action"          text        NOT NULL,
  "actor_user_id"   text        REFERENCES "user"("id"),
  "actor_kind"      text        NOT NULL,
  "actor_ip"        inet,
  "actor_user_agent" text,
  "target_type"     text        NOT NULL,
  "target_id"       text        NOT NULL,
  "meta"            jsonb       NOT NULL DEFAULT '{}',
  "created_at"      timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint

CREATE UNIQUE INDEX "uniq_audit_workspace_seq"
  ON "audit_log" ("workspace_id", "seq");--> statement-breakpoint

-- ── 3. GRANT / REVOKE (mirrors 0006 for other tenant tables) ──────────────
GRANT SELECT, INSERT ON audit_log TO app_user;--> statement-breakpoint
REVOKE UPDATE, DELETE ON audit_log FROM app_user;--> statement-breakpoint
GRANT SELECT, INSERT ON audit_log TO cron_admin;--> statement-breakpoint

-- ── 4. RLS + Pattern A + FORCE (mirrors 0007 / 0008) ──────────────────────
DO $$ BEGIN PERFORM apply_pattern_a('audit_log'); END $$;--> statement-breakpoint
ALTER TABLE audit_log FORCE ROW LEVEL SECURITY;--> statement-breakpoint
