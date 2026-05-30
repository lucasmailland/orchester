// packages/mnemosyne/tests/unit/search-bfs.test.ts
//
// Unit tests for #26 (BFS verb-priority decay) and #27 (contains / contained_by).
// All tests are pure-function — no DB required.

import { describe, it, expect } from "vitest";
import { VERB_EXPAND_PRIORITY } from "../../src/recall/search";

// ── #26 BFS verb-priority ──────────────────────────────────────────────────

describe("VERB_EXPAND_PRIORITY (#26)", () => {
  it("covers all 8 expansion verbs", () => {
    const expected = [
      "part_of",
      "member_of",
      "contains",
      "contained_by", // #27
      "supersedes",
      "derived_from",
      "scoped",
      "related",
    ];
    for (const verb of expected) {
      expect(VERB_EXPAND_PRIORITY).toHaveProperty(verb);
    }
  });

  it("all priorities are in (0, 1]", () => {
    for (const [verb, p] of Object.entries(VERB_EXPAND_PRIORITY)) {
      expect(p).toBeGreaterThan(0);
      expect(p).toBeLessThanOrEqual(1.0);
      void verb;
    }
  });

  it("part_of and member_of have max priority (1.0)", () => {
    expect(VERB_EXPAND_PRIORITY["part_of"]).toBe(1.0);
    expect(VERB_EXPAND_PRIORITY["member_of"]).toBe(1.0);
  });

  it("#27 — contains and contained_by have high but sub-max priority", () => {
    const contains = VERB_EXPAND_PRIORITY["contains"]!;
    const containedBy = VERB_EXPAND_PRIORITY["contained_by"]!;
    // Both high, but less than part_of (they're coarser-grained).
    expect(contains).toBeGreaterThan(0.8);
    expect(contains).toBeLessThan(1.0);
    expect(containedBy).toBeGreaterThan(0.8);
    expect(containedBy).toBeLessThan(1.0);
  });

  it("related has strictly lower priority than all structural verbs", () => {
    const related = VERB_EXPAND_PRIORITY["related"]!;
    const structural = [
      VERB_EXPAND_PRIORITY["part_of"]!,
      VERB_EXPAND_PRIORITY["member_of"]!,
      VERB_EXPAND_PRIORITY["contains"]!,
      VERB_EXPAND_PRIORITY["contained_by"]!,
      VERB_EXPAND_PRIORITY["supersedes"]!,
      VERB_EXPAND_PRIORITY["derived_from"]!,
    ];
    for (const p of structural) {
      expect(p).toBeGreaterThan(related);
    }
  });

  it("priority ordering is consistent: part_of ≥ contains ≥ supersedes ≥ derived_from ≥ scoped ≥ related", () => {
    const order = [
      VERB_EXPAND_PRIORITY["part_of"]!,
      VERB_EXPAND_PRIORITY["contains"]!,
      VERB_EXPAND_PRIORITY["supersedes"]!,
      VERB_EXPAND_PRIORITY["derived_from"]!,
      VERB_EXPAND_PRIORITY["scoped"]!,
      VERB_EXPAND_PRIORITY["related"]!,
    ];
    for (let i = 0; i < order.length - 1; i++) {
      expect(order[i]!).toBeGreaterThanOrEqual(order[i + 1]!);
    }
  });
});

// ── Decay math (white-box, consistent with decayForEdge internals) ────────

describe("decayForEdge math via VERB_EXPAND_PRIORITY (#26)", () => {
  /**
   * Mirror of decayForEdge(base, provenance, verb) — the internal fn is
   * private, but we can verify the expected results through the priority
   * map directly (since the formula is: provenanceDecay × verbPriority).
   */
  function expectedDecay(base: number, provenance: string | null, verb: string): number {
    const provDecay = provenance === "heuristic" ? Math.min(base, 0.5) : base;
    const verbPriority = VERB_EXPAND_PRIORITY[verb] ?? 0.7;
    return provDecay * verbPriority;
  }

  it("part_of LLM edge has the same decay as base (priority = 1.0)", () => {
    expect(expectedDecay(0.7, null, "part_of")).toBeCloseTo(0.7);
  });

  it("related LLM edge decays more than part_of (priority < 1.0)", () => {
    const partOf = expectedDecay(0.7, null, "part_of");
    const related = expectedDecay(0.7, null, "related");
    expect(related).toBeLessThan(partOf);
  });

  it("related heuristic edge has the lowest effective decay", () => {
    const relatedHeuristic = expectedDecay(0.7, "heuristic", "related");
    const partOfHeuristic = expectedDecay(0.7, "heuristic", "part_of");
    const relatedLlm = expectedDecay(0.7, null, "related");
    expect(relatedHeuristic).toBeLessThan(relatedLlm);
    expect(relatedHeuristic).toBeLessThan(partOfHeuristic);
  });

  it("contains LLM decay is close to but less than part_of decay", () => {
    const contains = expectedDecay(0.7, null, "contains");
    const partOf = expectedDecay(0.7, null, "part_of");
    expect(contains).toBeLessThan(partOf);
    // Still high priority — not lower than 0.8× the base.
    expect(contains).toBeGreaterThan(0.7 * 0.8);
  });

  it("unknown verb defaults to 0.70 priority (conservative)", () => {
    const unknownVerb = expectedDecay(0.7, null, "invented_verb_xyz");
    expect(unknownVerb).toBeCloseTo(0.7 * 0.7);
  });
});

// ── #27 containment verbs present in expansion set ────────────────────────

describe("contains / contained_by expansion verbs (#27)", () => {
  it("contains and contained_by are tracked in VERB_EXPAND_PRIORITY", () => {
    expect(VERB_EXPAND_PRIORITY["contains"]).toBeDefined();
    expect(VERB_EXPAND_PRIORITY["contained_by"]).toBeDefined();
  });

  it("contains and contained_by are symmetric in priority", () => {
    // Hierarchical edges: A contains B / B contained_by A — same trust level.
    expect(VERB_EXPAND_PRIORITY["contains"]).toBe(VERB_EXPAND_PRIORITY["contained_by"]);
  });

  it("containment priority is higher than scoped and related", () => {
    const containsPrio = VERB_EXPAND_PRIORITY["contains"]!;
    expect(containsPrio).toBeGreaterThan(VERB_EXPAND_PRIORITY["scoped"]!);
    expect(containsPrio).toBeGreaterThan(VERB_EXPAND_PRIORITY["related"]!);
  });
});
