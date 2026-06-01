// packages/mnemosyne/tests/unit/cross-workspace-cluster.test.ts
//
// Tests for the pure cross-workspace clustering algorithm. Synthetic
// embeddings — no DB, no LLM.

import { describe, it, expect } from "vitest";
import {
  clusterCrossWorkspace,
  meanPairwiseSimilarity,
  cosineSimilarity,
  type CrossWorkspaceFactInput,
} from "../../src/consolidation/cross-workspace";

// ── Synthetic embedding helpers ─────────────────────────────────────────────
//
// Each test embedding is a 4-dim vector. Two facts with the same
// "axis index" of 1.0 cosine-1.0 to each other; orthogonal axes
// produce cosine 0. This lets us hand-build cluster scenarios.

const e = (axis: number, jitter = 0): number[] => {
  const v = [0, 0, 0, 0];
  v[axis] = 1;
  // Optional jitter in another axis to make the cosine < 1.0 but still
  // above the default 0.85 threshold for testing near-misses.
  if (jitter > 0) v[(axis + 1) % 4] = jitter;
  return v;
};

function fact(
  factId: string,
  workspaceId: string,
  axis: number,
  jitter = 0,
  opts: Partial<CrossWorkspaceFactInput> = {}
): CrossWorkspaceFactInput {
  return {
    factId,
    workspaceId,
    subject: "user",
    kind: "preference",
    embedding: e(axis, jitter),
    ...opts,
  };
}

// ── cosineSimilarity ────────────────────────────────────────────────────────

describe("cosineSimilarity (cross-workspace)", () => {
  it("returns 1 for identical unit vectors", () => {
    expect(cosineSimilarity([1, 0, 0, 0], [1, 0, 0, 0])).toBeCloseTo(1);
  });

  it("returns 0 for orthogonal unit vectors", () => {
    expect(cosineSimilarity([1, 0, 0, 0], [0, 1, 0, 0])).toBeCloseTo(0);
  });

  it("returns 0 for mismatched dimensions (defensive)", () => {
    expect(cosineSimilarity([1, 0], [1, 0, 0])).toBe(0);
  });

  it("returns 0 for empty inputs (defensive)", () => {
    expect(cosineSimilarity([], [])).toBe(0);
  });

  it("returns 0 for a zero-vector input (no division by zero)", () => {
    expect(cosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0);
  });
});

// ── meanPairwiseSimilarity ──────────────────────────────────────────────────

describe("meanPairwiseSimilarity", () => {
  it("returns 0 for a single-element input", () => {
    expect(meanPairwiseSimilarity([fact("f1", "ws-a", 0)])).toBe(0);
  });

  it("returns 1 for a pair of identical vectors", () => {
    const sim = meanPairwiseSimilarity([fact("f1", "ws-a", 0), fact("f2", "ws-b", 0)]);
    expect(sim).toBeCloseTo(1);
  });

  it("averages across all pairs", () => {
    // 3 facts: A and B identical (1.0), A and C orthogonal (0),
    // B and C orthogonal (0). Mean = (1 + 0 + 0) / 3.
    const sim = meanPairwiseSimilarity([
      fact("f1", "ws-a", 0),
      fact("f2", "ws-b", 0),
      fact("f3", "ws-c", 1),
    ]);
    expect(sim).toBeCloseTo(1 / 3);
  });
});

// ── clusterCrossWorkspace ───────────────────────────────────────────────────

