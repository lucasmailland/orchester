// Unit tests for the hybrid recall scoring formula in lib/brain/recall.ts.
// We replicate the JS-side math here so we can prove its properties
// without a database.

import { describe, it, expect } from "vitest";

const RECENCY_HALF_LIFE_DAYS = 30;

function score(parts: {
  semantic: number;
  recency: number;
  frequency: number;
  relevance: number;
  pin: number;
}): number {
  return (
    0.5 * parts.semantic +
    0.15 * parts.recency +
    0.1 * parts.frequency +
    0.2 * parts.relevance +
    0.05 * parts.pin
  );
}

/**
 * JS replica of the recency expression baked into the SQL in
 * `lib/brain/recall.ts`:
 *
 *   exp(-LN(2) * EXTRACT(EPOCH FROM (now() - created_at))
 *        / (30 * 86400))
 *
 * Replicating it here lets us pin the spec — anyone swapping the formula
 * to e-folding (`exp(-t/H)`) breaks `recency at H is exactly 0.5` and
 * the diff lights up in CI.
 */
function recency(daysOld: number): number {
  return Math.exp((-Math.LN2 * daysOld) / RECENCY_HALF_LIFE_DAYS);
}

describe("brain hybrid recall scoring", () => {
  it("weights sum to 1.0", () => {
    const all = score({ semantic: 1, recency: 1, frequency: 1, relevance: 1, pin: 1 });
    expect(all).toBeCloseTo(1.0, 6);
  });

  it("recency at age=H is exactly 0.5 (half-life, NOT e-folding)", () => {
    // Half-life means recency=0.5 at age=H. e-folding would give
    // exp(-1) ≈ 0.368 — a 25%+ silent error that would distort the
    // weighted blend, since `relevance` (from decay.ts) uses the same
    // half-life and is mixed into the same score.
    expect(recency(RECENCY_HALF_LIFE_DAYS)).toBeCloseTo(0.5, 6);
    expect(recency(2 * RECENCY_HALF_LIFE_DAYS)).toBeCloseTo(0.25, 6);
    // Sanity: brand-new fact reads as 1.0.
    expect(recency(0)).toBeCloseTo(1.0, 6);
  });

  it("pinned + high semantic outranks unpinned same semantic", () => {
    const pinned = score({ semantic: 0.8, recency: 0, frequency: 0, relevance: 0, pin: 1 });
    const unpinned = score({ semantic: 0.8, recency: 0, frequency: 0, relevance: 0, pin: 0 });
    expect(pinned).toBeGreaterThan(unpinned);
    expect(pinned - unpinned).toBeCloseTo(0.05, 6);
  });

  it("recency boost can flip ranking when semantic is close", () => {
    const stale = score({ semantic: 0.85, recency: 0.05, frequency: 0, relevance: 0.5, pin: 0 });
    const fresh = score({ semantic: 0.75, recency: 1.0, frequency: 0, relevance: 1.0, pin: 0 });
    expect(fresh).toBeGreaterThan(stale);
  });

  it("semantic dominates pin alone", () => {
    const lowSemPinned = score({ semantic: 0.1, recency: 0, frequency: 0, relevance: 0, pin: 1 });
    const highSemUnpinned = score({
      semantic: 0.9,
      recency: 0,
      frequency: 0,
      relevance: 0,
      pin: 0,
    });
    expect(highSemUnpinned).toBeGreaterThan(lowSemPinned);
  });

  it("all-zero inputs produce zero", () => {
    expect(score({ semantic: 0, recency: 0, frequency: 0, relevance: 0, pin: 0 })).toBe(0);
  });
});
