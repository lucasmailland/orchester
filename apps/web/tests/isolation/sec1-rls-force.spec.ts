import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.unmock("@orchester/db");
vi.doUnmock("@orchester/db");

import { setupTestDb, teardownTestDb, getTestDbUrl } from "../fixtures/db";
import {
  setupIsolation,
  teardownIsolation,
  withAppUserContext,
  withCronAdminContext,
  type IsolationFixture,
} from "./helpers";
import { teardownTestWorkspaces } from "../fixtures/workspaces";
import { createId } from "@paralleldrive/cuid2";
import postgres from "postgres";

let sql: ReturnType<typeof postgres>;

beforeAll(async () => {
  await setupTestDb();
  const url = getTestDbUrl();
  if (!url) throw new Error("setupTestDb did not expose a URL");
  sql = postgres(url, { max: 1, onnotice: () => {} });
}, 90_000);

afterAll(async () => {
  await sql?.end({ timeout: 5 });
  await teardownTestDb();
});

describe("SEC-1: schema catch-up migration", () => {
  it("creates the tables the TS schema declares but the baseline lacked", async () => {
    const rows = await sql.unsafe(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema='public'
         AND table_name = ANY($1)`,
      [["org", "gdpr_export_job", "security_event", "idempotency_key", "agent_tool"]]
    );
    const present = new Set(rows.map((r) => r["table_name"] as string));
    expect(present.has("org")).toBe(true);
    expect(present.has("gdpr_export_job")).toBe(true);
    expect(present.has("security_event")).toBe(true);
    expect(present.has("idempotency_key")).toBe(true);
    expect(present.has("agent_tool")).toBe(true);
  });

  it("adds the workspace lifecycle columns", async () => {
    const cols = await sql.unsafe(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema='public' AND table_name='workspace'`
    );
    const names = new Set(cols.map((c) => c["column_name"] as string));
    for (const c of [
      "status",
      "suspended_at",
      "deleted_at",
      "delete_scheduled_at",
      "restore_token",
      "owner_user_id",
      "org_id",
    ]) {
      expect(names.has(c)).toBe(true);
    }
  });
});

describe("SEC-1: RLS helpers + roles", () => {
  it("defines current_workspace_id() and is_cross_tenant_admin()", async () => {
    const fns = await sql.unsafe(
      `SELECT proname FROM pg_proc
       WHERE proname IN ('current_workspace_id','is_cross_tenant_admin','apply_pattern_a')`
    );
    const names = new Set(fns.map((r) => r["proname"] as string));
    expect(names.has("current_workspace_id")).toBe(true);
    expect(names.has("is_cross_tenant_admin")).toBe(true);
    expect(names.has("apply_pattern_a")).toBe(true);
  });

  it("creates app_user (no bypassrls) and cron_admin (bypassrls)", async () => {
    const roles = await sql.unsafe(
      `SELECT rolname, rolbypassrls FROM pg_roles
       WHERE rolname IN ('app_user','cron_admin','read_only_audit')`
    );
    const byName = new Map(
      roles.map((r) => [r["rolname"] as string, r["rolbypassrls"] as boolean])
    );
    expect(byName.has("app_user")).toBe(true);
    expect(byName.get("app_user")).toBe(false);
    expect(byName.get("cron_admin")).toBe(true);
  });

  it("current_workspace_id() returns the LOCAL app.workspace_id GUC", async () => {
    const out = await sql.begin(async (tx) => {
      await tx.unsafe(`SELECT set_config('app.workspace_id', 'ws-test-123', true)`);
      return tx.unsafe(`SELECT current_workspace_id() AS wid`);
    });
    expect(out[0]?.["wid"]).toBe("ws-test-123");
  });
});

const PATTERN_A = [
  "team",
  "agent",
  "channel",
  "employee",
  "conversation",
  "flow",
  "flow_run",
  "workspace_integration",
  "api_key",
  "knowledge_base",
  "knowledge_doc",
  "knowledge_chunk",
  "agent_memory",
  "audit_log",
  "feature_flag",
  "gdpr_export_job",
  "conversation_label",
  "notification_pref",
  "ai_provider",
  "outbound_webhook",
  "security_event",
  "agent_tool",
  "agent_version",
  "flow_schedule",
  "flow_version",
  "flow_webhook",
  "usage_event",
  "webhook_delivery",
  "workspace_billing",
  "workspace_invite",
];

