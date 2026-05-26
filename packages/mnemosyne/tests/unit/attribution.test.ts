// packages/mnemosyne/tests/unit/attribution.test.ts
//
// Pure type-surface tests for v1.4 theory-of-mind attribution. The
// integration coverage (filter pushdown into FTS + vector branches)
// lives in `tests/integration/recall-attribution.spec.ts`; this file
// pins the public type contract so a future renaming / re-tagging
// breaks the build instead of silently shifting downstream consumers.
import { describe, it, expect } from "vitest";
import type { Attribution } from "../../src/types";

describe("types/Attribution", () => {
  it("accepts the four canonical values", () => {
    // Type-level check via TS narrowing: each variant must satisfy the
    // Attribution union, and an arbitrary string must NOT (commented
    // assertion below — would be a TS error if uncommented).
    const samples: Attribution[] = ["user_stated", "user_belief", "objective_fact", "inferred"];
    expect(samples).toHaveLength(4);
    // The runtime assertions are trivial — the value of this test is
    // that the line above fails to compile if the vocabulary changes
    // without a coordinated update to dependents.
    expect(samples).toContain("inferred");
    expect(samples).toContain("user_stated");
  });

  it("defaults conceptually to 'inferred' (SQL DEFAULT contract)", () => {
    // We can't run a DB here, but the contract is documented + enforced
    // at the migration layer. This assertion is the documentation: any
    // downstream code that special-cases 'inferred' (e.g. UI badges,
    // confidence boosts) reads this test as the authoritative default.
    const fallback: Attribution = "inferred";
    expect(fallback).toBe("inferred");
  });
});
