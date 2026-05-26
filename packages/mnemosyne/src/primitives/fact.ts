// packages/mnemosyne/src/primitives/fact.ts
//
// CRUD for mnemo_fact. All helpers require an active transaction
// (withMnemoTx wrapper) so RLS FORCE is satisfied — every operation
// accepts `tx: Tx` explicitly; we never open our own connection here.
//
// Mode A note: embedding columns are nullable. Callers in Mode A
// (no embedding provider configured) simply omit `embedding*` fields
// and the row is inserted without a vector.
//
// §0.1: this file is package-clean — no `server-only`, no path aliases
// to the host app. Embedding is dependency-injected via `embedFn`.
import { createId } from "@paralleldrive/cuid2";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { schema } from "@orchester/db";
import { redactPIIWithCategories } from "../pii/redact";
import { embedMnemo, type EmbedFn, type EmbeddingProvider } from "../recall/embed";
import type { Tx } from "../tx";
import type { Attribution } from "../types";

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
/**
 * Mnemosyne v1.4 — "The Cognitive Leap". Separates facts by the way
 * human cognition does. Default 'semantic' matches the SQL DEFAULT so
 * legacy callers (and every pre-v1.4 row) keep their current behaviour.
 * Re-exported from `./episode` so consumers can grab the type from
 * either entry point.
 */
export type MemoryType = "semantic" | "episodic" | "procedural" | "working";

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
  /**
   * v1.4 — cognitive classification (default 'semantic'). See MemoryType.
   *
   * Marked optional on the public type so legacy row-mappers (janitor
   * dedup / prune helpers, hand-rolled test fixtures) keep compiling
   * without a forced update. Every row produced by `createFact` after
   * v1.4 carries this field; mappers that omit it leave it undefined
   * and downstream consumers treat the absence as 'semantic'.
   */
  memoryType?: MemoryType;
  /**
   * v1.4 — per-conversation actor isolation (migration 0037). When set,
   * tracks the User.id this fact was learned from. NULL = workspace-
   * shared (current behaviour). Semantic reference, no FK.
   *
   * Marked optional (rather than `string | null`) so legacy row-
   * mappers (janitor dedup/prune helpers, hand-rolled test fixtures)
   * keep compiling without a forced update. Every row produced by
   * `createFact` after v1.4 carries this field explicitly; mappers
   * that omit it leave it undefined and downstream consumers treat
   * the absence as workspace-shared (same semantics as NULL).
   */
  actorId?: string | null;
  /**
   * v1.4 — theory-of-mind attribution (migration 0035). Tracks the
   * cognitive provenance of the fact:
   *   `user_stated` (the user said it) /
   *   `user_belief` (the user thinks it; may not be true) /
   *   `objective_fact` (canonical/verifiable) /
   *   `inferred` (extractor-derived, default).
   *
   * Marked optional on the public type so legacy row-mappers (janitor
   * dedup / prune helpers, hand-rolled test fixtures) keep compiling
   * without a forced update. Every row produced by `createFact` after
   * v1.4 carries this field; mappers that omit it leave it undefined
   * and downstream consumers treat the absence as 'inferred'.
   */
  attribution?: Attribution;
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
  /**
   * v1.4 — cognitive classification. Defaults to 'semantic' so every
   * existing caller keeps producing the same row shape as v1.3. The
   * extraction pipeline overrides this when it detects an event tied
   * to a specific moment ('episodic'), a how-to ('procedural'), or
   * the current conversation only ('working').
   */
  memoryType?: MemoryType;
  /**
   * v1.4 — per-conversation actor isolation (migration 0037). When
   * set, attributes the fact to a specific end-user (User.id). NULL =
   * workspace-shared (current behaviour). The extraction pipeline
   * populates this from the conversation's user when known; legacy
   * callers omit it and the row defaults to NULL.
   */
  actorId?: string | null;
  /**
   * v1.4 — theory-of-mind attribution (migration 0035). When omitted,
   * defaults to `'inferred'` so every legacy caller (and every v1.4
   * caller that hasn't been updated yet) keeps producing the same row
   * shape. Extraction-pipeline upgrades classify each emitted fact
   * explicitly; manual save endpoints pass through whatever the user
   * specified (user-edited facts typically become `'user_stated'`).
   */
  attribution?: Attribution;
  /** Pre-computed embedding. If omitted and no embeddingProvider+Model,
   * the row is inserted without an embedding (Mode A). */
  embedding?: number[] | null;
  /**
   * Optional provider + model. If BOTH are provided AND `embedFn` is
   * supplied AND `embedding` is omitted AND `skipEmbed` is not set,
   * the statement is embedded via the host-provided `embedFn`
   * (wrapped by `embedMnemo`'s LRU cache). Charter §25: we never fall
   * back to a hardcoded default — caller resolves these from workspace
   * settings and passes the embed impl.
   */
  embeddingProvider?: EmbeddingProvider;
  embeddingModel?: string;
  /** Host-provided embedding function. Required only if provider+model
   *  are set and `embedding` is omitted. */
  embedFn?: EmbedFn;
  /**
   * v1.1 cost optimization (async batch embedding): when `true`, the
   * fact is inserted with `embedding = NULL` regardless of any
   * provider/model/embedFn supplied — the caller is responsible for
   * enqueuing a background job that fills in the embedding later
   * (see `createFactAsync` in `primitives/fact-async.ts`). FTS recall
   * already handles NULL embeddings, so the fact is searchable
   * immediately; vector search picks it up once the batch worker
   * runs. Additive flag — defaults to false, leaving the synchronous
   * embedding path unchanged for legacy callers and the PII pipeline.
   */
  skipEmbed?: boolean;
  tx: Tx;
}

