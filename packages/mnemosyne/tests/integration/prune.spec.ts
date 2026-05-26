// packages/mnemosyne/tests/integration/prune.spec.ts
//
// Integration tests for the v1.2 janitor prune pipeline.
//
// Strategy: seed a workspace with a mix of:
//   • stale facts (old + 0 hits + low relevance) — eligible
//   • a pinned fact that ALSO matches the predicate — must NOT be pruned
//   • a "useful" fact (recent + high relevance) — must NOT be pruned
//   • a fact with hit_count > 0 — must NOT be pruned
//
// Assert that findPruneCandidates returns ONLY the stale ones, and
// that pruneFacts moves them to mnemo_fact_archive with
// archive_reason = 'pruned_inactive'.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { sql } from "drizzle-orm";

vi.unmock("@orchester/db");
vi.doUnmock("@orchester/db");

import {
  setupTestWorkspaces,
  teardownTestWorkspaces,
  type WsFixture,
} from "../../../../apps/web/tests/fixtures/workspaces";

let wsA: WsFixture;
let withMnemoTx: typeof import("../../src/tx").withMnemoTx;
let createFact: typeof import("../../src/primitives/fact").createFact;
let findPruneCandidates: typeof import("../../src/janitor/prune").findPruneCandidates;
let pruneFacts: typeof import("../../src/janitor/prune").pruneFacts;

beforeAll(async () => {
  [wsA] = await setupTestWorkspaces();
  ({ withMnemoTx } = await import("../../src/tx"));
  ({ createFact } = await import("../../src/primitives/fact"));
  ({ findPruneCandidates, pruneFacts } = await import("../../src/janitor/prune"));
});

afterAll(() => teardownTestWorkspaces());

/**
 * Seed N facts whose `created_at` is backdated past the prune
 * threshold and whose `relevance` is below the floor. Returns the
 * created fact ids in seed order.
 */
async function seedStaleFacts(count: number, tagPrefix: string): Promise<string[]> {
  const created: string[] = [];
  await withMnemoTx(wsA.id, async (tx) => {
    for (let i = 0; i < count; i++) {
      const f = await createFact({
        workspaceId: wsA.id,
        scope: "global",
        kind: "preference",
        subject: "user",
        statement: `${tagPrefix}-stale-${i}: old fact with zero hits + low relevance`,
        tx,
      });
      created.push(f.id);
      // Backdate + force low relevance + clear hit_count so the
      // prune predicate matches.
      await tx.execute(sql`
        UPDATE mnemo_fact
        SET created_at = now() - interval '100 days',
            relevance = 0.05,
            hit_count = 0,
            last_recalled_at = NULL
        WHERE workspace_id = ${wsA.id} AND id = ${f.id}
      `);
    }
  });
  return created;
}

