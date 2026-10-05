import { afterEach, describe, expect, it, vi } from "vitest";
import { evaluateSheet } from "@/lib/flows/spreadsheet";

// Spreadsheet formulas are evaluated like the JavaScript step, so they share
// its FLOW_CODE_EXECUTION switch.
describe("evaluateSheet code-execution gate", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("refuses to evaluate formulas when FLOW_CODE_EXECUTION is off", async () => {
    vi.stubEnv("FLOW_CODE_EXECUTION", "");
    await expect(evaluateSheet({ A1: "=1+1" }, {}, "A1")).rejects.toThrow(/FLOW_CODE_EXECUTION/);
  });

  it("evaluates formulas when FLOW_CODE_EXECUTION=1", async () => {
    vi.stubEnv("FLOW_CODE_EXECUTION", "1");
    await expect(evaluateSheet({ A1: "=1+1" }, {}, "A1")).resolves.toBe(2);
  });
});
