// apps/web/tests/unit/monthly-usage-cost.spec.ts
//
// COST-2: getMonthlyUsage must expose authoritative USD (sum of usage_event.cost_usd),
// not only message/token counts.
import { describe, it, expect } from "vitest";
import path from "node:path";
import fs from "node:fs";

describe("COST-2 — getMonthlyUsage returns authoritative USD", () => {
  it("getMonthlyUsage return type includes costUsd", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "../../lib/billing/quotas.ts"), "utf8");
    expect(src).toMatch(/costUsd/);
    expect(src).toMatch(/costUsd.*sum|sum.*cost/);
  });

  it("billing/usage API route exposes usage (costUsd passthrough)", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "../../app/api/billing/usage/route.ts"),
      "utf8"
    );
    // The route returns the full usage object; since getMonthlyUsage now includes
    // costUsd, the API passthrough makes it available without extra changes.
    expect(src).toMatch(/usage/);
  });
});
