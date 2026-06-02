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
import { and, desc, eq, sql } from "drizzle-orm";
import { schema } from "@orchester/db";
import { redactPIIWithCategories } from "../pii/redact";
import { scanForPoisoning } from "../poisoning/detect";
import { PoisoningRejectedError } from "../poisoning/error";
import { deriveSyntheticEpisodeId } from "../episode/synthetic";
import { embedMnemo, type EmbedFn, type EmbeddingProvider } from "../recall/embed";
import { upsertPointerTerms } from "../index/pointer";
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
  /**
   * v1.6 (G2) — link to `mnemo_entity` row (migration 0039). NULL =
   * workspace-shared / no resolved entity. Optional on the type so
   * legacy row mappers keep compiling without a forced update.
   */
  entityId?: string | null;
  /**
   * v1.6 (G2) — Memory Protocol version under which this fact was
   * extracted (migration 0041). Defaults to 'v1.1' at the SQL layer.
   * Optional on the type so legacy row mappers keep compiling.
   */
  protocolVersion?: string;
  /**
   * v1.1 #10 — Hebbian trace strength in [0.05, 5.0]. Default 1.0.
   * Potentiated by +0.05 on each qualifying recall (Cepeda ≥ 1 h
   * spacing); decays exponentially between recalls (Ebbinghaus curve).
   * Optional on the type so legacy row-mappers keep compiling.
   */
  memoryStrength?: number;
  /**
   * v1.1 #10 — forgetting-curve time constant in days. Higher = slower
   * decay. Default 1.0. Incremented on each potentiating recall so
   * frequently-recalled facts become progressively harder to forget.
   * Optional on the type so legacy row-mappers keep compiling.
   */
  memoryStability?: number;
  /**
   * v1.1 #10 — timestamp of the last decay + potentiation pass.
   * NULL = fact was never recalled via markRecalled (strength is at the
   * DB default of 1.0). Optional on the type so legacy row-mappers
   * keep compiling.
   */
  lastStrengthUpdate?: Date | null;
  /**
   * v1.1 #13 — virtual line number within the entity's active-fact drawer.
   * Computed as `ROW_NUMBER() OVER (PARTITION BY entity_id ORDER BY
   * created_at)` over the facts that matched the recall query. Null when:
   *   (a) the fact has no entity_id (unaffiliated), or
   *   (b) the retrieve path doesn't project it (legacy callers).
   *
   * Stable within a single recall response; may differ across calls if
   * the query filter includes a different subset of the entity's facts
   * (e.g. different `asOf` / `memoryTypes` / FTS match). Use for
   * prompt-time citation ("as stated in fact #3 about Alice") rather
   * than cross-session persistent bookmarks.
   *
   * Optional on the type so legacy row-mappers keep compiling without
   * a forced update.
   */
  drawerLine?: number | null;
}

// ─── v1.1 #10 — Hebbian / Ebbinghaus constants ───────────────────────────────
//
// Exported so callers can display the ceiling in UI ("strength 4.2 / 5.0")
// and unit tests can assert exact math without hardcoding magic numbers.

/** Increment added to `memory_strength` on each qualifying recall. */
export const POTENTIATION_INCREMENT = 0.05;
/** Increment added to `memory_stability` on each potentiating recall. */
export const STABILITY_INCREMENT = 0.1;
/** Upper bound of the `memory_strength` range. */
export const MAX_MEMORY_STRENGTH = 5.0;
/** Lower bound — a fact can never decay to zero (minimum trace). */
export const MIN_MEMORY_STRENGTH = 0.05;
/** Cepeda spacing threshold: recalls closer than this are not potentiated. */
export const CEPEDA_SPACING_SECONDS = 3600; // 1 hour

/**
 * v1.1 #10 — Pure Ebbinghaus decay formula. Exported for unit-testing.
 *
 * Computes how much `memory_strength` decays over `secondsSince` seconds
 * given the current `stability` (time constant in days). The floor of
 * `MIN_MEMORY_STRENGTH` prevents complete forgetting — a fact always
 * retains a minimal trace.
 *
 * Formula: strength × exp(-days_elapsed / stability)
 *
 * @param strength       Current memory_strength (should be in [MIN, MAX]).
 * @param stability      Current memory_stability (time constant, days ≥ 1.0).
 * @param secondsSince   Seconds elapsed since the last markRecalled call.
 * @returns              Decayed strength, floored at MIN_MEMORY_STRENGTH.
 */
