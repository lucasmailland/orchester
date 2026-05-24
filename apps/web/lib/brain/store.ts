// apps/web/lib/brain/store.ts
//
// CRUD for Brain Core facts. All helpers accept optional `tx?: Db`
// and use it when present (v1.2 pattern). Without tx, opens its own
// workspace-scoped transaction so RLS FORCE is satisfied.
import "server-only";
import { createId } from "@paralleldrive/cuid2";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb, schema, type DbClient } from "@orchester/db";
import { embedBrain } from "./embed";
import type { EmbeddingProvider } from "@/lib/embeddings";
import type { BrainFact, FactKind, FactScope } from "./types";

type Tx = DbClient | Parameters<Parameters<DbClient["transaction"]>[0]>[0];

/**
 * Run `fn` inside a transaction with `app.workspace_id` SET LOCAL.
 * Use this for callers that don't have a `tx` in scope — every
 * mutating method below will set the GUC for you.
 */
export async function withBrainTx<T>(workspaceId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const db = getDb();
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.workspace_id', ${workspaceId}, true)`);
    return fn(tx);
  });
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
  metadata?: Record<string, unknown>;
  /** Pre-computed embedding. If omitted and (embeddingProvider,
   * embeddingModel) are both unset, the row is inserted with
   * `embedding = NULL` (Mode A). */
  embedding?: number[];
  /**
   * Optional embedding provider + model. FIX-007 (audit): if both are
   * provided, the statement is embedded; if either is missing, no
   * embedding call is made (Mode A) and the row is persisted with
   * `embedding = NULL`. Charter §25: this function never picks a
   * provider default — the caller resolves these from workspace
   * settings.
   */
  embeddingProvider?: EmbeddingProvider;
  embeddingModel?: string;
  /** Required: must be inside withBrainTx OR be passed an existing tx. */
  tx: Tx;
}

/**
 * Insert a new fact. Auto-embeds the statement if (embeddingProvider,
 * embeddingModel) are both supplied. In Mode A (no embedding config)
 * the row is inserted with `embedding = NULL` (FIX-007, M-A-003).
 *
 * Dedup: the unique partial index on (workspace, scope, scope_ref,
 * subject, md5(statement)) WHERE status='active' will throw on
 * duplicate. Callers that want upsert semantics should catch the
 * unique-violation error and call `updateFact` instead.
 */
export async function createFact(input: CreateFactInput): Promise<BrainFact> {
  const id = `bfact_${createId()}`;
  let embedding: number[] | null = input.embedding ?? null;
  if (!embedding) {
    // FIX-007 (audit, M-A-003): embedBrain returns [] in Mode A (no
    // embedding provider/model resolved). `vec` will then be undefined
    // and `embedding` falls through to NULL — the row is persisted as
    // a Mode A fact (no vector, but `text_lemmatized` GIN index still
    // covers it for FTS recall via FIX-006).
    const [vec] = await embedBrain({
      workspaceId: input.workspaceId,
      texts: [input.statement],
      ...(input.embeddingProvider ? { provider: input.embeddingProvider } : {}),
      ...(input.embeddingModel ? { model: input.embeddingModel } : {}),
      tx: input.tx as DbClient,
    });
    embedding = vec ?? null;
  }

  const rows = await input.tx
    .insert(schema.brainFacts)
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
      embedding: embedding as number[] | null,
      metadata: input.metadata ?? {},
      status: "active",
    })
    .returning();

  return rows[0] as BrainFact;
}

/** Soft-delete (status='forgotten'). Use `hardDelete` only from compaction. */
export async function forgetFact(workspaceId: string, factId: string, tx: Tx): Promise<void> {
  await tx
    .update(schema.brainFacts)
    .set({ status: "forgotten" })
    .where(and(eq(schema.brainFacts.id, factId), eq(schema.brainFacts.workspaceId, workspaceId)));
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

/** Paginated list. Default status='active'. */
export async function listFacts(input: ListFactsInput): Promise<BrainFact[]> {
  const filters = [eq(schema.brainFacts.workspaceId, input.workspaceId)];
  if (input.status !== "all") {
    filters.push(eq(schema.brainFacts.status, input.status ?? "active"));
  }
  if (input.agentId) filters.push(eq(schema.brainFacts.agentId, input.agentId));
  if (input.scope) filters.push(eq(schema.brainFacts.scope, input.scope));
  if (input.scopeRef) filters.push(eq(schema.brainFacts.scopeRef, input.scopeRef));

  const rows = await input.tx
    .select()
    .from(schema.brainFacts)
    .where(and(...filters))
    .orderBy(desc(schema.brainFacts.updatedAt))
    .limit(input.limit ?? 100)
    .offset(input.offset ?? 0);

  return rows as BrainFact[];
}

/** Get a single fact by id. Returns null if not found / not in workspace. */
export async function getFact(
  workspaceId: string,
  factId: string,
  tx: Tx
): Promise<BrainFact | null> {
  const rows = await tx
    .select()
    .from(schema.brainFacts)
    .where(and(eq(schema.brainFacts.id, factId), eq(schema.brainFacts.workspaceId, workspaceId)))
    .limit(1);
  return (rows[0] as BrainFact | undefined) ?? null;
}

export interface UpdateFactInput {
  workspaceId: string;
  factId: string;
  patch: {
    statement?: BrainFact["statement"];
    confidence?: BrainFact["confidence"];
    pinned?: BrainFact["pinned"];
    kind?: BrainFact["kind"];
    subject?: BrainFact["subject"];
    metadata?: BrainFact["metadata"];
  };
  tx: Tx;
}

/** Update mutable fields. If `statement` is changed, re-embeds. */
export async function updateFact(input: UpdateFactInput): Promise<BrainFact | null> {
  const update: Record<string, unknown> = { ...input.patch };
  if (input.patch.statement) {
    const [vec] = await embedBrain({
      workspaceId: input.workspaceId,
      texts: [input.patch.statement],
      tx: input.tx as DbClient,
    });
    update["embedding"] = vec;
  }

  const rows = await input.tx
    .update(schema.brainFacts)
    .set(update)
    .where(
      and(
        eq(schema.brainFacts.id, input.factId),
        eq(schema.brainFacts.workspaceId, input.workspaceId)
      )
    )
    .returning();

  return (rows[0] as BrainFact | undefined) ?? null;
}

/** Bump hitCount + lastRecalledAt for a set of facts. Used by recall. */
export async function markRecalled(workspaceId: string, factIds: string[], tx: Tx): Promise<void> {
  if (factIds.length === 0) return;
  await tx
    .update(schema.brainFacts)
    .set({
      hitCount: sql`hit_count + 1`,
      lastRecalledAt: new Date(),
    })
    .where(
      and(eq(schema.brainFacts.workspaceId, workspaceId), inArray(schema.brainFacts.id, factIds))
    );
}
