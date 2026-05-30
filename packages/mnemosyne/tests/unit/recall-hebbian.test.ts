// packages/mnemosyne/tests/unit/recall-hebbian.test.ts
//
// Unit tests for the v1.1 #10 Hebbian / Ebbinghaus pure functions.
// No DB, no imports from drizzle — just math validation.

import { describe, it, expect } from "vitest";
import {
  computeHebbianDecay,
  MAX_MEMORY_STRENGTH,
  MIN_MEMORY_STRENGTH,
  POTENTIATION_INCREMENT,
  STABILITY_INCREMENT,
  CEPEDA_SPACING_SECONDS,
} from "../../src/primitives/fact";

describe("computeHebbianDecay", () => {
  it("returns the same strength when no time has elapsed", () => {
    expect(computeHebbianDecay(2.0, 1.0, 0)).toBeCloseTo(2.0, 6);
  });

  it("returns the same strength for negative elapsed time (safety guard)", () => {
    expect(computeHebbianDecay(3.0, 1.0, -3600)).toBeCloseTo(3.0, 6);
  });

  it("decays by exp(-1) after stability-equivalent days (stability=1.0, 1 day)", () => {
    // days_elapsed = 86400s / 86400 = 1.0 day; stability = 1.0 day
    // decay_factor = exp(-1/1) ≈ 0.3679
    const decayed = computeHebbianDecay(1.0, 1.0, 86400);
    expect(decayed).toBeCloseTo(Math.exp(-1), 5);
  });

  it("decays slower with higher stability", () => {
    // stability = 10 days: after 1 day → exp(-1/10) ≈ 0.905
    const decayed = computeHebbianDecay(1.0, 10.0, 86400);
    expect(decayed).toBeCloseTo(Math.exp(-1 / 10), 5);
    // stability = 1 day: much faster
    const decayedFast = computeHebbianDecay(1.0, 1.0, 86400);
    expect(decayed).toBeGreaterThan(decayedFast);
  });

  it("floors at MIN_MEMORY_STRENGTH when strength decays below threshold", () => {
    // A very long elapsed time should floor, not reach zero
    const veryDecayed = computeHebbianDecay(1.0, 1.0, 86400 * 1000);
    expect(veryDecayed).toBeCloseTo(MIN_MEMORY_STRENGTH, 6);
  });

  it("floors correctly when starting near the floor", () => {
    // strength = 0.06 after 1 day with stability=1: 0.06 * exp(-1) ≈ 0.022 → floor
    const decayed = computeHebbianDecay(0.06, 1.0, 86400);
    expect(decayed).toBe(MIN_MEMORY_STRENGTH);
  });

  it("does not floor when result is above MIN_MEMORY_STRENGTH", () => {
    // strength = 5.0, stability = 10, elapsed = 1 day: 5 * exp(-0.1) ≈ 4.52
    const decayed = computeHebbianDecay(5.0, 10.0, 86400);
    expect(decayed).toBeGreaterThan(MIN_MEMORY_STRENGTH);
    expect(decayed).toBeCloseTo(5.0 * Math.exp(-1 / 10), 4);
  });

  it("is consistent with half-life semantics (H = stability * ln(2))", () => {
    // After H seconds, strength should halve (to the extent the floor allows)
    const stability = 7.0; // days
    const halfLifeSeconds = stability * Math.LN2 * 86400;
    const halved = computeHebbianDecay(2.0, stability, halfLifeSeconds);
    expect(halved).toBeCloseTo(1.0, 3); // 2.0 * 0.5 = 1.0
  });
});

describe("exported constants — contract", () => {
  it("POTENTIATION_INCREMENT is positive and < 0.5", () => {
    expect(POTENTIATION_INCREMENT).toBeGreaterThan(0);
    expect(POTENTIATION_INCREMENT).toBeLessThan(0.5);
  });

  it("STABILITY_INCREMENT is positive and < 1.0", () => {
    expect(STABILITY_INCREMENT).toBeGreaterThan(0);
    expect(STABILITY_INCREMENT).toBeLessThan(1.0);
  });

  it("MAX_MEMORY_STRENGTH is greater than the DB default (1.0)", () => {
    expect(MAX_MEMORY_STRENGTH).toBeGreaterThan(1.0);
  });

  it("MIN_MEMORY_STRENGTH is greater than zero", () => {
    expect(MIN_MEMORY_STRENGTH).toBeGreaterThan(0);
  });

  it("CEPEDA_SPACING_SECONDS is at least 1 hour", () => {
    // Must be at least 3600 seconds (1 hour) as per the spec.
    expect(CEPEDA_SPACING_SECONDS).toBeGreaterThanOrEqual(3600);
  });

  it("potentiation from 1.0 stays below MAX_MEMORY_STRENGTH in a single step", () => {
    // 1.0 + POTENTIATION_INCREMENT must still be <= MAX
    expect(1.0 + POTENTIATION_INCREMENT).toBeLessThanOrEqual(MAX_MEMORY_STRENGTH);
  });

  it("MIN_MEMORY_STRENGTH < 1.0 + POTENTIATION_INCREMENT (floor below default+potentiation)", () => {
    expect(MIN_MEMORY_STRENGTH).toBeLessThan(1.0 + POTENTIATION_INCREMENT);
  });
});
