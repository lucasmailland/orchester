// Decision BOM — Bill of Materials for a single recall decision.
// Borrowed from AGT's "Decision BOM" concept. Joins 4 sources so the
// Inspector UI can answer "why did this fact get returned" weeks after
// the deploy that produced it. PURE TYPES — no IO, no host imports.

import type { RecallMetricEvent } from "../recall/telemetry";
import type { TieredFactCountBucket } from "../recall/cap-tiers";

export interface BOMAuditSlice {
  entries: Array<{
    id: string;
    seq: string; // bigint serialized
    action: string;
    actorUserId: string | null;
    actorKind: string;
    targetType: string;
    targetId: string;
    meta: Record<string, unknown>;
    createdAt: string;
  }>;
  windowMs: number;
}

export interface BOMTraceSlice {
  events: RecallMetricEvent[];
}

export interface BOMPolicySlice {
  stageCapByTier: Readonly<
    Record<TieredFactCountBucket, { drawerGrep: number; firstStage: number }>
  >;
  flags: Record<string, string>;
}

export interface BOMTrustSlice {
  factCount: number;
  factCountTier: TieredFactCountBucket;
}

export interface BOMIdentitySlice {
  userId: string;
  agentId: string | null;
  role: string;
}

export interface BOMOutcomeSlice {
  hits: number;
  totalMs: number;
}

export interface DecisionBOM {
  traceId: string;
  workspaceId: string;
  decisionAt: string;
  agentIdentity: BOMIdentitySlice;
  trustSnapshot: BOMTrustSlice;
  policySnapshot: BOMPolicySlice;
  traceEvents: BOMTraceSlice["events"];
  auditWindow: BOMAuditSlice;
  decisionOutcome: BOMOutcomeSlice;
}

export const REQUIRED_BOM_FIELDS = [
  "agentIdentity",
  "trustSnapshot",
  "policySnapshot",
  "traceEvents",
  "auditWindow",
  "decisionOutcome",
] as const;

export function completenessScore(bom: Partial<DecisionBOM>): number {
  let present = 0;
  for (const k of REQUIRED_BOM_FIELDS) {
    const v = (bom as Record<string, unknown>)[k];
    if (v !== undefined && v !== null) present++;
  }
  return present / REQUIRED_BOM_FIELDS.length;
}
