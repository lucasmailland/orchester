import { describe, it, expect } from "vitest";
import { runRerank } from "../src/recall/trust-decay";

describe("runRerank — trust decay wiring", () => {
  const now = new Date("2026-06-01T00:00:00Z");
  const stale = new Date(now.getTime() - 90 * 86_400_000);

  const baseHits = [
    {
      factId: "fresh",
      score: 0.5,
      statement: "fresh",
      memoryStrength: 0.8,
      lastRecalledAt: now,
    },
    {
      factId: "stale",
      score: 0.5,
      statement: "stale",
      memoryStrength: 0.8,
      lastRecalledAt: stale,
    },
  ];

  it("with applyTrustDecay=false, raw score order preserved", () => {
    const out = runRerank({ hits: baseHits, applyTrustDecay: false, now });
    expect(out[0]?.factId).toBe("fresh");
    expect(out[1]?.factId).toBe("stale");
  });

  it("with applyTrustDecay=true, fresh beats stale by wide margin", () => {
    const out = runRerank({ hits: baseHits, applyTrustDecay: true, now });
    expect(out[0]?.factId).toBe("fresh");
    expect(out[0]?.score).toBeGreaterThan(out[1]!.score * 2);
  });
});
