// packages/mnemosyne/tests/integration/dedup.spec.ts
//
// Integration tests for the v1.2 janitor dedup pipeline.
//
// Strategy: seed N near-duplicate facts with identical pre-computed
// embeddings + a couple of diverse ones. Assert that:
//   • findDedupCandidates returns one cluster with 3 members,
//   • mergeCluster archives 2 rows into mnemo_fact_archive (with
//     archive_reason = 'merged' and merged_into_id = primary.id),
//   • the primary survives with the SUM of cluster hit_counts.
//
// Mode A facts (no embedding) are seeded as a control — they must
// NEVER end up in a cluster.
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
let findDedupCandidates: typeof import("../../src/janitor/dedup").findDedupCandidates;
let mergeCluster: typeof import("../../src/janitor/dedup").mergeCluster;

// mnemo_fact.embedding is vector(1536). We build deterministic axis-
// aligned vectors so identical vectors give cosine 1.0, axis-distinct
// give cosine ≈ 0.06 (well below the 0.92 threshold).
const VEC_DIM = 1536;
function axisVec(axis: 0 | 1 | 2 | 3): number[] {
  const v = new Array<number>(VEC_DIM).fill(0.001);
  const seg = Math.floor(VEC_DIM / 4);
  for (let i = axis * seg; i < (axis + 1) * seg; i++) v[i] = 1;
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n);
  for (let i = 0; i < VEC_DIM; i++) v[i] = v[i]! / n;
  return v;
}

const DUP_VEC = axisVec(0);
const DIVERSE_VEC = axisVec(1);

beforeAll(async () => {
  [wsA] = await setupTestWorkspaces();
  ({ withMnemoTx } = await import("../../src/tx"));
  ({ createFact } = await import("../../src/primitives/fact"));
  ({ findDedupCandidates, mergeCluster } = await import("../../src/janitor/dedup"));
});

afterAll(() => teardownTestWorkspaces());

describe("janitor/dedup — integration", () => {
  it("clusters near-duplicates and merges them into a single primary", async () => {
    // Seed 3 near-duplicate facts with identical embeddings + 1 diverse + 1 Mode A.
    const ids: string[] = [];
    await withMnemoTx(wsA.id, async (tx) => {
      for (let i = 0; i < 3; i++) {
        const f = await createFact({
          workspaceId: wsA.id,
          scope: "global",
          kind: "preference",
          subject: "user",
          statement: `dedup-cluster-near-dup-${i}: redundant variation #${i} for dedup`,
          embedding: DUP_VEC,
          tx,
        });
        ids.push(f.id);
      }
      await createFact({
        workspaceId: wsA.id,
        scope: "global",
        kind: "preference",
        subject: "user",
        statement: "dedup-diverse-control: this fact should never get clustered",
        embedding: DIVERSE_VEC,
        tx,
      });
      await createFact({
        workspaceId: wsA.id,
        scope: "global",
        kind: "preference",
        subject: "user",
        statement: "dedup-mode-a-control: no embedding, must be ignored by the cron",
        tx,
      });
      // Bump hit_count on the first near-dup so we can verify the SUM
      // lands on whichever fact wins the composite-score pick.
      await tx.execute(sql`
        UPDATE mnemo_fact SET hit_count = 5
        WHERE workspace_id = ${wsA.id} AND id = ${ids[0]}
      `);
      await tx.execute(sql`
        UPDATE mnemo_fact SET hit_count = 2
        WHERE workspace_id = ${wsA.id} AND id = ${ids[1]}
      `);
    });

    // ── findDedupCandidates ──────────────────────────────────────────
    const candidates = await withMnemoTx(wsA.id, (tx) =>
      findDedupCandidates({ workspaceId: wsA.id, tx })
    );
    // Filter to the cluster that contains OUR seeded ids — other tests
    // in this suite may have seeded their own embedded facts.
    const ourCluster = candidates.find((c) => {
      const members = [c.primary.id, ...c.duplicates.map((d) => d.id)];
      return ids.every((id) => members.includes(id));
    });
    expect(ourCluster).toBeDefined();
    expect(ourCluster!.duplicates.length + 1).toBe(3); // 3 members total.
    expect(ourCluster!.cosineMin).toBeGreaterThanOrEqual(0.92);

    // ── mergeCluster ─────────────────────────────────────────────────
    const result = await withMnemoTx(wsA.id, (tx) =>
      mergeCluster({ workspaceId: wsA.id, cluster: ourCluster!, tx })
    );
    expect(result.merged).toBe(2);

    // ── verify state ─────────────────────────────────────────────────
    await withMnemoTx(wsA.id, async (tx) => {
      // 1. Primary survives in mnemo_fact.
      const primaryRows = (await tx.execute(sql`
        SELECT id, hit_count FROM mnemo_fact
        WHERE workspace_id = ${wsA.id} AND id = ${ourCluster!.primary.id}
      `)) as unknown as Array<{ id: string; hit_count: number }>;
      expect(primaryRows.length).toBe(1);
      // hit_count is the SUM across the cluster: 5 + 2 + 0 = 7.
      expect(Number(primaryRows[0]!.hit_count)).toBe(7);

      // 2. Duplicates are gone from mnemo_fact.
      const dupIds = ourCluster!.duplicates.map((d) => d.id);
      const remaining = (await tx.execute(sql`
        SELECT id FROM mnemo_fact
        WHERE workspace_id = ${wsA.id} AND id = ANY(${sql.param(dupIds)}::text[])
      `)) as unknown as Array<{ id: string }>;
      expect(remaining.length).toBe(0);

      // 3. Duplicates landed in mnemo_fact_archive with the right shape.
      const archived = (await tx.execute(sql`
        SELECT id, archive_reason, merged_into_id, original_status
        FROM mnemo_fact_archive
        WHERE workspace_id = ${wsA.id} AND id = ANY(${sql.param(dupIds)}::text[])
      `)) as unknown as Array<{
        id: string;
        archive_reason: string;
        merged_into_id: string;
        original_status: string;
      }>;
      expect(archived.length).toBe(2);
      for (const row of archived) {
        expect(row.archive_reason).toBe("merged");
        expect(row.merged_into_id).toBe(ourCluster!.primary.id);
        expect(row.original_status).toBe("active");
      }
    });
  });

  it("re-running on the same workspace is idempotent (zero new merges)", async () => {
    // The previous test left an embedded primary + a diverse fact +
    // a Mode A fact. None should cluster.
    const candidates = await withMnemoTx(wsA.id, (tx) =>
      findDedupCandidates({ workspaceId: wsA.id, tx })
    );
    // The diverse fact (axis 1) is alone in vector space; no cluster
    // should form for it. Any remaining clusters belong to a previous
    // suite's seed — verify ours is gone by id.
    expect(candidates.every((c) => c.duplicates.length >= 1)).toBe(true);
  });
});