describe("clusterCrossWorkspace", () => {
  it("returns no clusters for an empty input", () => {
    expect(clusterCrossWorkspace({ facts: [] })).toEqual([]);
  });

  it("returns no clusters for single-workspace input (filtered by spec §4)", () => {
    const facts = [fact("f1", "ws-a", 0), fact("f2", "ws-a", 0), fact("f3", "ws-a", 0)];
    expect(clusterCrossWorkspace({ facts })).toEqual([]);
  });

  it("clusters two cosine-1.0 facts from different workspaces", () => {
    const facts = [fact("f1", "ws-a", 0), fact("f2", "ws-b", 0)];
    const clusters = clusterCrossWorkspace({ facts });
    expect(clusters).toHaveLength(1);
    expect(clusters[0]?.facts).toHaveLength(2);
    expect(clusters[0]?.workspaceIds).toEqual(["ws-a", "ws-b"]);
    expect(clusters[0]?.meanSimilarity).toBeCloseTo(1);
  });

  it("does NOT cluster facts with different (subject, kind) keys", () => {
    const facts = [
      fact("f1", "ws-a", 0, 0, { subject: "user" }),
      fact("f2", "ws-b", 0, 0, { subject: "company" }),
    ];
    expect(clusterCrossWorkspace({ facts })).toEqual([]);
  });

  it("respects similarityThreshold — sub-threshold pairs don't merge", () => {
    // Inputs: ws-a uses axis 0; ws-b uses axis 0 with heavy jitter on
    // axis 1. Cosine = 1 / sqrt(1 + jitter²); choose a jitter that
    // gives ~0.7 cosine (below default 0.85).
    const facts = [fact("f1", "ws-a", 0), fact("f2", "ws-b", 0, 1.0)]; // cos ≈ 0.707
    expect(clusterCrossWorkspace({ facts })).toEqual([]);
  });

  it("clusters near-1.0 cosine when threshold is loosened", () => {
    const facts = [fact("f1", "ws-a", 0), fact("f2", "ws-b", 0, 1.0)];
    const clusters = clusterCrossWorkspace({ facts, similarityThreshold: 0.6 });
    expect(clusters).toHaveLength(1);
  });

  it("forms transitive clusters via union-find", () => {
    // A-B-C all axis 0 but in 3 distinct workspaces → single cluster.
    const facts = [fact("f1", "ws-a", 0), fact("f2", "ws-b", 0), fact("f3", "ws-c", 0)];
    const clusters = clusterCrossWorkspace({ facts });
    expect(clusters).toHaveLength(1);
    expect(clusters[0]?.facts).toHaveLength(3);
    expect(clusters[0]?.workspaceIds).toEqual(["ws-a", "ws-b", "ws-c"]);
  });

  it("forms separate clusters for separate semantic groups", () => {
    // Two cosine-1.0 pairs on orthogonal axes; each cross-workspace.
    const facts = [
      fact("f1", "ws-a", 0),
      fact("f2", "ws-b", 0),
      fact("f3", "ws-a", 1),
      fact("f4", "ws-b", 1),
    ];
    const clusters = clusterCrossWorkspace({ facts });
    expect(clusters).toHaveLength(2);
  });

  it("returns clusters sorted by meanSimilarity descending", () => {
    // Cluster A — perfect cosine 1.0 across 2 workspaces.
    // Cluster B — cosine ~0.9 across 2 workspaces.
    const facts = [
      fact("f1", "ws-a", 0),
      fact("f2", "ws-b", 0),
      fact("f3", "ws-a", 1, 0.5), // sim with f4 ≈ 1/sqrt(1.25) ≈ 0.894
      fact("f4", "ws-b", 1, 0.5),
    ];
    const clusters = clusterCrossWorkspace({ facts, similarityThreshold: 0.85 });
    expect(clusters).toHaveLength(2);
    expect(clusters[0]!.meanSimilarity).toBeGreaterThan(clusters[1]!.meanSimilarity);
  });

  it("preserves stable ordering on identical inputs (determinism)", () => {
    const facts = [
      fact("f1", "ws-a", 0),
      fact("f2", "ws-b", 0),
      fact("f3", "ws-a", 1),
      fact("f4", "ws-b", 1),
    ];
    const a = clusterCrossWorkspace({ facts });
    const b = clusterCrossWorkspace({ facts });
    expect(a).toEqual(b);
  });

  it("respects custom minWorkspaceCount", () => {
    // 4 facts, all axis 0, across 4 distinct workspaces. With
    // minWorkspaceCount = 5 the cluster fails the check and is
    // filtered out.
    const facts = [
      fact("f1", "ws-a", 0),
      fact("f2", "ws-b", 0),
      fact("f3", "ws-c", 0),
      fact("f4", "ws-d", 0),
    ];
    expect(clusterCrossWorkspace({ facts, minWorkspaceCount: 5 })).toEqual([]);
    expect(clusterCrossWorkspace({ facts, minWorkspaceCount: 4 })).toHaveLength(1);
  });

  it("respects custom minClusterSize", () => {
    const facts = [fact("f1", "ws-a", 0), fact("f2", "ws-b", 0)];
    expect(clusterCrossWorkspace({ facts, minClusterSize: 3 })).toEqual([]);
    expect(clusterCrossWorkspace({ facts, minClusterSize: 2 })).toHaveLength(1);
  });

  it("clamps minWorkspaceCount below 2 to 2 (single-workspace clusters never qualify)", () => {
    const facts = [fact("f1", "ws-a", 0), fact("f2", "ws-a", 0)];
    expect(clusterCrossWorkspace({ facts, minWorkspaceCount: 1 })).toEqual([]);
  });

  it("attaches stable workspaceIds sorted ascending", () => {
    const facts = [fact("f1", "ws-c", 0), fact("f2", "ws-a", 0), fact("f3", "ws-b", 0)];
    const clusters = clusterCrossWorkspace({ facts });
    expect(clusters[0]?.workspaceIds).toEqual(["ws-a", "ws-b", "ws-c"]);
  });
});
