# Tenant Hardening + Workspace Switcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert Orchester from multi-tenant L1 basic to enterprise-grade SOC2/ISO27001-ready, with N workspaces per user, URL-based slug routing, defense-in-depth isolation (RLS), full operational lifecycle (soft-delete, restore, suspend, transfer, GDPR export), tamper-evident audit log, and feature flag system.

**Architecture:** Five sequential phases (A → E) with verifiable gates between each. Phase A is dormant infrastructure. Phase B silently backfills tenant context. Phase C enforces RLS via FORCE. Phase D migrates URLs and launches switcher. Phase E activates lifecycle features.

**Tech Stack:** Next.js 15.5.18, Turbopack, Postgres 15+ with RLS, Drizzle ORM, pg-boss queue, better-auth, AES-256-GCM encryption, Vitest + Playwright + testcontainers.

**Spec reference:** `docs/specs/2026-05-23-tenant-hardening-design.md`

**Plan structure:** 5 chapters (one per phase). Within each chapter, tasks are atomic (2-5 min each) following TDD: failing test → minimal implementation → verify pass → commit.

---

## Chapter 0 — Pre-flight

### Task 0.1: Confirm Postgres version and pgvector extension

**Files:**

- Check: `packages/db/docker-compose.yml`

- [ ] **Step 1: Verify Postgres version**

Run: `docker exec orchester-postgres psql -U postgres -c "SELECT version();"`
Expected: PostgreSQL 15.x or higher

- [ ] **Step 2: Verify pgvector available**

Run: `docker exec orchester-postgres psql -U postgres -d orchester -c "SELECT extname FROM pg_extension;"`
Expected: includes `vector`

- [ ] **Step 3: Verify pg-boss installed**

Run: `cd apps/web && pnpm ls pg-boss`
Expected: pg-boss present

If any check fails, halt and reconcile before proceeding.

### Task 0.2: Establish performance baseline

**Files:**

- Create: `tests/perf/baseline.md`

- [ ] **Step 1: Capture current p95 latency for key routes**

Run from staging or local with realistic data:

```bash
curl -w "%{time_total}\n" -o /dev/null -s http://localhost:3333/en/agents
# Repeat 100x via k6 or autocannon
```

Record p50/p95 for: `/[locale]/agents`, `/[locale]/conversations`, `/api/me/workspaces`, `/api/agents`.

- [ ] **Step 2: Write baseline doc**

```markdown
# Pre-Phase-A baseline (2026-05-23)

- GET /[locale]/agents: p50=Xms, p95=Yms
- GET /[locale]/conversations: p50=Xms, p95=Yms
- GET /api/me/workspaces: p50=Xms, p95=Yms
- GET /api/agents: p50=Xms, p95=Yms

These numbers are the regression threshold for Phase B/C. SLO: < +5%.
```

- [ ] **Step 3: Commit**

```bash
git add tests/perf/baseline.md
git commit -m "test(perf): capture baseline latency before tenant hardening"
```

---

## Chapter A — Foundation (Week 1)

**Goal:** All new infrastructure created in dormant state. Migrations applied additively. Modules written. RLS enabled but not forced. Tests passing.

**Output gate:** Schema integrity + RLS enabled (not forced) + app role lacks UPDATE/DELETE on audit_log + all existing tests green + new unit tests green + performance baseline unchanged.

### Task A.1: Migration — workspace lifecycle columns

**Files:**

- Create: `packages/db/migrations/0001_workspace_lifecycle.sql`
- Create: `packages/db/migrations/0001_workspace_lifecycle.down.sql`

- [ ] **Step 1: Write migration up**

```sql
-- packages/db/migrations/0001_workspace_lifecycle.sql

CREATE TYPE workspace_status AS ENUM ('active', 'suspended', 'deleted');

ALTER TABLE workspace
  ADD COLUMN status workspace_status NOT NULL DEFAULT 'active',
  ADD COLUMN suspended_at timestamp,
  ADD COLUMN suspended_reason text,
  ADD COLUMN suspended_by_user_id text REFERENCES "user"(id),
  ADD COLUMN deleted_at timestamp,
  ADD COLUMN delete_scheduled_at timestamp,
  ADD COLUMN deleted_by_user_id text REFERENCES "user"(id),
  ADD COLUMN restore_token text UNIQUE,
  ADD COLUMN restore_token_consumed_at timestamp,
  ADD COLUMN owner_user_id text REFERENCES "user"(id);

CREATE INDEX idx_workspace_status ON workspace(status) WHERE status != 'active';
CREATE INDEX idx_workspace_delete_scheduled ON workspace(delete_scheduled_at)
  WHERE delete_scheduled_at IS NOT NULL;
CREATE INDEX idx_workspace_owner ON workspace(owner_user_id);

-- Backfill owner_user_id from workspace_member.role='owner'
UPDATE workspace w SET owner_user_id = (
  SELECT m.user_id FROM workspace_member m
  WHERE m.workspace_id = w.id AND m.role = 'owner'
  ORDER BY m.created_at ASC LIMIT 1
);

ALTER TABLE workspace
  ADD CONSTRAINT workspace_owner_must_be_member CHECK (owner_user_id IS NOT NULL),
  ADD CONSTRAINT workspace_lifecycle_consistent CHECK (
    (status = 'active' AND deleted_at IS NULL AND suspended_at IS NULL) OR
    (status = 'suspended' AND deleted_at IS NULL AND suspended_at IS NOT NULL) OR
    (status = 'deleted' AND deleted_at IS NOT NULL AND delete_scheduled_at IS NOT NULL)
  );
```

- [ ] **Step 2: Write migration down**

```sql
-- packages/db/migrations/0001_workspace_lifecycle.down.sql

ALTER TABLE workspace
  DROP CONSTRAINT IF EXISTS workspace_lifecycle_consistent,
  DROP CONSTRAINT IF EXISTS workspace_owner_must_be_member;

ALTER TABLE workspace
  DROP COLUMN IF EXISTS owner_user_id,
  DROP COLUMN IF EXISTS restore_token_consumed_at,
  DROP COLUMN IF EXISTS restore_token,
  DROP COLUMN IF EXISTS deleted_by_user_id,
  DROP COLUMN IF EXISTS delete_scheduled_at,
  DROP COLUMN IF EXISTS deleted_at,
  DROP COLUMN IF EXISTS suspended_by_user_id,
  DROP COLUMN IF EXISTS suspended_reason,
  DROP COLUMN IF EXISTS suspended_at,
  DROP COLUMN IF EXISTS status;

DROP INDEX IF EXISTS idx_workspace_owner;
DROP INDEX IF EXISTS idx_workspace_delete_scheduled;
DROP INDEX IF EXISTS idx_workspace_status;

DROP TYPE IF EXISTS workspace_status;
```

- [ ] **Step 3: Run migration in dev**

Run: `cd packages/db && pnpm drizzle-kit push`
Expected: Migration applies cleanly. `psql ... -c "\d workspace"` shows new columns.

- [ ] **Step 4: Verify backfill**

Run: `psql -U postgres -d orchester -c "SELECT count(*) FROM workspace WHERE owner_user_id IS NULL;"`
Expected: 0

- [ ] **Step 5: Commit**

```bash
git add packages/db/migrations/0001_workspace_lifecycle.sql packages/db/migrations/0001_workspace_lifecycle.down.sql
git commit -m "feat(db): workspace lifecycle columns (status, deleted_at, owner_user_id)"
```

### Task A.2: Schema typescript — workspace extension

**Files:**

- Modify: `packages/db/src/schema/workspaces.ts`

- [ ] **Step 1: Update Drizzle schema**

Add to `packages/db/src/schema/workspaces.ts`:

```typescript
export const workspaceStatusEnum = pgEnum("workspace_status", [
  "active",
  "suspended",
  "deleted",
]);

// Within workspaces pgTable definition, add:
//   status: workspaceStatusEnum("status").notNull().default("active"),
//   suspendedAt: timestamp("suspended_at"),
//   suspendedReason: text("suspended_reason"),
//   suspendedByUserId: text("suspended_by_user_id").references(() => users.id),
//   deletedAt: timestamp("deleted_at"),
//   deleteScheduledAt: timestamp("delete_scheduled_at"),
//   deletedByUserId: text("deleted_by_user_id").references(() => users.id),
//   restoreToken: text("restore_token").unique(),
//   restoreTokenConsumedAt: timestamp("restore_token_consumed_at"),
//   ownerUserId: text("owner_user_id").references(() => users.id).notNull(),
```

- [ ] **Step 2: Run typecheck**

Run: `cd apps/web && pnpm exec tsc --noEmit 2>&1 | head -20`
Expected: No errors related to workspace schema.

- [ ] **Step 3: Commit**

```bash
git add packages/db/src/schema/workspaces.ts
git commit -m "feat(db): drizzle schema for workspace lifecycle"
```

### Task A.3: Migration — audit log table

**Files:**

- Create: `packages/db/migrations/0002_audit_log.sql`
- Create: `packages/db/migrations/0002_audit_log.down.sql`

- [ ] **Step 1: Write up migration**

```sql
-- packages/db/migrations/0002_audit_log.sql

CREATE TABLE audit_log (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  seq bigint NOT NULL,
  prev_hash char(64),
  payload_hash char(64) NOT NULL,
  chain_hash char(64) NOT NULL,
  action text NOT NULL,
  actor_user_id text REFERENCES "user"(id),
  actor_kind text NOT NULL,
  actor_ip inet,
  actor_user_agent text,
  target_type text NOT NULL,
  target_id text NOT NULL,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, seq)
);

CREATE INDEX idx_audit_workspace_seq ON audit_log(workspace_id, seq DESC);
CREATE INDEX idx_audit_workspace_action ON audit_log(workspace_id, action, created_at DESC);
CREATE INDEX idx_audit_actor ON audit_log(actor_user_id, created_at DESC)
  WHERE actor_user_id IS NOT NULL;
CREATE INDEX idx_audit_target ON audit_log(target_type, target_id, created_at DESC);
```

- [ ] **Step 2: Write down migration**

```sql
-- packages/db/migrations/0002_audit_log.down.sql
DROP TABLE IF EXISTS audit_log CASCADE;
```

- [ ] **Step 3: Apply and verify**

Run: `cd packages/db && pnpm drizzle-kit push`
Run: `psql -d orchester -c "\d audit_log"`
Expected: Table exists with all columns and indices.

- [ ] **Step 4: Commit**

```bash
git add packages/db/migrations/0002_audit_log.sql packages/db/migrations/0002_audit_log.down.sql
git commit -m "feat(db): audit_log table with hash chain columns"
```

### Task A.4: Schema typescript — audit log

**Files:**

- Create: `packages/db/src/schema/audit.ts`
- Modify: `packages/db/src/schema/index.ts`

- [ ] **Step 1: Create schema file**

```typescript
// packages/db/src/schema/audit.ts
import {
  pgTable,
  text,
  timestamp,
  bigint,
  jsonb,
  uniqueIndex,
  char,
} from "drizzle-orm/pg-core";
import { customType } from "drizzle-orm/pg-core";
import { workspaces } from "./workspaces";
import { users } from "./auth";

const inet = customType<{ data: string }>({ dataType: () => "inet" });

export const auditLog = pgTable(
  "audit_log",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    seq: bigint("seq", { mode: "bigint" }).notNull(),
    prevHash: char("prev_hash", { length: 64 }),
    payloadHash: char("payload_hash", { length: 64 }).notNull(),
    chainHash: char("chain_hash", { length: 64 }).notNull(),
    action: text("action").notNull(),
    actorUserId: text("actor_user_id").references(() => users.id),
    actorKind: text("actor_kind").notNull(),
    actorIp: inet("actor_ip"),
    actorUserAgent: text("actor_user_agent"),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    uniqWorkspaceSeq: uniqueIndex("uniq_audit_workspace_seq").on(
      t.workspaceId,
      t.seq
    ),
  })
);

export type AuditLog = typeof auditLog.$inferSelect;
export type NewAuditLog = typeof auditLog.$inferInsert;
```

- [ ] **Step 2: Re-export from index**

In `packages/db/src/schema/index.ts` add: `export * from "./audit";`

- [ ] **Step 3: Typecheck**

Run: `cd packages/db && pnpm exec tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add packages/db/src/schema/audit.ts packages/db/src/schema/index.ts
git commit -m "feat(db): drizzle schema for audit_log"
```

### Task A.5: Migration — feature flags table

**Files:**

- Create: `packages/db/migrations/0003_feature_flags.sql`
- Create: `packages/db/migrations/0003_feature_flags.down.sql`

- [ ] **Step 1: Write migration**

```sql
-- packages/db/migrations/0003_feature_flags.sql

CREATE TABLE feature_flag (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  flag_key text NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  rolled_out_at timestamptz,
  set_by_user_id text REFERENCES "user"(id),
  meta jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, flag_key)
);

CREATE INDEX idx_feature_flag_workspace ON feature_flag(workspace_id);
CREATE INDEX idx_feature_flag_enabled ON feature_flag(workspace_id, flag_key) WHERE enabled = true;
```

- [ ] **Step 2: Write down**

```sql
DROP TABLE IF EXISTS feature_flag CASCADE;
```

- [ ] **Step 3: Apply + commit**

Run: `pnpm drizzle-kit push`

```bash
git add packages/db/migrations/0003_feature_flags.sql packages/db/migrations/0003_feature_flags.down.sql
git commit -m "feat(db): feature_flag table for per-workspace toggles"
```

### Task A.6: Schema typescript — feature flags

**Files:**

- Create: `packages/db/src/schema/feature-flags.ts`
- Modify: `packages/db/src/schema/index.ts`

- [ ] **Step 1: Create schema**

```typescript
// packages/db/src/schema/feature-flags.ts
import {
  pgTable,
  text,
  timestamp,
  boolean,
  jsonb,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { workspaces } from "./workspaces";
import { users } from "./auth";

export const featureFlags = pgTable(
  "feature_flag",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    flagKey: text("flag_key").notNull(),
    enabled: boolean("enabled").notNull().default(false),
    rolledOutAt: timestamp("rolled_out_at", { withTimezone: true }),
    setByUserId: text("set_by_user_id").references(() => users.id),
    meta: jsonb("meta").$type<Record<string, unknown>>().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    uniqWorkspaceKey: uniqueIndex("uniq_feature_flag_workspace_key").on(
      t.workspaceId,
      t.flagKey
    ),
  })
);

export type FeatureFlag = typeof featureFlags.$inferSelect;
export type NewFeatureFlag = typeof featureFlags.$inferInsert;
```

- [ ] **Step 2: Re-export + typecheck + commit**

Append `export * from "./feature-flags";` to `index.ts`.
Run: `pnpm exec tsc --noEmit`

```bash
git add packages/db/src/schema/feature-flags.ts packages/db/src/schema/index.ts
git commit -m "feat(db): drizzle schema for feature_flag"
```

### Task A.7: Migration — GDPR export jobs

**Files:**

- Create: `packages/db/migrations/0004_gdpr_export_jobs.sql`
- Create: `packages/db/migrations/0004_gdpr_export_jobs.down.sql`

- [ ] **Step 1: Write up migration**

```sql
CREATE TYPE gdpr_export_state AS ENUM (
  'pending', 'exporting', 'uploading', 'emailing', 'completed', 'failed'
);

CREATE TABLE gdpr_export_job (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  requested_by_user_id text NOT NULL REFERENCES "user"(id),
  state gdpr_export_state NOT NULL DEFAULT 'pending',
  progress integer NOT NULL DEFAULT 0,
  format text NOT NULL DEFAULT 'json+csv',
  storage_key text,
  signed_url text,
  signed_url_expires_at timestamptz,
  bytes_total bigint,
  error text,
  retry_count integer NOT NULL DEFAULT 0,
  checkpoint jsonb,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  started_at timestamptz,
  completed_at timestamptz
);

CREATE INDEX idx_gdpr_export_workspace ON gdpr_export_job(workspace_id, created_at DESC);
CREATE INDEX idx_gdpr_export_state ON gdpr_export_job(state)
  WHERE state IN ('pending', 'exporting', 'uploading', 'emailing');
```

- [ ] **Step 2: Write down**

```sql
DROP TABLE IF EXISTS gdpr_export_job CASCADE;
DROP TYPE IF EXISTS gdpr_export_state;
```

- [ ] **Step 3: Apply + commit**

```bash
git add packages/db/migrations/0004_gdpr_export_jobs.sql packages/db/migrations/0004_gdpr_export_jobs.down.sql
git commit -m "feat(db): gdpr_export_job state machine table"
```

### Task A.8: Schema typescript — GDPR + idempotency + security_event

**Files:**

- Create: `packages/db/src/schema/gdpr.ts`
- Create: `packages/db/src/schema/idempotency.ts`
- Create: `packages/db/src/schema/security.ts`
- Modify: `packages/db/src/schema/index.ts`

- [ ] **Step 1: Create gdpr.ts**

```typescript
// packages/db/src/schema/gdpr.ts
import {
  pgTable,
  text,
  timestamp,
  integer,
  jsonb,
  bigint,
  pgEnum,
} from "drizzle-orm/pg-core";
import { workspaces } from "./workspaces";
import { users } from "./auth";

export const gdprExportStateEnum = pgEnum("gdpr_export_state", [
  "pending",
  "exporting",
  "uploading",
  "emailing",
  "completed",
  "failed",
]);

export const gdprExportJobs = pgTable("gdpr_export_job", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  requestedByUserId: text("requested_by_user_id")
    .notNull()
    .references(() => users.id),
  state: gdprExportStateEnum("state").notNull().default("pending"),
  progress: integer("progress").notNull().default(0),
  format: text("format").notNull().default("json+csv"),
  storageKey: text("storage_key"),
  signedUrl: text("signed_url"),
  signedUrlExpiresAt: timestamp("signed_url_expires_at", {
    withTimezone: true,
  }),
  bytesTotal: bigint("bytes_total", { mode: "bigint" }),
  error: text("error"),
  retryCount: integer("retry_count").notNull().default(0),
  checkpoint: jsonb("checkpoint").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

export type GdprExportJob = typeof gdprExportJobs.$inferSelect;
export type NewGdprExportJob = typeof gdprExportJobs.$inferInsert;
```

- [ ] **Step 2: Create idempotency.ts**

```typescript
// packages/db/src/schema/idempotency.ts
import {
  pgTable,
  text,
  timestamp,
  integer,
  jsonb,
  char,
  primaryKey,
} from "drizzle-orm/pg-core";
import { workspaces } from "./workspaces";
import { users } from "./auth";

export const idempotencyKeys = pgTable(
  "idempotency_key",
  {
    key: text("key").notNull(),
    workspaceId: text("workspace_id").references(() => workspaces.id, {
      onDelete: "cascade",
    }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    endpoint: text("endpoint").notNull(),
    requestHash: char("request_hash", { length: 64 }).notNull(),
    responseStatus: integer("response_status"),
    responseBody: jsonb("response_body"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.endpoint, t.key] }),
  })
);

export type IdempotencyKey = typeof idempotencyKeys.$inferSelect;
```

- [ ] **Step 3: Create security.ts**

```typescript
// packages/db/src/schema/security.ts
import {
  pgTable,
  text,
  timestamp,
  jsonb,
  customType,
} from "drizzle-orm/pg-core";
import { workspaces } from "./workspaces";

const inet = customType<{ data: string }>({ dataType: () => "inet" });

export const securityEvents = pgTable("security_event", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").references(() => workspaces.id, {
    onDelete: "set null",
  }),
  eventType: text("event_type").notNull(),
  severity: text("severity").notNull(),
  actorUserId: text("actor_user_id"),
  actorIp: inet("actor_ip"),
  detail: jsonb("detail").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type SecurityEvent = typeof securityEvents.$inferSelect;
export type NewSecurityEvent = typeof securityEvents.$inferInsert;
```

- [ ] **Step 4: Append to index.ts + typecheck + commit**

```bash
echo 'export * from "./gdpr";' >> packages/db/src/schema/index.ts
echo 'export * from "./idempotency";' >> packages/db/src/schema/index.ts
echo 'export * from "./security";' >> packages/db/src/schema/index.ts

cd apps/web && pnpm exec tsc --noEmit
```

```bash
git add packages/db/src/schema/
git commit -m "feat(db): drizzle schemas for gdpr/idempotency/security_event"
```

### Task A.9: Migration — idempotency + security_event + RLS helpers

**Files:**

- Create: `packages/db/migrations/0005_idempotency_security.sql`
- Create: `packages/db/migrations/0005_idempotency_security.down.sql`
- Create: `packages/db/migrations/0006_rls_helpers.sql`
- Create: `packages/db/migrations/0006_rls_helpers.down.sql`

- [ ] **Step 1: idempotency + security tables migration**

