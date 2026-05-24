// packages/mnemosyne/src/primitives/decision.ts
//
// CRUD for mnemo_decision. Supports topic_key upsert: when a decision is saved
// with a topic_key that already exists for the workspace (status='active'),
// the existing row is updated and revision_count incremented (instead of
// creating a new row). This honors the partial UNIQUE INDEX
// `uniq_mnemo_decision_topic` defined in migration 0018.
//
// §0.1: package-clean — no `server-only`, no path aliases to the host app.
// Embeddings are caller-injected (pre-computed); Mode A leaves embedding null.
import { createHash } from "crypto";
import { createId } from "@paralleldrive/cuid2";
import { and, eq, sql } from "drizzle-orm";
import { schema } from "@orchester/db";
import type { Tx } from "../tx";

export type DecisionKind =
  | "decision"
  | "architecture"
  | "policy"
  | "process"
  | "bugfix"
  | "learning"
  | "discovery"
  | "config";
export type DecisionStatus = "active" | "superseded" | "withdrawn";

export interface MnemoDecision {
  id: string;
  workspaceId: string;
  agentId: string | null;
  conversationId: string | null;
  kind: DecisionKind;
  title: string;
  body: string;
  topicKey: string | null;
  revisionCount: number;
  normalizedHash: string;
  decidedByUserId: string | null;
  embedding: number[] | null;
  status: DecisionStatus;
  supersededById: string | null;
  metadata: Record<string, unknown>;
  validFrom: Date;
  validTo: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateDecisionInput {
  workspaceId: string;
  agentId?: string | null;
  conversationId?: string | null;
  kind: DecisionKind;
  title: string;
  body: string;
  topicKey?: string | null;
  decidedByUserId?: string | null;
  metadata?: Record<string, unknown>;
  /** Pre-computed embedding. If omitted, row is inserted without embedding (Mode A). */
  embedding?: number[] | null;
  embeddingModel?: string | null;
  tx: Tx;
}

/**
 * Stable hash of the decision's normalized form. Used as a fingerprint for
 * deduplication / change detection. Case-insensitive, kind+topic+title+body.
 */
function computeNormalizedHash(input: {
  title: string;
  body: string;
  kind: DecisionKind;
  topicKey?: string | null;
}): string {
  return createHash("md5")
    .update(
      `${input.kind}|${input.topicKey ?? ""}|${input.title.toLowerCase().trim()}|${input.body.toLowerCase().trim()}`
    )
    .digest("hex");
}

export async function createDecision(input: CreateDecisionInput): Promise<MnemoDecision> {
  const normalizedHash = computeNormalizedHash(input);

  if (input.topicKey) {
    // Upsert path: look up existing active row with the same topic_key
    const existing = await input.tx
      .select()
      .from(schema.mnemoDecisions)
      .where(
        and(
          eq(schema.mnemoDecisions.workspaceId, input.workspaceId),
          eq(schema.mnemoDecisions.topicKey, input.topicKey),
          eq(schema.mnemoDecisions.status, "active")
        )
      )
      .limit(1);
    if (existing[0]) {
      const updated = await input.tx
        .update(schema.mnemoDecisions)
        .set({
          title: input.title,
          body: input.body,
          kind: input.kind,
          revisionCount: sql`revision_count + 1`,
          normalizedHash,
          ...(input.metadata ? { metadata: input.metadata } : {}),
        })
        .where(eq(schema.mnemoDecisions.id, existing[0].id))
        .returning();
      return updated[0] as unknown as MnemoDecision;
    }
  }

  const id = `mdec_${createId()}`;
  const rows = await input.tx
    .insert(schema.mnemoDecisions)
    .values({
      id,
      workspaceId: input.workspaceId,
      agentId: input.agentId ?? null,
      conversationId: input.conversationId ?? null,
      kind: input.kind,
      title: input.title,
      body: input.body,
      topicKey: input.topicKey ?? null,
      revisionCount: 1,
      normalizedHash,
      decidedByUserId: input.decidedByUserId ?? null,
      embedding: input.embedding ?? null,
      embeddingModel: input.embeddingModel ?? null,
      metadata: input.metadata ?? {},
      status: "active",
    })
    .returning();
  return rows[0] as unknown as MnemoDecision;
}

export async function getDecision(
  workspaceId: string,
  id: string,
  tx: Tx
): Promise<MnemoDecision | null> {
  const rows = await tx
    .select()
    .from(schema.mnemoDecisions)
    .where(
      and(eq(schema.mnemoDecisions.id, id), eq(schema.mnemoDecisions.workspaceId, workspaceId))
    )
    .limit(1);
  return (rows[0] as MnemoDecision | undefined) ?? null;
}

/**
 * Mark `oldId` as superseded by `newId`. Sets status='superseded' and
 * supersededById on the old row. Caller is responsible for creating
 * the corresponding `supersedes` relation in `mnemo_relation` (Phase 2.6).
 */
export async function supersedeDecision(
  workspaceId: string,
  oldId: string,
  newId: string,
  tx: Tx
): Promise<void> {
  await tx
    .update(schema.mnemoDecisions)
    .set({ status: "superseded", supersededById: newId })
    .where(
      and(eq(schema.mnemoDecisions.id, oldId), eq(schema.mnemoDecisions.workspaceId, workspaceId))
    );
}
