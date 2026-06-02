// Pure builder for a DecisionBOM. Host endpoint
// (apps/web/app/api/mnemo/decisions/[traceId]/route.ts) fetches each
// raw input and hands them here — the composer is the single place
// that knows the BOM shape. PURE — no host imports, no IO.

import { factCountTier, STAGE_CAP_BY_TIER } from "../recall/stage-caps";
import type { RecallMetricEvent } from "../recall/telemetry";
import type { BOMIdentitySlice, BOMOutcomeSlice, DecisionBOM } from "./types";

export interface ComposeBOMInput {
  traceId: string;
  workspaceId: string;
  decisionAt: Date;
  identity: BOMIdentitySlice;
  factCount: number;
  flags: Record<string, string>;
  traceEvents: RecallMetricEvent[];
  auditEntries: Array<{
    id: string;
    seq: bigint;
    action: string;
    actorUserId: string | null;
    actorKind: string;
    targetType: string;
    targetId: string;
    meta: Record<string, unknown>;
    createdAt: Date;
  }>;
  windowMs: number;
  outcome: BOMOutcomeSlice;
}

export function composeBOM(input: ComposeBOMInput): DecisionBOM {
  return {
    traceId: input.traceId,
    workspaceId: input.workspaceId,
    decisionAt: input.decisionAt.toISOString(),
    agentIdentity: input.identity,
    trustSnapshot: {
      factCount: input.factCount,
      factCountTier: factCountTier(input.factCount),
    },
    policySnapshot: {
      stageCapByTier: STAGE_CAP_BY_TIER,
      flags: input.flags,
    },
    traceEvents: input.traceEvents,
    auditWindow: {
      windowMs: input.windowMs,
      entries: input.auditEntries.map((e) => ({
        id: e.id,
        seq: e.seq.toString(),
        action: e.action,
        actorUserId: e.actorUserId,
        actorKind: e.actorKind,
        targetType: e.targetType,
        targetId: e.targetId,
        meta: e.meta,
        createdAt: e.createdAt.toISOString(),
      })),
    },
    decisionOutcome: input.outcome,
  };
}