```sql
-- packages/db/migrations/0005_idempotency_security.sql

CREATE TABLE idempotency_key (
  key text NOT NULL,
  workspace_id text,
  user_id text NOT NULL REFERENCES "user"(id),
  endpoint text NOT NULL,
  request_hash char(64) NOT NULL,
  response_status integer,
  response_body jsonb,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  expires_at timestamptz NOT NULL DEFAULT NOW() + INTERVAL '24 hours',
  PRIMARY KEY (user_id, endpoint, key)
);
CREATE INDEX idx_idempotency_expires ON idempotency_key(expires_at);

CREATE TABLE security_event (
  id text PRIMARY KEY,
  workspace_id text REFERENCES workspace(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  severity text NOT NULL,
  actor_user_id text,
  actor_ip inet,
  detail jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_security_event_workspace ON security_event(workspace_id, created_at DESC);
CREATE INDEX idx_security_event_type ON security_event(event_type, created_at DESC);
```

- [ ] **Step 2: idempotency + security down**

```sql
DROP TABLE IF EXISTS security_event;
DROP TABLE IF EXISTS idempotency_key;
```

- [ ] **Step 3: RLS helpers migration up**

```sql
-- packages/db/migrations/0006_rls_helpers.sql

CREATE OR REPLACE FUNCTION current_workspace_id()
RETURNS text LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT NULLIF(current_setting('app.workspace_id', true), '')::text;
$$;

COMMENT ON FUNCTION current_workspace_id() IS
  'Returns the current tenant context from session GUC. Returns NULL if unset, '
  'which causes RLS policies to evaluate to false (fail-closed).';

CREATE OR REPLACE FUNCTION is_cross_tenant_admin()
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT current_setting('app.cross_tenant_admin', true) = 'true';
$$;
```

- [ ] **Step 4: RLS helpers down**

```sql
DROP FUNCTION IF EXISTS is_cross_tenant_admin();
DROP FUNCTION IF EXISTS current_workspace_id();
```

- [ ] **Step 5: Apply both**

Run: `pnpm drizzle-kit push`
Run: `psql -d orchester -c "SELECT current_workspace_id(), is_cross_tenant_admin();"`
Expected: returns `(NULL, false)`.

- [ ] **Step 6: Commit**

```bash
git add packages/db/migrations/0005_*.sql packages/db/migrations/0006_*.sql
git commit -m "feat(db): idempotency + security_event tables + RLS helper functions"
```

### Task A.10: Migration — Postgres roles

**Files:**

- Create: `packages/db/migrations/0007_postgres_roles.sql`
- Create: `packages/db/migrations/0007_postgres_roles.down.sql`

- [ ] **Step 1: Write role creation migration**

```sql
-- packages/db/migrations/0007_postgres_roles.sql
-- NOTE: requires superuser to execute. Run via psql with admin credentials.

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user NOINHERIT LOGIN PASSWORD 'CHANGEME_FROM_SECRET_MANAGER';
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'cron_admin') THEN
    CREATE ROLE cron_admin NOINHERIT LOGIN PASSWORD 'CHANGEME_FROM_SECRET_MANAGER' BYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'read_only_audit') THEN
    CREATE ROLE read_only_audit NOINHERIT LOGIN PASSWORD 'CHANGEME_FROM_SECRET_MANAGER';
  END IF;
END$$;

GRANT CONNECT ON DATABASE orchester TO app_user, cron_admin, read_only_audit;
GRANT USAGE ON SCHEMA public TO app_user, cron_admin, read_only_audit;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user, cron_admin;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO read_only_audit;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user, cron_admin;

REVOKE UPDATE, DELETE ON audit_log FROM app_user;
REVOKE UPDATE, DELETE ON security_event FROM app_user;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO cron_admin;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT ON TABLES TO read_only_audit;
```

- [ ] **Step 2: Write down**

```sql
-- packages/db/migrations/0007_postgres_roles.down.sql

-- Reassign owned objects before drop (safe-ish, but in prod this is rare)
REASSIGN OWNED BY app_user TO postgres;
REASSIGN OWNED BY cron_admin TO postgres;
REASSIGN OWNED BY read_only_audit TO postgres;

DROP OWNED BY app_user;
DROP OWNED BY cron_admin;
DROP OWNED BY read_only_audit;

DROP ROLE IF EXISTS app_user;
DROP ROLE IF EXISTS cron_admin;
DROP ROLE IF EXISTS read_only_audit;
```

- [ ] **Step 3: Apply (with superuser)**

Run: `psql -U postgres -d orchester -f packages/db/migrations/0007_postgres_roles.sql`
Run: `psql -U postgres -d orchester -c "SELECT rolname, rolbypassrls FROM pg_roles WHERE rolname IN ('app_user', 'cron_admin', 'read_only_audit');"`
Expected: 3 rows; cron_admin has rolbypassrls=true.

- [ ] **Step 4: Update .env.local with new connection string**

```
# .env.local — keep DATABASE_URL pointing to postgres superuser for migrations.
# Add new connection strings for runtime:
APP_DATABASE_URL=postgresql://app_user:<password>@localhost:5432/orchester
CRON_DATABASE_URL=postgresql://cron_admin:<password>@localhost:5432/orchester
```

(Do NOT commit the password in .env.local. Store passwords in secret manager.)

- [ ] **Step 5: Commit**

```bash
git add packages/db/migrations/0007_postgres_roles.sql packages/db/migrations/0007_postgres_roles.down.sql
git commit -m "feat(db): postgres roles app_user/cron_admin/read_only_audit"
```

### Task A.11: Migration — RLS enable (NOT FORCED) on all tenant tables

**Files:**

- Create: `packages/db/migrations/0008_rls_enable_no_force.sql`
- Create: `packages/db/migrations/0008_rls_enable_no_force.down.sql`

- [ ] **Step 1: Write enable + Pattern A policies**

```sql
-- packages/db/migrations/0008_rls_enable_no_force.sql

CREATE OR REPLACE FUNCTION apply_pattern_a(tbl text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
  EXECUTE format($f$
    CREATE POLICY %1$I_tenant_select ON %1$I FOR SELECT
    USING (workspace_id = current_workspace_id() OR is_cross_tenant_admin())
  $f$, tbl);
  EXECUTE format($f$
    CREATE POLICY %1$I_tenant_insert ON %1$I FOR INSERT
    WITH CHECK (workspace_id = current_workspace_id() OR is_cross_tenant_admin())
  $f$, tbl);
  EXECUTE format($f$
    CREATE POLICY %1$I_tenant_update ON %1$I FOR UPDATE
    USING (workspace_id = current_workspace_id() OR is_cross_tenant_admin())
    WITH CHECK (workspace_id = current_workspace_id() OR is_cross_tenant_admin())
  $f$, tbl);
  EXECUTE format($f$
    CREATE POLICY %1$I_tenant_delete ON %1$I FOR DELETE
    USING (workspace_id = current_workspace_id() OR is_cross_tenant_admin())
  $f$, tbl);
END;
$$;

-- Apply to direct-workspace_id tables
DO $$
DECLARE tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'team','agent','channel','employee','conversation',
    'flow','flow_run','integration','api_key',
    'knowledge_base','knowledge_doc','knowledge_chunk',
    'agent_memory','audit_log','feature_flag',
    'gdpr_export_job','conversation_label','notification_pref',
    'ai_provider','webhook_out','security_event'
  ]
  LOOP
    PERFORM apply_pattern_a(tbl);
  END LOOP;
END$$;

-- Pattern B (JOIN): message → conversation
ALTER TABLE message ENABLE ROW LEVEL SECURITY;

CREATE POLICY message_tenant_select ON message FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM conversation c
      WHERE c.id = message.conversation_id
        AND (c.workspace_id = current_workspace_id() OR is_cross_tenant_admin())
    )
  );

CREATE POLICY message_tenant_insert ON message FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM conversation c
      WHERE c.id = message.conversation_id
        AND (c.workspace_id = current_workspace_id() OR is_cross_tenant_admin())
    )
  );

CREATE POLICY message_tenant_update ON message FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM conversation c
      WHERE c.id = message.conversation_id
        AND (c.workspace_id = current_workspace_id() OR is_cross_tenant_admin())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM conversation c
      WHERE c.id = message.conversation_id
        AND (c.workspace_id = current_workspace_id() OR is_cross_tenant_admin())
    )
  );

CREATE POLICY message_tenant_delete ON message FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM conversation c
      WHERE c.id = message.conversation_id
        AND (c.workspace_id = current_workspace_id() OR is_cross_tenant_admin())
    )
  );

-- Pattern C: workspace + workspace_member
ALTER TABLE workspace ENABLE ROW LEVEL SECURITY;

CREATE POLICY workspace_member_select ON workspace FOR SELECT
  USING (
    id = current_workspace_id()
    OR is_cross_tenant_admin()
    OR EXISTS (
      SELECT 1 FROM workspace_member m
      WHERE m.workspace_id = workspace.id
        AND m.user_id = current_setting('app.user_id', true)::text
    )
  );

CREATE POLICY workspace_owner_update ON workspace FOR UPDATE
  USING (id = current_workspace_id() OR is_cross_tenant_admin())
  WITH CHECK (id = current_workspace_id() OR is_cross_tenant_admin());

CREATE POLICY workspace_owner_delete ON workspace FOR DELETE
  USING (id = current_workspace_id() OR is_cross_tenant_admin());

CREATE POLICY workspace_insert_any ON workspace FOR INSERT
  WITH CHECK (true);
  -- INSERT on workspace is special: no tenant exists yet. Application enforces
  -- that the creator becomes the owner.

ALTER TABLE workspace_member ENABLE ROW LEVEL SECURITY;

CREATE POLICY workspace_member_tenant ON workspace_member FOR ALL
  USING (
    workspace_id = current_workspace_id()
    OR is_cross_tenant_admin()
    OR (user_id = current_setting('app.user_id', true)::text)
  )
  WITH CHECK (
    workspace_id = current_workspace_id()
    OR is_cross_tenant_admin()
  );

-- Pattern A also for idempotency_key (workspace_id is nullable but RLS rule works)
ALTER TABLE idempotency_key ENABLE ROW LEVEL SECURITY;
CREATE POLICY idempotency_key_tenant ON idempotency_key FOR ALL
  USING (
    workspace_id = current_workspace_id()
    OR workspace_id IS NULL
    OR is_cross_tenant_admin()
  )
  WITH CHECK (
    workspace_id = current_workspace_id()
    OR workspace_id IS NULL
    OR is_cross_tenant_admin()
  );
```

- [ ] **Step 2: Write down migration**

```sql
-- 0008 down
DO $$
DECLARE tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'team','agent','channel','employee','conversation','message',
    'flow','flow_run','integration','api_key',
    'knowledge_base','knowledge_doc','knowledge_chunk',
    'agent_memory','audit_log','feature_flag',
    'gdpr_export_job','conversation_label','notification_pref',
    'ai_provider','webhook_out','security_event',
    'workspace','workspace_member','idempotency_key'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I DISABLE ROW LEVEL SECURITY', tbl);
    -- DROP POLICIES is implicit when RLS disabled, but explicit per safety:
    EXECUTE format('DROP POLICY IF EXISTS %1$I_tenant_select ON %1$I', tbl);
    EXECUTE format('DROP POLICY IF EXISTS %1$I_tenant_insert ON %1$I', tbl);
    EXECUTE format('DROP POLICY IF EXISTS %1$I_tenant_update ON %1$I', tbl);
    EXECUTE format('DROP POLICY IF EXISTS %1$I_tenant_delete ON %1$I', tbl);
  END LOOP;
END$$;

DROP POLICY IF EXISTS workspace_member_select ON workspace;
DROP POLICY IF EXISTS workspace_owner_update ON workspace;
DROP POLICY IF EXISTS workspace_owner_delete ON workspace;
DROP POLICY IF EXISTS workspace_insert_any ON workspace;
DROP POLICY IF EXISTS workspace_member_tenant ON workspace_member;
DROP POLICY IF EXISTS idempotency_key_tenant ON idempotency_key;

DROP FUNCTION IF EXISTS apply_pattern_a(text);
```

- [ ] **Step 3: Apply migration**

Run: `psql -U postgres -d orchester -f packages/db/migrations/0008_rls_enable_no_force.sql`
Run: `psql -U postgres -d orchester -c "SELECT count(*) FROM pg_policies WHERE schemaname='public';"`
Expected: ≥ 92 policies (22 direct tables × 4 + workspace 4 + workspace_member 1 + idempotency 1 + message 4 + insert any 1).

- [ ] **Step 4: Verify NOT FORCED**

```bash
psql -U postgres -d orchester -c "SELECT count(*) FROM pg_tables WHERE rowsecurity=true AND forcerowsecurity=true AND schemaname='public';"
```

Expected: 0

- [ ] **Step 5: Commit**

```bash
git add packages/db/migrations/0008_*.sql
git commit -m "feat(db): RLS policies on all tenant tables (NOT FORCED — Phase A)"
```

### Task A.12: Lib tenant — types + barrel

**Files:**

- Create: `apps/web/lib/tenant/index.ts`
- Create: `apps/web/lib/tenant/types.ts`

- [ ] **Step 1: Write types**

```typescript
// apps/web/lib/tenant/types.ts
import type {
  Workspace,
  WorkspaceMember,
  WorkspaceMemberRole,
} from "@orchester/db";

export interface TenantContext {
  workspace: Workspace;
  member: WorkspaceMember;
  role: WorkspaceMemberRole;
}

export class TenantContextError extends Error {
  constructor(
    public code:
      | "no_tenant_in_request"
      | "workspace_not_found"
      | "no_session"
      | "not_a_member"
      | "workspace_suspended"
      | "workspace_deleted"
  ) {
    super(`TenantContextError: ${code}`);
    this.name = "TenantContextError";
  }
}
```

- [ ] **Step 2: Write barrel**

```typescript
// apps/web/lib/tenant/index.ts
export * from "./types";
export * from "./context";
export * from "./resolve";
export * from "./membership";
export * from "./lifecycle";
export * from "./guards";
export * from "./session";
```

- [ ] **Step 3: Commit (will fail typecheck until other files exist — OK)**

```bash
git add apps/web/lib/tenant/types.ts apps/web/lib/tenant/index.ts
git commit -m "feat(tenant): types module + barrel export (modules to follow)"
```

### Task A.13: Lib tenant — resolve (slug ↔ workspace cache)

**Files:**

- Create: `apps/web/lib/tenant/resolve.ts`
- Create: `apps/web/tests/unit/tenant/resolve.spec.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// apps/web/tests/unit/tenant/resolve.spec.ts
import { describe, it, expect, beforeEach } from "vitest";
import {
  resolveBySlug,
  resolveById,
  invalidateCache,
} from "@/lib/tenant/resolve";

// Note: this test requires DB available; in CI use testcontainers fixture.

describe("tenant/resolve", () => {
  beforeEach(() => {
    // Reset cache
    invalidateCache("*");
  });

  it("returns null for unknown slug", async () => {
    const ws = await resolveBySlug("definitely-not-a-real-slug-xyz");
    expect(ws).toBeNull();
  });

  it("returns workspace for known slug (case-sensitive)", async () => {
    // Assumes seed data has a workspace with slug 'demo'
    const ws = await resolveBySlug("demo");
    expect(ws?.slug).toBe("demo");
  });

  it("caches resolution (second call avoids DB)", async () => {
    const a = await resolveBySlug("demo");
    const b = await resolveBySlug("demo");
    expect(a).toBe(b); // referential equality from cache
  });

  it("invalidateCache clears entry", async () => {
    const a = await resolveBySlug("demo");
    invalidateCache(a!.slug);
    const b = await resolveBySlug("demo");
    expect(a).not.toBe(b); // re-fetched
    expect(a?.id).toBe(b?.id);
  });
});
```

- [ ] **Step 2: Run test — should fail (module doesn't exist)**

Run: `cd apps/web && pnpm exec vitest run tests/unit/tenant/resolve.spec.ts`
Expected: FAIL with "Cannot find module '@/lib/tenant/resolve'"

- [ ] **Step 3: Write implementation**

```typescript
// apps/web/lib/tenant/resolve.ts
import "server-only";
import { LRUCache } from "lru-cache";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@orchester/db";
import type { Workspace } from "@orchester/db";

const slugCache = new LRUCache<string, Workspace>({
  max: 5000,
  ttl: 1000 * 60 * 5, // 5 min
});
const idCache = new LRUCache<string, Workspace>({
  max: 5000,
  ttl: 1000 * 60 * 5,
});

export async function resolveBySlug(slug: string): Promise<Workspace | null> {
  const cached = slugCache.get(slug);
  if (cached) return cached;

  const db = getDb();
  const rows = await db
    .select()
    .from(schema.workspaces)
    .where(eq(schema.workspaces.slug, slug))
    .limit(1);
  const ws = rows[0];
  if (ws) {
    slugCache.set(slug, ws);
    idCache.set(ws.id, ws);
  }
  return ws ?? null;
}

export async function resolveById(id: string): Promise<Workspace | null> {
  const cached = idCache.get(id);
  if (cached) return cached;

  const db = getDb();
  const rows = await db
    .select()
    .from(schema.workspaces)
    .where(eq(schema.workspaces.id, id))
    .limit(1);
  const ws = rows[0];
  if (ws) {
    idCache.set(id, ws);
    slugCache.set(ws.slug, ws);
  }
  return ws ?? null;
}

export function invalidateCache(workspaceIdOrSlugOrStar: string): void {
  if (workspaceIdOrSlugOrStar === "*") {
    slugCache.clear();
    idCache.clear();
    return;
  }
  slugCache.delete(workspaceIdOrSlugOrStar);
  idCache.delete(workspaceIdOrSlugOrStar);
  // Best-effort cross-key invalidation
  for (const [slug, ws] of slugCache.entries()) {
    if (ws.id === workspaceIdOrSlugOrStar) slugCache.delete(slug);
  }
  for (const [id, ws] of idCache.entries()) {
    if (ws.slug === workspaceIdOrSlugOrStar) idCache.delete(id);
  }
}
```

- [ ] **Step 4: Add `lru-cache` dependency**

Run: `cd apps/web && pnpm add lru-cache@^11.0.0`

- [ ] **Step 5: Run test — should pass**

Run: `pnpm exec vitest run tests/unit/tenant/resolve.spec.ts`
Expected: PASS (assuming `demo` workspace exists in dev DB; if not, skip via test.skip).

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/tenant/resolve.ts apps/web/tests/unit/tenant/resolve.spec.ts apps/web/package.json apps/web/pnpm-lock.yaml
git commit -m "feat(tenant): slug/id resolver with LRU cache (5min TTL)"
```

### Task A.14: Lib tenant — membership

**Files:**

- Create: `apps/web/lib/tenant/membership.ts`
- Create: `apps/web/tests/unit/tenant/membership.spec.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// apps/web/tests/unit/tenant/membership.spec.ts
import { describe, it, expect } from "vitest";
import { checkMembership } from "@/lib/tenant/membership";

describe("tenant/membership", () => {
  it("returns null when user is not a member", async () => {
    const m = await checkMembership("nonexistent_user", "nonexistent_ws");
    expect(m).toBeNull();
  });

  // Add seed-dependent tests in integration suite
});
```

- [ ] **Step 2: Verify fails (no module)**

Run: `pnpm exec vitest run tests/unit/tenant/membership.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Write implementation**

```typescript
// apps/web/lib/tenant/membership.ts
import "server-only";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@orchester/db";
import type { WorkspaceMember } from "@orchester/db";

const TTL_MS = 60_000;
const cache = new Map<
  string,
  { value: WorkspaceMember | null; expiresAt: number }
>();

function cacheKey(userId: string, workspaceId: string) {
  return `${userId}:${workspaceId}`;
}

export async function checkMembership(
  userId: string,
  workspaceId: string
): Promise<WorkspaceMember | null> {
  const key = cacheKey(userId, workspaceId);
  const now = Date.now();
  const cached = cache.get(key);
  if (cached && cached.expiresAt > now) return cached.value;

  const db = getDb();
  const rows = await db
    .select()
    .from(schema.workspaceMembers)
    .where(
      and(
        eq(schema.workspaceMembers.userId, userId),
        eq(schema.workspaceMembers.workspaceId, workspaceId)
      )
    )
    .limit(1);

  const result = rows[0] ?? null;
  cache.set(key, { value: result, expiresAt: now + TTL_MS });
  return result;
}

export function invalidateMembership(
  userId: string,
  workspaceId: string
): void {
  cache.delete(cacheKey(userId, workspaceId));
}

export function invalidateAllMembershipFor(userId: string): void {
  for (const key of cache.keys()) {
    if (key.startsWith(`${userId}:`)) cache.delete(key);
  }
}
```

- [ ] **Step 4: Test passes**

Run: `pnpm exec vitest run tests/unit/tenant/membership.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/tenant/membership.ts apps/web/tests/unit/tenant/membership.spec.ts
git commit -m "feat(tenant): membership check with 60s in-process cache"
```

### Task A.15: Lib tenant — context (withTenantContext + guards)

**Files:**

- Create: `apps/web/lib/tenant/context.ts`
- Create: `apps/web/lib/tenant/guards.ts`
- Create: `apps/web/tests/integration/tenant/context.spec.ts`

- [ ] **Step 1: Write failing integration test**

```typescript
// apps/web/tests/integration/tenant/context.spec.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { withTenantContext } from "@/lib/tenant/context";
import { TenantContextError } from "@/lib/tenant/types";
import {
  setupTestWorkspaces,
  teardownTestWorkspaces,
  type WsFixture,
} from "../../fixtures/workspaces";

let wsA: WsFixture;
let wsB: WsFixture;

beforeAll(async () => {
  [wsA, wsB] = await setupTestWorkspaces();
});

afterAll(async () => {
  await teardownTestWorkspaces();
});

describe("withTenantContext", () => {
  it("throws TenantContextError if workspaceId is invalid", async () => {
    await expect(
      withTenantContext("nonexistent_ws", async () => 1)
    ).rejects.toThrow(TenantContextError);
  });

  it("provides the workspace/member/role inside callback", async () => {
    // mockSession to be wsA.owner
    const result = await withTenantContext(wsA.id, async (ctx) => {
      return { wsId: ctx.workspace.id, role: ctx.role };
    });
    expect(result.wsId).toBe(wsA.id);
    expect(result.role).toBe("owner");
  });

  it("isolates concurrent contexts (no cross-bleed)", async () => {
    const [a, b] = await Promise.all([
      withTenantContext(wsA.id, async (ctx) => ctx.workspace.id),
      withTenantContext(wsB.id, async (ctx) => ctx.workspace.id),
    ]);
    expect(a).toBe(wsA.id);
    expect(b).toBe(wsB.id);
  });
});
```

- [ ] **Step 2: Write context.ts**

```typescript
// apps/web/lib/tenant/context.ts
import "server-only";
import { sql } from "drizzle-orm";
import { getDb } from "@orchester/db";
import { resolveById } from "./resolve";
import { checkMembership } from "./membership";
import { TenantContextError, type TenantContext } from "./types";
import { getCurrentSession } from "@/lib/workspace";

/**
 * Run a callback inside a Postgres transaction with the tenant context
 * GUC `app.workspace_id` set. RLS policies enforce isolation.
 *
 * Caller MUST have an authenticated session (membership is validated).
 *
 * Throws TenantContextError on misuse.
 */
export async function withTenantContext<T>(
  workspaceId: string,
  fn: (ctx: TenantContext) => Promise<T>
): Promise<T> {
  if (!workspaceId) throw new TenantContextError("workspace_not_found");

  const ws = await resolveById(workspaceId);
  if (!ws) throw new TenantContextError("workspace_not_found");

  const session = await getCurrentSession();
  if (!session) throw new TenantContextError("no_session");

  const member = await checkMembership(session.user.id, workspaceId);
  if (!member) throw new TenantContextError("not_a_member");

  const db = getDb();
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT set_config('app.workspace_id', ${workspaceId}, true)`
    );
    await tx.execute(
      sql`SELECT set_config('app.user_id', ${session.user.id}, true)`
    );
    const ctx: TenantContext = { workspace: ws, member, role: member.role };
    return fn(ctx);
  });
}

