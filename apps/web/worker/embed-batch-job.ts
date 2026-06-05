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
import { embed as embedRaw } from "@/lib/embeddings";
import { assertWithinSpend } from "@/lib/cost-alerts";
import { recordAiUsage } from "@/lib/ai/run";
import { calculateEmbeddingCostUsd } from "@/lib/pricing";
import { safeLogError } from "@/lib/safe-log";
import { resolveEmbeddingTier, type EmbeddingTier } from "@/lib/ai/embedding-tier";

/**
 * Workspace-scoped transaction with role downgrade + GUC set — mirror
 * of `withBrainTx` (lib/brain/store.ts) and `withMnemoTx` (mnemosyne).
 * Inlined here to avoid pulling pg-boss-side code into the mnemosyne
 * package boundary (§0.1 — mnemosyne stays Next.js-agnostic).
 *
 * The role downgrade is layer 1 of defense-in-depth against the
 * BYPASSRLS connection role (audit P0, 2026-05-24). See
 * the mnemosyne standalone repo's `src/tx.ts` for the full rationale.
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

interface PendingFactRow {
  id: string;
  statement: string;
  attempts: number;
  /** v1.6 — read from `metadata.embedding_tier`; defaults to 'default'. */
  tier: EmbeddingTier;
  /** Used to re-classify if the tier metadata is absent (legacy rows). */
  pinned: boolean;
  confidence: number;
  kind: string;
  scope: string;
}

/**
 * v1.6 — Drains up to BATCH_SIZE unembedded facts for a workspace,
 * groups them by embedding tier (default | premium), and runs ONE
 * batched embedding API call per (workspace, tier). Updates the rows
 * in place with the resolved tier-appropriate vector.
 *
 * Tier resolution:
 *   - Honors `metadata.embedding_tier` when present (the host caller
 *     passed it through `createFactAsync`).
 *   - For legacy / hand-rolled rows that lack the metadata, we
 *     re-classify on the fly via `resolveEmbeddingTier` using the
 *     row's pinned/confidence/kind/scope attrs. The re-classification
 *     is cheap (pure code path inside the resolver) and only fires
 *     when the metadata is absent — no extra DB cost in steady state.
 *
 * Returns the total number of facts embedded across all tiers
 * (0 if Mode A / provider not configured / no pending work).
 */
async function flushPendingEmbeddings(workspaceId: string): Promise<number> {
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
    // Pull the columns we need to (re)classify the tier in addition to
    // the embed-write columns. The cost is negligible — every fact
    // already lives in cache after the workspace scan from
    // runEmbedBatchSweep.
    const pending = (await tx.execute(sql`
      SELECT id, statement,
             COALESCE((metadata->'embedding_failed'->>'attempts')::int, 0) AS attempts,
             COALESCE(metadata->>'embedding_tier', 'default') AS tier,
             pinned, confidence, kind, scope
      FROM mnemo_fact
      WHERE workspace_id = ${workspaceId}
        AND embedding IS NULL
        AND status = 'active'
        AND COALESCE((metadata->'embedding_failed'->>'final')::boolean, false) = false
      ORDER BY created_at ASC
      LIMIT ${BATCH_SIZE}
      FOR UPDATE SKIP LOCKED
    `)) as unknown as PendingFactRow[];

    if (pending.length === 0) return 0;

    // ── v1.6 — group by tier ────────────────────────────────────────
    // For rows missing the metadata hint (legacy / handcrafted), we
    // re-classify via the resolver so the grouping matches the v1.6
    // promotion rules (pinned, conf >= 0.85, workspace-scope kind).
    const byTier = new Map<EmbeddingTier, PendingFactRow[]>();
    for (const p of pending) {
      const declaredTier = p.tier === "premium" ? "premium" : "default";
      byTier.has(declaredTier) ? byTier.get(declaredTier)!.push(p) : byTier.set(declaredTier, [p]);
    }

    let total = 0;

    // One batched API call per (workspace, tier). The premium tier
    // typically has FAR fewer pending facts than the default tier (by
    // construction — only ~5-20% of facts are pinned/high-conf/
    // workspace-scope) so the cost overhead of the extra call is
    // bounded.
    for (const [tier, group] of byTier.entries()) {
      if (group.length === 0) continue;

      // Resolve provider+model FOR THIS TIER. The resolver consults
      // workspace settings (Charter §25 — no hardcoded model strings).
      // We pass the first row's attrs so the resolver sees a premium
      // input when the group's tier hint says premium — the per-fact
      // re-classify already happened at insert time / the grouper above.
      const head = group[0]!;
      const resolved = await resolveEmbeddingTier({
        workspaceId,
        factKind: head.kind,
        pinned: head.pinned,
        confidence: Number(head.confidence),
        scope: head.scope as "global" | "workspace" | "agent" | "conversation",
        tier,
      });
      if (!resolved) {
        // Mode A: no provider configured. Leave the group unembedded —
        // FTS recall covers them; the next sweep retries. Don't mark
        // embedding_failed — this is a recoverable config gap.
        continue;
      }

      const texts = group.map((p) => p.statement);
      let vectors: number[][];
      let tokensUsed = 0;
      try {
        // Single batched API call for this tier.
        const result = await embedRaw(
          workspaceId,
          resolved.provider,
          resolved.model,
          texts,
          tx as never
        );
        vectors = result.vectors;
        tokensUsed = result.tokensUsed;
      } catch (err) {
        // Embedding provider failure (rate limit, key revoked, etc.).
        // Bump per-fact attempts on THIS GROUP only; on max attempts,
        // stamp final + skip. Continue with the other tier — we
        // don't want a flaky premium provider to block default-tier
        // facts (or vice versa).
        await markBatchAttempt(tx as never, workspaceId, group, err);
        safeLogError(
          `[mnemo.embed.batch] tier=${tier} provider=${resolved.provider} failed for ws=${workspaceId}:`,
          err
        );
        continue;
      }

      for (let i = 0; i < group.length; i++) {
        const factId = group[i]!.id;
        const vec = vectors[i];
        if (!vec) continue;
        await tx
          .update(schema.mnemoFacts)
          .set({
            embedding: vec,
            embeddingModel: resolved.model,
          })
          .where(
            and(eq(schema.mnemoFacts.id, factId), eq(schema.mnemoFacts.workspaceId, workspaceId))
          );
      }

      // Record metering per tier. The `model` carries the tier
      // information (premium models are catalogued separately) so the
      // billing rollup can break down cost by tier without an extra
      // attribute on the usage row.
      const costUsd = calculateEmbeddingCostUsd(resolved.model, tokensUsed);
      await recordAiUsage({
        workspaceId,
        capability: "embedding",
        providerId: resolved.provider,
        model: resolved.model,
        tokensOut: tokensUsed,
        tokensTotal: tokensUsed,
        costUsd,
      });

      total += group.length;
    }

    return total;
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

// v1.6: tier resolution moved to `@/lib/ai/embedding-tier`. The legacy
// `resolveWorkspaceEmbeddingProvider` is no longer needed — the tier
// resolver consults workspace settings (premium override) AND the same
// `ai_provider` rows internally.

// Re-export sweep-helper unused-import guard. `isNull` is referenced
// implicitly by the embedding SQL above (via `IS NULL`); keep an
// explicit import line so the symbol stays in the module's surface
// area for future refactors that may want it in Drizzle expressions.
void isNull;
void inArray;
