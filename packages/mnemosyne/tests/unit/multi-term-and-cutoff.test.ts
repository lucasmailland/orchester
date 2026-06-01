// packages/mnemosyne/tests/unit/multi-term-and-cutoff.test.ts
//
// v2 (#5) + (#9) — opt-in scoring helpers. Pure-function tests, no
// pipeline integration (the integration is one-line wiring in
// runSearchPipeline; this file pins the pure semantics so the wire
// can rely on them).

import { describe, it, expect } from "vitest";
import {
  applyMultiTermBoost,
  applySignalCutoff,
  countQueryTermOverlap,
  DEFAULT_MULTI_TERM_BOOST,
} from "../../src/recall/search";

// Minimal ScoredHit-shaped helper. The real ScoredHit type carries
// the full MnemoFact + embedding shape, but the helpers under test
// only read `fact.id`, `fact.statement`, and `score`. We cast through
// `unknown` so the slim shape satisfies the parameter types without
// constructing a full MnemoFact fixture for every case.
type ScoredHitArg = Parameters<typeof applyMultiTermBoost>[0][number];

function hit(id: string, score: number, statement: string): ScoredHitArg {
  return {
    fact: { id, statement } as ScoredHitArg["fact"],
    score,
    reasons: { semantic: 0, recency: 0, frequency: 0, relevance: 0, pin: 0 },
    embedding: null,
  };
}

// ── countQueryTermOverlap ────────────────────────────────────────────────────

describe("countQueryTermOverlap (#5)", () => {
  it("returns 0 when no overlap", () => {
    expect(countQueryTermOverlap("postgres database", "user lives in barcelona")).toBe(0);
  });

  it("counts distinct query terms present in the statement", () => {
    expect(
      countQueryTermOverlap(
        "postgres database preferences",
        "user prefers postgres for the database"
      )
    ).toBe(2);
  });

  it("does NOT double-count a query term that appears twice in the statement", () => {
    expect(countQueryTermOverlap("postgres", "postgres postgres postgres")).toBe(1);
  });

  it("strips short tokens (≤ 2 chars) from BOTH sides — no spurious matches via 'in'/'is'", () => {
    // Only "the" (3 chars) passes the >2 filter on both sides. Use a
    // query that's ALL filtered (`is at`) to get overlap 0.
    expect(countQueryTermOverlap("is at", "in is at to a")).toBe(0);
  });

  it("is case-insensitive", () => {
    expect(countQueryTermOverlap("PostGres", "User prefers POSTGRES")).toBe(1);
  });

  it("returns 0 when the query has no content tokens", () => {
    expect(countQueryTermOverlap("is a", "anything goes here")).toBe(0);
  });
});

// ── applyMultiTermBoost (#5) ─────────────────────────────────────────────────

