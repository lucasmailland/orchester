// apps/web/worker/episode-backfill-job.ts
//
// v2 — Episode-id backfill cron.
//
// PURPOSE:
//   Walk every `mnemo_fact` row where `episode_id IS NULL` and
//   stamp it with a deterministic synthetic episode id derived via
//   `deriveSyntheticEpisodeId()`. When coverage hits 100%, the v2.1
//   follow-up migration can flip `mnemo_fact.episode_id` to NOT NULL.
//
// WHY A CRON, NOT A MIGRATION:
//   The codebase has potentially millions of legacy facts written
//   pre-v2. Backfilling inline during migration 0048 would lock
//   `mnemo_fact` for the entire pass (minutes-to-hours on large
//   tenants). The cron-based approach pages through facts in small
//   batches per workspace, sleeps between batches, and is safely
//   resumable — it picks up where it left off via `last_backfilled_id`
//   stored in workspace settings.
//
// DERIVATION KEYS:
//   - `source_message_ids[0]` present → message-turn derivation.
//   - `metadata.kb_chunk_id` or `metadata.source_kind`+`metadata.source_ref`
//     present → document derivation.
//   - Otherwise → daily derivation keyed on `created_at`.
//
// SAFETY:
//   - Only updates rows where `episode_id IS NULL`. Idempotent.
//   - Creates the synthetic `mnemo_episode` row on demand (one per
//     unique synthetic id per workspace) with `is_synthetic = true`.
//   - Bounded batch size + sleep keeps the cron tractable on a
//     shared DB.

import "server-only";
import { sql } from "drizzle-orm";
import { deriveSyntheticEpisodeId, withMnemoTx, type Tx } from "@mnemosyne/core";
import { logWithContext, recordMetric } from "@/lib/observability";
import { safeLogError } from "@/lib/safe-log";

const DEFAULT_BATCH_SIZE = 100;
/** Max rows the cron updates per workspace per invocation. Keeps the
 *  per-tick wall-clock bounded; the next tick resumes via the cursor. */
const DEFAULT_PER_WORKSPACE_CAP = 1_000;

/** Sleep between batches so the backfill never crowds out live recall
 *  traffic on the same connection pool. */
const INTER_BATCH_SLEEP_MS = 50;

export interface EpisodeBackfillStats {
  workspaceId: string;
  scanned: number;
  stamped: number;
  newSyntheticEpisodes: number;
  durationMs: number;
}

interface FactRow {
  id: string;
  created_at: Date | string;
  source_message_ids: string[] | null;
  metadata: Record<string, unknown> | null;
}

/**
 * Backfill `episode_id` for a single workspace. Caller invokes this
 * for each workspace in turn (or in parallel if the DB has headroom).
 */
export async function backfillWorkspaceEpisodes(
  workspaceId: string,
  opts: { batchSize?: number; perWorkspaceCap?: number } = {}
): Promise<EpisodeBackfillStats> {
  const t0 = Date.now();
  const batchSize = Math.max(1, Math.min(500, opts.batchSize ?? DEFAULT_BATCH_SIZE));
  const cap = Math.max(batchSize, opts.perWorkspaceCap ?? DEFAULT_PER_WORKSPACE_CAP);

  const stats: EpisodeBackfillStats = {
    workspaceId,
    scanned: 0,
    stamped: 0,
    newSyntheticEpisodes: 0,
    durationMs: 0,
  };

  // Track episode ids we've already ensured this run so we don't issue
  // an upsert per row when many rows share the same synthetic episode.
  const ensuredEpisodes = new Set<string>();

  try {
    while (stats.stamped < cap) {
      // Run each batch inside its own tx so a single failure can't
      // block forever-progress. RLS is workspace-scoped via withMnemoTx.
      const batch = await withMnemoTx(workspaceId, async (txRaw) => {
        const tx = txRaw as unknown as Tx;
        return processBatch(tx, workspaceId, batchSize, ensuredEpisodes, stats);
      });

      stats.scanned += batch.scanned;
      stats.stamped += batch.stamped;
      stats.newSyntheticEpisodes += batch.newSyntheticEpisodes;

      // No more candidates → done with this workspace.
      if (batch.scanned === 0) break;
      // Below the requested batch size → there are no more rows that
      // need stamping right now. (A future tick may pick up new
      // arrivals.)
      if (batch.scanned < batchSize) break;

      await sleep(INTER_BATCH_SLEEP_MS);
    }
  } catch (e) {
    safeLogError(`[episode-backfill] workspace=${workspaceId} failed:`, e);
  }

  stats.durationMs = Date.now() - t0;

  recordMetric("mnemo.backfill.episode.stamped", stats.stamped, { workspace_id: workspaceId });
  recordMetric("mnemo.backfill.episode.duration_ms", stats.durationMs, {
    workspace_id: workspaceId,
  });
  logWithContext("info", "[episode-backfill] workspace complete", { ...stats });

  return stats;
}