export async function createFact(input: CreateFactInput): Promise<MnemoFact> {
  const id = `mfact_${createId()}`;

  // ── PII redaction (Phase 5.1) ─────────────────────────────────────────
  // Facts often contain legitimate identifiers (emails, URLs, phone
  // numbers). We do NOT block on detection — we redact and store, then
  // stash the matched categories in metadata.pii for audit. Embedding
  // happens on the redacted statement so PII never crosses the embedding
  // provider boundary.
  let statement = input.statement;
  let metadata: Record<string, unknown> = input.metadata ?? {};
  const pii = redactPIIWithCategories(statement);
  if (pii.categories.length > 0) {
    statement = pii.redacted;
    metadata = {
      ...metadata,
      pii: {
        categories: pii.categories,
        detected_at: new Date().toISOString(),
      },
    };
  }

  let embedding: number[] | null = input.embedding ?? null;
  if (
    !embedding &&
    !input.skipEmbed &&
    input.embeddingProvider &&
    input.embeddingModel &&
    input.embedFn
  ) {
    const [vec] = await embedMnemo({
      workspaceId: input.workspaceId,
      texts: [statement],
      provider: input.embeddingProvider,
      model: input.embeddingModel,
      embedFn: input.embedFn,
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
      statement,
      confidence: input.confidence ?? 0.7,
      pinned: input.pinned ?? false,
      relevance: 1.0,
      hitCount: 0,
      sourceMessageIds: input.sourceMessageIds ?? [],
      attributedTo: input.attributedTo ?? null,
      embedding,
      embeddingModel: input.embeddingModel ?? null,
      metadata,
      status: "active",
      // v1.4 — explicit default keeps the row shape stable when callers
      // omit `memoryType`. Without this the drizzle layer would emit
      // INSERT … DEFAULT VALUES for the column and rely on the SQL
      // DEFAULT, which works but obscures intent at this call site.
      memoryType: input.memoryType ?? "semantic",
      // v1.4 — per-conversation actor isolation (migration 0037).
      // NULL = workspace-shared (default); the extraction pipeline
      // populates this from the conversation's user when known.
      actorId: input.actorId ?? null,
      // v1.4 — theory-of-mind attribution (migration 0035). The
      // explicit default keeps the application code honest about the
      // cognitive provenance — callers that don't know default to
      // 'inferred' (matches the SQL DEFAULT) rather than letting the
      // column silently fall back at the DB layer.
      attribution: input.attribution ?? "inferred",
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
