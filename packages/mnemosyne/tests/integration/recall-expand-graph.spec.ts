// packages/mnemosyne/tests/integration/recall-expand-graph.spec.ts
//
// Integration tests for the v1.4 opt-in 1-hop graph expansion stage of
// `searchMnemo`. Default-off contract: with `expandGraph` unset, the
// pipeline behaves exactly like v1.3. With `expandGraph: true`, facts
// linked to a top-K hit by a whitelisted relation verb (`derived_from`,
// `supersedes`, `part_of`, `member_of`, `scoped`, `related`) surface
// in the result, decay-scored, with `expandedFromId` populated.
//
// Two seed scenarios:
//   1. happy path — parent fact + 1 derived child via `derived_from`,
//      query matches the parent → child appears as an expanded hit
//      with `expandedFromId === parent.id`.
//   2. excluded verb — same shape but with `conflicts_with`. Expansion
//      MUST NOT surface the child (we never expand into a contradiction).
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
let searchMnemo: typeof import("../../src/recall/search").searchMnemo;
let invalidateRecallCacheForWorkspace: typeof import("../../src/recall/cache").invalidateRecallCacheForWorkspace;

beforeAll(async () => {
  [wsA] = await setupTestWorkspaces();
  ({ withMnemoTx } = await import("../../src/tx"));
  ({ createFact } = await import("../../src/primitives/fact"));
  ({ createRelation } = await import("../../src/graph/relation"));
  ({ searchMnemo } = await import("../../src/recall/search"));
  ({ invalidateRecallCacheForWorkspace } = await import("../../src/recall/cache"));
});

afterAll(() => teardownTestWorkspaces());