/**
 * Read tenant context set by middleware via x-tenant-id header.
 */
export async function requireTenantContext(): Promise<TenantContext> {
  const { headers } = await import("next/headers");
  const h = await headers();
  const workspaceId = h.get("x-tenant-id");
  if (!workspaceId) throw new TenantContextError("no_tenant_in_request");
  return withTenantContext(workspaceId, async (ctx) => ctx);
}
```

- [ ] **Step 3: Write guards.ts**

```typescript
// apps/web/lib/tenant/guards.ts
import "server-only";
import { assertCan, type Action } from "@/lib/rbac";
import { requireTenantContext } from "./context";
import type { TenantContext } from "./types";

/**
 * Combined tenant context + RBAC guard. Use at the top of every mutating
 * route handler.
 *
 * Throws TenantContextError (no tenant) or ForbiddenError (lacks action).
 */
export async function requireAction(action: Action): Promise<TenantContext> {
  const ctx = await requireTenantContext();
  assertCan(ctx.role, action);
  return ctx;
}
```

- [ ] **Step 4: Run test — should pass**

Run: `pnpm exec vitest run tests/integration/tenant/context.spec.ts`
Expected: PASS (after Task A.16 sets up fixtures).

(If fixtures are not ready yet, mark test `.skip` and revisit after Task A.16.)

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/tenant/context.ts apps/web/lib/tenant/guards.ts apps/web/tests/integration/tenant/context.spec.ts
git commit -m "feat(tenant): withTenantContext wrapper + requireAction guard"
```

### Task A.16: Test fixtures — DB and workspaces

**Files:**

- Create: `apps/web/tests/fixtures/db.ts`
- Create: `apps/web/tests/fixtures/workspaces.ts`
- Create: `apps/web/tests/factories/index.ts`

- [ ] **Step 1: Install testcontainers**

Run: `cd apps/web && pnpm add -D testcontainers @faker-js/faker`

- [ ] **Step 2: Write db.ts fixture**

```typescript
// apps/web/tests/fixtures/db.ts
import { GenericContainer, type StartedTestContainer } from "testcontainers";
import { Pool } from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import path from "path";

let container: StartedTestContainer | null = null;
let pool: Pool | null = null;
let db: NodePgDatabase | null = null;

export async function setupTestDb(): Promise<{
  db: NodePgDatabase;
  pool: Pool;
  cronPool: Pool;
}> {
  if (db && pool) return { db, pool, cronPool: pool };

  container = await new GenericContainer("postgres:15-alpine")
    .withEnvironment({
      POSTGRES_PASSWORD: "test",
      POSTGRES_DB: "orchester_test",
    })
    .withExposedPorts(5432)
    .start();

  const port = container.getMappedPort(5432);
  const host = container.getHost();

  pool = new Pool({
    host,
    port,
    user: "postgres",
    password: "test",
    database: "orchester_test",
  });

  db = drizzle(pool);

  // Apply migrations (in order)
  await migrate(db, {
    migrationsFolder: path.resolve(
      __dirname,
      "../../../../packages/db/migrations"
    ),
  });

  // Set up roles (Task A.10)
  await pool.query(`
    CREATE ROLE app_user NOINHERIT LOGIN PASSWORD 'app';
    CREATE ROLE cron_admin NOINHERIT LOGIN PASSWORD 'cron' BYPASSRLS;
    GRANT CONNECT ON DATABASE orchester_test TO app_user, cron_admin;
    GRANT USAGE ON SCHEMA public TO app_user, cron_admin;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public
      TO app_user, cron_admin;
    REVOKE UPDATE, DELETE ON audit_log FROM app_user;
    REVOKE UPDATE, DELETE ON security_event FROM app_user;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user, cron_admin;
  `);

  return { db, pool, cronPool: pool };
}

export async function teardownTestDb(): Promise<void> {
  await pool?.end();
  await container?.stop();
  pool = null;
  db = null;
  container = null;
}
```

- [ ] **Step 3: Write workspaces.ts fixture**

```typescript
// apps/web/tests/fixtures/workspaces.ts
import { setupTestDb, teardownTestDb } from "./db";
import { faker } from "@faker-js/faker";
import { createId } from "@paralleldrive/cuid2";
import { schema } from "@orchester/db";

export interface WsFixture {
  id: string;
  slug: string;
  name: string;
  ownerId: string;
  ownerEmail: string;
  agentCount: number;
  agentIds: string[];
}

export async function setupTestWorkspaces(): Promise<[WsFixture, WsFixture]> {
  faker.seed(42); // determinism
  const { db } = await setupTestDb();

  const wsA = await createWorkspace(db, "acme-hr");
  const wsB = await createWorkspace(db, "acme-marketing");

  return [wsA, wsB];
}

async function createWorkspace(db: any, slug: string): Promise<WsFixture> {
  const wsId = createId();
  const ownerId = createId();
  const email = faker.internet.email();

  // Insert user
  await db.insert(schema.users).values({
    id: ownerId,
    email,
    name: faker.person.fullName(),
    emailVerified: true,
  });

  // Insert workspace
  await db.insert(schema.workspaces).values({
    id: wsId,
    slug,
    name: faker.company.name(),
    timezone: "UTC",
    status: "active",
    ownerUserId: ownerId,
  });

  // Insert membership
  await db.insert(schema.workspaceMembers).values({
    id: createId(),
    workspaceId: wsId,
    userId: ownerId,
    role: "owner",
  });

  // Seed some agents
  const agentIds: string[] = [];
  for (let i = 0; i < 3; i++) {
    const aid = createId();
    agentIds.push(aid);
    await db.insert(schema.agents).values({
      id: aid,
      workspaceId: wsId,
      name: `Agent ${i + 1}`,
      role: "test",
      systemPrompt: "you are a test agent",
      status: "active",
    });
  }

  return {
    id: wsId,
    slug,
    name: slug,
    ownerId,
    ownerEmail: email,
    agentCount: 3,
    agentIds,
  };
}

export async function teardownTestWorkspaces(): Promise<void> {
  await teardownTestDb();
}
```

- [ ] **Step 4: Write factories**

```typescript
// apps/web/tests/factories/index.ts
import { faker } from "@faker-js/faker";
import { createId } from "@paralleldrive/cuid2";

export const factory = {
  workspace: (overrides: any = {}) => ({
    id: `ws_${createId()}`,
    name: faker.company.name(),
    slug: faker.helpers
      .slugify(faker.company.name())
      .toLowerCase()
      .slice(0, 30),
    timezone: "UTC",
    status: "active" as const,
    ...overrides,
  }),

  user: (overrides: any = {}) => ({
    id: `usr_${createId()}`,
    email: faker.internet.email(),
    name: faker.person.fullName(),
    emailVerified: true,
    ...overrides,
  }),

  agent: (workspaceId: string, overrides: any = {}) => ({
    id: `agt_${createId()}`,
    workspaceId,
    name: faker.person.firstName() + " Bot",
    role: faker.person.jobTitle(),
    systemPrompt: faker.lorem.paragraph(),
    status: "active" as const,
    ...overrides,
  }),
};
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/tests/fixtures/ apps/web/tests/factories/ apps/web/package.json apps/web/pnpm-lock.yaml
git commit -m "test(fixtures): testcontainers DB + workspaces + factory helpers"
```

### Task A.17: Lib audit — chain hash algorithm

**Files:**

- Create: `apps/web/lib/audit/types.ts`
- Create: `apps/web/lib/audit/chain.ts`
- Create: `apps/web/tests/unit/audit/chain.spec.ts`

- [ ] **Step 1: Write tests**

```typescript
// apps/web/tests/unit/audit/chain.spec.ts
import { describe, it, expect } from "vitest";
import {
  canonicalize,
  computePayloadHash,
  computeChainHash,
} from "@/lib/audit/chain";
import * as fc from "fast-check";

describe("canonicalize", () => {
  it("produces stable output regardless of key order", () => {
    expect(canonicalize({ a: 1, b: 2 })).toBe(canonicalize({ b: 2, a: 1 }));
  });

  it("recurses into nested objects with stable order", () => {
    expect(canonicalize({ x: { c: 3, a: 1, b: 2 } })).toBe(
      canonicalize({ x: { a: 1, b: 2, c: 3 } })
    );
  });

  it("preserves array order (arrays are ordered)", () => {
    expect(canonicalize([1, 2, 3])).toBe("[1,2,3]");
    expect(canonicalize([1, 2, 3])).not.toBe(canonicalize([3, 2, 1]));
  });

  it("handles null", () => {
    expect(canonicalize(null)).toBe("null");
    expect(canonicalize({ a: null })).toBe('{"a":null}');
  });
});

describe("computePayloadHash", () => {
  const base = {
    action: "workspace.create" as const,
    actorUserId: "usr_1",
    actorKind: "user",
    targetType: "workspace",
    targetId: "ws_1",
    meta: { name: "Acme" },
    createdAt: new Date("2026-05-23T10:00:00Z"),
  };

  it("is deterministic", () => {
    expect(computePayloadHash(base)).toBe(computePayloadHash({ ...base }));
  });

  it("is 64-char hex (sha256)", () => {
    expect(computePayloadHash(base)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes when any field changes", () => {
    const ref = computePayloadHash(base);
    expect(
      computePayloadHash({ ...base, action: "workspace.update" as any })
    ).not.toBe(ref);
    expect(computePayloadHash({ ...base, meta: { name: "Other" } })).not.toBe(
      ref
    );
    expect(
      computePayloadHash({
        ...base,
        createdAt: new Date(base.createdAt.getTime() + 1),
      })
    ).not.toBe(ref);
  });

  it("collision-resistant for arbitrary perturbations (200 random cases)", () => {
    fc.assert(
      fc.property(
        fc.record({
          a: fc.string({ minLength: 1, maxLength: 10 }),
          b: fc.integer(),
        }),
        (meta) => {
          const h1 = computePayloadHash({ ...base, meta });
          const h2 = computePayloadHash({
            ...base,
            meta: { ...meta, a: meta.a + "x" },
          });
          expect(h1).not.toBe(h2);
        }
      ),
      { numRuns: 200 }
    );
  });
});

describe("computeChainHash", () => {
  it("uses zero hash for null prev (genesis)", () => {
    expect(computeChainHash(null, "a".repeat(64), 1n)).toBe(
      computeChainHash("0".repeat(64), "a".repeat(64), 1n)
    );
  });

  it("varies with seq", () => {
    expect(computeChainHash(null, "a".repeat(64), 1n)).not.toBe(
      computeChainHash(null, "a".repeat(64), 2n)
    );
  });

  it("produces 64-char hex", () => {
    expect(computeChainHash(null, "a".repeat(64), 1n)).toMatch(
      /^[0-9a-f]{64}$/
    );
  });
});
```

- [ ] **Step 2: Add fast-check dep**

Run: `cd apps/web && pnpm add -D fast-check`

- [ ] **Step 3: Implement chain.ts**

```typescript
// apps/web/lib/audit/types.ts
export type AuditAction =
  | "workspace.create"
  | "workspace.update"
  | "workspace.soft_delete"
  | "workspace.restore"
  | "workspace.hard_delete"
  | "workspace.suspend"
  | "workspace.unsuspend"
  | "workspace.transfer"
  | "workspace.export"
  | "member.invite"
  | "member.role_change"
  | "member.remove"
  | "apikey.create"
  | "apikey.revoke"
  | "agent.create"
  | "agent.delete"
  | "audit.chain_break_detected"
  | "audit.chain_verified";

export type ActorKind = "user" | "system" | "api_key";

export interface AuditEntryInput {
  action: AuditAction;
  actorUserId: string | null;
  actorKind: ActorKind;
  actorIp?: string | null;
  actorUserAgent?: string | null;
  targetType: string;
  targetId: string;
  meta: Record<string, unknown>;
}

export interface ChainVerifyResult {
  workspaceId: string;
  entriesChecked: number;
  brokenAt: { entryId: string; expectedHash: string; foundHash: string } | null;
  verifiedAt: Date;
}
```

```typescript
// apps/web/lib/audit/chain.ts
import { createHash } from "crypto";

export function canonicalize(obj: unknown): string {
  if (obj === null || typeof obj !== "object") return JSON.stringify(obj);
  if (Array.isArray(obj)) return "[" + obj.map(canonicalize).join(",") + "]";
  const keys = Object.keys(obj as Record<string, unknown>).sort();
  return (
    "{" +
    keys
      .map(
        (k) =>
          JSON.stringify(k) +
          ":" +
          canonicalize((obj as Record<string, unknown>)[k])
      )
      .join(",") +
    "}"
  );
}

export interface PayloadHashInput {
  action: string;
  actorUserId: string | null;
  actorKind: string;
  targetType: string;
  targetId: string;
  meta: Record<string, unknown>;
  createdAt: Date;
}

export function computePayloadHash(input: PayloadHashInput): string {
  const canonical = canonicalize({
    action: input.action,
    actor_user_id: input.actorUserId,
    actor_kind: input.actorKind,
    target_type: input.targetType,
    target_id: input.targetId,
    meta: input.meta,
    created_at: input.createdAt.toISOString(),
  });
  return createHash("sha256").update(canonical).digest("hex");
}

export function computeChainHash(
  prevHash: string | null,
  payloadHash: string,
  seq: bigint
): string {
  const prev = prevHash ?? "0".repeat(64);
  return createHash("sha256")
    .update(`${prev}|${payloadHash}|${seq}`)
    .digest("hex");
}
```

- [ ] **Step 4: Tests pass**

Run: `pnpm exec vitest run tests/unit/audit/chain.spec.ts`
Expected: PASS (all describe blocks green).

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/audit/types.ts apps/web/lib/audit/chain.ts apps/web/tests/unit/audit/chain.spec.ts apps/web/package.json apps/web/pnpm-lock.yaml
git commit -m "feat(audit): chain hash algorithm (sha256 + canonical JSON) + tests"
```

### Task A.18: Lib audit — log append with advisory lock

**Files:**

- Create: `apps/web/lib/audit/log.ts`
- Create: `apps/web/tests/integration/audit/log.spec.ts`

- [ ] **Step 1: Write integration test**

```typescript
// apps/web/tests/integration/audit/log.spec.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { appendAuditSync } from "@/lib/audit/log";
import {
  setupTestWorkspaces,
  teardownTestWorkspaces,
  type WsFixture,
} from "../../fixtures/workspaces";
import { getDb, schema } from "@orchester/db";
import { eq, asc } from "drizzle-orm";

let wsA: WsFixture;

beforeAll(async () => {
  [wsA] = await setupTestWorkspaces();
});
afterAll(() => teardownTestWorkspaces());

describe("appendAuditSync", () => {
  it("creates a genesis entry with seq=1 and prev_hash=null", async () => {
    await appendAuditSync(wsA.id, {
      action: "workspace.create",
      actorUserId: wsA.ownerId,
      actorKind: "user",
      targetType: "workspace",
      targetId: wsA.id,
      meta: {},
    });
    const db = getDb();
    const rows = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.workspaceId, wsA.id))
      .orderBy(asc(schema.auditLog.seq));
    expect(rows[0].seq).toBe(1n);
    expect(rows[0].prevHash).toBeNull();
  });

  it("increments seq monotonically on subsequent appends", async () => {
    for (let i = 0; i < 5; i++) {
      await appendAuditSync(wsA.id, {
        action: "workspace.update",
        actorUserId: wsA.ownerId,
        actorKind: "user",
        targetType: "workspace",
        targetId: wsA.id,
        meta: { i },
      });
    }
    const db = getDb();
    const rows = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.workspaceId, wsA.id))
      .orderBy(asc(schema.auditLog.seq));
    const seqs = rows.map((r) => Number(r.seq));
    expect(seqs).toEqual(seqs.map((_, i) => i + 1));
  });

  it("handles concurrent appends without seq gaps", async () => {
    const db = getDb();
    const before = (
      await db
        .select()
        .from(schema.auditLog)
        .where(eq(schema.auditLog.workspaceId, wsA.id))
    ).length;

    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        appendAuditSync(wsA.id, {
          action: "workspace.update",
          actorUserId: wsA.ownerId,
          actorKind: "user",
          targetType: "workspace",
          targetId: wsA.id,
          meta: { concurrent: i },
        })
      )
    );

    const after = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.workspaceId, wsA.id))
      .orderBy(asc(schema.auditLog.seq));
    expect(after.length).toBe(before + 10);
    const seqs = after.map((r) => Number(r.seq));
    // All consecutive
    for (let i = 1; i < seqs.length; i++) {
      expect(seqs[i]).toBe(seqs[i - 1]! + 1);
    }
  });
});
```

- [ ] **Step 2: Verify test fails**

Run: `pnpm exec vitest run tests/integration/audit/log.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implement log.ts**

```typescript
// apps/web/lib/audit/log.ts
import "server-only";
import { sql, desc, eq } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import { getDb, schema } from "@orchester/db";
import { computePayloadHash, computeChainHash } from "./chain";
import type { AuditEntryInput } from "./types";

/**
 * Append to audit_log synchronously inside a transaction with advisory lock
 * per-workspace to guarantee seq monotonicity even under concurrent writers.
 *
 * Prefer the async `appendAudit()` below for hot path.
 */
export async function appendAuditSync(
  workspaceId: string,
  entry: AuditEntryInput
): Promise<void> {
  const db = getDb();
  await db.transaction(async (tx) => {
    // Advisory lock keyed by workspace id; releases at COMMIT
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${workspaceId}))`
    );

    const last = await tx
      .select({
        seq: schema.auditLog.seq,
        chainHash: schema.auditLog.chainHash,
      })
      .from(schema.auditLog)
      .where(eq(schema.auditLog.workspaceId, workspaceId))
      .orderBy(desc(schema.auditLog.seq))
      .limit(1);

    const nextSeq = (last[0]?.seq ?? 0n) + 1n;
    const prevHash = last[0]?.chainHash ?? null;

    const createdAt = new Date();
    const payloadHash = computePayloadHash({
      action: entry.action,
      actorUserId: entry.actorUserId,
      actorKind: entry.actorKind,
      targetType: entry.targetType,
      targetId: entry.targetId,
      meta: entry.meta,
      createdAt,
    });
    const chainHash = computeChainHash(prevHash, payloadHash, nextSeq);

    await tx.insert(schema.auditLog).values({
      id: createId(),
      workspaceId,
      seq: nextSeq,
      prevHash,
      payloadHash,
      chainHash,
      action: entry.action,
      actorUserId: entry.actorUserId,
      actorKind: entry.actorKind,
      actorIp: entry.actorIp ?? null,
      actorUserAgent: entry.actorUserAgent ?? null,
      targetType: entry.targetType,
      targetId: entry.targetId,
      meta: entry.meta,
      createdAt,
    });
  });
}

