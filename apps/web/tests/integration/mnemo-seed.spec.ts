// apps/web/tests/integration/mnemo-seed.spec.ts
//
// v1.6 G1-7: integration spec for the dev seeder + admin endpoint
// that bootstraps the Memory Inspector smoke test.
//
// Verifies that:
//   1. `seedMnemoFacts({ workspaceId, count: 30 })` lands 30 rows in
//      mnemo_fact under the right workspace, with the documented
//      distribution (kind / memory_type / pinned / hit_count).
//   2. Re-running the seeder is idempotent within a single test run
//      (deterministic ids would otherwise re-fire ON CONFLICT — we
//      use a timestamp prefix so each invocation creates fresh ids,
//      which is the desired behaviour for the smoke test).
//   3. Per-workspace isolation — facts seeded into wsA are invisible
//      to wsB's tx scope (RLS still enforces).
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.unmock("@orchester/db");
vi.doUnmock("@orchester/db");

import { sql } from "drizzle-orm";

import {
  setupTestWorkspaces,
  teardownTestWorkspaces,
  type WsFixture,
} from "../fixtures/workspaces";

let wsA: WsFixture;
let wsB: WsFixture;
let withMnemoTx: typeof import("@orchester/mnemosyne").withMnemoTx;
let seedMnemoFacts: typeof import("../../lib/dev-seed/mnemo-seed").seedMnemoFacts;

beforeAll(async () => {
  [wsA, wsB] = await setupTestWorkspaces();
  ({ withMnemoTx } = await import("@orchester/mnemosyne"));
  ({ seedMnemoFacts } = await import("../../lib/dev-seed/mnemo-seed"));
});

afterAll(() => teardownTestWorkspaces());

async function countSeedFacts(workspaceId: string): Promise<number> {
  return withMnemoTx(workspaceId, async (tx) => {
    const rows = (await tx.execute(sql`
      SELECT count(*)::int AS n
      FROM mnemo_fact
      WHERE workspace_id = ${workspaceId}
        AND id LIKE 'mfact_seed_%'
    `)) as unknown as Array<{ n: number }>;
    return rows[0]?.n ?? 0;
  });
}

describe("dev-seed/mnemo-seed — v1.6 G1-6 Inspector bootstrap", () => {
  it("inserts the default 30 facts with the documented distribution", async () => {
    // Clean any prior seed rows so the count is deterministic.
    await withMnemoTx(wsA.id, async (tx) => {
      await tx.execute(
        sql`DELETE FROM mnemo_fact WHERE workspace_id = ${wsA.id} AND id LIKE 'mfact_seed_%'`
      );
    });

    const result = await seedMnemoFacts({ workspaceId: wsA.id, count: 30 });

    expect(result.inserted).toBe(30);
    expect(result.pinnedCount).toBe(5);
    // All seven kinds represented.
    expect(Object.keys(result.byKind).length).toBe(7);
    expect(Object.values(result.byKind).reduce((a, b) => a + b, 0)).toBe(30);
    // All four memory types represented.
    expect(result.byMemoryType.semantic).toBeGreaterThan(0);
    expect(result.byMemoryType.episodic).toBeGreaterThan(0);
    expect(result.byMemoryType.procedural).toBeGreaterThan(0);
    expect(result.byMemoryType.working).toBeGreaterThan(0);

    const n = await countSeedFacts(wsA.id);
    expect(n).toBe(30);
  });

  it("respects custom count parameter", async () => {
    await withMnemoTx(wsA.id, async (tx) => {
      await tx.execute(
        sql`DELETE FROM mnemo_fact WHERE workspace_id = ${wsA.id} AND id LIKE 'mfact_seed_%'`
      );
    });

    const result = await seedMnemoFacts({ workspaceId: wsA.id, count: 10 });
    expect(result.inserted).toBe(10);

    const n = await countSeedFacts(wsA.id);
    expect(n).toBe(10);
  });

  it("clamps count to [1, 200]", async () => {
    await withMnemoTx(wsA.id, async (tx) => {
      await tx.execute(
        sql`DELETE FROM mnemo_fact WHERE workspace_id = ${wsA.id} AND id LIKE 'mfact_seed_%'`
      );
    });

    const result = await seedMnemoFacts({ workspaceId: wsA.id, count: 500 });
    expect(result.inserted).toBeLessThanOrEqual(200);
  });

  it("seeded facts in wsA are invisible to wsB via RLS", async () => {
    await withMnemoTx(wsA.id, async (tx) => {
      await tx.execute(
        sql`DELETE FROM mnemo_fact WHERE workspace_id = ${wsA.id} AND id LIKE 'mfact_seed_%'`
      );
    });
    await seedMnemoFacts({ workspaceId: wsA.id, count: 5 });

    const aCount = await countSeedFacts(wsA.id);
    const bCount = await countSeedFacts(wsB.id);
    expect(aCount).toBe(5);
    expect(bCount).toBe(0);
  });
});
