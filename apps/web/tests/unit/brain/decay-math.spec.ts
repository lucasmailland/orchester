// Unit tests for the decay formula used in lib/brain/decay.ts.
// The actual decay runs as a single SQL UPDATE; this spec lives at
// the math level (we replicate the formula in TS) so we can prove the
// behavior properties without spinning up a DB.

import { describe, it, expect } from "vitest";

const HALF_LIFE_DAYS = 30;
const FLOOR = 0.05;

function decay(relevance: number, daysElapsed: number): number {
  // True half-life: factor = 2^(-Δt/H) = exp(-ln(2) * Δt/H)
  const factor = Math.exp((-Math.LN2 * daysElapsed) / HALF_LIFE_DAYS);
  return Math.max(FLOOR, relevance * factor);
}

describe("brain decay formula", () => {
  it("halves relevance over HALF_LIFE_DAYS", () => {
    const r0 = 1.0;
    const r30 = decay(r0, HALF_LIFE_DAYS);
    expect(r30).toBeGreaterThan(0.49);
    expect(r30).toBeLessThan(0.51);
  });

  it("approaches floor as days → infinity", () => {
    const r = decay(1.0, 10_000);
    expect(r).toBe(FLOOR);
  });

  it("is monotonically non-increasing with time", () => {
    let prev = 1.0;
    for (let d = 1; d <= 365; d += 7) {
      const r = decay(1.0, d);
      expect(r).toBeLessThanOrEqual(prev);
      prev = r;
    }
  });

  it("never goes below floor even from a low start", () => {
    const r = decay(0.06, 1000);
    expect(r).toBe(FLOOR);
  });

  it("starting at floor stays at floor", () => {
    const r = decay(FLOOR, 1);
    expect(r).toBe(FLOOR);
  });
});