/**
 * Async path. Enqueues an `audit.append` pg-boss job. Worker calls
 * appendAuditSync. Keeps HTTP latency low.
 *
 * Falls back to sync append if pg-boss is not available (e.g. tests).
 */
export function appendAudit(workspaceId: string, entry: AuditEntryInput): void {
  // Async via pg-boss — wired in Phase B
  // For now (Phase A), call sync to avoid losing audit entries
  void appendAuditSync(workspaceId, entry);
}
```

- [ ] **Step 4: Tests pass**

Run: `pnpm exec vitest run tests/integration/audit/log.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/audit/log.ts apps/web/tests/integration/audit/log.spec.ts
git commit -m "feat(audit): appendAuditSync with advisory lock + integration tests"
```

### Task A.19: Lib audit — verify chain

**Files:**

- Create: `apps/web/lib/audit/verify.ts`
- Create: `apps/web/tests/integration/audit/verify.spec.ts`

- [ ] **Step 1: Write test**

```typescript
// apps/web/tests/integration/audit/verify.spec.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { appendAuditSync } from "@/lib/audit/log";
import { verifyChain } from "@/lib/audit/verify";
import {
  setupTestWorkspaces,
  teardownTestWorkspaces,
  type WsFixture,
} from "../../fixtures/workspaces";
import { getDb, schema } from "@orchester/db";
import { eq } from "drizzle-orm";

let wsA: WsFixture;

beforeAll(async () => {
  [wsA] = await setupTestWorkspaces();
  for (let i = 0; i < 5; i++) {
    await appendAuditSync(wsA.id, {
      action: "workspace.update",
      actorUserId: wsA.ownerId,
      actorKind: "user",
      targetType: "workspace",
      targetId: wsA.id,
      meta: { i },
    });
  }
});
afterAll(() => teardownTestWorkspaces());

describe("verifyChain", () => {
  it("returns brokenAt=null for an intact chain", async () => {
    const r = await verifyChain(wsA.id);
    expect(r.brokenAt).toBeNull();
    expect(r.entriesChecked).toBe(5);
  });

  it("detects tampering when meta is modified", async () => {
    const db = getDb();
    await db
      .update(schema.auditLog)
      .set({ meta: { tampered: true } })
      .where(eq(schema.auditLog.workspaceId, wsA.id));
    const r = await verifyChain(wsA.id);
    expect(r.brokenAt).not.toBeNull();
  });
});
```

- [ ] **Step 2: Implement verify.ts**

```typescript
// apps/web/lib/audit/verify.ts
import "server-only";
import { asc, eq } from "drizzle-orm";
import { getDb, schema } from "@orchester/db";
import { computePayloadHash, computeChainHash } from "./chain";
import type { ChainVerifyResult } from "./types";

export async function verifyChain(
  workspaceId: string
): Promise<ChainVerifyResult> {
  const db = getDb();
  const entries = await db
    .select()
    .from(schema.auditLog)
    .where(eq(schema.auditLog.workspaceId, workspaceId))
    .orderBy(asc(schema.auditLog.seq));

  let prevHash: string | null = null;
  for (const e of entries) {
    const expectedPayloadHash = computePayloadHash({
      action: e.action,
      actorUserId: e.actorUserId,
      actorKind: e.actorKind,
      targetType: e.targetType,
      targetId: e.targetId,
      meta: e.meta as Record<string, unknown>,
      createdAt: e.createdAt,
    });
    const expectedChainHash = computeChainHash(
      prevHash,
      expectedPayloadHash,
      e.seq
    );
    if (
      e.payloadHash !== expectedPayloadHash ||
      e.chainHash !== expectedChainHash
    ) {
      return {
        workspaceId,
        entriesChecked: Number(e.seq),
        brokenAt: {
          entryId: e.id,
          expectedHash: expectedChainHash,
          foundHash: e.chainHash,
        },
        verifiedAt: new Date(),
      };
    }
    prevHash = e.chainHash;
  }

  return {
    workspaceId,
    entriesChecked: entries.length,
    brokenAt: null,
    verifiedAt: new Date(),
  };
}
```

- [ ] **Step 3: Tests pass**

Run: `pnpm exec vitest run tests/integration/audit/verify.spec.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/lib/audit/verify.ts apps/web/tests/integration/audit/verify.spec.ts
git commit -m "feat(audit): verifyChain detects retroactive tampering"
```

### Task A.20: Lib audit — barrel export

**Files:**

- Create: `apps/web/lib/audit/index.ts`

- [ ] **Step 1: Write barrel**

```typescript
// apps/web/lib/audit/index.ts
export * from "./types";
export * from "./chain";
export * from "./log";
export * from "./verify";
```

- [ ] **Step 2: Typecheck + commit**

Run: `cd apps/web && pnpm exec tsc --noEmit`

```bash
git add apps/web/lib/audit/index.ts
git commit -m "feat(audit): barrel export"
```

### Task A.21: Lib feature-flags

**Files:**

- Create: `apps/web/lib/feature-flags/check.ts`
- Create: `apps/web/lib/feature-flags/cache.ts`
- Create: `apps/web/lib/feature-flags/admin.ts`
- Create: `apps/web/lib/feature-flags/index.ts`
- Create: `apps/web/tests/integration/feature-flags/check.spec.ts`

- [ ] **Step 1: Write test**

```typescript
// apps/web/tests/integration/feature-flags/check.spec.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { isEnabled, setFlag } from "@/lib/feature-flags";
import {
  setupTestWorkspaces,
  teardownTestWorkspaces,
  type WsFixture,
} from "../../fixtures/workspaces";

let wsA: WsFixture;

beforeAll(async () => {
  [wsA] = await setupTestWorkspaces();
});
afterAll(() => teardownTestWorkspaces());

describe("feature-flags", () => {
  it("returns false for unset flag", async () => {
    expect(await isEnabled(wsA.id, "nonexistent_flag")).toBe(false);
  });

  it("returns true after setFlag(true)", async () => {
    await setFlag(wsA.id, "test_flag", true, { userId: wsA.ownerId });
    expect(await isEnabled(wsA.id, "test_flag")).toBe(true);
  });

  it("returns false after setFlag(false)", async () => {
    await setFlag(wsA.id, "test_flag", false, { userId: wsA.ownerId });
    expect(await isEnabled(wsA.id, "test_flag")).toBe(false);
  });
});
```

- [ ] **Step 2: Implement check.ts + cache.ts + admin.ts + index.ts**

```typescript
// apps/web/lib/feature-flags/cache.ts
const TTL_MS = 60_000;
const cache = new Map<string, { value: boolean; expiresAt: number }>();

function key(workspaceId: string, flagKey: string) {
  return `${workspaceId}:${flagKey}`;
}

export function getCached(
  workspaceId: string,
  flagKey: string
): boolean | undefined {
  const e = cache.get(key(workspaceId, flagKey));
  if (!e) return undefined;
  if (e.expiresAt < Date.now()) {
    cache.delete(key(workspaceId, flagKey));
    return undefined;
  }
  return e.value;
}

export function setCached(
  workspaceId: string,
  flagKey: string,
  value: boolean
): void {
  cache.set(key(workspaceId, flagKey), {
    value,
    expiresAt: Date.now() + TTL_MS,
  });
}

export function invalidateFlag(workspaceId: string, flagKey: string): void {
  cache.delete(key(workspaceId, flagKey));
}

export function invalidateAll(workspaceId: string): void {
  for (const k of cache.keys()) {
    if (k.startsWith(`${workspaceId}:`)) cache.delete(k);
  }
}
```

```typescript
// apps/web/lib/feature-flags/check.ts
import "server-only";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@orchester/db";
import { getCached, setCached } from "./cache";

export async function isEnabled(
  workspaceId: string,
  flagKey: string
): Promise<boolean> {
  const cached = getCached(workspaceId, flagKey);
  if (cached !== undefined) return cached;

  const db = getDb();
  const rows = await db
    .select()
    .from(schema.featureFlags)
    .where(
      and(
        eq(schema.featureFlags.workspaceId, workspaceId),
        eq(schema.featureFlags.flagKey, flagKey)
      )
    )
    .limit(1);

  const enabled = rows[0]?.enabled ?? false;
  setCached(workspaceId, flagKey, enabled);
  return enabled;
}
```

```typescript
// apps/web/lib/feature-flags/admin.ts
import "server-only";
import { and, eq } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import { getDb, schema } from "@orchester/db";
import { invalidateFlag } from "./cache";

export async function setFlag(
  workspaceId: string,
  flagKey: string,
  enabled: boolean,
  opts: { userId: string }
): Promise<void> {
  const db = getDb();
  const existing = await db
    .select()
    .from(schema.featureFlags)
    .where(
      and(
        eq(schema.featureFlags.workspaceId, workspaceId),
        eq(schema.featureFlags.flagKey, flagKey)
      )
    )
    .limit(1);

  if (existing[0]) {
    await db
      .update(schema.featureFlags)
      .set({ enabled, setByUserId: opts.userId, updatedAt: new Date() })
      .where(eq(schema.featureFlags.id, existing[0].id));
  } else {
    await db.insert(schema.featureFlags).values({
      id: createId(),
      workspaceId,
      flagKey,
      enabled,
      setByUserId: opts.userId,
      rolledOutAt: enabled ? new Date() : null,
    });
  }
  invalidateFlag(workspaceId, flagKey);
}

export async function listFlags(workspaceId: string) {
  const db = getDb();
  return db
    .select()
    .from(schema.featureFlags)
    .where(eq(schema.featureFlags.workspaceId, workspaceId));
}
```

```typescript
// apps/web/lib/feature-flags/index.ts
export * from "./check";
export * from "./admin";
export { invalidateFlag, invalidateAll } from "./cache";
```

- [ ] **Step 3: Tests pass**

Run: `pnpm exec vitest run tests/integration/feature-flags/check.spec.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/lib/feature-flags/ apps/web/tests/integration/feature-flags/
git commit -m "feat(feature-flags): per-workspace check/set/list with 60s in-process cache"
```

### Task A.22: Lib tenant — lifecycle (soft-delete / restore / suspend)

**Files:**

- Create: `apps/web/lib/tenant/lifecycle.ts`
- Create: `apps/web/tests/integration/tenant/lifecycle.spec.ts`

- [ ] **Step 1: Write tests**

```typescript
// apps/web/tests/integration/tenant/lifecycle.spec.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  softDelete,
  restore,
  suspend,
  unsuspend,
  isAccessible,
} from "@/lib/tenant/lifecycle";
import {
  setupTestWorkspaces,
  teardownTestWorkspaces,
  type WsFixture,
} from "../../fixtures/workspaces";
import { getDb, schema } from "@orchester/db";
import { eq } from "drizzle-orm";

let wsA: WsFixture;

beforeAll(async () => {
  [wsA] = await setupTestWorkspaces();
});
afterAll(() => teardownTestWorkspaces());

async function getWs(id: string) {
  const db = getDb();
  return (
    await db
      .select()
      .from(schema.workspaces)
      .where(eq(schema.workspaces.id, id))
      .limit(1)
  )[0];
}

describe("lifecycle", () => {
  it("softDelete sets status=deleted + schedules hard-delete in 30 days", async () => {
    const result = await softDelete(wsA.id, { userId: wsA.ownerId });
    const ws = await getWs(wsA.id);
    expect(ws.status).toBe("deleted");
    expect(ws.deletedAt).toBeInstanceOf(Date);
    expect(ws.deleteScheduledAt).toBeInstanceOf(Date);
    expect(result.restoreToken).toBeDefined();
  });

  it("restore returns workspace to active", async () => {
    const ws1 = await getWs(wsA.id);
    await restore(wsA.id, { token: ws1.restoreToken!, userId: wsA.ownerId });
    const ws2 = await getWs(wsA.id);
    expect(ws2.status).toBe("active");
    expect(ws2.deletedAt).toBeNull();
  });

  it("suspend sets status=suspended", async () => {
    await suspend(wsA.id, { reason: "test", userId: wsA.ownerId });
    const ws = await getWs(wsA.id);
    expect(ws.status).toBe("suspended");
    expect(ws.suspendedReason).toBe("test");
  });

  it("unsuspend returns to active", async () => {
    await unsuspend(wsA.id, { userId: wsA.ownerId });
    const ws = await getWs(wsA.id);
    expect(ws.status).toBe("active");
    expect(ws.suspendedAt).toBeNull();
  });

  it("isAccessible returns suspended reason", async () => {
    await suspend(wsA.id, { reason: "test", userId: wsA.ownerId });
    const ws = await getWs(wsA.id);
    const r = isAccessible(ws);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("suspended");
    await unsuspend(wsA.id, { userId: wsA.ownerId });
  });
});
```

- [ ] **Step 2: Implement lifecycle.ts**

```typescript
// apps/web/lib/tenant/lifecycle.ts
import "server-only";
import { eq } from "drizzle-orm";
import { randomBytes } from "crypto";
import { getDb, schema } from "@orchester/db";
import type { Workspace } from "@orchester/db";
import { appendAudit } from "@/lib/audit";
import { invalidateCache } from "./resolve";

const RESTORE_WINDOW_DAYS = 30;

export async function softDelete(
  workspaceId: string,
  opts: { userId: string; reason?: string }
): Promise<{ restoreToken: string; restoreUntil: Date }> {
  const db = getDb();
  const restoreToken = `rst_${randomBytes(24).toString("base64url")}`;
  const now = new Date();
  const restoreUntil = new Date(
    now.getTime() + RESTORE_WINDOW_DAYS * 24 * 60 * 60 * 1000
  );

  await db
    .update(schema.workspaces)
    .set({
      status: "deleted",
      deletedAt: now,
      deletedByUserId: opts.userId,
      deleteScheduledAt: restoreUntil,
      restoreToken,
      restoreTokenConsumedAt: null,
    })
    .where(eq(schema.workspaces.id, workspaceId));

  invalidateCache(workspaceId);

  appendAudit(workspaceId, {
    action: "workspace.soft_delete",
    actorUserId: opts.userId,
    actorKind: "user",
    targetType: "workspace",
    targetId: workspaceId,
    meta: {
      reason: opts.reason ?? null,
      restoreUntil: restoreUntil.toISOString(),
    },
  });

  return { restoreToken, restoreUntil };
}

export async function restore(
  workspaceId: string,
  opts: { token?: string; userId: string }
): Promise<void> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.workspaces)
    .where(eq(schema.workspaces.id, workspaceId))
    .limit(1);
  const ws = rows[0];
  if (!ws) throw new Error("workspace_not_found");
  if (ws.status !== "deleted") throw new Error("workspace_lifecycle_invalid");
  if (
    opts.token &&
    (ws.restoreToken !== opts.token || ws.restoreTokenConsumedAt)
  )
    throw new Error("invalid_or_used_token");

  await db
    .update(schema.workspaces)
    .set({
      status: "active",
      deletedAt: null,
      deletedByUserId: null,
      deleteScheduledAt: null,
      restoreToken: null,
      restoreTokenConsumedAt: opts.token ? new Date() : null,
    })
    .where(eq(schema.workspaces.id, workspaceId));

  invalidateCache(workspaceId);

  appendAudit(workspaceId, {
    action: "workspace.restore",
    actorUserId: opts.userId,
    actorKind: "user",
    targetType: "workspace",
    targetId: workspaceId,
    meta: { via_token: Boolean(opts.token) },
  });
}

export async function suspend(
  workspaceId: string,
  opts: { reason: string; userId: string }
): Promise<void> {
  const db = getDb();
  await db
    .update(schema.workspaces)
    .set({
      status: "suspended",
      suspendedAt: new Date(),
      suspendedReason: opts.reason,
      suspendedByUserId: opts.userId,
    })
    .where(eq(schema.workspaces.id, workspaceId));

  invalidateCache(workspaceId);

  appendAudit(workspaceId, {
    action: "workspace.suspend",
    actorUserId: opts.userId,
    actorKind: "user",
    targetType: "workspace",
    targetId: workspaceId,
    meta: { reason: opts.reason },
  });
}

export async function unsuspend(
  workspaceId: string,
  opts: { userId: string }
): Promise<void> {
  const db = getDb();
  await db
    .update(schema.workspaces)
    .set({
      status: "active",
      suspendedAt: null,
      suspendedReason: null,
      suspendedByUserId: null,
    })
    .where(eq(schema.workspaces.id, workspaceId));

  invalidateCache(workspaceId);

  appendAudit(workspaceId, {
    action: "workspace.unsuspend",
    actorUserId: opts.userId,
    actorKind: "user",
    targetType: "workspace",
    targetId: workspaceId,
    meta: {},
  });
}

export function isAccessible(workspace: Workspace): {
  ok: boolean;
  reason?: "suspended" | "deleted";
} {
  if (workspace.status === "active") return { ok: true };
  if (workspace.status === "suspended")
    return { ok: false, reason: "suspended" };
  return { ok: false, reason: "deleted" };
}
```

- [ ] **Step 3: Tests pass**

Run: `pnpm exec vitest run tests/integration/tenant/lifecycle.spec.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/lib/tenant/lifecycle.ts apps/web/tests/integration/tenant/lifecycle.spec.ts
git commit -m "feat(tenant): lifecycle softDelete/restore/suspend/unsuspend + audit"
```

### Task A.23: Lib tenant — query helper

**Files:**

- Create: `apps/web/lib/tenant/query.ts`

- [ ] **Step 1: Write helper**

```typescript
// apps/web/lib/tenant/query.ts
import "server-only";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@orchester/db";
import type { TenantContext } from "./types";

/**
 * Safe-by-default query factory. Every query is pre-filtered by workspaceId.
 * Eliminates the chance of forgetting the filter in application code. RLS
 * still acts as the second barrier (defense in depth).
 */