describe("applyMultiTermBoost (#5)", () => {
  it("is a no-op when flag is false / undefined / 0", () => {
    const hits = [hit("a", 0.5, "postgres database preferences")];
    expect(applyMultiTermBoost([...hits], "postgres database", false)[0]!.score).toBe(0.5);
    expect(applyMultiTermBoost([...hits], "postgres database", undefined)[0]!.score).toBe(0.5);
    expect(applyMultiTermBoost([...hits], "postgres database", 0)[0]!.score).toBe(0.5);
  });

  it("is a no-op on single-term queries (#4 dampener owns that case)", () => {
    const hits = [hit("a", 0.5, "postgres postgres postgres")];
    expect(applyMultiTermBoost(hits, "postgres", true)[0]!.score).toBe(0.5);
  });

  it("boosts by (1 + perTerm * overlap) when flag is true (default 0.05)", () => {
    const hits = [hit("a", 1.0, "postgres database preferences")];
    applyMultiTermBoost(hits, "postgres database preferences", true);
    // overlap = 3, multiplier = 1 + 0.05*3 = 1.15
    expect(hits[0]!.score).toBeCloseTo(1.0 * (1 + DEFAULT_MULTI_TERM_BOOST * 3));
  });

  it("honors a custom per-term coefficient when flag is a number", () => {
    const hits = [hit("a", 1.0, "postgres database")];
    applyMultiTermBoost(hits, "postgres database", 0.1);
    // overlap = 2, multiplier = 1.2
    expect(hits[0]!.score).toBeCloseTo(1.0 * 1.2);
  });

  it("caps overlap at MULTI_TERM_OVERLAP_CAP (5) — long statements don't dominate", () => {
    const hits = [hit("a", 1.0, "alpha beta gamma delta epsilon zeta eta theta")];
    applyMultiTermBoost(hits, "alpha beta gamma delta epsilon zeta eta theta", true);
    // overlap capped at 5, multiplier = 1 + 0.05*5 = 1.25
    expect(hits[0]!.score).toBeCloseTo(1.0 * 1.25);
  });

  it("clamps the per-term coefficient to (0, 0.5]", () => {
    const hits = [hit("a", 1.0, "postgres database")];
    applyMultiTermBoost(hits, "postgres database", 999);
    // clamped to 0.5, overlap 2 → multiplier 2.0
    expect(hits[0]!.score).toBeCloseTo(2.0);
  });

  it("does not modify hits with zero overlap", () => {
    const hits = [hit("a", 0.7, "totally unrelated")];
    applyMultiTermBoost(hits, "postgres database preferences", true);
    expect(hits[0]!.score).toBe(0.7);
  });

  it("returns the same array reference for chain ergonomics", () => {
    const hits = [hit("a", 1.0, "postgres database")];
    const out = applyMultiTermBoost(hits, "postgres database", true);
    expect(out).toBe(hits);
  });
});

// ── applySignalCutoff (#9) ───────────────────────────────────────────────────

describe("applySignalCutoff (#9)", () => {
  it("is a no-op when cutoff is undefined", () => {
    const hits = [hit("a", 0.9, "x"), hit("b", 0.1, "y")];
    expect(applySignalCutoff(hits, undefined)).toEqual(hits);
  });

  it("is a no-op when cutoff is 0", () => {
    const hits = [hit("a", 0.9, "x"), hit("b", 0.1, "y")];
    expect(applySignalCutoff(hits, 0)).toEqual(hits);
  });

  it("is a no-op when cutoff is negative (defensive)", () => {
    const hits = [hit("a", 0.9, "x"), hit("b", 0.1, "y")];
    expect(applySignalCutoff(hits, -0.5)).toEqual(hits);
  });

  it("drops hits below topScore * cutoff", () => {
    // top = 0.9, cutoff = 0.5 → threshold = 0.45
    const hits = [
      hit("a", 0.9, "x"),
      hit("b", 0.5, "y"), // above 0.45 → kept
      hit("c", 0.4, "z"), // below 0.45 → dropped
      hit("d", 0.1, "w"), // dropped
    ];
    const out = applySignalCutoff(hits, 0.5);
    expect(out.map((h) => h.fact.id)).toEqual(["a", "b"]);
  });

  it("keeps the top hit regardless of cutoff strength (threshold = top * cutoff ≤ top)", () => {
    const hits = [hit("a", 0.9, "x"), hit("b", 0.85, "y")];
    expect(applySignalCutoff(hits, 0.95).map((h) => h.fact.id)).toEqual(["a"]);
    expect(applySignalCutoff(hits, 0.99).map((h) => h.fact.id)).toEqual(["a"]);
  });

  it("clamps cutoff at 0.95 (defensive — never drop the top)", () => {
    const hits = [hit("a", 1.0, "x"), hit("b", 0.96, "y")];
    // Even with cutoff=10, internal clamp limits to 0.95 → threshold 0.95
    // b at 0.96 stays in.
    expect(applySignalCutoff(hits, 10).map((h) => h.fact.id)).toEqual(["a", "b"]);
  });

  it("handles an empty input gracefully", () => {
    expect(applySignalCutoff([], 0.5)).toEqual([]);
  });

  it("does NOT mutate the input array", () => {
    const hits = [hit("a", 0.9, "x"), hit("b", 0.1, "y")];
    const before = hits.length;
    applySignalCutoff(hits, 0.5);
    expect(hits.length).toBe(before);
  });
});
