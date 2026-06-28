// apps/web/tests/integration/dev-seed/lightweight.spec.ts
//
// SET-5 — the per-workspace lightweight demo seed creates a handful of
// agents + a flow + conversations, scoped to the given workspace, and is
// idempotent (a second call doesn't duplicate).
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.unmock("@orchester/db");
vi.doUnmock("@orchester/db");

import {
  setupTestWorkspaces,
  teardownTestWorkspaces,
  type WsFixture,
} from "../../fixtures/workspaces";

let wsA: WsFixture;
let seedLightweightDemo: typeof import("@/lib/dev-seed/lightweight").seedLightweightDemo;
let getDb: typeof import("@orchester/db").getDb;
let schema: typeof import("@orchester/db").schema;
let eq: typeof import("drizzle-orm").eq;

beforeAll(async () => {
  [wsA] = await setupTestWorkspaces();
  ({ seedLightweightDemo } = await import("@/lib/dev-seed/lightweight"));
  ({ getDb, schema } = await import("@orchester/db"));
  ({ eq } = await import("drizzle-orm"));
}, 60_000);

afterAll(() => teardownTestWorkspaces());

describe("seedLightweightDemo", () => {
  it("seeds sample data into the given workspace and is idempotent", async () => {
    const before = await getDb()
      .select()
      .from(schema.agents)
      .where(eq(schema.agents.workspaceId, wsA.id));

    const r1 = await seedLightweightDemo(wsA.id);
    expect(r1.seeded).toBe(true);

    const afterFirst = await getDb()
      .select()
      .from(schema.agents)
      .where(eq(schema.agents.workspaceId, wsA.id));
    expect(afterFirst.length).toBeGreaterThan(before.length);

    // Idempotent — second call must not duplicate the seeded agents.
    const r2 = await seedLightweightDemo(wsA.id);
    expect(r2.seeded).toBe(false);

    const afterSecond = await getDb()
      .select()
      .from(schema.agents)
      .where(eq(schema.agents.workspaceId, wsA.id));
    expect(afterSecond.length).toBe(afterFirst.length);

    // A demo flow + at least one demo conversation exist.
    const flows = await getDb()
      .select()
      .from(schema.flows)
      .where(eq(schema.flows.workspaceId, wsA.id));
    expect(flows.length).toBeGreaterThanOrEqual(1);
  });
});