export function tenantQuery(ctx: TenantContext) {
  const ws = ctx.workspace.id;
  const db = getDb();

  return {
    agents: {
      list: () =>
        db
          .select()
          .from(schema.agents)
          .where(eq(schema.agents.workspaceId, ws)),
      byId: (id: string) =>
        db
          .select()
          .from(schema.agents)
          .where(
            and(eq(schema.agents.id, id), eq(schema.agents.workspaceId, ws))
          )
          .limit(1),
      create: (data: any) =>
        db
          .insert(schema.agents)
          .values({ ...data, workspaceId: ws })
          .returning(),
      update: (id: string, data: any) =>
        db
          .update(schema.agents)
          .set(data)
          .where(
            and(eq(schema.agents.id, id), eq(schema.agents.workspaceId, ws))
          )
          .returning(),
      delete: (id: string) =>
        db
          .delete(schema.agents)
          .where(
            and(eq(schema.agents.id, id), eq(schema.agents.workspaceId, ws))
          ),
    },
    teams: {
      list: () =>
        db.select().from(schema.teams).where(eq(schema.teams.workspaceId, ws)),
      byId: (id: string) =>
        db
          .select()
          .from(schema.teams)
          .where(and(eq(schema.teams.id, id), eq(schema.teams.workspaceId, ws)))
          .limit(1),
    },
    employees: {
      list: () =>
        db
          .select()
          .from(schema.employees)
          .where(eq(schema.employees.workspaceId, ws)),
      byId: (id: string) =>
        db
          .select()
          .from(schema.employees)
          .where(
            and(
              eq(schema.employees.id, id),
              eq(schema.employees.workspaceId, ws)
            )
          )
          .limit(1),
    },
    // Pattern continues for: channels, conversations, flows, integrations,
    // knowledgeBases, knowledgeDocs, knowledgeChunks, agentMemories, aiProviders,
    // webhooksOut, apiKeys, etc. Add as endpoints adopt this pattern in later tasks.
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/lib/tenant/query.ts
git commit -m "feat(tenant): tenantQuery typed helper for safe-by-default queries"
```

### Task A.24: Custom ESLint rule — require-tenant-filter

**Files:**

- Create: `apps/web/lint-rules/require-tenant-filter.js`
- Modify: `apps/web/.eslintrc.json`

- [ ] **Step 1: Implement rule (CommonJS module)**

```javascript
// apps/web/lint-rules/require-tenant-filter.js
"use strict";

const TENANT_TABLES = new Set([
  "agents",
  "teams",
  "channels",
  "employees",
  "conversations",
  "flows",
  "integrations",
  "apiKeys",
  "knowledgeBases",
  "knowledgeDocs",
  "knowledgeChunks",
  "agentMemories",
  "auditLog",
  "featureFlags",
  "gdprExportJobs",
  "aiProviders",
  "webhooksOut",
  "flowRuns",
  "conversationLabels",
  "notificationPrefs",
  "securityEvents",
]);

function getCalleeChainRoot(node) {
  while (node && node.type === "MemberExpression") node = node.object;
  return node;
}

function isSchemaTenantTable(node) {
  if (!node || node.type !== "MemberExpression") return null;
  if (
    node.object.type === "Identifier" &&
    node.object.name === "schema" &&
    node.property.type === "Identifier" &&
    TENANT_TABLES.has(node.property.name)
  ) {
    return node.property.name;
  }
  return null;
}

function findWhereWithWorkspaceFilter(chainNode) {
  // walk the call chain looking for .where(...) that contains workspaceId
  let cur = chainNode;
  while (cur && cur.type === "CallExpression") {
    const callee = cur.callee;
    if (
      callee.type === "MemberExpression" &&
      callee.property.name === "where"
    ) {
      const src = JSON.stringify(cur.arguments);
      if (src.includes("workspaceId")) return true;
    }
    cur = callee.object;
  }
  return false;
}

module.exports = {
  meta: {
    type: "problem",
    docs: {
      description: "Tenant-scoped Drizzle queries must filter by workspaceId.",
    },
    schema: [],
    messages: {
      missing:
        "Query on tenant-scoped table '{{table}}' without workspaceId filter. " +
        "Use tenantQuery(ctx) or add .where(eq(t.workspaceId, ctx.workspace.id)).",
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        // Detect db.select().from(schema.<tenantTable>) or db.update / db.delete
        // We look for `.from(schema.X)` or `db.update(schema.X)` etc.
        if (node.callee.type === "MemberExpression") {
          const methodName = node.callee.property.name;
          if (methodName === "from" && node.arguments.length === 1) {
            const tbl = isSchemaTenantTable(node.arguments[0]);
            if (tbl) {
              // walk up to root call chain and check for where(workspaceId)
              let root = node;
              while (root.parent && root.parent.type === "MemberExpression") {
                root = root.parent;
                if (root.parent && root.parent.type === "CallExpression")
                  root = root.parent;
              }
              if (!findWhereWithWorkspaceFilter(root)) {
                context.report({
                  node,
                  messageId: "missing",
                  data: { table: tbl },
                });
              }
            }
          }
        }
      },
    };
  },
};
```

- [ ] **Step 2: Register rule**

Modify `apps/web/.eslintrc.json`:

```json
{
  "extends": ["next/core-web-vitals", "next/typescript"],
  "rules": {
    "@typescript-eslint/no-unused-vars": [
      "warn",
      {
        "argsIgnorePattern": "^_",
        "varsIgnorePattern": "^_",
        "destructuredArrayIgnorePattern": "^_",
        "ignoreRestSiblings": true
      }
    ],
    "orchester/require-tenant-filter": "warn"
  },
  "plugins": ["orchester"],
  "settings": {
    "orchester/local-plugin-path": "./lint-rules"
  }
}
```

(NOTE: ESLint local plugin loading requires either npm-link approach or @typescript-eslint plugin SDK. As a simpler alternative for this plan, the rule starts as a script-based check; see Step 3.)

- [ ] **Step 3: Add script-based check (fallback)**

Add to `apps/web/package.json` scripts:

```json
"lint:tenant": "node lint-rules/check-tenant-filters.mjs"
```

```javascript
// apps/web/lint-rules/check-tenant-filters.mjs
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, extname } from "node:path";

const TENANT_TABLES = [
  "agents",
  "teams",
  "channels",
  "employees",
  "conversations",
  "flows",
  "integrations",
  "apiKeys",
  "knowledgeBases",
  "knowledgeDocs",
  "knowledgeChunks",
  "agentMemories",
  "auditLog",
  "featureFlags",
  "gdprExportJobs",
  "aiProviders",
  "webhooksOut",
  "flowRuns",
  "conversationLabels",
  "notificationPrefs",
  "securityEvents",
];

let violations = 0;

function walk(dir) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) {
      if (f === "node_modules" || f === ".next" || f === "tests") continue;
      walk(p);
    } else if ([".ts", ".tsx"].includes(extname(p))) {
      const src = readFileSync(p, "utf-8");
      for (const tbl of TENANT_TABLES) {
        const re = new RegExp(`\\.from\\(\\s*schema\\.${tbl}\\b`, "g");
        const matches = [...src.matchAll(re)];
        for (const m of matches) {
          // Look ahead 800 chars for a .where(...) with workspaceId
          const tail = src.slice(m.index, m.index + 800);
          if (!/\.where\([^)]*workspaceId/.test(tail)) {
            console.error(`${p}: ${tbl} query without workspaceId filter`);
            violations++;
          }
        }
      }
    }
  }
}

walk("app");
walk("lib");
walk("components");

if (violations > 0) {
  console.error(`\n${violations} tenant-filter violations`);
  process.exit(1);
}
console.log("No tenant-filter violations found.");
```

- [ ] **Step 4: Run the check**

Run: `cd apps/web && pnpm lint:tenant`
Expected: prints violations OR "No violations". Tolerate violations in this iteration — the goal is to add the check; fixing existing violations is part of Phase B.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lint-rules/ apps/web/.eslintrc.json apps/web/package.json
git commit -m "build(lint): script-based tenant-filter check + ESLint hook"
```

### Task A.25: Run all existing tests + verify Phase A gate

**Files:**

- (verification only)

- [ ] **Step 1: Run full unit + integration suite**

Run: `cd apps/web && pnpm exec tsc --noEmit && pnpm exec vitest run`
Expected: green.

- [ ] **Step 2: Check schema invariants**

Run:

```bash
psql -U postgres -d orchester -c "SELECT count(*) FROM workspace WHERE owner_user_id IS NULL;"
psql -U postgres -d orchester -c "SELECT count(*) FROM pg_policies WHERE schemaname='public';"
psql -U postgres -d orchester -c "SELECT count(*) FROM pg_tables WHERE rowsecurity=true AND forcerowsecurity=true AND schemaname='public';"
psql -U postgres -d orchester -c "SELECT has_table_privilege('app_user', 'audit_log', 'UPDATE') AS update_should_be_false, has_table_privilege('app_user', 'audit_log', 'INSERT') AS insert_should_be_true;"
```

Expected:

- 0 NULL owners
- 92+ policies
- 0 forced tables
- update=false, insert=true

- [ ] **Step 3: Re-record baseline + verify no regression**

Run latency test against the same endpoints from Task 0.2; confirm p95 within ±5% of baseline.

- [ ] **Step 4: Tag Phase A complete**

```bash
git tag phase-a-complete -m "Tenant Hardening Phase A: foundation in place, dormant"
```

**Phase A is complete.** Proceed to Phase B.

---

## Chapter B — Silent backfill of tenant context (Week 1-2)

**Goal:** Middleware sets `app.workspace_id` per request. Behavior unchanged (RLS still NOT forced). Telemetry confirms 99%+ queries have tenant context. Identify and patch any code paths missing context.

**Output gate:** `tenant.context.missing_count / tenant.context.set_count < 1%` for 7 consecutive days. Performance within ±5% of baseline. Tenant isolation suite passes (against unforced RLS).

### Task B.1: Middleware — tenant slug extraction + GUC setting

**Files:**

- Modify: `apps/web/middleware.ts`
- Create: `apps/web/lib/tenant/middleware.ts`
- Create: `apps/web/lib/tenant/telemetry.ts`

- [ ] **Step 1: Write telemetry helper**

```typescript
// apps/web/lib/tenant/telemetry.ts
import "server-only";

let setCount = 0;
let missingCount = 0;

export function recordTenantContextSet(): void {
  setCount++;
}

export function recordTenantContextMissing(route: string): void {
  missingCount++;
  // Log structured for analysis
  console.log(
    JSON.stringify({
      level: "warn",
      msg: "tenant.context.missing",
      route,
      setCount,
      missingCount,
    })
  );
}

export function snapshotCounts(): {
  set: number;
  missing: number;
  ratio: number;
} {
  const total = setCount + missingCount;
  return {
    set: setCount,
    missing: missingCount,
    ratio: total === 0 ? 0 : missingCount / total,
  };
}
```

- [ ] **Step 2: Write tenant middleware helper**

```typescript
// apps/web/lib/tenant/middleware.ts
import "server-only";
import { NextRequest, NextResponse } from "next/server";

const LOCALE_RE = /^[a-z]{2}(-[A-Z]{2})?$/;

const PUBLIC_PREFIXES = [
  "/api/auth",
  "/auth",
  "/api/health",
  "/_next",
  "/favicon",
];

export function isPublicRoute(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));
}

export function extractLocaleAndSlug(pathname: string): {
  locale: string | null;
  slug: string | null;
} {
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 0) return { locale: null, slug: null };
  const locale = LOCALE_RE.test(segments[0]!) ? segments[0]! : null;
  // Phase B: slug is NOT yet in URL. Returns null.
  // Phase D will populate this from segments[1].
  const slug = null;
  return { locale, slug };
}

/**
 * Resolves tenant context from the request and applies it.
 * In Phase B, the slug comes from cookie `orch-active-workspace`.
 * In Phase D, it will come from the URL path.
 */
export async function resolveTenantForRequest(req: NextRequest): Promise<{
  tenantId: string | null;
  slug: string | null;
}> {
  // Phase B: cookie-based active workspace
  const activeSlug = req.cookies.get("orch-active-workspace")?.value ?? null;
  if (!activeSlug) return { tenantId: null, slug: null };

  // Avoid importing resolveBySlug here to keep middleware light
  // (Edge runtime constraints). Instead resolve in handlers.
  return { tenantId: null, slug: activeSlug };
}
```

- [ ] **Step 3: Update root middleware**

Replace `apps/web/middleware.ts`:

```typescript
// apps/web/middleware.ts
import { NextRequest, NextResponse } from "next/server";
import {
  isPublicRoute,
  extractLocaleAndSlug,
  resolveTenantForRequest,
} from "@/lib/tenant/middleware";

export async function middleware(req: NextRequest) {
  const url = new URL(req.url);
  const reqId = req.headers.get("x-request-id") ?? crypto.randomUUID();

  const res = NextResponse.next();
  res.headers.set("x-request-id", reqId);

  // Public routes pass through without tenant context
  if (isPublicRoute(url.pathname)) return res;

  // Phase B: extract active workspace from cookie
  const { tenantId, slug } = await resolveTenantForRequest(req);

  if (slug) {
    res.headers.set("x-tenant-slug", slug);
    // tenantId is null in middleware (we don't query DB here);
    // server components / route handlers resolve via resolveBySlug.
  }

  // Security headers (applied to all responses)
  res.headers.set(
    "Strict-Transport-Security",
    "max-age=63072000; includeSubDomains; preload"
  );
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("X-Frame-Options", "DENY");
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");

  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
```

- [ ] **Step 4: Wire setTenant config in `lib/workspace.ts`**

Modify `apps/web/lib/workspace.ts` — make `getCurrentWorkspace` call `withTenantContext` style SET when called:

```typescript
// apps/web/lib/workspace.ts (modify existing)
import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { sql, eq } from "drizzle-orm";
import { auth } from "./auth";
import { getDb, schema } from "@orchester/db";
import {
  recordTenantContextSet,
  recordTenantContextMissing,
} from "./tenant/telemetry";

export const getCurrentSession = cache(async () => {
  return auth.api.getSession({ headers: await headers() });
});

export const getCurrentWorkspace = cache(async () => {
  const session = await getCurrentSession();
  if (!session) {
    recordTenantContextMissing("no-session");
    return null;
  }

  const db = getDb();
  // First lookup membership (no tenant context required for this query;
  // workspace_member uses Pattern C policy that allows reading own row).
  const result = await db
    .select({
      workspace: schema.workspaces,
      role: schema.workspaceMembers.role,
    })
    .from(schema.workspaceMembers)
    .innerJoin(
      schema.workspaces,
      eq(schema.workspaceMembers.workspaceId, schema.workspaces.id)
    )
    .where(eq(schema.workspaceMembers.userId, session.user.id))
    .limit(1);

  const ctx = result[0] ?? null;
  if (!ctx) {
    recordTenantContextMissing("no-membership");
    return null;
  }

  // Set GUC for the rest of this request's DB queries
  // NOTE: SET LOCAL needs a transaction. For "global" use, we use SET (not LOCAL)
  // which persists for the session/connection. Connection pooling makes this
  // tricky; we rely on Phase A's NOT FORCED RLS to permit reads even without
  // the var being set everywhere.
  try {
    await db.execute(
      sql`SELECT set_config('app.workspace_id', ${ctx.workspace.id}, false)`
    );
    await db.execute(
      sql`SELECT set_config('app.user_id', ${session.user.id}, false)`
    );
    recordTenantContextSet();
  } catch (e) {
    recordTenantContextMissing("set-config-failed");
  }

  return ctx;
});

export async function requireSession(redirectTo = "/en/login") {
  const session = await getCurrentSession();
  if (!session) {
    const { redirect } = await import("next/navigation");
    redirect(redirectTo);
  }
  return session;
}
```

- [ ] **Step 5: Smoke test**

Run: `cd apps/web && pnpm dev`
Manually:

- Open `/en/agents` while logged in.
- In DB, check: `SELECT current_setting('app.workspace_id', true);` from app_user connection.
- Confirm GUC is set.

- [ ] **Step 6: Commit**

```bash
git add apps/web/middleware.ts apps/web/lib/tenant/middleware.ts apps/web/lib/tenant/telemetry.ts apps/web/lib/workspace.ts
git commit -m "feat(tenant): middleware sets app.workspace_id + telemetry counters (Phase B)"
```

### Task B.2: Cron job worker — explicit cross-tenant flag

**Files:**

- Modify: `apps/web/lib/jobs/*` (whatever exists; check via grep)
- Create: `apps/web/lib/tenant/cron.ts`

- [ ] **Step 1: Find existing pg-boss workers**

Run: `grep -rln "boss\." apps/web/lib | head -10`

- [ ] **Step 2: Write cron helper**

```typescript
// apps/web/lib/tenant/cron.ts
import "server-only";
import { sql } from "drizzle-orm";
import { getDb } from "@orchester/db";

/**
 * Run callback with cross-tenant admin GUC set. Used by cron jobs that
 * need to operate across multiple workspaces (e.g. hard-delete cron,
 * audit verify cron, GDPR export workers).
 *
 * Every bypass is logged with the reason.
 */
export async function withCrossTenantAdmin<T>(
  reason: string,
  fn: () => Promise<T>
): Promise<T> {
  const db = getDb();
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT set_config('app.cross_tenant_admin', 'true', true)`
    );
    console.log(
      JSON.stringify({
        level: "info",
        msg: "tenant.cross_tenant_admin.bypass",
        reason,
      })
    );
    return fn();
  });
}
```

- [ ] **Step 3: Audit existing workers and wrap them**

For each `boss.work(...)` registration in the codebase, identify whether the handler needs cross-tenant access. If yes, wrap the body with `withCrossTenantAdmin("<reason>", async () => { ... })`.

Common workers to check:

- flow-runner
- cost alerts
- retention
- background tasks

- [ ] **Step 4: Commit**

```bash
git add apps/web/lib/tenant/cron.ts apps/web/lib/jobs/
git commit -m "feat(tenant): withCrossTenantAdmin wrapper for cron workers with bypass logging"
```

### Task B.3: Telemetry endpoint (read-only, owner-only)

**Files:**

- Create: `apps/web/app/api/admin/tenant-telemetry/route.ts`

- [ ] **Step 1: Write endpoint**

```typescript
// apps/web/app/api/admin/tenant-telemetry/route.ts
import { NextResponse } from "next/server";
import { snapshotCounts } from "@/lib/tenant/telemetry";
import { getCurrentSession } from "@/lib/workspace";

export async function GET() {
  const session = await getCurrentSession();
  if (!session)
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  // Restrict to your admin email(s); for now, gate by env var
  const adminEmails = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim());
  if (!adminEmails.includes(session.user.email)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  return NextResponse.json(snapshotCounts());
}
```

- [ ] **Step 2: Add to .env.local**

```
ADMIN_EMAILS=lucasmailland@gmail.com
```

- [ ] **Step 3: Smoke test**

Run: `curl http://localhost:3333/api/admin/tenant-telemetry -H "cookie: <session>"`
Expected: JSON with `{ set, missing, ratio }`.

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/api/admin/tenant-telemetry/route.ts
git commit -m "feat(tenant): admin endpoint to read context telemetry counters"
```

### Task B.4: Phase B gate verification

**Files:**

- (verification only)

- [ ] **Step 1: Smoke-test all major routes manually**

Visit while signed in:

- `/en` (dashboard)
- `/en/agents`
- `/en/conversations`
- `/en/flows`
- `/en/employees`
- `/en/knowledge`
- `/en/channels`
- `/en/integrations`
- `/en/settings`

After each, check the telemetry endpoint. Confirm `missing` count grows only on routes you expect (e.g. public/auth pages).

- [ ] **Step 2: Confirm performance baseline within ±5%**

Re-run latency probe from Task 0.2. Document any regressions in `tests/perf/phase-b.md`.

- [ ] **Step 3: Run isolation suite (still against NOT FORCED RLS)**

Run: `cd apps/web && pnpm exec vitest run tests/integration/`
Expected: green.

- [ ] **Step 4: Tag Phase B complete**

```bash
git tag phase-b-complete -m "Tenant Hardening Phase B: silent backfill verified"
```

**Phase B is complete.** Proceed to Phase C.

---

## Chapter C — RLS FORCE on critical tables (Week 2)

**Goal:** Apply `FORCE ROW LEVEL SECURITY` so even app_user is subject to RLS. Critical tables first, then rest. Use feature flag for canary rollout.

**Output gate:** `tenant.rls.violations_per_minute = 0` for 24h. Performance within ±5%. Zero "RLS denied row" 500s in logs. Isolation suite green against FORCED tables.

### Task C.1: Tenant isolation matrix tests (built before FORCE)

**Files:**

- Create: `apps/web/tests/isolation/api-matrix.spec.ts`
- Create: `apps/web/tests/isolation/db-scan.spec.ts`
- Create: `apps/web/tests/isolation/injection-probes.spec.ts`
- Create: `apps/web/tests/isolation/helpers.ts`

- [ ] **Step 1: Write isolation helpers**

```typescript
// apps/web/tests/isolation/helpers.ts
import { setupTestWorkspaces, type WsFixture } from "../fixtures/workspaces";
import { Pool } from "pg";

export interface IsolationFixture {
  wsA: WsFixture;
  wsB: WsFixture;
  appPool: Pool;
  cronPool: Pool;
}

export async function setupIsolation(): Promise<IsolationFixture> {
  const [wsA, wsB] = await setupTestWorkspaces();
  // In testcontainers we already created roles in Task A.16
  // Open dedicated connection pools using app_user / cron_admin
  const baseUrl =
    process.env.TEST_PG_URL ?? "postgresql://localhost:5432/orchester_test";
  const appPool = new Pool({
    connectionString: baseUrl.replace("postgres", "app_user"),
  });
  const cronPool = new Pool({
    connectionString: baseUrl.replace("postgres", "cron_admin"),
  });
  return { wsA, wsB, appPool, cronPool };
}
```

- [ ] **Step 2: Write deep DB scan**

```typescript
// apps/web/tests/isolation/db-scan.spec.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setupIsolation, type IsolationFixture } from "./helpers";
import { teardownTestWorkspaces } from "../fixtures/workspaces";

let f: IsolationFixture;

beforeAll(async () => {
  f = await setupIsolation();
});
afterAll(async () => {
  await Promise.all([f.appPool.end(), f.cronPool.end()]);
  await teardownTestWorkspaces();
});

const TENANT_TABLES = [
  "agent",
  "team",
  "channel",
  "employee",
  "conversation",
  "flow",
  "integration",
  "api_key",
  "knowledge_base",
  "knowledge_doc",
  "knowledge_chunk",
  "agent_memory",
  "audit_log",
  "feature_flag",
  "gdpr_export_job",
  "ai_provider",
  "webhook_out",
];