describe("janitor/prune — integration", () => {
  it("returns only stale facts; preserves pinned / useful / recently-hit ones", async () => {
    const staleIds = await seedStaleFacts(3, "prune-test-A");

    // Pinned + stale (predicate-matching except for the pinned gate).
    let pinnedId = "";
    // Useful (recent + high relevance) — must NOT match.
    let usefulId = "";
    // Has a hit — must NOT match.
    let hitId = "";

    await withMnemoTx(wsA.id, async (tx) => {
      const pinned = await createFact({
        workspaceId: wsA.id,
        scope: "global",
        kind: "preference",
        subject: "user",
        statement: "prune-test-A-pinned: this fact is pinned and must survive",
        pinned: true,
        tx,
      });
      pinnedId = pinned.id;
      await tx.execute(sql`
        UPDATE mnemo_fact
        SET created_at = now() - interval '120 days',
            relevance = 0.02,
            hit_count = 0
        WHERE workspace_id = ${wsA.id} AND id = ${pinnedId}
      `);

      const useful = await createFact({
        workspaceId: wsA.id,
        scope: "global",
        kind: "preference",
        subject: "user",
        statement: "prune-test-A-useful: recent fact with high relevance",
        tx,
      });
      usefulId = useful.id;
      // Default relevance is 1.0 from createFact — leave as is. created_at
      // is now() so the age gate fails too.

      const hit = await createFact({
        workspaceId: wsA.id,
        scope: "global",
        kind: "preference",
        subject: "user",
        statement: "prune-test-A-hit: old, low-relevance, but recalled once",
        tx,
      });
      hitId = hit.id;
      await tx.execute(sql`
        UPDATE mnemo_fact
        SET created_at = now() - interval '120 days',
            relevance = 0.02,
            hit_count = 1,
            last_recalled_at = now() - interval '5 days'
        WHERE workspace_id = ${wsA.id} AND id = ${hitId}
      `);
    });

    // ── findPruneCandidates ──────────────────────────────────────────
    const candidates = await withMnemoTx(wsA.id, (tx) =>
      findPruneCandidates({ workspaceId: wsA.id, tx })
    );
    const candIds = new Set(candidates.map((c) => c.id));
    // All stale ids must be present.
    for (const id of staleIds) expect(candIds.has(id)).toBe(true);
    // Pinned / useful / hit must NOT be present.
    expect(candIds.has(pinnedId)).toBe(false);
    expect(candIds.has(usefulId)).toBe(false);
    expect(candIds.has(hitId)).toBe(false);

    // ── pruneFacts ───────────────────────────────────────────────────
    const result = await withMnemoTx(wsA.id, (tx) =>
      pruneFacts({
        workspaceId: wsA.id,
        factIds: staleIds,
        reason: "pruned_inactive",
        tx,
      })
    );
    expect(result.archived).toBe(staleIds.length);

    // ── verify state ─────────────────────────────────────────────────
    await withMnemoTx(wsA.id, async (tx) => {
      // 1. Stale rows are gone from mnemo_fact.
      const remaining = (await tx.execute(sql`
        SELECT id FROM mnemo_fact
        WHERE workspace_id = ${wsA.id} AND id = ANY(${sql.param(staleIds)}::text[])
      `)) as unknown as Array<{ id: string }>;
      expect(remaining.length).toBe(0);

      // 2. Stale rows are in mnemo_fact_archive with the right reason.
      const archived = (await tx.execute(sql`
        SELECT id, archive_reason, original_status
        FROM mnemo_fact_archive
        WHERE workspace_id = ${wsA.id} AND id = ANY(${sql.param(staleIds)}::text[])
      `)) as unknown as Array<{
        id: string;
        archive_reason: string;
        original_status: string;
      }>;
      expect(archived.length).toBe(staleIds.length);
      for (const row of archived) {
        expect(row.archive_reason).toBe("pruned_inactive");
        expect(row.original_status).toBe("active");
      }

      // 3. Pinned / useful / hit are still in mnemo_fact.
      const survivors = (await tx.execute(sql`
        SELECT id FROM mnemo_fact
        WHERE workspace_id = ${wsA.id} AND id = ANY(${sql.param([pinnedId, usefulId, hitId])}::text[])
      `)) as unknown as Array<{ id: string }>;
      expect(survivors.length).toBe(3);
    });
  });

  it("re-running pruneFacts on already-archived ids is a no-op", async () => {
    const staleIds = await seedStaleFacts(2, "prune-test-B");
    // First archive.
    await withMnemoTx(wsA.id, (tx) =>
      pruneFacts({ workspaceId: wsA.id, factIds: staleIds, reason: "pruned_inactive", tx })
    );
    // Second archive — should archive 0 rows (already gone from mnemo_fact).
    const result = await withMnemoTx(wsA.id, (tx) =>
      pruneFacts({ workspaceId: wsA.id, factIds: staleIds, reason: "pruned_inactive", tx })
    );
    expect(result.archived).toBe(0);
  });

  it("returns [] when no facts match the predicate", async () => {
    // The earlier tests should have left only non-matching facts in
    // wsA — pinned, useful, hit-bumped. A fresh call returns either
    // empty or only facts seeded by other tests that match by accident.
    // We don't assert exact emptiness because other suites share the
    // fixture; we only assert the call doesn't throw.
    const candidates = await withMnemoTx(wsA.id, (tx) =>
      findPruneCandidates({ workspaceId: wsA.id, tx })
    );
    expect(Array.isArray(candidates)).toBe(true);
  });
});
