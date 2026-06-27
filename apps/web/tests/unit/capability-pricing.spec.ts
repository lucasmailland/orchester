// apps/web/tests/unit/capability-pricing.spec.ts
//
// COST-7: an unknown capability must not silently price at 0 — it must warn.
import { describe, it, expect, vi } from "vitest";
import { calculateCapabilityCostUsd } from "@/lib/pricing";

describe("COST-7 — unknown capability pricing", () => {
  it("warns once for an unknown capability and returns 0 (best-effort)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const cost = calculateCapabilityCostUsd("holographic-render", 3);
    expect(cost).toBe(0);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("unknown capability"),
      "holographic-render"
    );
    warn.mockRestore();
  });
  it("prices a known capability normally without warning", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(calculateCapabilityCostUsd("image", 2)).toBeCloseTo(0.08, 6);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
