// packages/mnemosyne/tests/integration/consolidation-cluster.spec.ts
//
// Integration tests for `findConsolidationClusters` — the pure-READ
// phase of v1.4 REM-style consolidation. Asserts:
//
//   • clusters require >= minClusterSize members (default 4),
//   • clusters require SAME subject + SAME kind (semantic tightness),
//   • already-consolidated facts (with outgoing `derived_from`) are
//     excluded from a second pass — idempotency under re-run.
//
// The summarise + write phase (`consolidateCluster`) has its own
// LLM-mocked integration test in `consolidation.spec.ts`.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

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
let createRelation: typeof import("../../src/graph/relation").createRelation;
let findConsolidationClusters: typeof import("../../src/consolidation").findConsolidationClusters;

// mnemo_fact.embedding is vector(1536) — match dimensionality.
const VEC_DIM = 1536;

/** Axis-aligned 1536-dim vector: high weight on one segment, light
 *  spread elsewhere. Same construction as the recall-pruning suite. */
function axisVec(axis: number, jitter = 0): number[] {
  const v = new Array<number>(VEC_DIM).fill(0.001 + jitter * 0.0001);
  const seg = Math.floor(VEC_DIM / 8);
  for (let i = axis * seg; i < (axis + 1) * seg; i++) v[i] = 1;
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n);
  for (let i = 0; i < VEC_DIM; i++) v[i] = v[i]! / n;
  return v;
}

beforeAll(async () => {
  [wsA] = await setupTestWorkspaces();
  ({ withMnemoTx } = await import("../../src/tx"));
  ({ createFact } = await import("../../src/primitives/fact"));
  ({ createRelation } = await import("../../src/graph/relation"));
  ({ findConsolidationClusters } = await import("../../src/consolidation"));
});

afterAll(() => teardownTestWorkspaces());

describe("consolidation/cluster — findConsolidationClusters", () => {
  it("returns clusters of 4+ same-subject same-kind facts above the cosine threshold", async () => {
    // Seed 4 near-related facts about the same subject + kind.
    const vec = axisVec(0);
    const ids = await withMnemoTx(wsA.id, async (tx) => {
      const a = await createFact({
        workspaceId: wsA.id,
        scope: "global",
        kind: "preference",
        subject: "consolidation_subj_a",
        statement: "cluster_seed_a_1 — prefers TypeScript with strict mode",
        embedding: vec,
        tx,
      });
      const b = await createFact({
        workspaceId: wsA.id,
        scope: "global",
        kind: "preference",
        subject: "consolidation_subj_a",
        statement: "cluster_seed_a_2 — preferred to use strict TS in projects",
        embedding: vec,
        tx,
      });
      const c = await createFact({
        workspaceId: wsA.id,
        scope: "global",
        kind: "preference",
        subject: "consolidation_subj_a",
        statement: "cluster_seed_a_3 — TS strict mode chosen for new code",
        embedding: vec,
        tx,
      });
      const d = await createFact({
        workspaceId: wsA.id,
        scope: "global",
        kind: "preference",
        subject: "consolidation_subj_a",
        statement: "cluster_seed_a_4 — strict TypeScript across all new repos",
        embedding: vec,
        tx,
      });
      return [a.id, b.id, c.id, d.id];
    });

    const clusters = await withMnemoTx(wsA.id, (tx) =>
      findConsolidationClusters({
        workspaceId: wsA.id,
        tx,
        minClusterSize: 4,
        minCosine: 0.7,
      })
    );

    // At least one cluster surfaced and it contains all 4 seeds.
    const seedCluster = clusters.find(
      (c) => c.members.every((m) => ids.includes(m.id)) && c.members.length >= 4
    );
    expect(seedCluster).toBeDefined();
    expect(seedCluster?.subject).toBe("consolidation_subj_a");
    expect(seedCluster?.kind).toBe("preference");
    expect(seedCluster?.cosineMin).toBeGreaterThanOrEqual(0.7);
  });

  it("does NOT cluster across different subjects (semantic tightness)", async () => {
    const vec = axisVec(1);
    // Two facts about subject B, two facts about subject C — same
    // embedding, but different subjects → must NOT cluster together.
    const ids = await withMnemoTx(wsA.id, async (tx) => {
      const b1 = await createFact({
        workspaceId: wsA.id,
        scope: "global",
        kind: "preference",
        subject: "consolidation_subj_b",
        statement: "subj_b_1 anchor — different subject leg 1",
        embedding: vec,
        tx,
      });
      const b2 = await createFact({
        workspaceId: wsA.id,
        scope: "global",
        kind: "preference",
        subject: "consolidation_subj_b",
        statement: "subj_b_2 anchor — different subject leg 2",
        embedding: vec,
        tx,
      });
      const c1 = await createFact({
        workspaceId: wsA.id,
        scope: "global",
        kind: "preference",
        subject: "consolidation_subj_c",
        statement: "subj_c_1 anchor — other subject leg 1",
        embedding: vec,
        tx,
      });
      const c2 = await createFact({
        workspaceId: wsA.id,
        scope: "global",
        kind: "preference",
        subject: "consolidation_subj_c",
        statement: "subj_c_2 anchor — other subject leg 2",
        embedding: vec,
        tx,
      });
      return { b: [b1.id, b2.id], c: [c1.id, c2.id] };
    });

    const clusters = await withMnemoTx(wsA.id, (tx) =>
      findConsolidationClusters({
        workspaceId: wsA.id,
        tx,
        minClusterSize: 4,
        minCosine: 0.7,
      })
    );

    // No cluster should mix subject_b ids with subject_c ids.
    for (const cluster of clusters) {
      const memberIds = cluster.members.map((m) => m.id);
      const hasB = memberIds.some((id) => ids.b.includes(id));
      const hasC = memberIds.some((id) => ids.c.includes(id));
      expect(hasB && hasC).toBe(false);
    }
  });

  it("excludes facts already linked via `derived_from` (idempotent re-run)", async () => {
    const vec = axisVec(2);
    // Seed 4 facts + one summary fact + derived_from edges from each
    // member → summary. Re-running findConsolidationClusters must NOT
    // produce a cluster including any of the 4 (they're already
    // consolidated).
    const { memberIds } = await withMnemoTx(wsA.id, async (tx) => {
      const summary = await createFact({
        workspaceId: wsA.id,
        scope: "global",
        kind: "event",
        subject: "consolidation_subj_d",
        statement: "consolidated summary placeholder",
        embedding: vec,
        tx,
      });
      const members: string[] = [];
      for (let i = 0; i < 4; i++) {
        const m = await createFact({
          workspaceId: wsA.id,
          scope: "global",
          kind: "preference",
          subject: "consolidation_subj_d",
          statement: `consolidated_member_${i} anchor — already consolidated`,
          embedding: vec,
          tx,
        });
        members.push(m.id);
        await createRelation({
          workspaceId: wsA.id,
          sourceKind: "fact",
          sourceId: m.id,
          targetKind: "fact",
          targetId: summary.id,
          relation: "derived_from",
          markedByKind: "system",
          tx,
        });
      }
      return { summaryId: summary.id, memberIds: members };
    });

    const clusters = await withMnemoTx(wsA.id, (tx) =>
      findConsolidationClusters({
        workspaceId: wsA.id,
        tx,
        minClusterSize: 4,
        minCosine: 0.7,
      })
    );

    // None of the 4 already-consolidated members may appear as a
    // cluster member in this re-run.
    for (const cluster of clusters) {
      for (const m of cluster.members) {
        expect(memberIds).not.toContain(m.id);
      }
    }
  });
});
