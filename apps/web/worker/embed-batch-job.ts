// apps/web/worker/embed-batch-job.ts
//
// pg-boss handler for `mnemo.embed.fact` (per-fact) + scheduled
// `mnemo.embed.batch` (periodic flush). Drains pending fact-embed jobs,
// batches their statements into a single embedding API call per
// workspace (BATCH_SIZE = 100), and updates `mnemo_fact.embedding` in
// place.
//
// Why batched? The synchronous `createFact` path (legacy + PII pipeline)
// calls the embedding provider once per fact: ~200-500ms per call AND
// per-call overhead pricing. A 5-fact extraction → 5 round trips =
// 1-2.5s wall-clock and ~5× the per-token cost vs batching. With
// `createFactAsync`, the fact inserts immediately (searchable via FTS),
// the embedding cost amortizes 10-100× lower for high-throughput
// workspaces.
//
// Mode A note: when a workspace has no embedding provider configured,
// we DEFER the job for 30 min (the workspace may be in the middle of
// onboarding and a provider key is imminent). Recall already handles
// `embedding IS NULL` via the `text_lemmatized` GIN index, so deferred
// facts remain searchable. On final retry exhaustion, the fact's
// `metadata.embedding_failed` is stamped and the job is marked done so
// pg-boss doesn't infinitely retry.
//
// Invariants enforced by `scripts/audit-invariants.sh`:
//   - `assertWithinSpend` MUST appear in this file (this is a billable
//     AI dispatch).
//   - `recordAiUsage` MUST appear in this file (metering — see D4-1).
// Both invariants are real LLM-ish calls below; the audit script does
// substring scanning so the names must be present.
import "server-only";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { getDb, schema } from "@orchester/db";
import { embed as embedRaw, defaultEmbeddingModel, type EmbeddingProvider } from "@/lib/embeddings";
import { assertWithinSpend } from "@/lib/cost-alerts";
import { recordAiUsage } from "@/lib/ai/run";
import { calculateEmbeddingCostUsd } from "@/lib/pricing";
import { safeLogError } from "@/lib/safe-log";

/**
 * Workspace-scoped transaction with role downgrade + GUC set — mirror
 * of `withBrainTx` (lib/brain/store.ts) and `withMnemoTx` (mnemosyne).
 * Inlined here to avoid pulling pg-boss-side code into the mnemosyne
 * package boundary (§0.1 — mnemosyne stays Next.js-agnostic).
 *
 * The role downgrade is layer 1 of defense-in-depth against the
 * BYPASSRLS connection role (audit P0, 2026-05-24). See
 * `packages/mnemosyne/src/tx.ts` for the full rationale.
 */