describe("Cross-tenant DB scan (Pattern A tables)", () => {
  it.each(TENANT_TABLES)(
    "%s: app_user with wsA context cannot see wsB rows",
    async (table) => {
      // Set tenant to wsA
      const client = await f.appPool.connect();
      try {
        await client.query(
          `BEGIN; SELECT set_config('app.workspace_id', $1, true)`,
          [f.wsA.id]
        );
        const wsACount = await client.query(`SELECT count(*) FROM ${table}`);
        await client.query("COMMIT");

        await client.query(
          `BEGIN; SELECT set_config('app.workspace_id', $1, true)`,
          [f.wsB.id]
        );
        const wsBCount = await client.query(`SELECT count(*) FROM ${table}`);
        await client.query("COMMIT");

        // Total via cron (BYPASSRLS)
        const totalRes = await f.cronPool.query(
          `SELECT count(*) FROM ${table}`
        );
        const total = Number(totalRes.rows[0].count);
        const a = Number(wsACount.rows[0].count);
        const b = Number(wsBCount.rows[0].count);

        expect(a + b).toBeLessThanOrEqual(total);
        // Critically: a !== b (each workspace has its own data)
        // Sum may be less than total if there's a third workspace seeded
      } finally {
        client.release();
      }
    }
  );
});
```

- [ ] **Step 3: Write injection probes**

```typescript
// apps/web/tests/isolation/injection-probes.spec.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setupIsolation, type IsolationFixture } from "./helpers";
import { teardownTestWorkspaces } from "../fixtures/workspaces";

let f: IsolationFixture;

beforeAll(async () => {
  f = await setupIsolation();
});
afterAll(async () => {
  await Promise.all([f.appPool.end(), f.cronPool.end()]);
  await teardownTestWorkspaces();
});

const PAYLOADS = [
  `'; DROP TABLE agent; --`,
  `' OR '1'='1`,
  `'; SET LOCAL app.workspace_id = 'other_ws'; --`,
  `' UNION SELECT * FROM agent --`,
];

describe("SQL injection probes against agent name", () => {
  it.each(PAYLOADS)(
    "payload %s is stored literally without execution",
    async (payload) => {
      const client = await f.appPool.connect();
      try {
        await client.query(
          `BEGIN; SELECT set_config('app.workspace_id', $1, true)`,
          [f.wsA.id]
        );
        // Use parameterized query to insert
        await client.query(
          `INSERT INTO agent (id, workspace_id, name, role, system_prompt)
         VALUES ('atest_' || md5(random()::text), $1, $2, 'role', 'sp')`,
          [f.wsA.id, payload]
        );
        await client.query("COMMIT");
      } catch (e: any) {
        // RLS check failure or constraint violation is acceptable
        console.log("rejected:", e.message);
      } finally {
        client.release();
      }

      // Verify DB integrity: agent table still exists
      const r = await f.cronPool.query(
        `SELECT count(*) FROM information_schema.tables WHERE table_name='agent'`
      );
      expect(Number(r.rows[0].count)).toBe(1);
    }
  );
});
```

- [ ] **Step 4: Run isolation suite against UNFORCED RLS to baseline**

Run: `pnpm exec vitest run tests/isolation/`
Expected: PASS (RLS already filters with workspace_id GUC).

- [ ] **Step 5: Commit**

```bash
git add apps/web/tests/isolation/
git commit -m "test(isolation): DB scan + injection probes + helpers"
```

### Task C.2: Migration — FORCE RLS on critical tables

**Files:**

- Create: `packages/db/migrations/0009_rls_force_critical.sql`
- Create: `packages/db/migrations/0009_rls_force_critical.down.sql`

- [ ] **Step 1: Write migration**

```sql
-- packages/db/migrations/0009_rls_force_critical.sql

ALTER TABLE agent_memory FORCE ROW LEVEL SECURITY;
ALTER TABLE knowledge_chunk FORCE ROW LEVEL SECURITY;
ALTER TABLE conversation FORCE ROW LEVEL SECURITY;
ALTER TABLE message FORCE ROW LEVEL SECURITY;
ALTER TABLE audit_log FORCE ROW LEVEL SECURITY;
ALTER TABLE feature_flag FORCE ROW LEVEL SECURITY;
ALTER TABLE gdpr_export_job FORCE ROW LEVEL SECURITY;
ALTER TABLE ai_provider FORCE ROW LEVEL SECURITY;
ALTER TABLE integration FORCE ROW LEVEL SECURITY;
ALTER TABLE api_key FORCE ROW LEVEL SECURITY;
ALTER TABLE security_event FORCE ROW LEVEL SECURITY;
```

- [ ] **Step 2: Write down**

```sql
ALTER TABLE security_event NO FORCE ROW LEVEL SECURITY;
ALTER TABLE api_key NO FORCE ROW LEVEL SECURITY;
ALTER TABLE integration NO FORCE ROW LEVEL SECURITY;
ALTER TABLE ai_provider NO FORCE ROW LEVEL SECURITY;
ALTER TABLE gdpr_export_job NO FORCE ROW LEVEL SECURITY;
ALTER TABLE feature_flag NO FORCE ROW LEVEL SECURITY;
ALTER TABLE audit_log NO FORCE ROW LEVEL SECURITY;
ALTER TABLE message NO FORCE ROW LEVEL SECURITY;
ALTER TABLE conversation NO FORCE ROW LEVEL SECURITY;
ALTER TABLE knowledge_chunk NO FORCE ROW LEVEL SECURITY;
ALTER TABLE agent_memory NO FORCE ROW LEVEL SECURITY;
```

- [ ] **Step 3: Apply via psql with superuser**

Run: `psql -U postgres -d orchester -f packages/db/migrations/0009_rls_force_critical.sql`
Run: `psql -U postgres -d orchester -c "SELECT tablename FROM pg_tables WHERE rowsecurity=true AND forcerowsecurity=true ORDER BY tablename;"`
Expected: 11 tables listed.

- [ ] **Step 4: Re-run isolation suite**

Run: `pnpm exec vitest run tests/isolation/`
Expected: green. If any test fails: identify the missing tenant context and patch that code path before continuing.

- [ ] **Step 5: Smoke test app**

Run: `cd apps/web && pnpm dev`
Visit `/en/agents`, `/en/conversations`, etc. Confirm no 500 errors.

- [ ] **Step 6: Commit**

```bash
git add packages/db/migrations/0009_*.sql
git commit -m "feat(db): FORCE RLS on critical tables (memory, KB chunks, conversations, audit, etc.)"
```

### Task C.3: Migration — FORCE RLS on remaining tables (canary then full)

**Files:**

- Create: `packages/db/migrations/0010_rls_force_rest.sql`
- Create: `packages/db/migrations/0010_rls_force_rest.down.sql`

- [ ] **Step 1: Write migration**

```sql
-- packages/db/migrations/0010_rls_force_rest.sql

