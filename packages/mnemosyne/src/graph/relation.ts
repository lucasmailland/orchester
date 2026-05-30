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
  /**
   * v1.1 #11 — edge provenance. NULL ⇒ LLM-derived (the default for
   * the v1.0 corpus and any new edge written by the extractor / judge).
   * 'heuristic' ⇒ synthesized programmatically by the system (alias
   * merge, coreference, deterministic dedup). Free text — see
   * migration 0043 for the rationale.
   */
  provenance: string | null;
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
  /**
   * v1.1 #11 — optional provenance tag. Omit (or pass `null`) for the
   * default LLM-derived case; pass `'heuristic'` when the edge is
   * synthesized by the system (alias merge, coreference, etc.).
   * Optional so existing callers don't need to be updated.
   */
  provenance?: string | null;
  conversationId?: string | null;
  /**
   * v1.1 #12 — bitemporal validity interval for the edge itself.
   * `validFrom` defaults to `now()` at the DB layer when omitted.
   * If both are supplied, `validTo` MUST be >= `validFrom` —
   * `createRelation` throws `Error('inverted validity interval')`
   * otherwise so an impossible interval never reaches disk.
   */
  validFrom?: Date;
  validTo?: Date | null;
  tx: Tx;
}

export async function createRelation(input: CreateRelationInput): Promise<MnemoRelation> {
  if (!isRelationVerb(input.relation)) {
    throw new Error(`invalid relation verb: ${input.relation}`);
  }
  // v1.1 #12 — reject an inverted interval before it reaches the DB.
  // `valid_to < valid_from` would produce a row that is *never* valid,
  // which is almost always a caller bug. We guard at the application
  // layer (fail-fast) rather than relying on a DB CHECK so the error
  // message is developer-friendly and the callsite is clear.
  if (input.validTo != null && input.validFrom != null && input.validTo < input.validFrom) {
    throw new Error(
      `createRelation: inverted validity interval — validTo (${input.validTo.toISOString()}) is before validFrom (${input.validFrom.toISOString()})`
    );
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
      provenance: input.provenance ?? null,
      conversationId: input.conversationId ?? null,
      // v1.1 #12 — pass caller-supplied interval; DB DEFAULT handles the
      // omitted case (validFrom → now(), validTo → NULL = "still valid").
      ...(input.validFrom != null ? { validFrom: input.validFrom } : {}),
      ...(input.validTo != null ? { validTo: input.validTo } : {}),
    })
    .returning();
  return rows[0] as unknown as MnemoRelation;
}

/**
 * @public
 * @sinceVersion 1.0 — public API surface, not yet consumed by host code as of v1.4.
 *
 * Lists pending (un-judged) relation edges for a workspace, used by the
 * judge worker / Inspector UI to surface multi-actor disagreement.
 * Tested end-to-end but no production caller invokes it yet — judgment
 * today flows through inline calls within the conflict surfacer rather
 * than through a polled queue. Inspector v1.5 will light up the polled
 * surface. Surfaced by 2026-05-25-mnemosyne-v1.4-final-audit.md §P2 —
 * intentionally retained.
 *
 * Note: the audit also flagged a `dismissRelation` orphan but no such
 * function exists in source — pending dismissal happens by re-judging
 * the row to status='dismissed' via `judgeRelation`.
 */
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
