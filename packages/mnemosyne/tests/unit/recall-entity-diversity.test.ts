// packages/mnemosyne/tests/unit/recall-entity-diversity.test.ts
//
// v1.1 — #8: per-entity diversity cap formula.
//
// Unit tests for `computeEntityDiversityCap`. The full pipeline behaviour
// (fact seeding + entity linking + search) is exercised by the integration
// test in tests/integration/recall-entity-diversity.spec.ts; here we lock
// in the boundary semantics of the formula so a future coefficient tweak
// forces a deliberate update to these expectations.
import { describe, it, expect } from "vitest";
import { computeEntityDiversityCap } from "../../src/recall/search";

describe("recall/search — computeEntityDiversityCap (#8)", () => {
  it("floors at 2 for small maxResults (< 14)", () => {
    // max(2, ceil(1 × 0.15)) = max(2, 1) = 2
    expect(computeEntityDiversityCap(1)).toBe(2);
    // max(2, ceil(3 × 0.15)) = max(2, 1) = 2   (default maxResults)
    expect(computeEntityDiversityCap(3)).toBe(2);
    // max(2, ceil(10 × 0.15)) = max(2, 2) = 2
    expect(computeEntityDiversityCap(10)).toBe(2);
    // max(2, ceil(13 × 0.15)) = max(2, ceil(1.95)) = max(2, 2) = 2
    expect(computeEntityDiversityCap(13)).toBe(2);
  });

  it("grows past 2 for larger maxResults", () => {
    // max(2, ceil(14 × 0.15)) = max(2, ceil(2.1)) = max(2, 3) = 3
    expect(computeEntityDiversityCap(14)).toBe(3);
    // max(2, ceil(20 × 0.15)) = max(2, ceil(3.0)) = max(2, 3) = 3
    expect(computeEntityDiversityCap(20)).toBe(3);
  });

  it("scales linearly above the floor", () => {
    // Verify the ceiling monotonically increases with maxResults.
    const caps = [1, 3, 10, 13, 14, 20].map(computeEntityDiversityCap);
    for (let i = 1; i < caps.length; i++) {
      expect(caps[i]).toBeGreaterThanOrEqual(caps[i - 1]!);
    }
  });

  it("never returns less than 2 for any reasonable maxResults", () => {
    for (const n of [1, 2, 3, 5, 8, 12, 13]) {
      expect(computeEntityDiversityCap(n)).toBeGreaterThanOrEqual(2);
    }
  });
});
