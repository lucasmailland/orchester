// packages/mnemosyne/tests/integration/recall-attribution.spec.ts
//
// Integration tests for the v1.4 theory-of-mind attribution filter.
// Backwards compatibility: `attributionFilter` unset → no filter → all
// facts (default 'inferred' for legacy rows) visible. With the filter
// set, only matching facts surface.
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
let searchMnemo: typeof import("../../src/recall/search").searchMnemo;
let invalidateRecallCacheForWorkspace: typeof import("../../src/recall/cache").invalidateRecallCacheForWorkspace;

beforeAll(async () => {
  [wsA] = await setupTestWorkspaces();
  ({ withMnemoTx } = await import("../../src/tx"));
  ({ createFact } = await import("../../src/primitives/fact"));
  ({ searchMnemo } = await import("../../src/recall/search"));
  ({ invalidateRecallCacheForWorkspace } = await import("../../src/recall/cache"));
});

afterAll(() => teardownTestWorkspaces());

describe("recall/search — v1.4 attribution filter", () => {
  it("legacy rows default to 'inferred' and remain recallable without a filter", async () => {
    invalidateRecallCacheForWorkspace(wsA.id);

    const fact = await withMnemoTx(wsA.id, (tx) =>
      createFact({
        workspaceId: wsA.id,
        scope: "global",
        kind: "preference",
        subject: "user",
        statement: "attribfilter_default_anchor — legacy row baseline",
        tx,
      })
    );

    const hits = await searchMnemo({
      workspaceId: wsA.id,
      query: "attribfilter_default_anchor",
      maxResults: 5,
    });
    const found = hits.find((h) => h.fact.id === fact.id);
    expect(found).toBeDefined();
    expect(found?.fact.attribution).toBe("inferred");
  });

  it("returns only user_stated facts when filter is ['user_stated']", async () => {
    invalidateRecallCacheForWorkspace(wsA.id);

    const { stated, inferred } = await withMnemoTx(wsA.id, async (tx) => {
      const stated = await createFact({
        workspaceId: wsA.id,
        scope: "global",
        kind: "preference",
        subject: "user",
        statement: "attribfilter_userstated_anchor — explicit user statement",
        attribution: "user_stated",
        tx,
      });
      const inferred = await createFact({
        workspaceId: wsA.id,
        scope: "global",
        kind: "preference",
        subject: "user",
        statement: "attribfilter_userstated_anchor — pipeline-derived sibling",
        attribution: "inferred",
        tx,
      });
      return { stated, inferred };
    });

    const hits = await searchMnemo({
      workspaceId: wsA.id,
      query: "attribfilter_userstated_anchor",
      maxResults: 5,
      attributionFilter: ["user_stated"],
    });

    const ids = hits.map((h) => h.fact.id);
    expect(ids).toContain(stated.id);
    expect(ids).not.toContain(inferred.id);
  });

  it("treats an empty attribution filter array as no-filter", async () => {
    invalidateRecallCacheForWorkspace(wsA.id);

    const fact = await withMnemoTx(wsA.id, (tx) =>
      createFact({
        workspaceId: wsA.id,
        scope: "global",
        kind: "preference",
        subject: "user",
        statement: "attribfilter_empty_anchor — should always surface",
        attribution: "objective_fact",
        tx,
      })
    );

    const hits = await searchMnemo({
      workspaceId: wsA.id,
      query: "attribfilter_empty_anchor",
      maxResults: 5,
      attributionFilter: [],
    });
    expect(hits.map((h) => h.fact.id)).toContain(fact.id);
  });

  it("accepts a multi-value filter (user_stated + user_belief)", async () => {
    invalidateRecallCacheForWorkspace(wsA.id);

    const { belief, objective } = await withMnemoTx(wsA.id, async (tx) => {
      const belief = await createFact({
        workspaceId: wsA.id,
        scope: "global",
        kind: "preference",
        subject: "user",
        statement: "attribfilter_multi_anchor — what the user thinks",
        attribution: "user_belief",
        tx,
      });
      const objective = await createFact({
        workspaceId: wsA.id,
        scope: "global",
        kind: "trait",
        subject: "user",
        statement: "attribfilter_multi_anchor — canonical fact",
        attribution: "objective_fact",
        tx,
      });
      return { belief, objective };
    });

    const hits = await searchMnemo({
      workspaceId: wsA.id,
      query: "attribfilter_multi_anchor",
      maxResults: 5,
      attributionFilter: ["user_stated", "user_belief"],
    });
    const ids = hits.map((h) => h.fact.id);
    expect(ids).toContain(belief.id);
    expect(ids).not.toContain(objective.id);
  });
});