describe("recall/search — v1.4 1-hop graph expansion", () => {
  it("does NOT expand when `expandGraph` is unset (v1.3 contract)", async () => {
    invalidateRecallCacheForWorkspace(wsA.id);

    const { parent, child } = await withMnemoTx(wsA.id, async (tx) => {
      const parent = await createFact({
        workspaceId: wsA.id,
        scope: "global",
        kind: "trait",
        subject: "user",
        statement: "expandgraph_anchor_default — parent durable trait",
        tx,
      });
      const child = await createFact({
        workspaceId: wsA.id,
        scope: "global",
        kind: "event",
        subject: "user",
        // Child statement does NOT include the anchor token — direct
        // FTS won't surface it. Expansion is the only way to see it.
        statement: "expanded child neighbour — derived event detail",
        tx,
      });
      await createRelation({
        workspaceId: wsA.id,
        sourceKind: "fact",
        sourceId: parent.id,
        targetKind: "fact",
        targetId: child.id,
        relation: "derived_from",
        markedByKind: "system",
        tx,
      });
      return { parent, child };
    });

    const hits = await searchMnemo({
      workspaceId: wsA.id,
      query: "expandgraph_anchor_default",
      maxResults: 5,
      // expandGraph intentionally omitted → default behaviour.
    });

    const ids = hits.map((h) => h.fact.id);
    expect(ids).toContain(parent.id);
    expect(ids).not.toContain(child.id);
    for (const h of hits) {
      // `expandedFromId` must be unset / null on every direct hit.
      expect(h.expandedFromId ?? null).toBeNull();
    }
  });

  it("expands into a `derived_from` child and stamps `expandedFromId`", async () => {
    invalidateRecallCacheForWorkspace(wsA.id);

    const { parent, child } = await withMnemoTx(wsA.id, async (tx) => {
      const parent = await createFact({
        workspaceId: wsA.id,
        scope: "global",
        kind: "trait",
        subject: "user",
        statement: "expandgraph_anchor_derived — parent durable trait",
        tx,
      });
      const child = await createFact({
        workspaceId: wsA.id,
        scope: "global",
        kind: "event",
        subject: "user",
        // Different lexical anchor so the child is unreachable via FTS.
        statement: "downstream observation — only reachable via 1-hop expansion",
        tx,
      });
      await createRelation({
        workspaceId: wsA.id,
        sourceKind: "fact",
        sourceId: parent.id,
        targetKind: "fact",
        targetId: child.id,
        relation: "derived_from",
        markedByKind: "system",
        tx,
      });
      return { parent, child };
    });

    const hits = await searchMnemo({
      workspaceId: wsA.id,
      query: "expandgraph_anchor_derived",
      maxResults: 5,
      expandGraph: true,
    });

    const ids = hits.map((h) => h.fact.id);
    expect(ids).toContain(parent.id);
    expect(ids).toContain(child.id);
    const childHit = hits.find((h) => h.fact.id === child.id);
    expect(childHit?.expandedFromId).toBe(parent.id);
    // Decay default is 0.7 — child score must be strictly less than parent's.
    const parentHit = hits.find((h) => h.fact.id === parent.id);
    expect(childHit && parentHit && childHit.score).toBeLessThan(parentHit?.score ?? Infinity);
  });

  it("does NOT expand into `conflicts_with` (excluded verb)", async () => {
    invalidateRecallCacheForWorkspace(wsA.id);

    const { parent, child } = await withMnemoTx(wsA.id, async (tx) => {
      const parent = await createFact({
        workspaceId: wsA.id,
        scope: "global",
        kind: "preference",
        subject: "user",
        statement: "expandgraph_anchor_conflict — primary policy claim",
        tx,
      });
      const child = await createFact({
        workspaceId: wsA.id,
        scope: "global",
        kind: "preference",
        subject: "user",
        statement: "contradicting follow-up never surfaced via expansion",
        tx,
      });
      await createRelation({
        workspaceId: wsA.id,
        sourceKind: "fact",
        sourceId: parent.id,
        targetKind: "fact",
        targetId: child.id,
        relation: "conflicts_with",
        markedByKind: "system",
        tx,
      });
      return { parent, child };
    });

    const hits = await searchMnemo({
      workspaceId: wsA.id,
      query: "expandgraph_anchor_conflict",
      maxResults: 5,
      expandGraph: true,
    });

    const ids = hits.map((h) => h.fact.id);
    expect(ids).toContain(parent.id);
    // `conflicts_with` is on the excluded list — the child must NOT
    // surface even with expansion enabled.
    expect(ids).not.toContain(child.id);
  });

  it("v1.1 #11 — heuristic-provenance edges decay harder than LLM-derived ones", async () => {
    // Seed two neighbors from the same parent. Edge 1 is LLM-derived
    // (provenance NULL) → decay = base (0.7). Edge 2 is heuristic →
    // decay = min(base, 0.5) = 0.5. The LLM neighbor must end up with
    // a strictly higher inherited score than the heuristic neighbor.
    invalidateRecallCacheForWorkspace(wsA.id);

    const { parent, llmChild, heuristicChild } = await withMnemoTx(wsA.id, async (tx) => {
      const parent = await createFact({
        workspaceId: wsA.id,
        scope: "global",
        kind: "trait",
        subject: "user",
        statement: "expandgraph_anchor_provenance — parent for asymmetric decay test",
        tx,
      });
      const llmChild = await createFact({
        workspaceId: wsA.id,
        scope: "global",
        kind: "event",
        subject: "user",
        statement: "llm-derived neighbor — reachable only via 1-hop expansion",
        tx,
      });
      const heuristicChild = await createFact({
        workspaceId: wsA.id,
        scope: "global",
        kind: "event",
        subject: "user",
        statement: "heuristic neighbor — reachable only via 1-hop expansion",
        tx,
      });
      await createRelation({
        workspaceId: wsA.id,
        sourceKind: "fact",
        sourceId: parent.id,
        targetKind: "fact",
        targetId: llmChild.id,
        relation: "derived_from",
        markedByKind: "llm_judge",
        // provenance omitted ⇒ NULL ⇒ LLM-derived (status quo).
        tx,
      });
      await createRelation({
        workspaceId: wsA.id,
        sourceKind: "fact",
        sourceId: parent.id,
        targetKind: "fact",
        targetId: heuristicChild.id,
        relation: "derived_from",
        markedByKind: "system",
        provenance: "heuristic",
        tx,
      });
      return { parent, llmChild, heuristicChild };
    });

    const hits = await searchMnemo({
      workspaceId: wsA.id,
      query: "expandgraph_anchor_provenance",
      // Both neighbors must survive the cap, hence 5.
      maxResults: 5,
      expandGraph: true,
      // Explicit base decay 0.7 — heuristic cap is min(0.7, 0.5) = 0.5.
      expandDecay: 0.7,
    });

    const ids = hits.map((h) => h.fact.id);
    expect(ids).toContain(parent.id);
    expect(ids).toContain(llmChild.id);
    expect(ids).toContain(heuristicChild.id);

    const parentHit = hits.find((h) => h.fact.id === parent.id);
    const llmHit = hits.find((h) => h.fact.id === llmChild.id);
    const heuristicHit = hits.find((h) => h.fact.id === heuristicChild.id);
    expect(parentHit).toBeDefined();
    expect(llmHit?.expandedFromId).toBe(parent.id);
    expect(heuristicHit?.expandedFromId).toBe(parent.id);

    // The core invariant: heuristic edge's decay (0.5) < LLM edge's
    // decay (0.7), so for the same parent score the heuristic neighbor
    // must end up with a strictly lower inherited score.
    expect(heuristicHit!.score).toBeLessThan(llmHit!.score);
    // And both must be strictly below the parent (any decay < 1).
    expect(llmHit!.score).toBeLessThan(parentHit!.score);
    // Sanity: the ratio matches the decay ratio (within float noise).
    // heuristic / llm == 0.5 / 0.7 ≈ 0.714. Both neighbors derive from
    // the SAME parent, so the parent-score factor cancels and the ratio
    // is determined entirely by `decayForEdge`. If runFirstStage ever
    // changes parent ordering / scoring in a way that gives the two
    // neighbors different parents, this assertion will drift — pin the
    // parent explicitly in that case.
    const ratio = heuristicHit!.score / llmHit!.score;
    expect(ratio).toBeCloseTo(0.5 / 0.7, 5);
  });

  it("clamps `expandDecay` outside [0,1] to a safe default", async () => {
    invalidateRecallCacheForWorkspace(wsA.id);

    const { parent } = await withMnemoTx(wsA.id, async (tx) => {
      const parent = await createFact({
        workspaceId: wsA.id,
        scope: "global",
        kind: "trait",
        subject: "user",
        statement: "expandgraph_anchor_decay — parent for decay-clamp test",
        tx,
      });
      return { parent };
    });

    // Negative decay → clamp to 0 → no expansion (neighbors have 0
    // score and the parent dominates). The smoke test here is "no
    // throw" — a misconfigured caller should not blow up the pipeline.
    const hits = await searchMnemo({
      workspaceId: wsA.id,
      query: "expandgraph_anchor_decay",
      maxResults: 3,
      expandGraph: true,
      expandDecay: -42,
    });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]?.fact.id).toBe(parent.id);
  });
});
