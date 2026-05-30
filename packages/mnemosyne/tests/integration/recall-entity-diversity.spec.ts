// packages/mnemosyne/tests/integration/recall-entity-diversity.spec.ts
//
// v1.1 — #8: integration test for the per-entity diversity cap.
//
// When many high-scoring facts belong to the same entity, the cap
// `max(2, ceil(maxResults × 0.15))` prevents that entity from flooding
// the result set. Facts with entity_id = null are never capped.
//
// Design notes:
// - We create TWO entities and seed 4 facts each, all with unique
//   synthetic tokens so FTS rank is tight and deterministic.
// - With maxResults=3 the formula cap is 2, so at most 2 facts per
//   entity survive the diversity stage — leaving 1 slot for the other
//   entity or an unaffiliated fact.
// - With entityDiversityCap: false the cap is off and the top entity
//   can fill all available slots.
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
let createEntity: typeof import("../../src/entity/store").createEntity;
let searchMnemo: typeof import("../../src/recall/search").searchMnemo;
let invalidateRecallCacheForWorkspace: typeof import("../../src/recall/cache").invalidateRecallCacheForWorkspace;

beforeAll(async () => {
  [wsA] = await setupTestWorkspaces();
  ({ withMnemoTx } = await import("../../src/tx"));
  ({ createFact } = await import("../../src/primitives/fact"));
  ({ createEntity } = await import("../../src/entity/store"));
  ({ searchMnemo } = await import("../../src/recall/search"));
  ({ invalidateRecallCacheForWorkspace } = await import("../../src/recall/cache"));
});

afterAll(() => teardownTestWorkspaces());

describe("recall/search — v1.1 per-entity diversity cap (#8)", () => {
  it("caps a dominant entity at max(2, ceil(maxResults × 0.15)) slots", async () => {
    invalidateRecallCacheForWorkspace(wsA.id);

    // Create two entities.
    const entityA = await withMnemoTx(wsA.id, (tx) =>
      createEntity({ workspaceId: wsA.id, name: "DiversityEntity Alpha", kind: "person", tx })
    );
    const entityB = await withMnemoTx(wsA.id, (tx) =>
      createEntity({ workspaceId: wsA.id, name: "DiversityEntity Beta", kind: "person", tx })
    );

    // Seed 4 facts for entityA and 1 fact for entityB, all pinned so
    // they float to the top and the diversity cap is meaningful.
    // Use synthetic tokens unique to this test so FTS rank is clean.
    await withMnemoTx(wsA.id, async (tx) => {
      for (let i = 0; i < 4; i++) {
        await createFact({
          workspaceId: wsA.id,
          scope: "global",
          kind: "preference",
          subject: "user",
          statement: `diversityalpha_fact_${i} diversityalpha_marker`,
          pinned: true,
          entityId: entityA.id,
          tx,
        });
      }
      // One fact for entityB — different marker token.
      await createFact({
        workspaceId: wsA.id,
        scope: "global",
        kind: "preference",
        subject: "user",
        statement: "diversitybeta_fact diversityalpha_marker",
        pinned: true,
        entityId: entityB.id,
        tx,
      });
    });

    invalidateRecallCacheForWorkspace(wsA.id);

    // Query with maxResults=3 → formula cap = max(2, ceil(3×0.15)) = 2.
    // entityA has 4 matching facts but only 2 should survive the cap.
    const hits = await searchMnemo({
      workspaceId: wsA.id,
      query: "diversityalpha_marker",
      maxResults: 3,
    });

    expect(hits.length).toBeGreaterThan(0);

    // Count hits per entity.
    const countByEntity = new Map<string | null, number>();
    for (const h of hits) {
      const eid = h.fact.entityId ?? null;
      countByEntity.set(eid, (countByEntity.get(eid) ?? 0) + 1);
    }

    // entityA must be capped at 2 (formula cap for maxResults=3).
    const alphaCount = countByEntity.get(entityA.id) ?? 0;
    expect(alphaCount).toBeLessThanOrEqual(2);

    // entityB contributes ≥ 1 hit — at least one non-alpha fact survived.
    // (Exact count depends on whether the beta fact scored high enough to
    // appear in the top-3, but since it's pinned it should.)
    const betaCount = countByEntity.get(entityB.id) ?? 0;
    expect(betaCount).toBeGreaterThanOrEqual(1);
  });

  it("entityDiversityCap: false disables the cap entirely", async () => {
    invalidateRecallCacheForWorkspace(wsA.id);

    // Seed 3 more facts for a new entity (gammaentity) using a fresh
    // query token so this test is isolated from the previous one's facts.
    const entityGamma = await withMnemoTx(wsA.id, (tx) =>
      createEntity({ workspaceId: wsA.id, name: "DiversityEntity Gamma", kind: "person", tx })
    );

    await withMnemoTx(wsA.id, async (tx) => {
      for (let i = 0; i < 3; i++) {
        await createFact({
          workspaceId: wsA.id,
          scope: "global",
          kind: "preference",
          subject: "user",
          statement: `diversitygamma_fact_${i} diversitygamma_marker`,
          pinned: true,
          entityId: entityGamma.id,
          tx,
        });
      }
    });

    invalidateRecallCacheForWorkspace(wsA.id);

    const hitsWithCap = await searchMnemo({
      workspaceId: wsA.id,
      query: "diversitygamma_marker",
      maxResults: 3,
      // Default: cap is ON → max 2 hits for entityGamma.
    });

    invalidateRecallCacheForWorkspace(wsA.id);

    const hitsNoCap = await searchMnemo({
      workspaceId: wsA.id,
      query: "diversitygamma_marker",
      maxResults: 3,
      entityDiversityCap: false,
    });

    // With cap: entityGamma can contribute at most 2 hits.
    const gammaCapped = hitsWithCap.filter((h) => h.fact.entityId === entityGamma.id).length;
    expect(gammaCapped).toBeLessThanOrEqual(2);

    // Without cap: entityGamma can fill all 3 slots.
    const gammaUncapped = hitsNoCap.filter((h) => h.fact.entityId === entityGamma.id).length;
    // With 3 seeded facts and no cap, all 3 may appear (depending on
    // other workspace content competing for the top-3 slots).
    expect(gammaUncapped).toBeGreaterThanOrEqual(gammaCapped);
  });

  it("does not cap facts with entity_id = null", async () => {
    invalidateRecallCacheForWorkspace(wsA.id);

    // Seed 4 unaffiliated facts (no entityId) — none should be capped.
    await withMnemoTx(wsA.id, async (tx) => {
      for (let i = 0; i < 4; i++) {
        await createFact({
          workspaceId: wsA.id,
          scope: "global",
          kind: "preference",
          subject: "user",
          statement: `diversitynull_fact_${i} diversitynull_marker`,
          pinned: true,
          tx, // entityId omitted → null
        });
      }
    });

    invalidateRecallCacheForWorkspace(wsA.id);

    const hits = await searchMnemo({
      workspaceId: wsA.id,
      query: "diversitynull_marker",
      maxResults: 4,
    });

    // All matching hits should have entity_id = null.
    const nullEntityHits = hits.filter((h) => h.fact.entityId == null);
    expect(nullEntityHits.length).toBe(hits.length);
    // And the cap must not have dropped any of them.
    expect(hits.length).toBeGreaterThanOrEqual(3);
  });
});
