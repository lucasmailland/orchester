// apps/web/tests/unit/pct-change.spec.ts
//
// COST-3: growth deltas must be clamped and "from zero" must be flagged as new,
// not rendered as an absurd percentage.
import { describe, it, expect } from "vitest";
import { pctChange, PCT_CHANGE_CAP } from "@/components/dashboard/DashboardClient";

describe("COST-3 — pctChange clamping", () => {
  it("returns null when prev and now are both 0 (nothing to compare)", () => {
    expect(pctChange(0, 0)).toBeNull();
  });
  it("returns 'new' when prev is 0 but now > 0", () => {
    expect(pctChange(98, 0)).toBe("new");
  });
  it("clamps a huge positive jump to the cap", () => {
    // 8 -> 98 is +1125%; must clamp to +PCT_CHANGE_CAP.
    expect(pctChange(98, 8)).toBe(PCT_CHANGE_CAP);
  });
  it("returns -100 for a complete drop (now=0, mathematical floor for positive values)", () => {
    // With non-negative usage stats, (0-prev)/prev = -100% at most.
    // Math.max(-PCT_CHANGE_CAP, -100) = -100 (cap irrelevant, but the clamp is present).
    expect(pctChange(0, 100)).toBe(-100);
  });
  it("passes through a normal change unclamped", () => {
    expect(pctChange(110, 100)).toBe(10);
  });
});
