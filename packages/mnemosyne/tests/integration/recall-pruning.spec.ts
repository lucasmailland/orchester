// packages/mnemosyne/tests/integration/recall-pruning.spec.ts
//
// Integration tests for the v1.1 post-recall pruning stage. Pruning
// drops a candidate fact when its embedding's cosine similarity to ANY
// already-kept fact exceeds `pruneRedundantThreshold` (default 0.88).
//
// Strategy: seed N near-duplicate facts (identical embeddings) + a few
// diverse facts. Assert that:
//   • the final output respects the hard cap `maxResults`,
//   • we don't return more than one near-duplicate per cluster,
//   • the pruning is a no-op in Mode A (no embeddings → can't measure
//     cosine → keep order intact, just hard-cap to maxResults).
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.unmock("@orchester/db");
vi.doUnmock("@orchester/db");

import {
  setupTestWorkspaces,
  teardownTestWorkspaces,
  type WsFixture,
} from "../../../../apps/web/tests/fixtures/workspaces";
import type { EmbedFn } from "../../src/recall/embed";

let wsA: WsFixture;
let withMnemoTx: typeof import("../../src/tx").withMnemoTx;
let createFact: typeof import("../../src/primitives/fact").createFact;
let searchMnemo: typeof import("../../src/recall/search").searchMnemo;
let invalidateRecallCacheForWorkspace: typeof import("../../src/recall/cache").invalidateRecallCacheForWorkspace;

// mnemo_fact.embedding is `vector(1536)` — match that dimensionality.
const VEC_DIM = 1536;

/**
 * Build a 1536-dim "axis-aligned" vector: heavy weight on a single
 * 4-segment slot, light spread elsewhere. Different `axis` values
 * produce vectors with low cosine to each other (≈ 0.06), and the
 * SAME `axis` produces vectors with cosine 1.0.
 */
function axisVec(axis: 0 | 1 | 2 | 3): number[] {
  const v = new Array<number>(VEC_DIM).fill(0.001);
  const seg = Math.floor(VEC_DIM / 4);
  for (let i = axis * seg; i < (axis + 1) * seg; i++) v[i] = 1;
  // L2-normalise.
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n);
  for (let i = 0; i < VEC_DIM; i++) v[i] = v[i]! / n;
  return v;
}

const NEAR_DUP_VEC = axisVec(0);
const DIVERSE_VECS = [axisVec(1), axisVec(2), axisVec(3)];

beforeAll(async () => {
  [wsA] = await setupTestWorkspaces();
  ({ withMnemoTx } = await import("../../src/tx"));
  ({ createFact } = await import("../../src/primitives/fact"));
  ({ searchMnemo } = await import("../../src/recall/search"));
  ({ invalidateRecallCacheForWorkspace } = await import("../../src/recall/cache"));
});

afterAll(() => teardownTestWorkspaces());

describe("recall/search — v1.1 post-recall pruning", () => {
  it("drops near-duplicates so output is ≤ maxResults with diverse content", async () => {
    invalidateRecallCacheForWorkspace(wsA.id);

    // 5 near-duplicate facts (identical embedding) + 3 diverse.
    await withMnemoTx(wsA.id, async (tx) => {
      for (let i = 0; i < 5; i++) {
        await createFact({
          workspaceId: wsA.id,
          scope: "global",
          kind: "preference",
          subject: "user",
          statement: `prune-near-dup-${i}: redundant preference statement variation`,
          embedding: NEAR_DUP_VEC,
          tx,
        });
      }
      for (let i = 0; i < DIVERSE_VECS.length; i++) {
        await createFact({
          workspaceId: wsA.id,
          scope: "global",
          kind: "preference",
          subject: "user",
          statement: `prune-diverse-${i}: distinct semantic content variation`,
          embedding: DIVERSE_VECS[i]!,
          tx,
        });
      }
    });

    // Query vector lives close to the near-dup cluster but the diverse
    // vectors also have non-trivial cosine. We want to see > 1 result
    // and prove the near-dup cluster only contributes one entry.
    const queryVec = NEAR_DUP_VEC;
    const embedFn = (async () => ({
      vectors: [queryVec],
      model: "test-embed",
      tokensUsed: 1,
    })) as unknown as EmbedFn;

    const hits = await searchMnemo({
      workspaceId: wsA.id,
      query: "any preference statement",
      embeddingProvider: "openai",
      embeddingModel: "test-embed",
      embedFn,
      maxResults: 3,
      pruneRedundantThreshold: 0.88,
    });

    // Hard cap respected.
    expect(hits.length).toBeLessThanOrEqual(3);
    // At least one hit returned (sanity).
    expect(hits.length).toBeGreaterThan(0);

    // Of the 5 near-duplicate facts (statement contains "prune-near-dup"),
    // at most ONE should appear in the final results — pruning kept the
    // first and dropped the rest because all 5 have identical embeddings.
    const nearDupCount = hits.filter((h) => h.fact.statement.includes("prune-near-dup")).length;
    expect(nearDupCount).toBeLessThanOrEqual(1);
  });

  it("hard-caps at maxResults even when pruning can't run (Mode A)", async () => {
    invalidateRecallCacheForWorkspace(wsA.id);

    // Seed 6 unique-anchor facts in Mode A (no embeddings).
    await withMnemoTx(wsA.id, async (tx) => {
      for (let i = 0; i < 6; i++) {
        await createFact({
          workspaceId: wsA.id,
          scope: "global",
          kind: "preference",
          subject: "user",
          statement: `prunecapanchor variant ${i}`,
          tx,
        });
      }
    });

    const hits = await searchMnemo({
      workspaceId: wsA.id,
      query: "prunecapanchor",
      maxResults: 3,
    });

    expect(hits.length).toBeLessThanOrEqual(3);
  });

  it("uses the default maxResults of 3 when neither maxResults nor topK is supplied", async () => {
    invalidateRecallCacheForWorkspace(wsA.id);

    await withMnemoTx(wsA.id, async (tx) => {
      for (let i = 0; i < 5; i++) {
        await createFact({
          workspaceId: wsA.id,
          scope: "global",
          kind: "preference",
          subject: "user",
          statement: `defaultcaptoken variant ${i}`,
          tx,
        });
      }
    });

    const hits = await searchMnemo({
      workspaceId: wsA.id,
      query: "defaultcaptoken",
      // no maxResults, no topK
    });

    expect(hits.length).toBeLessThanOrEqual(3);
  });

  it("preserves legacy topK option for backward compat", async () => {
    invalidateRecallCacheForWorkspace(wsA.id);

    await withMnemoTx(wsA.id, async (tx) => {
      for (let i = 0; i < 6; i++) {
        await createFact({
          workspaceId: wsA.id,
          scope: "global",
          kind: "preference",
          subject: "user",
          statement: `legacytopktoken variant ${i}`,
          tx,
        });
      }
    });

    // Legacy v1.0 call shape: `topK: 5`. Should still cap at 5.
    const hits = await searchMnemo({
      workspaceId: wsA.id,
      query: "legacytopktoken",
      topK: 5,
    });
    expect(hits.length).toBeLessThanOrEqual(5);
    expect(hits.length).toBeGreaterThan(0);

    // Spy/sanity: passing maxResults overrides topK.
    const hits2 = await searchMnemo({
      workspaceId: wsA.id,
      query: "legacytopktoken",
      topK: 5,
      maxResults: 2,
    });
    expect(hits2.length).toBeLessThanOrEqual(2);
  });
});
