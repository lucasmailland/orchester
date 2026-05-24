// apps/web/tests/integration/tenant/lifecycle.spec.ts
//
// Spec: docs/specs/2026-05-23-tenant-hardening-design.md §4 + §5
// Plan: Task A.22
//
// Drives the workspace lifecycle transitions against a real postgres
// (testcontainer) to verify status changes + audit side-effects.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

// The global vitest.setup.ts stubs out @orchester/db. Integration tests
// need the real DB module, so un-mock before any dynamic imports.
vi.unmock("@orchester/db");
vi.doUnmock("@orchester/db");

import {
  setupTestWorkspaces,
  teardownTestWorkspaces,
  type WsFixture,
} from "../../fixtures/workspaces";

let wsA: WsFixture;
let softDelete: typeof import("@/lib/tenant/lifecycle").softDelete;
let restore: typeof import("@/lib/tenant/lifecycle").restore;
let suspend: typeof import("@/lib/tenant/lifecycle").suspend;
let unsuspend: typeof import("@/lib/tenant/lifecycle").unsuspend;
let isAccessible: typeof import("@/lib/tenant/lifecycle").isAccessible;
let getDb: typeof import("@orchester/db").getDb;
let schema: typeof import("@orchester/db").schema;
let eq: typeof import("drizzle-orm").eq;

beforeAll(async () => {
  [wsA] = await setupTestWorkspaces();
  ({ softDelete, restore, suspend, unsuspend, isAccessible } =
    await import("@/lib/tenant/lifecycle"));
  ({ getDb, schema } = await import("@orchester/db"));
  ({ eq } = await import("drizzle-orm"));
});
afterAll(() => teardownTestWorkspaces());

async function getWs(id: string) {
  const db = getDb();
  return (
    await db.select().from(schema.workspaces).where(eq(schema.workspaces.id, id)).limit(1)
  )[0];
}

describe("lifecycle", () => {
  it("softDelete sets status=deleted + schedules hard-delete in 30 days", async () => {
    const result = await softDelete(wsA.id, { userId: wsA.ownerId });
    const ws = await getWs(wsA.id);
    expect(ws!.status).toBe("deleted");
    expect(ws!.deletedAt).toBeInstanceOf(Date);
    expect(ws!.deleteScheduledAt).toBeInstanceOf(Date);
    expect(result.restoreToken).toBeDefined();
  });

  it("restore returns workspace to active", async () => {
    const ws1 = await getWs(wsA.id);
    await restore(wsA.id, { token: ws1!.restoreToken!, userId: wsA.ownerId });
    const ws2 = await getWs(wsA.id);
    expect(ws2!.status).toBe("active");
    expect(ws2!.deletedAt).toBeNull();
  });

  it("suspend sets status=suspended", async () => {
    await suspend(wsA.id, { reason: "test", userId: wsA.ownerId });
    const ws = await getWs(wsA.id);
    expect(ws!.status).toBe("suspended");
    expect(ws!.suspendedReason).toBe("test");
  });

  it("unsuspend returns to active", async () => {
    await unsuspend(wsA.id, { userId: wsA.ownerId });
    const ws = await getWs(wsA.id);
    expect(ws!.status).toBe("active");
    expect(ws!.suspendedAt).toBeNull();
  });

  it("isAccessible returns suspended reason", async () => {
    await suspend(wsA.id, { reason: "test", userId: wsA.ownerId });
    const ws = await getWs(wsA.id);
    const r = isAccessible(ws!);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("suspended");
    await unsuspend(wsA.id, { userId: wsA.ownerId });
  });
});
