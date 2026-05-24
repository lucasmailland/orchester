// apps/web/tests/integration/audit/log.spec.ts
//
// Spec: docs/specs/2026-05-23-tenant-hardening-design.md §3.3 + §3.4
// Plan: Task A.18
//
// Drives `appendAuditSync` against a real postgres (testcontainer) to
// verify the per-workspace advisory lock prevents seq gaps even under
// concurrent writers.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

// The global vitest.setup.ts stubs out @orchester/db so unit tests can
// import server modules without a DB. Integration tests need the real
// thing — un-mock first, then dynamic-import everything that touches it.
vi.unmock("@orchester/db");
vi.doUnmock("@orchester/db");

import {
  setupTestWorkspaces,
  teardownTestWorkspaces,
  type WsFixture,
} from "../../fixtures/workspaces";

let wsA: WsFixture;
// Bind dynamically after fixtures set DATABASE_URL so the real modules
// see the testcontainer connection string at first import.
let appendAuditSync: typeof import("@/lib/audit/log").appendAuditSync;
let getDb: typeof import("@orchester/db").getDb;
let schema: typeof import("@orchester/db").schema;
let eq: typeof import("drizzle-orm").eq;
let asc: typeof import("drizzle-orm").asc;

beforeAll(async () => {
  [wsA] = await setupTestWorkspaces();
  // Dynamic imports so module evaluation happens AFTER DATABASE_URL is set
  // by setupTestDb (via setupTestWorkspaces).
  ({ appendAuditSync } = await import("@/lib/audit/log"));
  ({ getDb, schema } = await import("@orchester/db"));
  ({ eq, asc } = await import("drizzle-orm"));
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
    expect(rows[0]).toBeDefined();
    expect(rows[0]!.seq).toBe(BigInt(1));
    expect(rows[0]!.prevHash).toBeNull();
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
      await db.select().from(schema.auditLog).where(eq(schema.auditLog.workspaceId, wsA.id))
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
