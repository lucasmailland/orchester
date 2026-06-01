// packages/mnemosyne/tests/unit/episode-coherence-dedup-quality.test.ts
//
// v2 — Pure-function tests for the three new opt-in helpers:
//   - applyEpisodeCoherenceBoost (v2 §4.3)
//   - applySourceScopedDedup (#16)
//   - applyQualityThreshold (#17)

import { describe, it, expect } from "vitest";
import {
  applyEpisodeCoherenceBoost,
  applySourceScopedDedup,
  applyQualityThreshold,
  EPISODE_COHERENCE_BOOST,
} from "../../src/recall/search";

type Hit = Parameters<typeof applyQualityThreshold>[0][number];

function hit(
  id: string,
  score: number,
  opts: {
    episodeId?: string | null;
    sourceRef?: string;
    confidence?: number;
    embedding?: number[] | null;
  } = {}
): Hit {
  const fact: Record<string, unknown> = {
    id,
    statement: `fact ${id}`,
    metadata: opts.sourceRef ? { source_ref: opts.sourceRef } : {},
    confidence: opts.confidence ?? 0.7,
    episodeId: opts.episodeId ?? null,
  };
  return {
    fact: fact as unknown as Hit["fact"],
    score,
    reasons: { semantic: 0, recency: 0, frequency: 0, relevance: 0, pin: 0 },
    embedding: opts.embedding ?? null,
  };
}

// ── applyEpisodeCoherenceBoost ───────────────────────────────────────────────

describe("applyEpisodeCoherenceBoost (v2 §4.3)", () => {
  it("boosts when ≥2 facts share an episode_id", () => {
    const hits = [
      hit("a", 0.7, { episodeId: "ep-1" }),
      hit("b", 0.6, { episodeId: "ep-1" }),
      hit("c", 0.5, { episodeId: "ep-2" }),
    ];
    const out = applyEpisodeCoherenceBoost(hits);
    expect(out[0]!.score).toBeCloseTo(0.7 + EPISODE_COHERENCE_BOOST);
    expect(out[1]!.score).toBeCloseTo(0.6 + EPISODE_COHERENCE_BOOST);
    expect(out[2]!.score).toBe(0.5); // singleton episode, no boost
  });

  it("does NOT boost facts with null/undefined episode_id", () => {
    const hits = [hit("a", 0.7), hit("b", 0.6, { episodeId: null })];
    const out = applyEpisodeCoherenceBoost(hits);
    expect(out[0]!.score).toBe(0.7);
    expect(out[1]!.score).toBe(0.6);
  });

  it("returns a new array (does not mutate input)", () => {
    const hits = [hit("a", 0.5, { episodeId: "x" })];
    const before = hits[0]!.score;
    applyEpisodeCoherenceBoost(hits);
    expect(hits[0]!.score).toBe(before);
  });
});

// ── applySourceScopedDedup (#16) ─────────────────────────────────────────────

describe("applySourceScopedDedup (#16)", () => {
  it("is a no-op when threshold is 0 or undefined", () => {
    const hits = [
      hit("a", 0.7, { sourceRef: "s1", embedding: [1, 0] }),
      hit("b", 0.6, { sourceRef: "s1", embedding: [1, 0.01] }),
    ];
    expect(applySourceScopedDedup(hits, 0)).toEqual(hits);
  });

  it("drops a near-duplicate within the same source_ref", () => {
    const hits = [
      hit("a", 0.7, { sourceRef: "s1", embedding: [1, 0] }),
      hit("b", 0.6, { sourceRef: "s1", embedding: [1, 0.001] }), // ~ identical
      hit("c", 0.5, { sourceRef: "s2", embedding: [1, 0] }),
    ];
    const out = applySourceScopedDedup(hits, 0.9);
    expect(out.map((h) => h.fact.id)).toEqual(["a", "c"]);
  });

  it("does NOT cross-collapse across different source_refs", () => {
    const hits = [
      hit("a", 0.7, { sourceRef: "s1", embedding: [1, 0] }),
      hit("b", 0.6, { sourceRef: "s2", embedding: [1, 0] }), // identical embedding, DIFFERENT source
    ];
    const out = applySourceScopedDedup(hits, 0.5);
    expect(out).toHaveLength(2);
  });

  it("passes through hits without source_ref", () => {
    const hits = [hit("a", 0.7, { embedding: [1, 0] }), hit("b", 0.6, { embedding: [1, 0] })];
    expect(applySourceScopedDedup(hits, 0.5)).toEqual(hits);
  });
});

// ── applyQualityThreshold (#17) ──────────────────────────────────────────────

describe("applyQualityThreshold (#17)", () => {
  it("is a no-op when threshold is 0 or undefined", () => {
    const hits = [hit("a", 0.7, { confidence: 0.1 })];
    expect(applyQualityThreshold(hits, 0)).toEqual(hits);
  });

  it("drops hits below the threshold", () => {
    const hits = [
      hit("a", 0.9, { confidence: 0.8 }),
      hit("b", 0.8, { confidence: 0.4 }),
      hit("c", 0.7, { confidence: 0.5 }),
    ];
    expect(applyQualityThreshold(hits, 0.5).map((h) => h.fact.id)).toEqual(["a", "c"]);
  });

  it("keeps hits with exactly-threshold confidence (>= semantics)", () => {
    const hits = [hit("a", 0.5, { confidence: 0.5 })];
    expect(applyQualityThreshold(hits, 0.5)).toHaveLength(1);
  });

  it("handles missing confidence as 0 (defensive — old fixture rows)", () => {
    const hits = [
      hit("a", 0.7, { confidence: 0.8 }),
      // Manually wipe confidence to undefined.
      {
        ...hit("b", 0.6),
        fact: { ...hit("b", 0.6).fact, confidence: undefined } as unknown as Hit["fact"],
      },
    ];
    expect(applyQualityThreshold(hits, 0.5)).toHaveLength(1);
  });
});
