// packages/mnemosyne/tests/unit/stage-caps.test.ts
//
// v2 — Per-stage adaptive cap helper tests.

import { describe, it, expect } from "vitest";
import {
  STAGE_CAP_BY_TIER,
  factCountTier,
  drawerGrepCapForFactCount,
  firstStageCapForFactCount,
} from "../../src/recall/stage-caps";

describe("factCountTier", () => {
  it("maps 0 → '<1k'", () => {
    expect(factCountTier(0)).toBe("<1k");
  });

  it("maps 999 → '<1k' (boundary − 1)", () => {
    expect(factCountTier(999)).toBe("<1k");
  });

  it("maps 1000 → '<10k' (boundary)", () => {
    expect(factCountTier(1000)).toBe("<10k");
  });

  it("maps 9999 → '<10k'", () => {
    expect(factCountTier(9999)).toBe("<10k");
  });

  it("maps 10000 → '<100k' (boundary)", () => {
    expect(factCountTier(10000)).toBe("<100k");
  });

  it("maps 100000 → '>=100k' (boundary)", () => {
    expect(factCountTier(100000)).toBe(">=100k");
  });

  it("maps 10_000_000 → '>=100k' (large)", () => {
    expect(factCountTier(10_000_000)).toBe(">=100k");
  });
});

describe("STAGE_CAP_BY_TIER", () => {
  it("first-stage cap grows monotonically with tier", () => {
    expect(STAGE_CAP_BY_TIER["<1k"]!.firstStage).toBeLessThan(
      STAGE_CAP_BY_TIER["<10k"]!.firstStage
    );
    expect(STAGE_CAP_BY_TIER["<10k"]!.firstStage).toBeLessThan(
      STAGE_CAP_BY_TIER["<100k"]!.firstStage
    );
    expect(STAGE_CAP_BY_TIER["<100k"]!.firstStage).toBeLessThan(
      STAGE_CAP_BY_TIER[">=100k"]!.firstStage
    );
  });

  it("drawer-grep cap grows monotonically with tier", () => {
    expect(STAGE_CAP_BY_TIER["<1k"]!.drawerGrep).toBeLessThan(
      STAGE_CAP_BY_TIER["<10k"]!.drawerGrep
    );
    expect(STAGE_CAP_BY_TIER["<10k"]!.drawerGrep).toBeLessThan(
      STAGE_CAP_BY_TIER["<100k"]!.drawerGrep
    );
    expect(STAGE_CAP_BY_TIER["<100k"]!.drawerGrep).toBeLessThan(
      STAGE_CAP_BY_TIER[">=100k"]!.drawerGrep
    );
  });

  it("first-stage cap is always >= drawer-grep cap (full pool is the recall floor)", () => {
    for (const tier of ["<1k", "<10k", "<100k", ">=100k"] as const) {
      expect(STAGE_CAP_BY_TIER[tier]!.firstStage).toBeGreaterThanOrEqual(
        STAGE_CAP_BY_TIER[tier]!.drawerGrep
      );
    }
  });

  it("is frozen", () => {
    expect(Object.isFrozen(STAGE_CAP_BY_TIER)).toBe(true);
  });
});

describe("drawerGrepCapForFactCount / firstStageCapForFactCount", () => {
  it("agree with the map at every tier", () => {
    for (const [count, tier] of [
      [500, "<1k"],
      [5000, "<10k"],
      [50_000, "<100k"],
      [500_000, ">=100k"],
    ] as const) {
      expect(drawerGrepCapForFactCount(count)).toBe(STAGE_CAP_BY_TIER[tier]!.drawerGrep);
      expect(firstStageCapForFactCount(count)).toBe(STAGE_CAP_BY_TIER[tier]!.firstStage);
    }
  });
});
