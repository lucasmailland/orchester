// apps/web/tests/unit/max-tool-iterations.spec.ts
//
// ORCH-5: maxTurns must be honored (up to a sane ceiling), not hard-capped at 5.
import { describe, it, expect } from "vitest";
import { resolveMaxToolIterations, MAX_TOOL_ITERATIONS_CEILING } from "@/lib/agent-runtime";

describe("ORCH-5 — resolveMaxToolIterations", () => {
  it("honors a configured value of 20 (no longer clamped to 5)", () => {
    expect(resolveMaxToolIterations(20)).toBe(20);
  });
  it("defaults to 20 when null/undefined", () => {
    expect(resolveMaxToolIterations(null)).toBe(20);
    expect(resolveMaxToolIterations(undefined)).toBe(20);
  });
  it("clamps to the sane ceiling for absurd values", () => {
    expect(resolveMaxToolIterations(10_000)).toBe(MAX_TOOL_ITERATIONS_CEILING);
  });
  it("floors at 1 for zero/negative", () => {
    expect(resolveMaxToolIterations(0)).toBe(1);
    expect(resolveMaxToolIterations(-3)).toBe(1);
  });
});
