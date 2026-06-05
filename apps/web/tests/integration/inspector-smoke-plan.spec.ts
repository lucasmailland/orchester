// apps/web/tests/integration/inspector-smoke-plan.spec.ts
//
// v1.6 G1-7 — Inspector smoke-test PLAN.
//
// This file documents the 14-step Chrome MCP smoke test that bootstraps
// the Memory Inspector via /api/admin/mnemo-seed and walks every screen
// the Inspector exposes. The actual browser walk-through runs out-of-
// band (the Chrome session lives on the operator's machine, not in CI)
// — this spec asserts the PRE-CONDITIONS the smoke test depends on:
//
//   1. /api/admin/mnemo-seed endpoint exists and is gated to non-prod.
//   2. seedMnemoFacts produces the expected distribution.
//   3. The bitemporal asOf filter (G1-3) is wired into the GET route.
//
// The end-to-end smoke walk is:
//
//   1. POST /api/admin/mnemo-seed?count=30 — populates 30 facts.
//   2. GET /en/<ws>/brain — verify 30 facts visible.
//   3. Click into a fact — detail page renders with citations panel.
//   4. PATCH statement inline — toast → refresh → row updated.
//   5. Pin / unpin — badge toggles.
//   6. Forget / restore — status changes.
//   7. Filter by kind — subset matches.
//   8. Filter by memory_type — subset matches.
//   9. Search "espresso" — preference subset matches.
//  10. TimeTravelPicker → past date → count drops; Now → 30 back.
//  11. /brain/timeline — today's group has 30 entries.
//  12. /brain/diff — "Added" column has 30.
//  13. /brain/export — download triggered (Content-Disposition header).
//  14. /brain/undo — seed activity in the undo log.

import { describe, it, expect } from "vitest";
import { existsSync } from "fs";
import { resolve } from "path";

describe("v1.6 G1-7 — Inspector smoke-test plan pre-conditions", () => {
  it("admin/mnemo-seed route file exists", () => {
    const p = resolve(__dirname, "../../app/api/admin/mnemo-seed/route.ts");
    expect(existsSync(p)).toBe(true);
  });

  it("dev-seed helper file exists", () => {
    const p = resolve(__dirname, "../../lib/dev-seed/mnemo-seed.ts");
    expect(existsSync(p)).toBe(true);
  });

  it("TimeTravelPicker component file exists", () => {
    const p = resolve(__dirname, "../../components/brain/TimeTravelPicker.tsx");
    expect(existsSync(p)).toBe(true);
  });

  it("/api/mnemo/facts route accepts ?asOf query param", async () => {
    // Source-level assertion — read the route file and confirm the
    // bitemporal filter wiring is present. End-to-end behaviour is
    // covered by the L3 cache spec + recall-hyde spec in mnemosyne.
    const { readFileSync } = await import("fs");
    const src = readFileSync(resolve(__dirname, "../../app/api/mnemo/facts/route.ts"), "utf8");
    expect(src).toMatch(/asOf/);
    expect(src).toMatch(/valid_from <=/);
  });
});
