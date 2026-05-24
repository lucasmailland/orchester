// packages/mnemosyne/src/graph/relation.ts
//
// CRUD for mnemo_relation. Multi-actor disagreement is by design: no UNIQUE
// constraint on (source, target, relation), so multiple judgments coexist
// (e.g., agent says "conflicts_with", LLM-judge says "compatible"). The
// supersede chain via `supersededByRelationId` is how reconciliation walks
// the history when callers need a single answer.
//
// §0.1: package-clean — no `server-only`, no path aliases.
import { createId } from "@paralleldrive/cuid2";
import { and, desc, eq } from "drizzle-orm";
import { schema } from "@orchester/db";
import { isRelationVerb, type RelationVerb } from "./verbs";
import type { Tx } from "../tx";

export type RelationKind = "fact" | "decision" | "entity" | "episode";
export type MarkerKind = "user" | "agent" | "system" | "llm_judge";
export type JudgmentStatus = "pending" | "judged" | "dismissed";

export interface MnemoRelation {
  id: string;
  workspaceId: string;
  sourceKind: RelationKind;
  sourceId: string;
  targetKind: RelationKind;
  targetId: string;
  relation: RelationVerb;
  judgmentStatus: JudgmentStatus;
  reason: string | null;
  evidence: Record<string, unknown> | null;
  confidence: number | null;
  markedByUserId: string | null;
  markedByKind: MarkerKind;
  markedByModel: string | null;
  markedByPromptVersion: string | null;
  conversationId: string | null;
  supersededByRelationId: string | null;
  validFrom: Date;
  validTo: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateRelationInput {
  workspaceId: string;
  sourceKind: RelationKind;
  sourceId: string;
  targetKind: RelationKind;
  targetId: string;
  relation: RelationVerb;
  judgmentStatus?: JudgmentStatus;
  reason?: string;
  evidence?: Record<string, unknown>;
  confidence?: number;
  markedByUserId?: string | null;
  markedByKind: MarkerKind;
  markedByModel?: string;
  markedByPromptVersion?: string;
  conversationId?: string | null;
  tx: Tx;
}

export async function createRelation(input: CreateRelationInput): Promise<MnemoRelation> {
  if (!isRelationVerb(input.relation)) {
    throw new Error(`invalid relation verb: ${input.relation}`);
  }
  const id = `mrel_${createId()}`;
  const rows = await input.tx
    .insert(schema.mnemoRelations)
    .values({
      id,
      workspaceId: input.workspaceId,
      sourceKind: input.sourceKind,
      sourceId: input.sourceId,
      targetKind: input.targetKind,
      targetId: input.targetId,
      relation: input.relation,
      judgmentStatus: input.judgmentStatus ?? "pending",
      reason: input.reason ?? null,
      evidence: input.evidence ?? null,
      confidence: input.confidence ?? null,
      markedByUserId: input.markedByUserId ?? null,
      markedByKind: input.markedByKind,
      markedByModel: input.markedByModel ?? null,
      markedByPromptVersion: input.markedByPromptVersion ?? null,
      conversationId: input.conversationId ?? null,
    })
    .returning();
  return rows[0] as unknown as MnemoRelation;
}

export async function listPendingRelations(
  workspaceId: string,
  limit: number,
  tx: Tx
): Promise<MnemoRelation[]> {
  const rows = await tx
    .select()
    .from(schema.mnemoRelations)
    .where(
      and(
        eq(schema.mnemoRelations.workspaceId, workspaceId),
        eq(schema.mnemoRelations.judgmentStatus, "pending")
      )
    )
    .orderBy(desc(schema.mnemoRelations.createdAt))
    .limit(limit);
  return rows as unknown as MnemoRelation[];
}

export interface JudgeInput {
  workspaceId: string;
  relationId: string;
  newRelation: RelationVerb;
  reason?: string;
  evidence?: Record<string, unknown>;
  confidence?: number;
  markedByUserId?: string | null;
  markedByKind: MarkerKind;
  markedByModel?: string;
  markedByPromptVersion?: string;
  tx: Tx;
}

/**
 * Apply a judgment to a pending relation: update the verb, flip status to
 * 'judged', and stamp the marker. Does NOT create a new row — judgment
 * replaces in place. Multi-actor disagreement is captured by creating a
 * separate `createRelation` row with the second actor's verb (no UNIQUE
 * prevents that — see migration 0020).
 */
export async function judgeRelation(input: JudgeInput): Promise<MnemoRelation | null> {
  if (!isRelationVerb(input.newRelation)) {
    throw new Error(`invalid relation verb: ${input.newRelation}`);
  }
  const rows = await input.tx
    .update(schema.mnemoRelations)
    .set({
      relation: input.newRelation,
      judgmentStatus: "judged",
      reason: input.reason ?? null,
      evidence: input.evidence ?? null,
      confidence: input.confidence ?? null,
      markedByUserId: input.markedByUserId ?? null,
      markedByKind: input.markedByKind,
      markedByModel: input.markedByModel ?? null,
      markedByPromptVersion: input.markedByPromptVersion ?? null,
    })
    .where(
      and(
        eq(schema.mnemoRelations.id, input.relationId),
        eq(schema.mnemoRelations.workspaceId, input.workspaceId)
      )
    )
    .returning();
  return (rows[0] as MnemoRelation | undefined) ?? null;
}