describe("SEC-1: RLS enabled + policies", () => {
  it.each(PATTERN_A)("%s has rowsecurity enabled", async (table) => {
    const rows = await sql.unsafe(`SELECT relrowsecurity FROM pg_class WHERE relname=$1`, [table]);
    expect(rows[0]?.["relrowsecurity"]).toBe(true);
  });

  it("message and flow_run_step (Pattern B) have RLS enabled", async () => {
    for (const t of ["message", "flow_run_step"]) {
      const rows = await sql.unsafe(`SELECT relrowsecurity FROM pg_class WHERE relname=$1`, [t]);
      expect(rows[0]?.["relrowsecurity"]).toBe(true);
    }
  });

  it("each Pattern A table has 4 tenant policies", async () => {
    const counts = await sql.unsafe(
      `SELECT tablename, count(*)::int AS n FROM pg_policies
       WHERE schemaname='public' AND tablename = ANY($1)
       GROUP BY tablename`,
      [PATTERN_A]
    );
    for (const row of counts) {
      expect(row["n"], `${row["tablename"]} policy count`).toBeGreaterThanOrEqual(4);
    }
    expect(counts.length).toBe(PATTERN_A.length);
  });
});

describe("SEC-1: FORCE RLS blocks cross-tenant reads/writes (NOSUPERUSER)", () => {
  let f: IsolationFixture;

  beforeAll(async () => {
    f = await setupIsolation();
    await f.sql.unsafe(
      `INSERT INTO agent (id, workspace_id, name, role, system_prompt, status)
       VALUES ($1,$2,'force-A','r','sp','active')`,
      [createId(), f.wsA.id]
    );
    await f.sql.unsafe(
      `INSERT INTO agent (id, workspace_id, name, role, system_prompt, status)
       VALUES ($1,$2,'force-B','r','sp','active')`,
      [createId(), f.wsB.id]
    );
  }, 90_000);

  afterAll(async () => {
    await teardownIsolation(f);
    await teardownTestWorkspaces();
  });

  it("agent table is FORCE row level security", async () => {
    const rows = await f.sql.unsafe(
      `SELECT relforcerowsecurity FROM pg_class WHERE relname='agent'`
    );
    expect(rows[0]?.["relforcerowsecurity"]).toBe(true);
  });

  it("workspace table is FORCE row level security", async () => {
    const rows = await sql.unsafe(
      `SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'workspace'`
    );
    expect(rows[0]?.["relrowsecurity"]).toBe(true);
    expect(rows[0]?.["relforcerowsecurity"]).toBe(true);
  });

  it("app_user scoped to wsA sees only wsA agents (no wsB leak)", async () => {
    const visible = await withAppUserContext(f.sql, f.wsA.id, (tx) =>
      tx.unsafe(`SELECT workspace_id FROM agent`)
    );
    expect(visible.length).toBeGreaterThan(0);
    for (const r of visible) expect(r["workspace_id"]).toBe(f.wsA.id);
  });

  it("app_user scoped to wsA CANNOT insert a row for wsB (WITH CHECK)", async () => {
    await expect(
      withAppUserContext(f.sql, f.wsA.id, (tx) =>
        tx.unsafe(
          `INSERT INTO agent (id, workspace_id, name, role, system_prompt, status)
           VALUES ($1,$2,'evil','r','sp','active')`,
          [createId(), f.wsB.id]
        )
      )
    ).rejects.toThrow();
  });

  it("cron_admin (BYPASSRLS) sees both workspaces", async () => {
    const all = await withCronAdminContext(f.sql, (tx) =>
      tx.unsafe(`SELECT DISTINCT workspace_id FROM agent WHERE name LIKE 'force-%'`)
    );
    const ids = new Set(all.map((r) => r["workspace_id"] as string));
    expect(ids.has(f.wsA.id)).toBe(true);
    expect(ids.has(f.wsB.id)).toBe(true);
  });
});
