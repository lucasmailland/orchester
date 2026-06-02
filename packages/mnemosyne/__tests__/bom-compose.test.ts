import { describe, it, expect } from "vitest";
import { composeBOM } from "../src/bom/compose";

describe("composeBOM", () => {
  it("assembles all 6 slices from raw inputs", () => {
    const decisionAt = new Date("2026-06-01T12:00:00Z");
    const bom = composeBOM({
      traceId: "trace_abc",
      workspaceId: "ws_x",
      decisionAt,
      identity: { userId: "u_1", agentId: null, role: "owner" },
      factCount: 42,
      flags: { MNEMO_TRUST_DECAY: "true" },
      traceEvents: [{ stage: "total", workspaceId: "ws_x", durationMs: 11.6, count: 3 }],
      auditEntries: [
        {
          id: "audit_1",
          seq: BigInt(7),
          action: "inspector.recall_debug",
          actorUserId: "u_1",
          actorKind: "user",
          targetType: "recall",
          targetId: "trace_abc",
          meta: { traceId: "trace_abc" },
          createdAt: decisionAt,
        },
      ],
      windowMs: 5_000,
      outcome: { hits: 3, totalMs: 11.6 },
    });
    expect(bom.traceId).toBe("trace_abc");
    expect(bom.decisionAt).toBe(decisionAt.toISOString());
    expect(bom.trustSnapshot.factCount).toBe(42);
    expect(bom.trustSnapshot.factCountTier).toBe("<1k");
    expect(bom.policySnapshot.flags.MNEMO_TRUST_DECAY).toBe("true");
    expect(bom.auditWindow.entries[0]?.seq).toBe("7"); // bigint → string
    expect(bom.decisionOutcome.hits).toBe(3);
  });

  it("uses the correct tier bucket for big workspaces", () => {
    const bom = composeBOM({
      traceId: "t",
      workspaceId: "w",
      decisionAt: new Date(),
      identity: { userId: "u", agentId: null, role: "owner" },
      factCount: 250_000,
      flags: {},
      traceEvents: [],
      auditEntries: [],
      windowMs: 5_000,
      outcome: { hits: 0, totalMs: 0 },
    });
    expect(bom.trustSnapshot.factCountTier).toBe(">=100k");
  });
});