export function computeHebbianDecay(
  strength: number,
  stability: number,
  secondsSince: number
): number {
  if (secondsSince <= 0) return strength;
  const daysSince = secondsSince / 86400;
  return Math.max(MIN_MEMORY_STRENGTH, strength * Math.exp(-daysSince / stability));
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * v1.6 — embedding tier. Set by the resolver to mark a fact as
 * "premium" (uses the workspace's premium embedding model) or
 * "default" (cheap-tier). The value is opaque to the primitive — we
 * just stash it in `metadata.embedding_tier` so the batch worker
 * (`embed-batch-job.ts`) can group pending facts by tier and issue
 * one batched API call per (workspace, tier).
 */
export type EmbeddingTier = "default" | "premium";

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
   * v1.6 — embedding tier hint. When set, the fact is stored with
   * `metadata.embedding_tier = <tier>` so the batch worker can group
   * pending facts and issue one API call per (workspace, tier).
   * Defaults to 'default' (omit to opt out of tiering — back-compat
   * with v1.5 callers).
   */
  embeddingTier?: EmbeddingTier;
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
  /**
   * v1.6 (G2) — link to a `mnemo_entity` row (migration 0039). NULL
   * when the extraction pipeline could not resolve a canonical entity
   * (legacy behaviour preserved). Populated when the fact is
   * primarily about a known entity ("Lucas prefers TS" → entity for
   * user "Lucas"). The reverse direction (mention_count on the
   * entity row) is bumped by `findOrCreate`.
   */
  entityId?: string | null;
  /**
   * v1.6 (G2) — Memory Protocol version under which this fact was
   * extracted (migration 0041). Defaults to 'v1.1' at the SQL layer
   * so legacy callers keep producing v1.1-tagged rows. Extraction-
   * pipeline upgrades set 'v1.2' explicitly. Free-form text (not an
   * enum) so future protocol bumps don't require a fact.ts change.
   */
  protocolVersion?: string;
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
  /**
   * v2 — explicit episode_id. When omitted, the caller's
   * `sourceMessageIds[0]` (if present) or the current UTC day
   * (otherwise) is used to derive a deterministic synthetic
   * episode id via `deriveSyntheticEpisodeId`. Pass an explicit
   * value when the fact belongs to a user-created episode
   * (meeting, milestone, etc.).
   */
  episodeId?: string;
  tx: Tx;
}

export async function createFact(input: CreateFactInput): Promise<MnemoFact> {
  const id = `mfact_${createId()}`;

  // ── Context-poisoning gate (v2.1, AGT borrow) ──────────────────────
  // Runs BEFORE PII redaction — a delimiter-injection payload that
  // gets PII-redacted is still a delimiter injection. Throws so the
  // host route can map to a 422 with structured findings.
  const poisonScan = scanForPoisoning(input.statement);
  if (!poisonScan.ok) {
    throw new PoisoningRejectedError(poisonScan);
  }

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

  // v1.6 — tiered embedding hint. The batch worker reads this to
  // group pending facts by tier and issue one batched API call per
  // (workspace, tier). Stored in metadata so we don't need a column
  // migration; the embed-batch-job reads it back via the JSONB path.
  if (input.embeddingTier) {
    metadata = {
      ...metadata,
      embedding_tier: input.embeddingTier,
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

  // v2 — derive + ensure the synthetic episode FK target.
  // Precedence: explicit input.episodeId > derived-from-message > derived-from-day(now).
  // The fact insert below requires episode_id (NOT NULL per migration
  // 0051), so we MUST have a row to point to.
  const messageUuid = input.sourceMessageIds?.[0];
  const episodeId =
    input.episodeId ??
    deriveSyntheticEpisodeId({
      workspaceId: input.workspaceId,
      ...(messageUuid ? { messageUuid } : { day: new Date() }),
    });

  // Upsert the synthetic episode (idempotent). When the caller passed
  // an explicit episodeId pointing at a real user-created episode,
  // this INSERT short-circuits via ON CONFLICT.
  await input.tx.execute(sql`
    INSERT INTO mnemo_episode (
      id, workspace_id, title, narrative, occurred_at,
      participants, topics, linked_fact_ids,
      metadata, is_synthetic
    ) VALUES (
      ${episodeId}, ${input.workspaceId},
      ${"(synthetic)"}, ${"Auto-created by createFact for v2 episode_id invariant."},
      now(),
      ARRAY[]::text[], ARRAY[]::text[], ARRAY[]::text[],
      '{}'::jsonb, true
    )
    ON CONFLICT (id) DO NOTHING
  `);

  const rows = await input.tx
    .insert(schema.mnemoFacts)
    .values({
      id,
      episodeId,
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
      // v1.6 (G2) — link to a `mnemo_entity` row (migration 0039).
      // NULL when the extraction pipeline could not resolve a
      // canonical entity. We pass `null` explicitly so a missing
      // input is round-tripped as NULL rather than UNDEFINED (which
      // drizzle would skip and the SQL DEFAULT for the column is
      // NULL anyway, but the explicit value keeps the insert audit
      // trail honest).
      entityId: input.entityId ?? null,
      // v1.6 (G2) — Memory Protocol version tag (migration 0041).
      // The SQL DEFAULT is 'v1.1' for back-compat; callers that
      // produce v1.2-classified facts (extract-job.ts after the
      // v1.6 upgrade) pass 'v1.2' explicitly.
      protocolVersion: input.protocolVersion ?? "v1.1",
    })
    .returning();

  const fact = rows[0] as unknown as MnemoFact;

  // v1.1 #1+2 — pointer index: wire the new fact's content into the
  // routing index so future queries can be directed to this entity's
  // drawer. Only facts with a resolved entity_id enter the pointer;
  // facts without one (workspace-shared) are only reachable via the
  // existing full first-stage retrieval. This call shares the same
  // transaction so the pointer is always consistent with the fact row.
  if (input.entityId) {
    await upsertPointerTerms({
      workspaceId: input.workspaceId,
      entityId: input.entityId,
      statement, // post-PII redaction
      tx: input.tx,
    });
  }

  return fact;
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

/**
 * Mark a batch of facts as recalled. Updates hit_count, last_recalled_at,
 * and — via the v1.1 #10 Hebbian model — memory_strength, memory_stability,
 * and last_strength_update atomically in a single UPDATE.
 *
 * Hebbian potentiation (per-row, in SQL):
 *   1. Ebbinghaus decay: the stored strength is first decayed by
 *      `exp(-days_since_last_update / stability)` to account for the
 *      time since the previous recall.
 *   2. Cepeda spacing guard: potentiation (+0.05) is ONLY applied when
 *      the gap since `last_recalled_at` is ≥ 1 hour. Closer recalls
 *      count toward hit_count but do not strengthen the trace.
 *   3. Stability increment (+0.1) mirrors potentiation — it happens on
 *      the same qualifying recalls, not on rapid re-reads.
 *
 * This is a bulk UPDATE so all rows are processed in one round-trip.
 * The SQL CASE expressions handle the per-row branching server-side;
 * no per-row TypeScript loop is needed.
 */
export async function markRecalled(workspaceId: string, factIds: string[], tx: Tx): Promise<void> {
  if (factIds.length === 0) return;
  await tx.execute(sql`
    UPDATE mnemo_fact
    SET
      hit_count        = hit_count + 1,
      last_recalled_at = NOW(),

      -- v1.1 #10 — Hebbian strength: decay then conditionally potentiate.
      memory_strength = CASE
        -- First-ever strength update: default starts at 1.0; no elapsed
        -- time to decay, so go straight to potentiation.
        WHEN last_strength_update IS NULL THEN
          LEAST(${MAX_MEMORY_STRENGTH}, 1.0 + ${POTENTIATION_INCREMENT})

        -- Cepeda spacing satisfied (≥ 1 h since last recall, or the fact
        -- has been recalled before but never under the Hebbian model):
        -- apply Ebbinghaus decay, then potentiate.
        WHEN (last_recalled_at IS NULL
              OR EXTRACT(EPOCH FROM (NOW() - last_recalled_at)) >= ${CEPEDA_SPACING_SECONDS}) THEN
          LEAST(
            ${MAX_MEMORY_STRENGTH},
            GREATEST(${MIN_MEMORY_STRENGTH},
              memory_strength * EXP(
                -EXTRACT(EPOCH FROM (NOW() - last_strength_update))
                  / 86400.0 / memory_stability
              )
            ) + ${POTENTIATION_INCREMENT}
          )

        -- Too soon (< 1 h): decay only, no potentiation.
        ELSE
          GREATEST(${MIN_MEMORY_STRENGTH},
            memory_strength * EXP(
              -EXTRACT(EPOCH FROM (NOW() - last_strength_update))
                / 86400.0 / memory_stability
            )
          )
        END,

      -- v1.1 #10 — Stability: increments only on potentiating recalls
      -- (the spacing condition is checked identically to strength above).
      memory_stability = CASE
        WHEN last_strength_update IS NULL THEN
          memory_stability + ${STABILITY_INCREMENT}
        WHEN (last_recalled_at IS NULL
              OR EXTRACT(EPOCH FROM (NOW() - last_recalled_at)) >= ${CEPEDA_SPACING_SECONDS}) THEN
          memory_stability + ${STABILITY_INCREMENT}
        ELSE memory_stability
        END,

      last_strength_update = NOW()

    WHERE workspace_id = ${workspaceId}
      AND id = ANY(${sql.param(factIds)}::text[])
  `);
}
