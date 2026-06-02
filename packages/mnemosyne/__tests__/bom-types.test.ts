import { describe, it, expect } from "vitest";
import type { DecisionBOM } from "../src/bom/types";
import { REQUIRED_BOM_FIELDS, completenessScore } from "../src/bom/types";

describe("Decision BOM types", () => {
  it("declares the 6 required slices", () => {
    expect(REQUIRED_BOM_FIELDS).toEqual([
      "agentIdentity",
      "trustSnapshot",
      "policySnapshot",
      "traceEvents",
      "auditWindow",
      "decisionOutcome",
    ]);
  });

  it("completenessScore returns 1.0 when every required field present", () => {
    const bom: DecisionBOM = {
      traceId: "trace_x",
      workspaceId: "ws_x",
      decisionAt: new Date(0).toISOString(),
      agentIdentity: { userId: "u_x", agentId: null, role: "owner" },
      trustSnapshot: { factCount: 0, factCountTier: "<1k" },
      policySnapshot: {
        stageCapByTier: {
          "<1k": { drawerGrep: 6, firstStage: 10 },
          "<10k": { drawerGrep: 8, firstStage: 16 },
          "<100k": { drawerGrep: 10, firstStage: 24 },
          ">=100k": { drawerGrep: 12, firstStage: 32 },
        },
        flags: {},
      },
      traceEvents: [],
      auditWindow: { entries: [], windowMs: 5_000 },
      decisionOutcome: { hits: 0, totalMs: 0 },
    };
    expect(completenessScore(bom)).toBe(1);
  });

  it("completenessScore drops proportionally when slices missing", () => {
    const bom = {
      traceId: "trace_x",
      workspaceId: "ws_x",
      decisionAt: new Date(0).toISOString(),
      agentIdentity: { userId: "u_x", agentId: null, role: "owner" },
      traceEvents: [],
      decisionOutcome: { hits: 0, totalMs: 0 },
    } as unknown as DecisionBOM;
    expect(completenessScore(bom)).toBeCloseTo(3 / 6, 5);
  });
});
