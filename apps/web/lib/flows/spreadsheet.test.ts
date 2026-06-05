import { describe, it, expect } from "vitest";
import { evaluateSheet } from "./spreadsheet";

describe("evaluateSheet", () => {
  it("evaluates literals and a SUM over a range", async () => {
    const r = await evaluateSheet({ A1: "2", A2: "3", A3: "=SUM(A1:A2)" }, {}, "A3");
    expect(r).toBe(5);
  });

  it("supports IF and cell refs", async () => {
    const r = await evaluateSheet({ A1: "12", B1: '=IF(A1>10,"alto","bajo")' }, {}, "B1");
    expect(r).toBe("alto");
  });

  it("can read flow data from input", async () => {
    const r = await evaluateSheet({ A1: "=SUM(input.vals)" }, { vals: [1, 2, 3] }, "A1");
    expect(r).toBe(6);
  });

  it("detects circular references", async () => {
    await expect(evaluateSheet({ A1: "=A2", A2: "=A1" }, {}, "A1")).rejects.toThrow(/circular/i);
  });

  it("returns all filled cells when no output cell is given", async () => {
    const r = (await evaluateSheet({ A1: "5", A2: "=A1*2" }, {})) as Record<string, unknown>;
    expect(r.A1).toBe(5);
    expect(r.A2).toBe(10);
  });
});
