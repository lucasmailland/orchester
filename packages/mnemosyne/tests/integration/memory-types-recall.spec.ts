// packages/mnemosyne/tests/integration/memory-types-recall.spec.ts
//
// Mnemosyne v1.4 — verifies the `memoryTypes` filter on `searchMnemo`.
//
// Seeds a workspace with a fixed FTS anchor across multiple memory
// types so we can:
//   (a) issue a no-filter search and observe all of them,
//   (b) issue a single-type filter and observe only the matching subset,
//   (c) issue a multi-type filter and observe the union,
//   (d) confirm an empty array is treated as "no filter" (no zero-row
//       trap from an upstream `.filter()` accidentally producing []).
//
// Cache hygiene: each search uses a distinct `memoryTypes` shape, so
// they hash to different L1 cache keys (we mixed `memoryTypes` into
// the cache key in v1.4). The recall-cache LRU also invalidates per-
// workspace via `invalidateRecallCacheForWorkspace`, which we call at
// the top of the test so prior-suite seeds can't pollute this one.
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

// Anchor token used in every seeded statement so FTS hits all of them
// for the same query. Chosen to be lexically unique so prior-test
// seeds can't accidentally match.
const ANCHOR = "memtype_test_anchor";

beforeAll(async () => {
  [wsA] = await setupTestWorkspaces();
  ({ withMnemoTx } = await import("../../src/tx"));
  ({ createFact } = await import("../../src/primitives/fact"));
  ({ searchMnemo } = await import("../../src/recall/search"));
  ({ invalidateRecallCacheForWorkspace } = await import("../../src/recall/cache"));
});

afterAll(() => teardownTestWorkspaces());

describe("recall/search — v1.4 memoryTypes filter", () => {
  it("filters recall results by memory_type", async () => {
    invalidateRecallCacheForWorkspace(wsA.id);

    // Seed 3 semantic + 2 episodic + 1 procedural fact, all sharing
    // the FTS anchor token. None override `memoryType` for the
    // procedural one — we set it explicitly. Pre-v1.4 callers
    // (no memoryType arg) get `semantic` by default.
    await withMnemoTx(wsA.id, async (tx) => {
      for (let i = 0; i < 3; i++) {
        await createFact({
          workspaceId: wsA.id,
          scope: "global",
          kind: "preference",
          subject: "user",
          statement: `${ANCHOR} semantic-${i}: durable preference variation`,
          memoryType: "semantic",
          tx,
        });
      }
      for (let i = 0; i < 2; i++) {
        await createFact({
          workspaceId: wsA.id,
          scope: "global",
          kind: "event",
          subject: "user",
          statement: `${ANCHOR} episodic-${i}: moment-anchored event variation`,
          memoryType: "episodic",
          tx,
        });
      }
      await createFact({
        workspaceId: wsA.id,
        scope: "global",
        kind: "other",
        subject: "system",
        statement: `${ANCHOR} procedural-0: how-to step variation`,
        memoryType: "procedural",
        tx,
      });
    });

    // (a) No filter → all 6 should be reachable. The recall pipeline
    //     caps results (default 3 + reranker/pruner) so we ask for a
    //     wider window.
    const allHits = await searchMnemo({
      workspaceId: wsA.id,
      query: ANCHOR,
      maxResults: 20,
    });
    const allFromAnchor = allHits.filter((h) => h.fact.statement.includes(ANCHOR));
    expect(allFromAnchor.length).toBeGreaterThanOrEqual(6);

    // (b) memoryTypes=['episodic'] → only the 2 episodic facts.
    const episodicHits = await searchMnemo({
      workspaceId: wsA.id,
      query: ANCHOR,
      memoryTypes: ["episodic"],
      maxResults: 20,
    });
    const epFromAnchor = episodicHits.filter((h) => h.fact.statement.includes(ANCHOR));
    expect(epFromAnchor.length).toBe(2);
    for (const h of epFromAnchor) {
      expect(h.fact.memoryType).toBe("episodic");
    }

    // (c) memoryTypes=['episodic','procedural'] → 2 + 1 = 3.
    const mixedHits = await searchMnemo({
      workspaceId: wsA.id,
      query: ANCHOR,
      memoryTypes: ["episodic", "procedural"],
      maxResults: 20,
    });
    const mixFromAnchor = mixedHits.filter((h) => h.fact.statement.includes(ANCHOR));
    expect(mixFromAnchor.length).toBe(3);
    for (const h of mixFromAnchor) {
      expect(["episodic", "procedural"]).toContain(h.fact.memoryType);
    }

    // (d) Empty array MUST behave like "no filter" — same row count as (a).
    const emptyFilterHits = await searchMnemo({
      workspaceId: wsA.id,
      query: ANCHOR,
      memoryTypes: [],
      maxResults: 20,
    });
    const emptyFromAnchor = emptyFilterHits.filter((h) => h.fact.statement.includes(ANCHOR));
    expect(emptyFromAnchor.length).toBeGreaterThanOrEqual(6);
  });

  it("returns memoryType on each MnemoFact (default 'semantic' for legacy callers)", async () => {
    invalidateRecallCacheForWorkspace(wsA.id);

    // Insert a fact WITHOUT specifying memoryType — should default to
    // 'semantic' per the SQL DEFAULT + the TS-layer fallback.
    const uniqueAnchor = "memtype_default_anchor_xyz";
    await withMnemoTx(wsA.id, (tx) =>
      createFact({
        workspaceId: wsA.id,
        scope: "global",
        kind: "preference",
        subject: "user",
        statement: `${uniqueAnchor}: legacy caller, no memoryType passed`,
        tx,
      })
    );

    const hits = await searchMnemo({
      workspaceId: wsA.id,
      query: uniqueAnchor,
      maxResults: 5,
    });
    const ours = hits.find((h) => h.fact.statement.includes(uniqueAnchor));
    expect(ours).toBeDefined();
    expect(ours!.fact.memoryType).toBe("semantic");
  });
});