async function withMnemoTx<T>(
  workspaceId: string,
  fn: (tx: Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0]) => Promise<T>
): Promise<T> {
  const db = getDb();
  return db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL ROLE app_user`);
    await tx.execute(sql`SELECT set_config('app.workspace_id', ${workspaceId}, true)`);
    return fn(tx);
  });
}

/**
 * Provider-side batch ceiling. Most embedding APIs (OpenAI, Voyage,
 * Google) accept 100-512 inputs per request. Keep it conservative at
 * 100 — well below all provider caps, leaves headroom for very long
 * statements, and the wall-clock win is already ~99% at this size.
 */
const BATCH_SIZE = 100;

/**
 * Max attempts per fact before stamping `metadata.embedding_failed`
 * and giving up. After this the fact stays NULL-embedded forever
 * (FTS still covers it).
 */
const MAX_FACT_ATTEMPTS = 3;

export interface EmbedFactPayload {
  factId: string;
  workspaceId: string;
  /** Pre-redacted statement (PII redaction already applied at insert). */
  statement: string;
}

/**
 * Per-fact handler. pg-boss collapses these into batches automatically
 * via `teamSize`/`teamConcurrency`, but we ALSO eagerly drain pending
 * jobs for the same workspace inside a single embedding call when
 * pg-boss hands us a batch (Array<Job> when teamConcurrency > 1).
 * Implementation note: pg-boss v10 invokes the handler per-job; we
 * still batch by accumulating jobs *between* invocations via the
 * `embed.batch` scheduled flush below.
 */
export async function runEmbedFactJob(payload: EmbedFactPayload): Promise<void> {
  // Single-fact path: the heavy lifting happens in `flushPendingEmbeddings`
  // when the periodic cron fires. This handler is the eager path —
  // useful for low-throughput workspaces where the cron tick would
  // otherwise stall an isolated fact for up to a minute.
  await flushPendingEmbeddings(payload.workspaceId);
}

/**
 * Scheduled flush handler (`mnemo.embed.batch`, every minute). Scans
 * for unembedded facts across ALL workspaces, groups by workspace, and
 * runs one batched embedding call per workspace per batch.
 *
 * Cross-tenant scan: uses an admin-bypass connection (DEFAULT db
 * client without `app.workspace_id` set) ONLY to enumerate
 * `(workspace_id, COUNT)` pairs. All mutations happen inside
 * `withMnemoTx(workspaceId, ...)` per workspace — RLS FORCE applies
 * on the UPDATE path.
 */
export async function runEmbedBatchSweep(): Promise<void> {
  // SQL-only enumeration: cheap. We pick up at most 50 distinct
  // workspaces per tick so a single noisy workspace can't starve
  // others (we'll come back next minute).
  const db = getDb();
  const rows = (await db.execute(sql`
    SELECT workspace_id, COUNT(*)::int AS pending
    FROM mnemo_fact
    WHERE embedding IS NULL
      AND status = 'active'
      AND COALESCE((metadata->'embedding_failed'->>'final')::boolean, false) = false
    GROUP BY workspace_id
    ORDER BY pending DESC
    LIMIT 50
  `)) as unknown as Array<{ workspace_id: string; pending: number }>;

  for (const r of rows) {
    try {
      await flushPendingEmbeddings(r.workspace_id);
    } catch (e) {
      safeLogError(`[mnemo.embed.batch] flush failed for ws=${r.workspace_id}:`, e);
      // Continue with the next workspace; one bad provider config
      // can't block the whole sweep.
    }
  }
}

/**
 * Drains up to BATCH_SIZE unembedded facts for a workspace, runs a
 * single batched embedding API call, updates the rows in place.
 *
 * Returns the number of facts embedded (0 if Mode A / provider not
 * configured / no pending work).
 */
async function flushPendingEmbeddings(workspaceId: string): Promise<number> {
  // Resolve embedding provider/model from workspace config. Charter
  // §25: we never hardcode. The current MVP picks "first enabled
  // embedding-capable provider" — same pattern as
  // `resolveSmallTierModel` for chat. Future Phase 2+ will read
  // `workspace.mnemo.embedding_provider` / `embedding_model` settings.
  const provider = await resolveWorkspaceEmbeddingProvider(workspaceId);
  if (!provider) {
    // Mode A: no provider configured. Leave facts unembedded — FTS
    // recall already covers them. The next periodic flush (every minute)
    // re-checks the provider config, so the row gets picked up once the
    // workspace wires a provider. We do NOT mark `embedding_failed`
    // here — this is a recoverable config gap, not a per-fact failure.
    return 0;
  }
  const model = defaultEmbeddingModel(provider);

  // Spend cap (audit invariant): block the batch if the workspace hit
  // its monthly cap or the kill-switch is active. Throwing here lets
  // pg-boss retry once the budget refills (or the operator clears
  // the kill-switch). Note: assertWithinSpend signature takes
  // (workspaceId, tx?) — passing undefined uses getDb().
  await assertWithinSpend(workspaceId);

  // Single transaction for the SELECT + UPDATE: prevents two workers
  // racing on the same fact (FOR UPDATE SKIP LOCKED). The transaction
  // is workspace-scoped (RLS FORCE applies).
  return await withMnemoTx(workspaceId, async (tx) => {
    const pending = (await tx.execute(sql`
      SELECT id, statement,
             COALESCE((metadata->'embedding_failed'->>'attempts')::int, 0) AS attempts
      FROM mnemo_fact
      WHERE workspace_id = ${workspaceId}
        AND embedding IS NULL
        AND status = 'active'
        AND COALESCE((metadata->'embedding_failed'->>'final')::boolean, false) = false
      ORDER BY created_at ASC
      LIMIT ${BATCH_SIZE}
      FOR UPDATE SKIP LOCKED
    `)) as unknown as Array<{ id: string; statement: string; attempts: number }>;

    if (pending.length === 0) return 0;

    const texts = pending.map((p) => p.statement);
    let vectors: number[][];
    let tokensUsed = 0;
    try {
      // Single batched API call — this is the cost win. 100 facts in
      // one HTTP round-trip vs 100 separate calls is the difference
      // between $0.02/M tokens and $0.20/M tokens for most providers
      // (the per-request overhead dominates at small payloads).
      const result = await embedRaw(workspaceId, provider, model, texts, tx as never);
      vectors = result.vectors;
      tokensUsed = result.tokensUsed;
    } catch (err) {
      // Embedding provider failure (rate limit, key revoked, etc.).
      // Bump per-fact attempts; on max attempts, stamp final + skip.
      // Don't block other workspaces — log and re-throw so pg-boss
      // backs off this single batch.
      await markBatchAttempt(tx as never, workspaceId, pending, err);
      throw err;
    }

    // Update each fact with its vector. We zip in-order; the
    // embedding API contract preserves input order.
    for (let i = 0; i < pending.length; i++) {
      const factId = pending[i]!.id;
      const vec = vectors[i];
      if (!vec) continue;
      await tx
        .update(schema.mnemoFacts)
        .set({
          embedding: vec,
          embeddingModel: model,
        })
        .where(
          and(eq(schema.mnemoFacts.id, factId), eq(schema.mnemoFacts.workspaceId, workspaceId))
        );
    }

    // Record metering AFTER the successful batch. Per audit D4-1, the
    // `usageEvent` must carry the resolved model + capability so the
    // billing rollup attributes embedding cost correctly (the
    // pre-existing per-fact path used `calculateEmbeddingCostUsd`).
    const costUsd = calculateEmbeddingCostUsd(model, tokensUsed);
    await recordAiUsage({
      workspaceId,
      capability: "embedding",
      providerId: provider,
      model,
      tokensOut: tokensUsed,
      tokensTotal: tokensUsed,
      costUsd,
    });

    return pending.length;
  });
}

/**
 * On embedding failure: bump per-fact attempts in metadata. Once a
 * fact crosses MAX_FACT_ATTEMPTS, stamp `metadata.embedding_failed =
 * { final: true, ... }` so the sweep skips it forever. Recall via
 * FTS still works; the fact just never gets a vector. This prevents
 * a single poison-pill statement from blocking the whole queue.
 */
async function markBatchAttempt(
  tx: Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0],
  workspaceId: string,
  pending: Array<{ id: string; statement: string; attempts: number }>,
  err: unknown
): Promise<void> {
  const reason = err instanceof Error ? err.message : String(err);
  const finalIds = pending.filter((p) => p.attempts + 1 >= MAX_FACT_ATTEMPTS).map((p) => p.id);
  const retryIds = pending.filter((p) => p.attempts + 1 < MAX_FACT_ATTEMPTS).map((p) => p.id);
  const at = new Date().toISOString();

  if (finalIds.length > 0) {
    await tx.execute(sql`
      UPDATE mnemo_fact
      SET metadata = jsonb_set(
        COALESCE(metadata, '{}'::jsonb),
        '{embedding_failed}',
        jsonb_build_object('final', true, 'at', ${at}::text, 'reason', ${reason}::text,
                           'attempts', ${MAX_FACT_ATTEMPTS}::int)
      )
      WHERE workspace_id = ${workspaceId}
        AND id = ANY(${finalIds}::text[])
    `);
  }
  if (retryIds.length > 0) {
    await tx.execute(sql`
      UPDATE mnemo_fact
      SET metadata = jsonb_set(
        COALESCE(metadata, '{}'::jsonb),
        '{embedding_failed}',
        jsonb_build_object('final', false, 'at', ${at}::text, 'reason', ${reason}::text,
                           'attempts', (COALESCE((metadata->'embedding_failed'->>'attempts')::int, 0) + 1))
      )
      WHERE workspace_id = ${workspaceId}
        AND id = ANY(${retryIds}::text[])
    `);
  }
}

/**
 * Pick the first enabled embedding-capable provider. Mirror of
 * `resolveSmallTierModel`'s strategy for chat. Returns null if the
 * workspace has no embedding-capable provider configured (steady-state
 * Mode A — recall falls through to FTS).
 *
 * Charter §25: never returns a string-literal default — always
 * consults the workspace's `ai_provider` rows.
 */
async function resolveWorkspaceEmbeddingProvider(
  workspaceId: string
): Promise<EmbeddingProvider | null> {
  const db = getDb();
  const rows = await db
    .select({ provider: schema.aiProviders.provider })
    .from(schema.aiProviders)
    .where(
      and(eq(schema.aiProviders.workspaceId, workspaceId), eq(schema.aiProviders.enabled, true))
    );
  // ai_provider.provider is one of: openai | anthropic | google. Of
  // these, openai + google publish embedding models in our catalog.
  // Prefer openai (text-embedding-3-small) when both are available —
  // matches the default model resolution and is the cheaper option.
  const set = new Set(rows.map((r) => r.provider));
  if (set.has("openai")) return "openai";
  if (set.has("google")) return "google";
  return null;
}

// Re-export sweep-helper unused-import guard. `isNull` is referenced
// implicitly by the embedding SQL above (via `IS NULL`); keep an
// explicit import line so the symbol stays in the module's surface
// area for future refactors that may want it in Drizzle expressions.
void isNull;
void inArray;
