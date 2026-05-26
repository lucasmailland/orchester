// apps/web/worker/review-sweep-job.ts
//
// Mnemosyne v1.3 — active-learning daily review sweep cron.
//
// Walks every workspace with at least one active mnemo_fact and
// enqueues low-confidence inactive facts into mnemo_review_queue
// for human triage. Definition of "candidate" lives in
// `findLowConfidenceCandidates` (packages/mnemosyne/src/review/queue.ts):
//
//   • confidence < 0.5
//   • NOT pinned
//   • status = 'active'
//   • not already in an OPEN review row (any reason)
//
// Capped at 50 candidates per workspace per run; the next daily tick
// picks up any tail.
//
// No host-side LLM calls — pure SQL aggregates, so the
// spend-cap / metering invariants in `scripts/audit-invariants.sh`
// don't apply (the regex matches the chat-call / stream entry points,
// which this file deliberately never names).
import "server-only";
import { sql } from "drizzle-orm";
import {
  findLowConfidenceCandidates,
  enqueueReview,
  withMnemoTx,
  type Tx,
} from "@orchester/mnemosyne";
import { safeLogError } from "@/lib/safe-log";
import { withCrossTenantAdmin } from "@/lib/tenant/cron";

/** Hard cap on the workspace catalogue scan. Same shape as the other
 *  v1.2 / v1.3 crons. */
const MAX_WORKSPACES_PER_RUN = 5000;

/** Per-workspace cap on candidates enqueued per tick. Matches the
 *  brief's "Cap at 50 per workspace per run". */
const MAX_CANDIDATES_PER_WORKSPACE = 50;

interface SweepStats {
  workspacesScanned: number;
  factsQueued: number;
  workspacesSkipped: number;
}

/**
 * Run the sweep for ONE workspace inside a workspace-scoped tx
 * (`withMnemoTx`) so RLS+FORCE Pattern A applies. Returns the count
 * of rows enqueued, or `null` on hard failure (logged). The cron
 * loop swallows nulls and keeps going so one bad workspace doesn't
 * starve the others.
 */
async function sweepWorkspace(workspaceId: string): Promise<number | null> {
  try {
    return await withMnemoTx(workspaceId, async (tx: Tx) => {
      const candidates = await findLowConfidenceCandidates({
        workspaceId,
        tx,
        limit: MAX_CANDIDATES_PER_WORKSPACE,
      });
      if (candidates.length === 0) return 0;
      let queued = 0;
      for (const c of candidates) {
        const r = await enqueueReview({
          workspaceId,
          factId: c.factId,
          reason: "low_confidence",
          tx,
        });
        // enqueueReview dedups by (workspace_id, fact_id) — so a
        // concurrent `saveFactWithCandidates` reason='contradiction'
        // wins the slot. We count only the rows we actually inserted.
        if (r.inserted) queued += 1;
      }
      return queued;
    });
  } catch (err) {
    safeLogError(`[review-sweep] failed (ws=${workspaceId}):`, err);
    return null;
  }
}

/**
 * Cron entry point. Enumeration uses `withCrossTenantAdmin`
 * (cron_admin BYPASSRLS) so we see workspaces across tenants for
 * the catalogue read. The per-workspace sweep re-enters the tenant
 * context inside `sweepWorkspace`.
 */
export async function runReviewSweep(): Promise<SweepStats> {
  const stats: SweepStats = {
    workspacesScanned: 0,
    factsQueued: 0,
    workspacesSkipped: 0,
  };

  const workspaceRows = await withCrossTenantAdmin("mnemo.review.sweep.enumerate", async (tx) => {
    const rows = await tx.execute(sql`
        SELECT DISTINCT workspace_id
        FROM mnemo_fact
        WHERE status = 'active'
        LIMIT ${MAX_WORKSPACES_PER_RUN}
      `);
    return rows as unknown as Array<{ workspace_id: string }>;
  });

  stats.workspacesScanned = workspaceRows.length;
  for (const row of workspaceRows) {
    const queued = await sweepWorkspace(row.workspace_id);
    if (queued === null) {
      stats.workspacesSkipped += 1;
      continue;
    }
    stats.factsQueued += queued;
  }

  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ level: "info", msg: "mnemo.review.sweep.done", ...stats }));
  return stats;
}