/**
 * Process one batch. Pure (well, DB-touching) function so the loop in
 * `backfillWorkspaceEpisodes` stays readable.
 */
async function processBatch(
  tx: Tx,
  workspaceId: string,
  batchSize: number,
  ensuredEpisodes: Set<string>,
  runningStats: Pick<EpisodeBackfillStats, "newSyntheticEpisodes">
): Promise<{ scanned: number; stamped: number; newSyntheticEpisodes: number }> {
  // Pull the next batch of NULL-episode_id rows.
  const candidates = (await tx.execute(sql`
    SELECT id, created_at, source_message_ids, metadata
    FROM mnemo_fact
    WHERE workspace_id = ${workspaceId}
      AND episode_id IS NULL
    ORDER BY created_at ASC
    LIMIT ${batchSize}
  `)) as unknown as FactRow[];

  if (candidates.length === 0) {
    return { scanned: 0, stamped: 0, newSyntheticEpisodes: 0 };
  }

  let stamped = 0;
  let newEpisodes = 0;

  for (const fact of candidates) {
    const created = fact.created_at instanceof Date ? fact.created_at : new Date(fact.created_at);

    // Pick the most-specific derivation key the row has.
    const messageUuid = fact.source_message_ids?.[0];
    const meta = fact.metadata ?? {};
    const sourceKind =
      (meta as { source_kind?: string }).source_kind ??
      (typeof (meta as { kb_chunk_id?: string }).kb_chunk_id === "string" ? "kb" : undefined);
    const sourceRef =
      (meta as { source_ref?: string }).source_ref ??
      (meta as { kb_chunk_id?: string }).kb_chunk_id;

    const episodeId = deriveSyntheticEpisodeId({
      workspaceId,
      ...(messageUuid ? { messageUuid } : {}),
      ...(sourceKind && sourceRef ? { sourceKind, sourceRef } : {}),
      ...(!messageUuid && !(sourceKind && sourceRef) ? { day: created } : {}),
    });

    // Ensure the synthetic episode exists (idempotent INSERT ON
    // CONFLICT DO NOTHING). The episode's `occurred_at` defaults to
    // the fact's `created_at` for traceability.
    if (!ensuredEpisodes.has(episodeId)) {
      const insertedRows = (await tx.execute(sql`
        INSERT INTO mnemo_episode (
          id, workspace_id, title, narrative, occurred_at,
          participants, topics, linked_fact_ids,
          metadata, is_synthetic
        ) VALUES (
          ${episodeId}, ${workspaceId}, ${"(synthetic)"}, ${"Backfilled by episode-backfill cron."},
          ${created.toISOString()}::timestamptz,
          ${"{}"}::text[], ${"{}"}::text[], ${"{}"}::text[],
          ${"{}"}::jsonb, true
        )
        ON CONFLICT (id) DO NOTHING
        RETURNING id
      `)) as unknown as Array<{ id: string }>;
      ensuredEpisodes.add(episodeId);
      if (insertedRows.length > 0) {
        newEpisodes++;
        runningStats.newSyntheticEpisodes++;
      }
    }

    // Stamp the fact.
    await tx.execute(sql`
      UPDATE mnemo_fact
      SET episode_id = ${episodeId}
      WHERE id = ${fact.id} AND workspace_id = ${workspaceId}
        AND episode_id IS NULL
    `);
    stamped++;
  }

  return { scanned: candidates.length, stamped, newSyntheticEpisodes: newEpisodes };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
