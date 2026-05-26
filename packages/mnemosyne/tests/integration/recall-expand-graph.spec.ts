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