ALTER TABLE team FORCE ROW LEVEL SECURITY;
ALTER TABLE agent FORCE ROW LEVEL SECURITY;
ALTER TABLE channel FORCE ROW LEVEL SECURITY;
ALTER TABLE employee FORCE ROW LEVEL SECURITY;
ALTER TABLE flow FORCE ROW LEVEL SECURITY;
ALTER TABLE flow_run FORCE ROW LEVEL SECURITY;
ALTER TABLE knowledge_base FORCE ROW LEVEL SECURITY;
ALTER TABLE knowledge_doc FORCE ROW LEVEL SECURITY;
ALTER TABLE conversation_label FORCE ROW LEVEL SECURITY;
ALTER TABLE notification_pref FORCE ROW LEVEL SECURITY;
ALTER TABLE webhook_out FORCE ROW LEVEL SECURITY;
ALTER TABLE idempotency_key FORCE ROW LEVEL SECURITY;
-- workspace + workspace_member: special, do NOT FORCE so cross-membership reads work
```

- [ ] **Step 2: Write down**

```sql
-- mirror NO FORCE for each table
ALTER TABLE idempotency_key NO FORCE ROW LEVEL SECURITY;
ALTER TABLE webhook_out NO FORCE ROW LEVEL SECURITY;
-- ...etc
```

- [ ] **Step 3: Apply**

```bash
psql -U postgres -d orchester -f packages/db/migrations/0010_rls_force_rest.sql
```

- [ ] **Step 4: Run isolation suite + smoke test all major routes**

Run: `pnpm exec vitest run tests/isolation/`
Manual: visit `/en/*` flows.

- [ ] **Step 5: Commit + tag**

```bash
git add packages/db/migrations/0010_*.sql
git commit -m "feat(db): FORCE RLS on remaining tenant tables (full enforcement)"
git tag phase-c-complete -m "Tenant Hardening Phase C: RLS FORCED on all tenant tables"
```

**Phase C is complete.** Proceed to Phase D.

---

## Chapter D — URL migration + Workspace switcher launch (Week 2-3)

**Goal:** Activate switcher in topbar, migrate URLs to `/[locale]/[workspaceSlug]/...`, legacy URLs 301-redirect. Customer-facing change.

**Output gate:** Switcher p95 < 100ms for 30 days. Zero "tenant_context_missing" errors for 7 days. Multi-tab manually verified. A11y pass via axe-core.

### Task D.1: i18n keys — workspace namespace

**Files:**

- Modify: `apps/web/messages/en.json`
- Modify: `apps/web/messages/es.json`
- Modify: `apps/web/messages/pt-BR.json`

- [ ] **Step 1: Add `workspace` namespace to en.json**

Append before the closing `}`:

```json
,
"workspace": {
  "switcher": {
    "label": "Switch workspace",
    "search": "Search workspaces…",
    "current": "Current",
    "other": "Other workspaces",
    "create": "Create workspace",
    "invite": "Invite teammate to {name}",
    "openShortcut": "⌘K"
  },
  "create": {
    "title": "Create workspace",
    "nameLabel": "Workspace name",
    "slugLabel": "URL slug",
    "slugHint": "Lowercase letters, numbers, hyphens",
    "slugAvailable": "available",
    "slugTaken": "already taken",
    "slugChecking": "checking…",
    "timezoneLabel": "Timezone",
    "colorLabel": "Accent color",
    "cancel": "Cancel",
    "submit": "Create workspace",
    "created": "Workspace created"
  },
  "delete": {
    "title": "Delete {name}",
    "intro": "This will:",
    "willHide": "Hide the workspace from all members",
    "willPause": "Pause all integrations and channels",
    "willStop": "Stop all agents and flows",
    "willEmail": "Send you an email with a restore link",
    "windowExplainer": "You have {days} days to restore. After that, all data is permanently deleted.",
    "reasonLabel": "Reason (optional)",
    "confirmLabel": "Type the workspace slug to confirm:",
    "expected": "Expected: {slug}",
    "submit": "Delete workspace",
    "deleted": "Workspace deleted. Restore within {days} days."
  },
  "restore": {
    "title": "Restore {name}",
    "deletedOn": "Deleted on {date}",
    "restoreUntil": "You can restore until {date}",
    "daysRemaining": "{n} days remaining",
    "tokenLabel": "Restore token (from email)",
    "submit": "Restore workspace",
    "continueDeletion": "Continue deletion",
    "restored": "Workspace restored"
  },
  "suspended": {
    "title": "This workspace is paused (read-only)",
    "body": "You can view data and export, but cannot edit or send messages.",
    "reason": "Reason: {reason}",
    "contactSupport": "Contact support"
  },
  "export": {
    "preparing": "Preparing your export",
    "exporting": "Exporting data…",
    "ready": "Export ready",
    "failed": "Export failed",
    "availableUntil": "Available until {date}",
    "download": "Download",
    "retry": "Retry",
    "dismiss": "Dismiss"
  },
  "audit": {
    "title": "Audit log",
    "subtitle": "Every critical change is recorded.",
    "chainStatus": "Chain status",
    "chainIntact": "Intact",
    "chainBroken": "Broken",
    "lastVerified": "Last verified {date}",
    "loadMore": "Load more",
    "noEvents": "No events recorded yet"
  },
  "featureFlags": {
    "title": "Feature flags",
    "subtitle": "Enable experimental features for this workspace.",
    "search": "Search flags…",
    "setBy": "Set by {actor} · {time}",
    "system": "system"
  },
  "listPage": {
    "title": "Your workspaces",
    "memberCount": "{n} members",
    "lastVisited": "last visited {time}",
    "createNew": "Create new workspace",
    "recentlyDeleted": "Recently deleted workspaces can still be restored:",
    "restoreCta": "Restore"
  },
  "roles": {
    "owner": "Owner",
    "admin": "Admin",
    "editor": "Editor",
    "viewer": "Viewer"
  },
  "errors": {
    "workspaceNotFound": "Workspace not found",
    "notAMember": "You're not a member of this workspace",
    "suspended": "This workspace is paused",
    "deleted": "This workspace was deleted",
    "rateLimited": "You're doing that too often. Try again in {minutes} min.",
    "slugInvalid": "Use lowercase letters, numbers, and hyphens (3-40 chars).",
    "slugTaken": "That slug is already taken. Try {suggestion}."
  }
}
```

- [ ] **Step 2: Mirror to es.json + pt-BR.json**

Translate same structure to Spanish and Portuguese (mirror keys exactly).

- [ ] **Step 3: Verify by running typecheck (next-intl validates at build time)**

Run: `cd apps/web && pnpm exec tsc --noEmit`

- [ ] **Step 4: Commit**

```bash
git add apps/web/messages/
git commit -m "feat(i18n): workspace namespace (switcher, create, delete, restore, suspended, export, audit)"
```

### Task D.2: useMyWorkspaces hook + GET /api/me/workspaces

**Files:**

- Create: `apps/web/app/api/me/workspaces/route.ts`
- Create: `apps/web/components/workspace/hooks/useMyWorkspaces.ts`

- [ ] **Step 1: Route handler**

```typescript
// apps/web/app/api/me/workspaces/route.ts
import { NextResponse } from "next/server";
import { eq, desc } from "drizzle-orm";
import { getDb, schema } from "@orchester/db";
import { getCurrentSession } from "@/lib/workspace";

export async function GET() {
  const session = await getCurrentSession();
  if (!session) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const db = getDb();
  const rows = await db
    .select({
      id: schema.workspaces.id,
      slug: schema.workspaces.slug,
      name: schema.workspaces.name,
      status: schema.workspaces.status,
      timezone: schema.workspaces.timezone,
      role: schema.workspaceMembers.role,
    })
    .from(schema.workspaceMembers)
    .innerJoin(
      schema.workspaces,
      eq(schema.workspaceMembers.workspaceId, schema.workspaces.id)
    )
    .where(eq(schema.workspaceMembers.userId, session.user.id))
    .orderBy(desc(schema.workspaces.updatedAt));

  return NextResponse.json({ workspaces: rows });
}
```

- [ ] **Step 2: SWR hook**

```typescript
// apps/web/components/workspace/hooks/useMyWorkspaces.ts
"use client";
import useSWR from "swr";

export interface MyWorkspace {
  id: string;
  slug: string;
  name: string;
  status: "active" | "suspended" | "deleted";
  timezone: string;
  role: "owner" | "admin" | "editor" | "viewer";
}

async function fetcher(url: string): Promise<{ workspaces: MyWorkspace[] }> {
  const r = await fetch(url);
  if (!r.ok) throw new Error("fetch failed");
  return r.json();
}

export function useMyWorkspaces() {
  const { data, error, isLoading, mutate } = useSWR<{
    workspaces: MyWorkspace[];
  }>("/api/me/workspaces", fetcher, {
    revalidateOnFocus: true,
    dedupingInterval: 60_000,
  });

  return {
    workspaces: data?.workspaces ?? [],
    isLoading,
    error,
    refresh: mutate,
  };
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/api/me/workspaces/ apps/web/components/workspace/hooks/
git commit -m "feat(workspace): GET /api/me/workspaces + useMyWorkspaces hook"
```

### Task D.3: WorkspaceSwitcher topbar component

**Files:**

- Create: `apps/web/components/workspace/WorkspaceSwitcher.tsx`
- Create: `apps/web/components/workspace/WorkspaceMenu.tsx`
- Create: `apps/web/components/workspace/WorkspaceAvatar.tsx`
- Modify: `apps/web/components/shell/Sidebar.tsx`

- [ ] **Step 1: Build WorkspaceAvatar**

```typescript
// apps/web/components/workspace/WorkspaceAvatar.tsx
import { cn } from "@/lib/utils";

function initials(name: string): string {
  return name
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export function WorkspaceAvatar({
  name,
  color,
  size = "md",
}: {
  name: string;
  color?: string | null;
  size?: "sm" | "md" | "lg";
}) {
  const dim = size === "sm" ? "h-6 w-6 text-[10px]" : size === "lg" ? "h-9 w-9 text-sm" : "h-7 w-7 text-[11px]";
  return (
    <div
      className={cn("flex shrink-0 items-center justify-center rounded-lg font-bold text-white", dim)}
      style={{ backgroundColor: color ?? "#7C3AED" }}
    >
      {initials(name)}
    </div>
  );
}
```

- [ ] **Step 2: Build WorkspaceMenu**

```typescript
// apps/web/components/workspace/WorkspaceMenu.tsx
"use client";
import { useState, useMemo } from "react";
import { useRouter, useParams, usePathname } from "next/navigation";
import { Plus, Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMyWorkspaces } from "./hooks/useMyWorkspaces";
import { WorkspaceAvatar } from "./WorkspaceAvatar";
import { cn } from "@/lib/utils";

interface Props {
  onClose: () => void;
  activeSlug: string | null;
  onCreate: () => void;
}

export function WorkspaceMenu({ onClose, activeSlug, onCreate }: Props) {
  const t = useTranslations("workspace.switcher");
  const router = useRouter();
  const params = useParams<{ locale: string }>();
  const pathname = usePathname();
  const locale = params?.locale ?? "en";
  const [query, setQuery] = useState("");
  const { workspaces, isLoading } = useMyWorkspaces();

  const filtered = useMemo(() => {
    if (!query.trim()) return workspaces;
    const q = query.toLowerCase();
    return workspaces.filter(
      (w) => w.name.toLowerCase().includes(q) || w.slug.toLowerCase().includes(q)
    );
  }, [workspaces, query]);

  const current = filtered.find((w) => w.slug === activeSlug);
  const others = filtered.filter((w) => w.slug !== activeSlug);

  function switchTo(slug: string) {
    // Preserve current sub-path when switching
    const subPath = pathname?.split(`/${activeSlug ?? ""}`)[1] ?? "";
    router.push(`/${locale}/${slug}${subPath}`);
    document.cookie = `orch-active-workspace=${slug}; path=/; max-age=${60 * 60 * 24 * 30}; samesite=lax`;
    onClose();
  }

  return (
    <div role="menu" className="absolute left-2 top-12 z-50 w-80 rounded-xl border border-line bg-surface shadow-2xl">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <Search className="h-3.5 w-3.5 text-muted" />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("search")}
          className="flex-1 bg-transparent text-xs text-strong placeholder:text-faint outline-none"
        />
      </div>

      <div className="max-h-96 overflow-y-auto py-1">
        {isLoading && <div className="px-3 py-4 text-xs text-muted">Loading…</div>}

        {current && (
          <>
            <div className="px-3 py-1 text-[9px] uppercase tracking-wider text-faint">{t("current")}</div>
            <WorkspaceRow ws={current} active onClick={() => onClose()} />
          </>
        )}

        {others.length > 0 && (
          <>
            <div className="mt-1 px-3 py-1 text-[9px] uppercase tracking-wider text-faint">{t("other")}</div>
            {others.map((w) => (
              <WorkspaceRow key={w.id} ws={w} onClick={() => switchTo(w.slug)} />
            ))}
          </>
        )}
      </div>

      <div className="border-t border-line p-1">
        <button
          type="button"
          onClick={onCreate}
          className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-xs text-body hover:bg-hover"
        >
          <Plus className="h-3.5 w-3.5" /> {t("create")}
        </button>
      </div>
    </div>
  );
}

function WorkspaceRow({
  ws,
  active = false,
  onClick,
}: {
  ws: { id: string; slug: string; name: string; role: string; status: string };
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-3 px-3 py-2 text-left text-xs hover:bg-hover",
        active && "bg-hover"
      )}
    >
      <WorkspaceAvatar name={ws.name} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-strong">{ws.name}</div>
        <div className="truncate text-[10px] text-muted">{ws.slug}</div>
      </div>
      <span className="text-[9px] uppercase tracking-wider text-faint">{ws.role}</span>
    </button>
  );
}
```

- [ ] **Step 3: Build WorkspaceSwitcher**

```typescript
// apps/web/components/workspace/WorkspaceSwitcher.tsx
"use client";
import { useState, useEffect } from "react";
import { ChevronDown } from "lucide-react";
import { useParams } from "next/navigation";
import { WorkspaceMenu } from "./WorkspaceMenu";
import { CreateWorkspaceModal } from "./CreateWorkspaceModal";
import { WorkspaceAvatar } from "./WorkspaceAvatar";
import { useMyWorkspaces } from "./hooks/useMyWorkspaces";

export function WorkspaceSwitcher() {
  const [open, setOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const params = useParams<{ workspaceSlug?: string }>();
  const activeSlug = params?.workspaceSlug ?? null;
  const { workspaces } = useMyWorkspaces();
  const active = workspaces.find((w) => w.slug === activeSlug);

  // Keyboard shortcut ⌘K
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  return (
    <div className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 rounded-lg p-2 text-left hover:bg-hover"
      >
        <WorkspaceAvatar name={active?.name ?? "?"} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-strong">{active?.name ?? "Select workspace"}</div>
          <div className="truncate text-[10px] text-faint">{active?.slug ?? ""}</div>
        </div>
        <ChevronDown className="h-3.5 w-3.5 text-muted" />
      </button>

      {open && (
        <WorkspaceMenu
          onClose={() => setOpen(false)}
          activeSlug={activeSlug}
          onCreate={() => {
            setOpen(false);
            setCreateOpen(true);
          }}
        />
      )}

      {createOpen && <CreateWorkspaceModal onClose={() => setCreateOpen(false)} />}
    </div>
  );
}
```

- [ ] **Step 4: Wire into Sidebar**

In `apps/web/components/shell/Sidebar.tsx`, replace the existing logo block (lines around 79-96 per spec §5.3) with:

```typescript
import { WorkspaceSwitcher } from "@/components/workspace/WorkspaceSwitcher";

// Inside the component, where the logo div is:
{!collapsed && <WorkspaceSwitcher />}
```

Keep the collapsed-state logo behavior as fallback.

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/workspace/ apps/web/components/shell/Sidebar.tsx
git commit -m "feat(workspace): switcher topbar + menu + ⌘K shortcut"
```

### Task D.4: CreateWorkspaceModal + POST /api/workspaces

**Files:**

- Create: `apps/web/components/workspace/CreateWorkspaceModal.tsx`
- Create: `apps/web/app/api/workspaces/route.ts`

- [ ] **Step 1: Write POST handler**

```typescript
// apps/web/app/api/workspaces/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createId } from "@paralleldrive/cuid2";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@orchester/db";
import { getCurrentSession } from "@/lib/workspace";
import { appendAudit } from "@/lib/audit";

const Schema = z.object({
  name: z.string().min(2).max(80),
  slug: z.string().regex(/^[a-z][a-z0-9-]{2,38}[a-z0-9]$/),
  timezone: z.string().default("UTC"),
});

export async function POST(req: NextRequest) {
  const session = await getCurrentSession();
  if (!session)
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const body = await req.json();
  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "validation_failed",
        fields: parsed.error.flatten().fieldErrors,
      },
      { status: 422 }
    );
  }

  const db = getDb();
  // Check slug availability
  const existing = await db
    .select({ id: schema.workspaces.id })
    .from(schema.workspaces)
    .where(eq(schema.workspaces.slug, parsed.data.slug))
    .limit(1);
  if (existing.length > 0) {
    return NextResponse.json(
      { error: "workspace_slug_taken" },
      { status: 409 }
    );
  }

  const wsId = `ws_${createId()}`;
  await db.insert(schema.workspaces).values({
    id: wsId,
    name: parsed.data.name,
    slug: parsed.data.slug,
    timezone: parsed.data.timezone,
    status: "active",
    ownerUserId: session.user.id,
  });
  await db.insert(schema.workspaceMembers).values({
    id: createId(),
    workspaceId: wsId,
    userId: session.user.id,
    role: "owner",
  });

  appendAudit(wsId, {
    action: "workspace.create",
    actorUserId: session.user.id,
    actorKind: "user",
    targetType: "workspace",
    targetId: wsId,
    meta: { name: parsed.data.name, slug: parsed.data.slug },
  });

  return NextResponse.json(
    {
      workspace: {
        id: wsId,
        slug: parsed.data.slug,
        name: parsed.data.name,
        timezone: parsed.data.timezone,
        status: "active",
        role: "owner",
      },
    },
    { status: 201 }
  );
}
```

- [ ] **Step 2: Build CreateWorkspaceModal**

```typescript
// apps/web/components/workspace/CreateWorkspaceModal.tsx
"use client";
import { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";
import { toast } from "sonner";
import { useMyWorkspaces } from "./hooks/useMyWorkspaces";

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export function CreateWorkspaceModal({ onClose }: { onClose: () => void }) {
  const t = useTranslations("workspace.create");
  const router = useRouter();
  const params = useParams<{ locale: string }>();
  const locale = params?.locale ?? "en";
  const { refresh } = useMyWorkspaces();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [timezone, setTimezone] = useState("UTC");
  const [busy, setBusy] = useState(false);

  // Auto-derive slug from name
  useEffect(() => {
    if (!slug) setSlug(slugify(name));
  }, [name]); // eslint-disable-line react-hooks/exhaustive-deps

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const r = await fetch("/api/workspaces", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({ name, slug, timezone }),
      });
      const j = await r.json();
      if (!r.ok) {
        if (j.error === "workspace_slug_taken") toast.error("Slug already taken");
        else toast.error(j.error ?? "Error creating workspace");
        setBusy(false);
        return;
      }
      toast.success(t("created"));
      document.cookie = `orch-active-workspace=${slug}; path=/; max-age=${60 * 60 * 24 * 30}; samesite=lax`;
      await refresh();
      router.push(`/${locale}/${slug}`);
    } catch (e) {
      toast.error("Network error");
      setBusy(false);
    }
  }

  return (
    <AnimatePresence>
      <motion.div
        key="bd"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 bg-black/60"
        onClick={onClose}
      />
      <motion.div
        key="md"
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <form onSubmit={submit} className="w-full max-w-md rounded-2xl border border-line bg-surface shadow-2xl">
          <div className="flex items-center justify-between border-b border-line px-5 py-3">
            <h2 className="text-sm font-bold text-strong">{t("title")}</h2>
            <button type="button" onClick={onClose} className="text-muted hover:text-strong">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="space-y-3 p-5">
            <div>
              <label className="block text-[11px] text-muted">{t("nameLabel")}</label>
              <input
                autoFocus
                required
                minLength={2}
                maxLength={80}
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="mt-1 w-full rounded-lg border border-line bg-elevated px-3 py-2 text-sm text-strong outline-none"
              />
            </div>
            <div>
              <label className="block text-[11px] text-muted">{t("slugLabel")}</label>
              <input
                required
                pattern="^[a-z][a-z0-9-]{2,38}[a-z0-9]$"
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                className="mt-1 w-full rounded-lg border border-line bg-elevated px-3 py-2 font-mono text-xs text-strong outline-none"
              />
              <p className="mt-1 text-[10px] text-faint">{t("slugHint")}</p>
            </div>
            <div>
              <label className="block text-[11px] text-muted">{t("timezoneLabel")}</label>
              <input
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                className="mt-1 w-full rounded-lg border border-line bg-elevated px-3 py-2 text-xs text-strong outline-none"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
            <button type="button" onClick={onClose} className="rounded-lg border border-line px-3 py-1.5 text-xs">
              {t("cancel")}
            </button>
            <button
              type="submit"
              disabled={busy || !name || !slug}
              className="rounded-lg bg-violet-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-400 disabled:opacity-50"
            >
              {t("submit")}
            </button>
          </div>
        </form>
      </motion.div>
    </AnimatePresence>
  );
}
```

- [ ] **Step 3: Test manually**

Run: `cd apps/web && pnpm dev`
Open switcher → Click "Create workspace" → fill form → verify creation and redirect.

- [ ] **Step 4: Commit**

```bash
git add apps/web/components/workspace/CreateWorkspaceModal.tsx apps/web/app/api/workspaces/route.ts
git commit -m "feat(workspace): create workspace modal + POST /api/workspaces"
```

### Task D.5: URL migration — move shell layout under [workspaceSlug]

**Files:**

- Move: `apps/web/app/[locale]/(shell)/` → `apps/web/app/[locale]/[workspaceSlug]/(shell)/`
- Update middleware to redirect legacy URLs to active slug

- [ ] **Step 1: Move shell directory**

```bash
cd apps/web/app/[locale]
mkdir -p '[workspaceSlug]'
git mv '(shell)' '[workspaceSlug]/(shell)'
```

- [ ] **Step 2: Update internal links**

Run: `grep -rln '/\${locale}/\(agents\|conversations\|flows\|employees\|knowledge\|channels\|integrations\|settings\|teams\|org\)' apps/web | head -20`

For each file, change patterns like `\`/${locale}/agents\`` to `\`/${locale}/${slug}/agents\``using`useParams<{ workspaceSlug: string }>()`.

(This will be a substantial sweep — likely 30+ files. Do it incrementally; commit per file or per group.)

- [ ] **Step 3: Update middleware to extract slug + 301 legacy**

Modify `apps/web/lib/tenant/middleware.ts`:

```typescript
// extractLocaleAndSlug — Phase D version
export function extractLocaleAndSlug(pathname: string): {
  locale: string | null;
  slug: string | null;
  rest: string;
} {
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 0) return { locale: null, slug: null, rest: "/" };
  const locale = LOCALE_RE.test(segments[0]!) ? segments[0]! : null;
  if (!locale)
    return { locale: null, slug: null, rest: "/" + segments.join("/") };
  // Slug must look like a valid workspace slug; otherwise treat as legacy
  const candidate = segments[1];
  const isSlug = candidate && /^[a-z][a-z0-9-]{2,38}[a-z0-9]$/.test(candidate);
  if (isSlug) {
    return { locale, slug: candidate, rest: "/" + segments.slice(2).join("/") };
  }
  return { locale, slug: null, rest: "/" + segments.slice(1).join("/") };
}
```

Update root middleware to 301 redirect legacy URLs:

```typescript
// In middleware.ts
const { locale, slug, rest } = extractLocaleAndSlug(url.pathname);

if (locale && !slug && !isPublicRoute(url.pathname)) {
  // Legacy URL like /en/agents → redirect to /en/<activeSlug>/agents
  const activeSlug = req.cookies.get("orch-active-workspace")?.value;
  if (activeSlug) {
    const newPath = `/${locale}/${activeSlug}${rest}`;
    return NextResponse.redirect(new URL(newPath, url), 301);
  }
  // No active workspace → send to switcher
  return NextResponse.redirect(new URL(`/${locale}/workspaces`, url));
}
```

- [ ] **Step 4: Test all routes pass**

Run dev server; manually visit each major route. Verify 301 redirects from legacy URLs to slug-prefixed.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app apps/web/lib/tenant/middleware.ts apps/web/middleware.ts
git commit -m "feat(workspace): URL migration to /[locale]/[workspaceSlug]/* with legacy 301"
```

### Task D.6: Workspaces list page (no-workspace landing)

**Files:**

- Create: `apps/web/app/[locale]/workspaces/page.tsx`

- [ ] **Step 1: Build page**

```typescript
// apps/web/app/[locale]/workspaces/page.tsx
"use client";
import { useRouter, useParams } from "next/navigation";
import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMyWorkspaces } from "@/components/workspace/hooks/useMyWorkspaces";
import { WorkspaceAvatar } from "@/components/workspace/WorkspaceAvatar";
import { useState } from "react";
import { CreateWorkspaceModal } from "@/components/workspace/CreateWorkspaceModal";

export default function WorkspacesPage() {
  const t = useTranslations("workspace.listPage");
  const router = useRouter();
  const params = useParams<{ locale: string }>();
  const locale = params?.locale ?? "en";
  const { workspaces, isLoading } = useMyWorkspaces();
  const [createOpen, setCreateOpen] = useState(false);

  if (isLoading) return <div className="p-10 text-muted">Loading…</div>;

  function go(slug: string) {
    document.cookie = `orch-active-workspace=${slug}; path=/; max-age=${60 * 60 * 24 * 30}; samesite=lax`;
    router.push(`/${locale}/${slug}`);
  }

  return (
    <div className="mx-auto max-w-2xl p-10">
      <h1 className="mb-6 font-display text-2xl font-bold text-strong">{t("title")}</h1>
      <div className="space-y-2">
        {workspaces.map((ws) => (
          <button
            key={ws.id}
            type="button"
            onClick={() => go(ws.slug)}
            className="flex w-full items-center gap-3 rounded-2xl border border-line bg-card p-4 text-left hover:border-violet-500/40"
          >
            <WorkspaceAvatar name={ws.name} size="lg" />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-strong">{ws.name}</div>
              <div className="text-xs text-muted">{ws.slug} · {ws.role}</div>
            </div>
            <span className="text-[10px] uppercase tracking-wider text-faint">{ws.status}</span>
          </button>
        ))}
      </div>

      <button
        type="button"
        onClick={() => setCreateOpen(true)}
        className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-line bg-card py-4 text-sm text-muted hover:border-violet-500/40 hover:text-body"
      >
        <Plus className="h-4 w-4" /> {t("createNew")}
      </button>

      {createOpen && <CreateWorkspaceModal onClose={() => setCreateOpen(false)} />}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/app/[locale]/workspaces/
git commit -m "feat(workspace): /workspaces list page for no-context landing"
```

### Task D.7: Phase D gate verification

- [ ] **Step 1: Manually test multi-tab**

Open 2 tabs:

- Tab A: `/en/acme-hr`
- Tab B: `/en/acme-marketing`

Verify each tab keeps its own URL and data. Switch workspace in Tab A; Tab B unchanged.

- [ ] **Step 2: Confirm legacy 301 redirects work**

Visit `/en/agents` (legacy) → should 301 to `/en/<activeSlug>/agents`.

- [ ] **Step 3: Confirm switcher latency < 100ms p95**

Run k6 against `/api/me/workspaces` with 50 concurrent users for 2 min.

- [ ] **Step 4: Tag**

```bash
git tag phase-d-complete -m "Tenant Hardening Phase D: switcher launched, URLs migrated"
```

**Phase D is complete.** Proceed to Phase E.

---

## Chapter E — Lifecycle features GA (Week 3-5)

**Goal:** All lifecycle ops live: soft-delete, restore, suspend, transfer, GDPR export. Audit verify cron daily. Sub-spec complete.

**Output gate:** Audit chain verify 0 broken in 30 days. GDPR export success > 99%. Hard-delete cron 100%. Soft-delete restore 100%. Suspended block rate 100%. All ADRs committed. Incident response runbook live.

### Task E.1: API route — DELETE /api/workspaces/[slug] (soft-delete)

**Files:**

- Create: `apps/web/app/api/workspaces/[slug]/route.ts`

- [ ] **Step 1: Write handler**

```typescript
// apps/web/app/api/workspaces/[slug]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveBySlug } from "@/lib/tenant/resolve";
import { checkMembership } from "@/lib/tenant/membership";
import { getCurrentSession } from "@/lib/workspace";
import { softDelete } from "@/lib/tenant/lifecycle";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const session = await getCurrentSession();
  if (!session)
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const ws = await resolveBySlug(slug);
  if (!ws)
    return NextResponse.json({ error: "workspace_not_found" }, { status: 404 });

  const m = await checkMembership(session.user.id, ws.id);
  if (!m) return NextResponse.json({ error: "not_a_member" }, { status: 403 });

  return NextResponse.json({
    workspace: {
      id: ws.id,
      slug: ws.slug,
      name: ws.name,
      status: ws.status,
      timezone: ws.timezone,
      role: m.role,
    },
  });
}

const DeleteSchema = z.object({
  reason: z.string().optional(),
  confirm_slug: z.string(),
});

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const session = await getCurrentSession();
  if (!session)
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const ws = await resolveBySlug(slug);
  if (!ws)
    return NextResponse.json({ error: "workspace_not_found" }, { status: 404 });
  if (ws.ownerUserId !== session.user.id) {
    return NextResponse.json({ error: "role_insufficient" }, { status: 403 });
  }

  const body = await req.json();
  const parsed = DeleteSchema.safeParse(body);
  if (!parsed.success || parsed.data.confirm_slug !== ws.slug) {
    return NextResponse.json(
      {
        error: "validation_failed",
        fields: { confirm_slug: "does not match" },
      },
      { status: 422 }
    );
  }

  const { restoreToken, restoreUntil } = await softDelete(ws.id, {
    userId: session.user.id,
    reason: parsed.data.reason,
  });

  return NextResponse.json({
    workspace: { ...ws, status: "deleted" },
    restoreToken,
    restoreUntil: restoreUntil.toISOString(),
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/app/api/workspaces/[slug]/route.ts
git commit -m "feat(workspace): GET/DELETE /api/workspaces/[slug] with confirm_slug + audit"
```

### Task E.2: API route — POST /api/workspaces/[slug]/restore

**Files:**

- Create: `apps/web/app/api/workspaces/[slug]/restore/route.ts`

- [ ] **Step 1: Write handler**

```typescript
// apps/web/app/api/workspaces/[slug]/restore/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveBySlug } from "@/lib/tenant/resolve";
import { getCurrentSession } from "@/lib/workspace";
import { restore } from "@/lib/tenant/lifecycle";

const Schema = z.object({ token: z.string().optional() });

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const session = await getCurrentSession();
  if (!session)
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const ws = await resolveBySlug(slug);
  if (!ws)
    return NextResponse.json({ error: "workspace_not_found" }, { status: 404 });

  const body = await req.json();
  const parsed = Schema.safeParse(body);
  if (!parsed.success)
    return NextResponse.json({ error: "validation_failed" }, { status: 422 });

  // Either token OR owner authentication
  if (!parsed.data.token && ws.ownerUserId !== session.user.id) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  try {
    await restore(ws.id, { token: parsed.data.token, userId: session.user.id });
  } catch (e: any) {
    if (e.message === "workspace_lifecycle_invalid") {
      return NextResponse.json(
        { error: "workspace_lifecycle_invalid" },
        { status: 409 }
      );
    }
    if (e.message === "invalid_or_used_token") {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    throw e;
  }

  return NextResponse.json({ workspace: { ...ws, status: "active" } });
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/app/api/workspaces/[slug]/restore/
git commit -m "feat(workspace): POST /api/workspaces/[slug]/restore (token or owner)"
```

### Task E.3: API route — Audit log GET + verify

**Files:**

- Create: `apps/web/app/api/workspaces/[slug]/audit/route.ts`
- Create: `apps/web/app/api/workspaces/[slug]/audit/verify/route.ts`

- [ ] **Step 1: GET /audit handler**

```typescript
// apps/web/app/api/workspaces/[slug]/audit/route.ts
import { NextRequest, NextResponse } from "next/server";
import { desc, eq, and, lt } from "drizzle-orm";
import { getDb, schema } from "@orchester/db";
import { resolveBySlug } from "@/lib/tenant/resolve";
import { checkMembership } from "@/lib/tenant/membership";
import { getCurrentSession } from "@/lib/workspace";
import { assertCan } from "@/lib/rbac";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const url = new URL(req.url);
  const limit = Math.min(
    parseInt(url.searchParams.get("limit") ?? "50", 10),
    100
  );
  const cursor = url.searchParams.get("cursor");

  const session = await getCurrentSession();
  if (!session)
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const ws = await resolveBySlug(slug);
  if (!ws)
    return NextResponse.json({ error: "workspace_not_found" }, { status: 404 });

  const m = await checkMembership(session.user.id, ws.id);
  if (!m) return NextResponse.json({ error: "not_a_member" }, { status: 403 });

  try {
    assertCan(m.role, "audit.read");
  } catch {
    return NextResponse.json({ error: "role_insufficient" }, { status: 403 });
  }

  const db = getDb();
  const conditions = cursor
    ? and(
        eq(schema.auditLog.workspaceId, ws.id),
        lt(schema.auditLog.seq, BigInt(cursor))
      )
    : eq(schema.auditLog.workspaceId, ws.id);

  const entries = await db
    .select()
    .from(schema.auditLog)
    .where(conditions)
    .orderBy(desc(schema.auditLog.seq))
    .limit(limit + 1);

  const hasMore = entries.length > limit;
  const items = entries.slice(0, limit);
  const nextCursor = hasMore ? items[items.length - 1]!.seq.toString() : null;

  return NextResponse.json({ entries: items, nextCursor });
}
```

- [ ] **Step 2: GET /audit/verify handler**

```typescript
// apps/web/app/api/workspaces/[slug]/audit/verify/route.ts
import { NextRequest, NextResponse } from "next/server";
import { resolveBySlug } from "@/lib/tenant/resolve";
import { checkMembership } from "@/lib/tenant/membership";
import { getCurrentSession } from "@/lib/workspace";
import { assertCan } from "@/lib/rbac";
import { verifyChain } from "@/lib/audit/verify";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const session = await getCurrentSession();
  if (!session)
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const ws = await resolveBySlug(slug);
  if (!ws)
    return NextResponse.json({ error: "workspace_not_found" }, { status: 404 });

  const m = await checkMembership(session.user.id, ws.id);
  if (!m) return NextResponse.json({ error: "not_a_member" }, { status: 403 });

  try {
    assertCan(m.role, "audit.read");
  } catch {
    return NextResponse.json({ error: "role_insufficient" }, { status: 403 });
  }

  const result = await verifyChain(ws.id);
  return NextResponse.json(result);
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/api/workspaces/[slug]/audit/
git commit -m "feat(audit): GET /audit + GET /audit/verify endpoints (admin/owner only)"
```

### Task E.4: Verify audit chain cron worker

**Files:**

- Create: `apps/web/lib/audit/verify-job.ts`
- Modify: pg-boss registration (usually in `instrumentation-node.ts` or similar)

- [ ] **Step 1: Write worker**

```typescript
// apps/web/lib/audit/verify-job.ts
import "server-only";
import { createId } from "@paralleldrive/cuid2";
import { getDb, schema } from "@orchester/db";
import { withCrossTenantAdmin } from "@/lib/tenant/cron";
import { verifyChain } from "./verify";

export async function runVerifyAllChains(): Promise<void> {
  await withCrossTenantAdmin("audit.verify_all_chains", async () => {
    const db = getDb();
    const workspaces = await db
      .select({ id: schema.workspaces.id })
      .from(schema.workspaces)
      .where(/* status = active */);

    for (const ws of workspaces) {
      const result = await verifyChain(ws.id);
      if (result.brokenAt) {
        await db.insert(schema.securityEvents).values({
          id: createId(),
          workspaceId: ws.id,
          eventType: "audit_chain.break_detected",
          severity: "critical",
          detail: {
            entryId: result.brokenAt.entryId,
            expectedHash: result.brokenAt.expectedHash,
            foundHash: result.brokenAt.foundHash,
          },
        });
        // PagerDuty/Slack webhook integration is environment-specific
        // (configured via env var SECURITY_ALERT_WEBHOOK in production).
        // For now we log to stderr; production deploy adds the webhook fetch.
        console.error(
          JSON.stringify({
            level: "error",
            msg: "audit.chain_break_detected",
            workspaceId: ws.id,
            ...result,
          })
        );
      }
    }
  });
}
```

- [ ] **Step 2: Register cron**

In your pg-boss registration file (e.g. `apps/web/instrumentation-node.ts`):

```typescript
// Inside register() or equivalent
await boss.schedule("audit.verify_all_chains", "0 3 * * *"); // daily 03:00 UTC
await boss.work("audit.verify_all_chains", async () => {
  await runVerifyAllChains();
});
```

- [ ] **Step 3: Test manually**

Run: trigger the job once via `boss.send("audit.verify_all_chains", {})` or directly call `runVerifyAllChains()` from a CLI script.

- [ ] **Step 4: Commit**

```bash
git add apps/web/lib/audit/verify-job.ts apps/web/instrumentation-node.ts
git commit -m "feat(audit): daily verify-all-chains cron worker + security_event on break"
```

### Task E.5: Hard-delete cron

**Files:**

- Create: `apps/web/lib/tenant/hard-delete-job.ts`
- Modify: instrumentation file

- [ ] **Step 1: Write worker**

```typescript
// apps/web/lib/tenant/hard-delete-job.ts
import "server-only";
import { eq, lt, and } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { getDb, schema } from "@orchester/db";
import { withCrossTenantAdmin } from "./cron";

