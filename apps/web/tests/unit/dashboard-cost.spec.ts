// apps/web/tests/unit/dashboard-cost.spec.ts
//
// COST-1 / COST-14: the dashboard's cost numbers must come from the single
// authoritative pricing source (lib/pricing.calculateCostUsd), not a duplicate
// local rate table, and an unknown model must NOT silently bill at Sonnet's rate.
import { describe, it, expect, vi } from "vitest";
import { calculateCostUsd } from "@/lib/pricing";

describe("COST-1/COST-14 — dashboard cost uses the authoritative pricing source", () => {
  it("db-queries no longer defines a duplicate MODEL_COST_PER_1K table", async () => {
    const path = await import("node:path");
    const fs = await import("node:fs");
    const filePath = path.resolve(__dirname, "../../lib/db-queries.ts");
    const src = fs.readFileSync(filePath, "utf8");
    expect(src).not.toMatch(/MODEL_COST_PER_1K/);
    expect(src).toMatch(/calculateCostUsd/);
  });

  it("calculateCostUsd warns (does not silently use 0.008) for an unknown model", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const cost = calculateCostUsd("totally-unknown-model-xyz", 1000);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("unknown model"),
      "totally-unknown-model-xyz"
    );
    // It still returns a non-negative number (best-effort fallback) — but loudly.
    expect(cost).toBeGreaterThanOrEqual(0);
    warn.mockRestore();
  });

  it("a known Sonnet model is priced via the catalog blended rate, deterministically", () => {
    // 10k tokens at the canonical blended Sonnet rate (catalog: in 0.003 + out 0.015) / 2 = 0.009/1k.
    expect(calculateCostUsd("claude-sonnet-4-6", 10_000)).toBeCloseTo(0.09, 6);
  });
});
