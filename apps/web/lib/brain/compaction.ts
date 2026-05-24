// apps/web/lib/brain/compaction.ts
//
// Per-workspace compaction:
//   1. Find groups of active facts with same (scope, scope_ref, subject)
//   2. Within each group, find pairs with cosine similarity > THRESHOLD
//   3. Keep the newer (or higher-confidence) fact; mark the older as
//      `merged` with `merged_into_id` pointing to the kept one
//   4. Drop fully-forgotten facts past 30-day grace window
//
// The merge is conservative: similarity threshold 0.92 (very close
// semantic + same subject), so we don't conflate genuinely distinct
// facts that happen to share keywords.
import "server-only";
import { and, eq, lt, sql } from "drizzle-orm";
import { getDb, schema, type DbClient } from "@orchester/db";
import { withCrossTenantAdmin } from "@/lib/tenant/cron";
import { invalidateRecallCache } from "./recall";
import { safeLogError } from "@/lib/safe-log";

const SIMILARITY_THRESHOLD = 0.92;
const HARD_DELETE_AFTER_DAYS = 30;

interface CompactStats {
  workspacesProcessed: number;
  factsMerged: number;
  factsHardDeleted: number;
}

/**
 * Run compaction over every active workspace. Called daily at 03:30 UTC.
 *
 * For each workspace:
 *   - Use cross-tenant admin to enumerate workspaces
 *   - For each, open a workspace-scoped tx and run merge + hard-delete
 */
export async function runBrainCompaction(): Promise<CompactStats> {
  const stats: CompactStats = { workspacesProcessed: 0, factsMerged: 0, factsHardDeleted: 0 };
  const db = getDb();

  // Phase 1: get list of workspaces with brain activity. Cross-tenant
  // read via cron_admin role (BYPASSRLS).
  const wsRows = await withCrossTenantAdmin("brain.compact.enumerate", async (tx) => {
    const rows = await tx.execute(sql`
      SELECT DISTINCT workspace_id
      FROM brain_fact
      WHERE status IN ('active', 'forgotten')
    `);
    return rows as unknown as Array<{ workspace_id: string }>;
  });

  for (const { workspace_id: wsId } of wsRows) {
    try {
      const wsStats = await compactWorkspace(wsId, db);
      stats.factsMerged += wsStats.factsMerged;
      stats.factsHardDeleted += wsStats.factsHardDeleted;
      stats.workspacesProcessed += 1;
      if (wsStats.factsMerged > 0 || wsStats.factsHardDeleted > 0) {
        invalidateRecallCache(wsId);
      }
    } catch (e) {
      safeLogError(`[brain.compact] workspace ${wsId} failed:`, e);
    }
  }

  console.log(JSON.stringify({ level: "info", msg: "brain.compact.done", ...stats }));
  return stats;
}

interface WsCompactStats {
  factsMerged: number;
  factsHardDeleted: number;
}

async function compactWorkspace(workspaceId: string, db: DbClient): Promise<WsCompactStats> {
  let factsMerged = 0;
  let factsHardDeleted = 0;

  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.workspace_id', ${workspaceId}, true)`);

    // 1. Find duplicate-candidate pairs: same (scope, scope_ref, subject),
    //    cosine similarity ≥ threshold, both active, not pinned.
    //    Keep the one with newer updated_at OR (tie-break) higher
    //    confidence.
    const dupes = await tx.execute(sql`
      WITH pairs AS (
        SELECT
          a.id AS keep_id,
          b.id AS merge_id,
          (1.0 - (a.embedding <=> b.embedding)) AS similarity
        FROM brain_fact a
        JOIN brain_fact b
          ON a.workspace_id = b.workspace_id
         AND a.scope = b.scope
         AND COALESCE(a.scope_ref, '') = COALESCE(b.scope_ref, '')
         AND a.subject = b.subject
         AND a.id != b.id
         AND a.status = 'active'
         AND b.status = 'active'
         AND a.pinned = false
         AND b.pinned = false
         AND a.embedding IS NOT NULL
         AND b.embedding IS NOT NULL
         AND (
           a.updated_at > b.updated_at
           OR (a.updated_at = b.updated_at AND a.confidence > b.confidence)
           OR (a.updated_at = b.updated_at AND a.confidence = b.confidence AND a.id < b.id)
         )
        WHERE a.workspace_id = ${workspaceId}
          AND (1.0 - (a.embedding <=> b.embedding)) >= ${SIMILARITY_THRESHOLD}
      )
      SELECT keep_id, merge_id FROM pairs
    `);

    const pairs = dupes as unknown as Array<{ keep_id: string; merge_id: string }>;
    for (const { keep_id, merge_id } of pairs) {
      await tx
        .update(schema.brainFacts)
        .set({ status: "merged", mergedIntoId: keep_id })
        .where(eq(schema.brainFacts.id, merge_id));
      factsMerged += 1;
    }

    // 2. Hard-delete facts that have been 'forgotten' for > 30 days.
    //    Preserves the audit trail (audit_log entries remain).
    const cutoff = new Date(Date.now() - HARD_DELETE_AFTER_DAYS * 24 * 60 * 60 * 1000);
    const purged = await tx
      .delete(schema.brainFacts)
      .where(
        and(
          eq(schema.brainFacts.workspaceId, workspaceId),
          eq(schema.brainFacts.status, "forgotten"),
          lt(schema.brainFacts.updatedAt, cutoff)
        )
      )
      .returning({ id: schema.brainFacts.id });
    factsHardDeleted = purged.length;
  });

  return { factsMerged, factsHardDeleted };
}
