// apps/web/app/api/mnemo/health/history/route.ts
//
// GET /api/mnemo/health/history?days=30 — last N days of snapshots
// for the inspector dashboard's trend chart. Default 30 days; capped
// at 365 so a runaway query can't scan the whole timeseries.
//
// Returns rows in ASCENDING snapshot_at order so the chart can plot
// left-to-right without re-sorting client-side.
//
// RBAC: admin+.
import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { withMnemoTx } from "@orchester/mnemosyne";
import { requireAuth, isAuthContext } from "@/lib/auth-guards";

export const dynamic = "force-dynamic";

const MAX_DAYS = 365;

export async function GET(req: Request) {
  const ctx = await requireAuth({ minRole: "admin" });
  if (!isAuthContext(ctx)) return ctx;

  const url = new URL(req.url);
  const daysRaw = Number(url.searchParams.get("days") ?? "30");
  const days =
    Number.isFinite(daysRaw) && daysRaw > 0 ? Math.min(Math.floor(daysRaw), MAX_DAYS) : 30;

  const rows = await withMnemoTx(ctx.workspace.id, async (tx) => {
    return (await tx.execute(sql`
      SELECT
        id, snapshot_at,
        fact_count_active, fact_count_archived,
        fact_count_embedded, fact_count_unembedded,
        decision_count_active, relation_count_conflicts,
        facts_with_zero_hits, recall_hit_rate_30d,
        extraction_jobs_failed_7d, extraction_jobs_deferred,
        computed_in_ms
      FROM mnemo_health
      WHERE workspace_id = ${ctx.workspace.id}
        AND snapshot_at >= now() - (${days} || ' days')::interval
      ORDER BY snapshot_at ASC
    `)) as unknown as Array<{
      id: string;
      snapshot_at: Date;
      fact_count_active: number;
      fact_count_archived: number;
      fact_count_embedded: number;
      fact_count_unembedded: number;
      decision_count_active: number;
      relation_count_conflicts: number;
      facts_with_zero_hits: number;
      recall_hit_rate_30d: string | null;
      extraction_jobs_failed_7d: number;
      extraction_jobs_deferred: number;
      computed_in_ms: number;
    }>;
  });

  return NextResponse.json({
    days,
    snapshots: rows.map((r) => ({
      id: r.id,
      snapshotAt: r.snapshot_at,
      factCountActive: r.fact_count_active,
      factCountArchived: r.fact_count_archived,
      factCountEmbedded: r.fact_count_embedded,
      factCountUnembedded: r.fact_count_unembedded,
      decisionCountActive: r.decision_count_active,
      relationCountConflicts: r.relation_count_conflicts,
      factsWithZeroHits: r.facts_with_zero_hits,
      recallHitRate30d: r.recall_hit_rate_30d === null ? null : Number(r.recall_hit_rate_30d),
      extractionJobsFailed7d: r.extraction_jobs_failed_7d,
      extractionJobsDeferred: r.extraction_jobs_deferred,
      computedInMs: r.computed_in_ms,
    })),
  });
}
