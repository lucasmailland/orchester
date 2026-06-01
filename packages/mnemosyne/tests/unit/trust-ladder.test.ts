// packages/mnemosyne/tests/unit/trust-ladder.test.ts
//
// v2 — Trust ladder unit tests. Validates the back-compat mapping
// (NULL ⇒ "llm", unknown ⇒ "unverified") and the monotonic decay
// ordering across rungs.

import { describe, it, expect } from "vitest";
import {
  classifyTrustRung,
  trustDecay,
  TRUST_LADDER_DECAY,
  type TrustLadderRung,
} from "../../src/recall/trust-ladder";

describe("classifyTrustRung", () => {
  it("maps NULL to 'llm' (v1.1 back-compat default)", () => {
    expect(classifyTrustRung(null)).toBe("llm");
    expect(classifyTrustRung(undefined)).toBe("llm");
  });

  it("passes through canonical rung names verbatim", () => {
    const rungs: TrustLadderRung[] = ["verified", "llm", "heuristic", "pending", "unverified"];
    for (const r of rungs) {
      expect(classifyTrustRung(r)).toBe(r);
    }
  });

  it("maps unknown strings to 'unverified' (defensive lowest rung)", () => {
    expect(classifyTrustRung("bogus")).toBe("unverified");
    expect(classifyTrustRung("")).toBe("unverified");
    expect(classifyTrustRung("LLM")).toBe("unverified"); // case-sensitive
  });
});

describe("TRUST_LADDER_DECAY", () => {
  it("is monotonically non-increasing across the ladder ordering", () => {
    // The ladder reads "verified > llm > heuristic > pending > unverified"
    // top to bottom. Decay must respect that ordering so a more-trusted
    // edge never scores LOWER than a less-trusted one.
    const order: TrustLadderRung[] = ["verified", "llm", "heuristic", "pending", "unverified"];
    for (let i = 1; i < order.length; i++) {
      const lower = TRUST_LADDER_DECAY[order[i]!];
      const higher = TRUST_LADDER_DECAY[order[i - 1]!];
      expect(higher).toBeGreaterThanOrEqual(lower);
    }
  });

  it("preserves v1.1 behaviour for the NULL ⇒ 'llm' default", () => {
    // v1.1's `decayForEdge` returned the base unchanged for NULL.
    // Equivalent: trustDecay(null) = 1.0 → min(base, 1.0) = base.
    expect(TRUST_LADDER_DECAY.llm).toBe(1.0);
  });

  it("preserves v1.1 behaviour for 'heuristic' (capped at 0.5)", () => {
    expect(TRUST_LADDER_DECAY.heuristic).toBe(0.5);
  });

  it("is frozen (cannot be mutated by external callers)", () => {
    // Object.freeze prevents mutation; assigning throws in strict mode.
    expect(Object.isFrozen(TRUST_LADDER_DECAY)).toBe(true);
  });
});

describe("trustDecay", () => {
  it("returns the rung's cap directly", () => {
    expect(trustDecay("verified")).toBe(1.0);
    expect(trustDecay("heuristic")).toBe(0.5);
  });

  it("treats NULL and undefined as 'llm' (back-compat)", () => {
    expect(trustDecay(null)).toBe(TRUST_LADDER_DECAY.llm);
    expect(trustDecay(undefined)).toBe(TRUST_LADDER_DECAY.llm);
  });

  it("treats unknown strings as 'unverified' (defensive)", () => {
    expect(trustDecay("bogus")).toBe(TRUST_LADDER_DECAY.unverified);
  });
});
