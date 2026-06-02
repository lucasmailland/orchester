import { describe, it, expect } from "vitest";
import { effectiveTrust, DECAY_HALF_LIFE_DAYS } from "../src/recall/trust-decay";

describe("effectiveTrust", () => {
  const now = new Date("2026-06-01T00:00:00Z");

  it("returns base strength when never recalled", () => {
    expect(effectiveTrust({ memoryStrength: 0.8, lastRecalledAt: null, now })).toBeCloseTo(0.8, 5);
  });

  it("returns base strength when just recalled", () => {
    expect(effectiveTrust({ memoryStrength: 0.8, lastRecalledAt: now, now })).toBeCloseTo(0.8, 5);
  });

  it("halves base after one half-life", () => {
    const past = new Date(now.getTime() - DECAY_HALF_LIFE_DAYS * 86_400_000);
    expect(effectiveTrust({ memoryStrength: 0.8, lastRecalledAt: past, now })).toBeCloseTo(0.4, 4);
  });

  it("never returns less than 0", () => {
    const veryOld = new Date(now.getTime() - 365 * 100 * 86_400_000);
    const out = effectiveTrust({
      memoryStrength: 0.8,
      lastRecalledAt: veryOld,
      now,
    });
    expect(out).toBeGreaterThanOrEqual(0);
    expect(out).toBeLessThan(0.01);
  });

  it("is monotonic — more elapsed time never increases trust", () => {
    const t1 = new Date(now.getTime() - 1 * 86_400_000);
    const t30 = new Date(now.getTime() - 30 * 86_400_000);
    const v1 = effectiveTrust({ memoryStrength: 0.8, lastRecalledAt: t1, now });
    const v30 = effectiveTrust({ memoryStrength: 0.8, lastRecalledAt: t30, now });
    expect(v30).toBeLessThan(v1);
  });
});
