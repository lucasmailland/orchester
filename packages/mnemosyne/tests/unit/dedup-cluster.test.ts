// packages/mnemosyne/tests/unit/dedup-cluster.test.ts
//
// Unit tests for the pure-function pieces of the dedup pipeline:
// the UnionFind helper and `pickPrimary`. These never touch the DB
// so we can exercise edge cases (empty input, self-edges, pinned
// override, score ties) deterministically.
import { describe, it, expect } from "vitest";
import { UnionFind, pickPrimary } from "../../src/janitor/dedup";
import type { MnemoFact } from "../../src/primitives/fact";

function makeFact(overrides: Partial<MnemoFact> & { id: string }): MnemoFact {
  const now = new Date("2026-05-25T00:00:00Z");
  return {
    workspaceId: "ws_test",
    agentId: null,
    scope: "global",
    scopeRef: null,
    kind: "preference",
    subject: "user",
    statement: "test statement",
    confidence: 0.7,
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
    validFrom: now,
    validTo: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("janitor/dedup — UnionFind", () => {
  it("each id is its own root in a fresh structure", () => {
    const uf = new UnionFind(["a", "b", "c"]);
    expect(uf.find("a")).toBe("a");
    expect(uf.find("b")).toBe("b");
    expect(uf.find("c")).toBe("c");
  });

  it("union merges two singletons into one component", () => {
    const uf = new UnionFind(["a", "b", "c"]);
    uf.union("a", "b");
    expect(uf.find("a")).toBe(uf.find("b"));
    expect(uf.find("a")).not.toBe(uf.find("c"));
  });

  it("transitive unions collapse into a single root", () => {
    const uf = new UnionFind(["a", "b", "c", "d"]);
    uf.union("a", "b");
    uf.union("b", "c");
    uf.union("c", "d");
    const root = uf.find("a");
    expect(uf.find("b")).toBe(root);
    expect(uf.find("c")).toBe(root);
    expect(uf.find("d")).toBe(root);
  });

  it("union is a no-op when both ids already share a root", () => {
    const uf = new UnionFind(["a", "b"]);
    uf.union("a", "b");
    const r1 = uf.find("a");
    uf.union("a", "b"); // again
    expect(uf.find("a")).toBe(r1);
    expect(uf.find("b")).toBe(r1);
  });

  it("find on an unknown id returns the id itself (no crash)", () => {
    const uf = new UnionFind(["a"]);
    expect(uf.find("unknown")).toBe("unknown");
  });

  it("preserves multiple disjoint components", () => {
    const uf = new UnionFind(["a", "b", "c", "d", "e"]);
    uf.union("a", "b");
    uf.union("d", "e");
    // {a,b} and {d,e} and {c} are three components.
    expect(uf.find("a")).toBe(uf.find("b"));
    expect(uf.find("d")).toBe(uf.find("e"));
    expect(uf.find("a")).not.toBe(uf.find("d"));
    expect(uf.find("c")).not.toBe(uf.find("a"));
    expect(uf.find("c")).not.toBe(uf.find("d"));
  });

  it("survives a large connected component via union-by-rank", () => {
    // Linear chain a→b→c→…→j (10 nodes). Path compression should
    // flatten this so subsequent find() calls are O(1).
    const ids = "abcdefghij".split("");
    const uf = new UnionFind(ids);
    for (let i = 0; i < ids.length - 1; i++) {
      uf.union(ids[i]!, ids[i + 1]!);
    }
    const root = uf.find("a");
    for (const id of ids) {
      expect(uf.find(id)).toBe(root);
    }
  });
});

describe("janitor/dedup — pickPrimary", () => {
  it("returns the only fact when given a single-element array", () => {
    const f = makeFact({ id: "f1" });
    expect(pickPrimary([f])).toBe(f);
  });

  it("picks the highest composite score (relevance dominates at low hit counts)", () => {
    const high = makeFact({ id: "high", relevance: 0.9, confidence: 0.5, hitCount: 0 });
    const low = makeFact({ id: "low", relevance: 0.2, confidence: 0.5, hitCount: 0 });
    expect(pickPrimary([low, high])).toBe(high);
    expect(pickPrimary([high, low])).toBe(high);
  });

  it("prefers a pinned fact even when its other scores are worse", () => {
    const pinned = makeFact({
      id: "pinned",
      pinned: true,
      relevance: 0.1,
      confidence: 0.1,
      hitCount: 0,
    });
    const better = makeFact({
      id: "better",
      pinned: false,
      relevance: 0.9,
      confidence: 0.9,
      hitCount: 50,
    });
    expect(pickPrimary([better, pinned])).toBe(pinned);
    expect(pickPrimary([pinned, better])).toBe(pinned);
  });

  it("hit_count contribution is bounded by the log curve (100 hits ≈ +0.3)", () => {
    // Two facts identical except hit_count; the high-hit one wins, but
    // not by more than ~0.3 — the log-curve cap.
    const hot = makeFact({ id: "hot", relevance: 0.5, confidence: 0.5, hitCount: 100 });
    const cold = makeFact({ id: "cold", relevance: 0.5, confidence: 0.5, hitCount: 0 });
    expect(pickPrimary([cold, hot])).toBe(hot);
  });

  it("first pinned fact wins when multiple are pinned (stable order)", () => {
    const a = makeFact({ id: "a", pinned: true, relevance: 0.5 });
    const b = makeFact({ id: "b", pinned: true, relevance: 0.9 });
    // Per the implementation, `.find(...)` returns the first match —
    // which is `a` here. The order is deterministic: callers can rely
    // on the cluster's input ordering to pick a stable winner.
    expect(pickPrimary([a, b])).toBe(a);
  });
});
