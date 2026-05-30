// packages/mnemosyne/tests/unit/search-colocation.test.ts
//
// Unit tests for #6 — co-location boost (applyCoLocationBoost).
// No DB required: the function is a pure transform over ScoredHit[].

import { describe, it, expect } from "vitest";
import { applyCoLocationBoost, CO_LOCATION_BOOST } from "../../src/recall/search";
import type { RecallHit } from "../../src/recall/search";

// ── helpers ──────────────────────────────────────────────────────────────────

/** Minimal ScoredHit factory (internal type shares the public RecallHit
 *  shape plus `embedding`; we cast to avoid importing the private type). */
function makeHit(
  id: string,
  entityId: string | null,
  score: number
): RecallHit & { embedding: null } {
  return {
    fact: {
      id,
      workspaceId: "ws1",
      agentId: null,
      scope: "global",
      scopeRef: null,
      kind: "preference",
      subject: "test",
      statement: `fact ${id}`,
      confidence: 0.9,
      pinned: false,
      relevance: 0.5,
      hitCount: 0,
      lastRecalledAt: null,
      sourceMessageIds: [],
      attributedTo: null,
      linkedMemoryIds: [],
      embedding: null,
      metadata: {},
      status: "active",
      mergedIntoId: null,
      validFrom: new Date(),
      validTo: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      memoryType: "semantic",
      attribution: "inferred",
      entityId,
    },
    score,
    reasons: { semantic: 0, recency: 0, frequency: 0, relevance: 0, pin: 0 },
    embedding: null,
  };
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe("applyCoLocationBoost (#6)", () => {
  it("does not boost when every entity appears exactly once", () => {
    const hits = [makeHit("f1", "e1", 0.8), makeHit("f2", "e2", 0.6), makeHit("f3", "e3", 0.5)];
    const result = applyCoLocationBoost(hits as never);
    expect(result[0]!.score).toBe(0.8);
    expect(result[1]!.score).toBe(0.6);
    expect(result[2]!.score).toBe(0.5);
  });

  it("boosts ALL hits of an entity that appears ≥2 times", () => {
    const hits = [
      makeHit("f1", "e1", 0.8),
      makeHit("f2", "e1", 0.7), // e1 has 2 hits → both get boosted
      makeHit("f3", "e2", 0.6),
    ];
    const result = applyCoLocationBoost(hits as never);

    // e1 hits boosted
    expect(result[0]!.score).toBeCloseTo(0.8 + CO_LOCATION_BOOST);
    expect(result[1]!.score).toBeCloseTo(0.7 + CO_LOCATION_BOOST);
    // e2 has only 1 hit — unchanged
    expect(result[2]!.score).toBe(0.6);
  });

  it("boosts hits from an entity with 3 occurrences (all three)", () => {
    const hits = [
      makeHit("f1", "e1", 0.9),
      makeHit("f2", "e1", 0.8),
      makeHit("f3", "e1", 0.7),
      makeHit("f4", "e2", 0.65),
    ];
    const result = applyCoLocationBoost(hits as never);

    expect(result[0]!.score).toBeCloseTo(0.9 + CO_LOCATION_BOOST);
    expect(result[1]!.score).toBeCloseTo(0.8 + CO_LOCATION_BOOST);
    expect(result[2]!.score).toBeCloseTo(0.7 + CO_LOCATION_BOOST);
    expect(result[3]!.score).toBe(0.65); // e2 single hit — no boost
  });

  it("never boosts facts with entity_id=null (unaffiliated)", () => {
    const hits = [
      makeHit("f1", null, 0.8),
      makeHit("f2", null, 0.75), // two nulls — NOT treated as co-located
      makeHit("f3", "e1", 0.6),
    ];
    const result = applyCoLocationBoost(hits as never);

    expect(result[0]!.score).toBe(0.8);
    expect(result[1]!.score).toBe(0.75);
    expect(result[2]!.score).toBe(0.6); // e1 single hit, also no boost
  });

  it("handles a mix of co-located and singleton and null entities", () => {
    const hits = [
      makeHit("f1", "e1", 0.9),
      makeHit("f2", "e1", 0.85),
      makeHit("f3", "e2", 0.7),
      makeHit("f4", null, 0.65),
      makeHit("f5", "e2", 0.6),
    ];
    const result = applyCoLocationBoost(hits as never);

    // e1 → 2 hits → boosted
    expect(result[0]!.score).toBeCloseTo(0.9 + CO_LOCATION_BOOST);
    expect(result[1]!.score).toBeCloseTo(0.85 + CO_LOCATION_BOOST);
    // e2 → 2 hits → boosted
    expect(result[2]!.score).toBeCloseTo(0.7 + CO_LOCATION_BOOST);
    // null → never boosted
    expect(result[3]!.score).toBe(0.65);
    // e2 second hit → boosted
    expect(result[4]!.score).toBeCloseTo(0.6 + CO_LOCATION_BOOST);
  });

  it("returns an empty array without throwing on empty input", () => {
    const result = applyCoLocationBoost([]);
    expect(result).toEqual([]);
  });

  it("CO_LOCATION_BOOST constant is positive and small (< 0.1)", () => {
    // Regression guard — the boost must stay modest so it never
    // overwhelms the base scoring signal.
    expect(CO_LOCATION_BOOST).toBeGreaterThan(0);
    expect(CO_LOCATION_BOOST).toBeLessThan(0.1);
  });

  it("does not mutate the original hits array", () => {
    const hits = [makeHit("f1", "e1", 0.8), makeHit("f2", "e1", 0.7)];
    const original0 = hits[0]!.score;
    applyCoLocationBoost(hits as never);
    // Original array untouched (spread inside the map returns new objects).
    expect(hits[0]!.score).toBe(original0);
  });

  it("boost is exactly CO_LOCATION_BOOST (not scaled by count)", () => {
    // Three hits from the same entity should each get +CO_LOCATION_BOOST,
    // not +3*CO_LOCATION_BOOST. Co-location is a binary signal.
    const hits = [makeHit("f1", "e1", 0.5), makeHit("f2", "e1", 0.5), makeHit("f3", "e1", 0.5)];
    const result = applyCoLocationBoost(hits as never);
    for (const h of result) {
      expect(h.score).toBeCloseTo(0.5 + CO_LOCATION_BOOST);
    }
  });
});