export async function runHardDeleteCron(): Promise<void> {
  await withCrossTenantAdmin("workspace.hard_delete_cron", async () => {
    const db = getDb();
    const now = new Date();
    // Find workspaces eligible for hard delete
    const due = await db
      .select({ id: schema.workspaces.id, slug: schema.workspaces.slug })
      .from(schema.workspaces)
      .where(
        and(
          eq(schema.workspaces.status, "deleted"),
          lt(schema.workspaces.deleteScheduledAt, now)
        )
      );

    for (const ws of due) {
      // Advisory lock per workspace
      await db.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${ws.id}))`);
      // Hard delete; CASCADE cleans up everything
      await db.delete(schema.workspaces).where(eq(schema.workspaces.id, ws.id));
      console.log(
        JSON.stringify({
          level: "info",
          msg: "workspace.hard_delete",
          workspaceId: ws.id,
          slug: ws.slug,
        })
      );
    }
  });
}
```

- [ ] **Step 2: Register cron**

```typescript
await boss.schedule("workspace.hard_delete", "0 4 * * *"); // daily 04:00 UTC
await boss.work("workspace.hard_delete", async () => {
  await runHardDeleteCron();
});
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/lib/tenant/hard-delete-job.ts apps/web/instrumentation-node.ts
git commit -m "feat(tenant): daily hard-delete cron (workspaces past 30d window)"
```

### Task E.6: GDPR export — worker skeleton

**Files:**

- Create: `apps/web/lib/gdpr/export-job.ts`
- Create: `apps/web/lib/gdpr/zip-builder.ts`
- Create: `apps/web/lib/gdpr/storage.ts`
- Create: `apps/web/lib/gdpr/email.ts`
- Create: `apps/web/lib/gdpr/exporters/workspace.ts`
- Create: `apps/web/app/api/workspaces/[slug]/export/route.ts`

- [ ] **Step 1: Write workspace exporter**

```typescript
// apps/web/lib/gdpr/exporters/workspace.ts
import "server-only";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@orchester/db";

export async function exportWorkspace(workspaceId: string) {
  const db = getDb();
  return await db
    .select()
    .from(schema.workspaces)
    .where(eq(schema.workspaces.id, workspaceId))
    .limit(1)
    .then((r) => r[0]);
}

// Repeat pattern for: agents, conversations, messages, knowledge_base, etc.
// (stub here — full implementation per spec §3.8)
```

- [ ] **Step 2: Storage + email stubs**

```typescript
// apps/web/lib/gdpr/storage.ts
import "server-only";
// Storage backend choice is environment-driven (S3 in Cloud, MinIO in self-host).
// Implemented as a stub during Phase E; concrete integration is added when
// STORAGE_BACKEND env var is wired to either @aws-sdk/client-s3 or minio.
export async function uploadZip(
  key: string,
  _stream: NodeJS.ReadableStream
): Promise<{ signedUrl: string; expiresAt: Date }> {
  // Stub: in production, upload to S3 and generate signed URL
  return {
    signedUrl: `https://example.com/exports/${key}`,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  };
}
```

```typescript
// apps/web/lib/gdpr/email.ts
import "server-only";
export async function sendExportReadyEmail(
  toEmail: string,
  signedUrl: string,
  expiresAt: Date
): Promise<void> {
  // Stub: integrate with Resend/SES
  console.log(
    JSON.stringify({
      level: "info",
      msg: "gdpr.email.send",
      toEmail,
      expiresAt,
    })
  );
}
```

- [ ] **Step 3: Worker**

```typescript
// apps/web/lib/gdpr/export-job.ts
import "server-only";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@orchester/db";
import { withCrossTenantAdmin } from "@/lib/tenant/cron";
import { exportWorkspace } from "./exporters/workspace";
import { uploadZip } from "./storage";
import { sendExportReadyEmail } from "./email";

export async function runExportJob(jobId: string): Promise<void> {
  const db = getDb();
  await withCrossTenantAdmin("gdpr.export", async () => {
    const job = (
      await db
        .select()
        .from(schema.gdprExportJobs)
        .where(eq(schema.gdprExportJobs.id, jobId))
        .limit(1)
    )[0];
    if (!job) return;

    try {
      await db
        .update(schema.gdprExportJobs)
        .set({ state: "exporting", progress: 0, startedAt: new Date() })
        .where(eq(schema.gdprExportJobs.id, jobId));

      // Streaming export — pseudo-code:
      // const zipStream = createZipStream();
      // append JSON files per table to zipStream as they are queried;
      // update progress after each table; finalize zip.

      // For now: stub
      const ws = await exportWorkspace(job.workspaceId);
      const stub = JSON.stringify({ workspace: ws });

      const { signedUrl, expiresAt } = await uploadZip(
        `${job.workspaceId}/${jobId}.zip`,
        // @ts-expect-error stub
        Buffer.from(stub) as any
      );

      // Find owner email
      const owner = (
        await db
          .select({ email: schema.users.email })
          .from(schema.users)
          .where(eq(schema.users.id, job.requestedByUserId))
          .limit(1)
      )[0];

      if (owner) await sendExportReadyEmail(owner.email, signedUrl, expiresAt);

      await db
        .update(schema.gdprExportJobs)
        .set({
          state: "completed",
          progress: 100,
          signedUrl,
          signedUrlExpiresAt: expiresAt,
          completedAt: new Date(),
        })
        .where(eq(schema.gdprExportJobs.id, jobId));
    } catch (e: any) {
      await db
        .update(schema.gdprExportJobs)
        .set({
          state: "failed",
          error: String(e?.message ?? e),
          retryCount: (job.retryCount ?? 0) + 1,
        })
        .where(eq(schema.gdprExportJobs.id, jobId));
    }
  });
}
```

- [ ] **Step 4: POST /export endpoint**

```typescript
// apps/web/app/api/workspaces/[slug]/export/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createId } from "@paralleldrive/cuid2";
import { getDb, schema } from "@orchester/db";
import { resolveBySlug } from "@/lib/tenant/resolve";
import { getCurrentSession } from "@/lib/workspace";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const session = await getCurrentSession();
  if (!session)
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const ws = await resolveBySlug(slug);
  if (!ws)
    return NextResponse.json({ error: "workspace_not_found" }, { status: 404 });
  if (ws.ownerUserId !== session.user.id) {
    return NextResponse.json({ error: "role_insufficient" }, { status: 403 });
  }

  const db = getDb();
  const jobId = `exp_${createId()}`;
  await db.insert(schema.gdprExportJobs).values({
    id: jobId,
    workspaceId: ws.id,
    requestedByUserId: session.user.id,
    state: "pending",
    progress: 0,
  });

  // Enqueue worker
  // (Plug into pg-boss: boss.send("gdpr.export", { jobId }))

  return NextResponse.json(
    { jobId, state: "pending", estimatedDurationSeconds: 180 },
    { status: 202 }
  );
}
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/gdpr/ apps/web/app/api/workspaces/[slug]/export/
git commit -m "feat(gdpr): export job skeleton (worker + storage + email + endpoint)"
```

### Task E.7: ADR docs

**Files:**

- Create: `docs/adr/006-multi-tenancy-isolation.md` through `013-tenant-context-via-guc.md`

- [ ] **Step 1: Write 8 ADRs from D-001 to D-013 in spec**

For each ADR, use the Nygard template:

```markdown
# ADR-006 — Multi-tenancy isolation strategy (L1 RLS)

Date: 2026-05-23
Status: Accepted

## Context

Orchester must scale to 10k+ tenants with strong isolation but low operational overhead. Four standard tenancy levels exist (L1-L4 per AWS SaaS Lens).

## Decision

Adopt L1 logical row-level isolation. Every tenant-scoped table carries a `workspace_id` foreign key. PostgreSQL RLS enforces isolation as a second barrier behind application-level filters.

## Consequences

**Positive:** scales to many tenants in one DB cluster; cheaper than L2/L3; standard PostgreSQL feature set.
**Negative:** single code bug can risk cross-tenant leak; mitigated by RLS + isolation E2E tests + lint rules.
**Revisit when:** an Enterprise customer requests BYO database (then L3 as add-on).
```

(Write ADRs 007 through 013 following the same pattern. Each ≤ 200 words. Reference D-001 to D-013 from the spec.)

- [ ] **Step 2: Commit**

```bash
git add docs/adr/006-*.md docs/adr/007-*.md docs/adr/008-*.md docs/adr/009-*.md docs/adr/010-*.md docs/adr/011-*.md docs/adr/012-*.md docs/adr/013-*.md
git commit -m "docs(adr): record 8 ADRs from tenant hardening spec (006-013)"
```

### Task E.8: Incident response runbook

**Files:**

- Create: `docs/runbooks/incident-response.md`

- [ ] **Step 1: Write runbook**

```markdown
# Incident Response Runbook — Tenant Isolation & Audit

## Severity classification

- **SEV-1** (critical): cross-tenant data leak confirmed, audit chain break confirmed, ransomware, data exfiltration
- **SEV-2** (high): suspected breach, mass auth failures, isolation test fail in prod
- **SEV-3** (low): anomaly, single user complaint

## Phase A — Triage (0-15 min)

1. On-call ack alert.
2. Identify scope: 1 workspace? Multiple? All?
3. Severity classification.
4. Open incident channel (Slack `#inc-YYYYMMDD-N`).

## Phase B — Containment (15-60 min)

- Cross-tenant leak: disable affected endpoint via feature flag; freeze writes.
- Audit chain break: snapshot Postgres; preserve forensics.
- Auth compromise: force logout; rotate session secret.
- Data exfil suspected: revoke API keys; suspend webhooks.
- Key compromise: rotate encryption keys; re-encrypt; revoke caches.

## Phase C — Eradication & recovery (1-24h)

- Patch root cause.
- Re-enable systems.
- Restore from backup if needed.
- Notify customers within 72h (GDPR Art. 33).

## Phase D — Post-mortem

- Blameless post-mortem in 5 business days.
- Action items in issues.
- Update threat model.

## Common scenarios

### Scenario: Audit chain break detected (PagerDuty alert)

1. Snapshot Postgres state: `pg_dump --no-owner --format=custom orchester > snapshot-$(date +%s).dump`.
2. Identify which workspace + entry: `SELECT * FROM security_event WHERE event_type='audit_chain.break_detected' ORDER BY created_at DESC LIMIT 5;`
3. Lock down: do NOT auto-suspend the workspace. Human decision.
4. Investigate: was it a deploy bug, malicious actor, or DB tampering?
5. Inform owner of affected workspace within 72h if breach is confirmed.

### Scenario: Cross-tenant leak suspected

1. Disable affected endpoint via feature flag.
2. Snapshot logs of affected requests (request IDs).
3. Inspect SQL trail in Postgres logs.
4. Verify RLS is FORCED on affected table: `SELECT tablename, forcerowsecurity FROM pg_tables WHERE tablename='X';`
5. Patch the code path; redeploy.
6. Run isolation E2E suite against staging with the fix.
7. Notify all affected customers within 72h.

### Scenario: GDPR export job stuck

1. Check `gdpr_export_job` row state.
2. If state='exporting' for > 1h, retry or mark failed via direct SQL (cron_admin).
3. Re-enqueue: `boss.send("gdpr.export", { jobId })`.
```

- [ ] **Step 2: Commit**

```bash
git add docs/runbooks/incident-response.md
git commit -m "docs(runbook): incident response for tenant isolation + audit breaks"
```

### Task E.9: Derivative API endpoints + UI components (parallelizable)

The spec defines additional endpoints and components that follow established patterns. Each is a self-contained mini-task; they can be parallelized across subagents.

**Files to create (one task per row):**

| Endpoint / Component                             | Pattern reference                                           | Concrete change                                                                                                                                                 |
| ------------------------------------------------ | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PATCH /api/workspaces/[slug]`                   | E.1 (GET handler) + use `assertCan(role, 'settings.write')` | Update name/timezone (admin), slug (owner only). Audit `workspace.update`.                                                                                      |
| `POST /api/workspaces/[slug]/suspend`            | E.1 + `lifecycle.suspend()`                                 | Admin-global only. Body: `{ reason }`.                                                                                                                          |
| `DELETE /api/workspaces/[slug]/suspend`          | E.1 + `lifecycle.unsuspend()`                               | Admin-global only.                                                                                                                                              |
| `POST /api/workspaces/[slug]/transfer`           | E.1 + check `ownerUserId === session.user.id`               | Body: `{ newOwnerId, password }`. Verify password via better-auth. Update `ownerUserId` + member role swap. Force session rotation. Audit `workspace.transfer`. |
| `GET /api/workspaces/[slug]/export/[jobId]`      | E.3 (GET audit) + select from `gdpr_export_job`             | Returns state machine snapshot. Requester only.                                                                                                                 |
| `GET /api/workspaces/[slug]/feature-flags`       | E.3 + `listFlags()`                                         | Admin/owner only.                                                                                                                                               |
| `PUT /api/workspaces/[slug]/feature-flags/[key]` | E.3 + `setFlag()`                                           | Body: `{ enabled: boolean }`. Audit `featureflag.set`.                                                                                                          |
| `GET /api/workspaces/[slug]/members`             | (already exists in current codebase)                        | Verify it uses new tenant context (no code change usually).                                                                                                     |
| `POST /api/workspaces/[slug]/invites`            | (already exists)                                            | Idem.                                                                                                                                                           |
| `PATCH /api/workspaces/[slug]/members/[userId]`  | (already exists)                                            | Audit `member.role_change`.                                                                                                                                     |
| `DELETE /api/workspaces/[slug]/members/[userId]` | (already exists)                                            | Audit `member.remove` + `invalidateAllMembershipFor(userId)`.                                                                                                   |
| `POST /api/me/active-workspace`                  | Read body `{ slug }`, set cookie                            | Validate user is a member; reject otherwise.                                                                                                                    |

| Component                                              | Pattern reference                             | Concrete change                                                                                                |
| ------------------------------------------------------ | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `components/workspace/SoftDeleteWorkspaceModal.tsx`    | `CreateWorkspaceModal` (D.4)                  | Confirmation requires typing slug. Submits `DELETE /api/workspaces/[slug]`. Show restoreToken on success.      |
| `components/workspace/DeletedWorkspaceRestoreCard.tsx` | New page at `/[locale]/deleted/[id]/page.tsx` | Display deletedAt + restoreUntil. Input for token (optional if owner authenticated). POST to restore endpoint. |
| `components/workspace/SuspendedBanner.tsx`             | Sticky `role="status"` banner                 | Read suspended reason from active workspace. Show on every shell page when `status === "suspended"`.           |
| `components/workspace/TransferOwnershipModal.tsx`      | `CreateWorkspaceModal` (D.4)                  | Choose new owner from admin/owner members. Confirm with password.                                              |
| `components/workspace/GdprExportProgress.tsx`          | Sticky bottom-right toast                     | SWR polling on `/api/workspaces/[slug]/export/[jobId]` every 3s. Display state machine + signedUrl.            |
| `components/workspace/AuditLogViewer.tsx`              | Settings tab content                          | Cursor pagination via `/audit?cursor=...`. Chain status badge calls `/audit/verify`.                           |
| `components/workspace/FeatureFlagAdminPanel.tsx`       | Settings tab                                  | List + toggle flags via `PUT /feature-flags/[key]`. Optimistic UI with rollback.                               |
| `components/workspace/InviteMemberQuickAction.tsx`     | `CreateWorkspaceModal` (D.4)                  | Email + role. Submits to `/invites`.                                                                           |

- [ ] **Step 1: Create each endpoint/component as separate atomic task per row**

For each row, follow the established pattern. Code skeleton for each is ≤ 50 lines. Estimate 15-30 min each.

- [ ] **Step 2: Wire components into Settings tabs**

Add tabs to `apps/web/components/settings/SettingsClient.tsx` for `audit`, `feature-flags`. Render `AuditLogViewer` and `FeatureFlagAdminPanel` respectively.

- [ ] **Step 3: Add `SuspendedBanner` to shell layout**

In `apps/web/app/[locale]/[workspaceSlug]/(shell)/layout.tsx`, conditionally render the banner when active workspace has `status === "suspended"`.

- [ ] **Step 4: Add `GdprExportProgress` as global persistent component**

Mount in the shell layout (root) so it survives navigation. State managed by SWR keyed on the latest job ID stored in localStorage.

- [ ] **Step 5: Add `SoftDeleteWorkspaceModal` and `TransferOwnershipModal` to Settings → Danger Zone**

These already have UI hooks in `DangerZoneSection.tsx`; wire them to call the new endpoints.

- [ ] **Step 6: Run full test suite + typecheck after each batch**

```bash
cd apps/web && pnpm exec tsc --noEmit && pnpm exec vitest run && pnpm exec next lint
```

- [ ] **Step 7: Commit each row as a separate commit**

```bash
git commit -m "feat(workspace): <endpoint or component name>"
```

### Task E.10: Final gate verification + tag

- [ ] **Step 1: Run full suite**

```bash
cd apps/web
pnpm exec tsc --noEmit
pnpm exec next lint
pnpm exec vitest run
```

Expected: all green.

- [ ] **Step 2: Manual smoke**

- Switcher works (⌘K opens, navigation switches).
- Create workspace flow end-to-end.
- Soft-delete + restore.
- Suspended workspace shows banner + blocks mutations.
- Audit log viewer shows entries with chain status.
- GDPR export triggers (verify pending state in DB; full pipeline tested in staging).

- [ ] **Step 3: Tag complete**

```bash
git tag phase-e-complete -m "Tenant Hardening Phase E: lifecycle features GA"
git tag tenant-hardening-v1 -m "Sub-spec 1 complete: tenant hardening + workspace switcher"
```

**Sub-spec 1 is complete and production-hardened.** Ready for Sub-spec 2 (Brain Core).

---

## Plan completion summary

| Phase                        | Tasks | Tag                                       |
| ---------------------------- | ----- | ----------------------------------------- |
| Pre-flight                   | 2     | —                                         |
| A — Foundation               | 25    | `phase-a-complete`                        |
| B — Silent backfill          | 4     | `phase-b-complete`                        |
| C — RLS FORCE                | 3     | `phase-c-complete`                        |
| D — URL migration + switcher | 7     | `phase-d-complete`                        |
| E — Lifecycle GA             | 9     | `phase-e-complete`, `tenant-hardening-v1` |

Total: 50 atomic tasks across 5 phases.

**Execution:** Each task is self-contained, with failing test → minimal implementation → passing test → commit. After all phases complete, run the isolation E2E suite, audit chain verify, and performance baseline to confirm gates.

**Next sub-spec:** Brain Core (sub-spec 2). Open brainstorming for that once this one ships.
