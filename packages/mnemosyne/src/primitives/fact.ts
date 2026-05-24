// packages/mnemosyne/src/primitives/fact.ts
//
// CRUD for mnemo_fact. All helpers require an active transaction
// (withMnemoTx wrapper) so RLS FORCE is satisfied — every operation
// accepts `tx: Tx` explicitly; we never open our own connection here.
//
// Mode A note: embedding columns are nullable. Callers in Mode A
// (no embedding provider configured) simply omit `embedding*` fields
// and the row is inserted without a vector.
import "server-only";
import { createId } from "@paralleldrive/cuid2";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { schema } from "@orchester/db";
import type { EmbeddingProvider } from "@/lib/embeddings";
import { embedMnemo } from "../recall/embed";
import type { Tx } from "../tx";

export type FactKind =
  | "preference"
  | "trait"
  | "event"
  | "relationship"
  | "skill"
  | "concern"
  | "other";
export type FactScope = "global" | "conversation" | "employee" | "team";
export type FactStatus = "active" | "merged" | "forgotten";

export interface MnemoFact {
  id: string;
  workspaceId: string;
  agentId: string | null;
  scope: FactScope;
  scopeRef: string | null;
  kind: FactKind;
  subject: string;
  statement: string;
  confidence: number;
  pinned: boolean;
  relevance: number;
  hitCount: number;
  lastRecalledAt: Date | null;
  sourceMessageIds: string[];
  attributedTo: "user" | "assistant" | "system" | null;
  linkedMemoryIds: string[];
  embedding: number[] | null;
  metadata: Record<string, unknown>;
  status: FactStatus;
  mergedIntoId: string | null;
  validFrom: Date;
  validTo: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateFactInput {
  workspaceId: string;
  agentId?: string | null;
  scope: FactScope;
  scopeRef?: string | null;
  kind: FactKind;
  subject: string;
  statement: string;
  confidence?: number;
  pinned?: boolean;
  sourceMessageIds?: string[];
  attributedTo?: "user" | "assistant" | "system" | null;
  metadata?: Record<string, unknown>;
  /** Pre-computed embedding. If omitted and no embeddingProvider+Model,
   * the row is inserted without an embedding (Mode A). */
  embedding?: number[] | null;
  /**
   * Optional provider + model. If BOTH are provided and `embedding` is
   * omitted, the statement is embedded via `embedMnemo`. Charter §25:
   * we never fall back to a hardcoded default — caller must resolve
   * these from workspace settings.
   */
  embeddingProvider?: EmbeddingProvider;
  embeddingModel?: string;
  tx: Tx;
}

export async function createFact(input: CreateFactInput): Promise<MnemoFact> {
  const id = `mfact_${createId()}`;
  let embedding: number[] | null = input.embedding ?? null;
  if (!embedding && input.embeddingProvider && input.embeddingModel) {
    const [vec] = await embedMnemo({
      workspaceId: input.workspaceId,
      texts: [input.statement],
      provider: input.embeddingProvider,
      model: input.embeddingModel,
      tx: input.tx as never,
    });
    embedding = vec ?? null;
  }

  const rows = await input.tx
    .insert(schema.mnemoFacts)
    .values({
      id,
      workspaceId: input.workspaceId,
      agentId: input.agentId ?? null,
      scope: input.scope,
      scopeRef: input.scopeRef ?? null,
      kind: input.kind,
      subject: input.subject,
      statement: input.statement,
      confidence: input.confidence ?? 0.7,
      pinned: input.pinned ?? false,
      relevance: 1.0,
      hitCount: 0,
      sourceMessageIds: input.sourceMessageIds ?? [],
      attributedTo: input.attributedTo ?? null,
      embedding,
      embeddingModel: input.embeddingModel ?? null,
      metadata: input.metadata ?? {},
      status: "active",
    })
    .returning();
  return rows[0] as unknown as MnemoFact;
}

export async function getFact(
  workspaceId: string,
  factId: string,
  tx: Tx
): Promise<MnemoFact | null> {
  const rows = await tx
    .select()
    .from(schema.mnemoFacts)
    .where(and(eq(schema.mnemoFacts.id, factId), eq(schema.mnemoFacts.workspaceId, workspaceId)))
    .limit(1);
  return (rows[0] as MnemoFact | undefined) ?? null;
}

export async function forgetFact(workspaceId: string, factId: string, tx: Tx): Promise<void> {
  await tx
    .update(schema.mnemoFacts)
    .set({ status: "forgotten" })
    .where(and(eq(schema.mnemoFacts.id, factId), eq(schema.mnemoFacts.workspaceId, workspaceId)));
}

export interface ListFactsInput {
  workspaceId: string;
  agentId?: string;
  scope?: FactScope;
  scopeRef?: string;
  status?: "active" | "forgotten" | "all";
  limit?: number;
  offset?: number;
  tx: Tx;
}

export async function listFacts(input: ListFactsInput): Promise<MnemoFact[]> {
  const filters = [eq(schema.mnemoFacts.workspaceId, input.workspaceId)];
  if (input.status !== "all") filters.push(eq(schema.mnemoFacts.status, input.status ?? "active"));
  if (input.agentId) filters.push(eq(schema.mnemoFacts.agentId, input.agentId));
  if (input.scope) filters.push(eq(schema.mnemoFacts.scope, input.scope));
  if (input.scopeRef) filters.push(eq(schema.mnemoFacts.scopeRef, input.scopeRef));
  const rows = await input.tx
    .select()
    .from(schema.mnemoFacts)
    .where(and(...filters))
    .orderBy(desc(schema.mnemoFacts.updatedAt))
    .limit(input.limit ?? 100)
    .offset(input.offset ?? 0);
  return rows as unknown as MnemoFact[];
}

export async function markRecalled(workspaceId: string, factIds: string[], tx: Tx): Promise<void> {
  if (factIds.length === 0) return;
  await tx
    .update(schema.mnemoFacts)
    .set({ hitCount: sql`hit_count + 1`, lastRecalledAt: new Date() })
    .where(
      and(eq(schema.mnemoFacts.workspaceId, workspaceId), inArray(schema.mnemoFacts.id, factIds))
    );
}
