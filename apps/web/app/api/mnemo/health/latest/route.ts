// apps/web/app/api/mnemo/health/latest/route.ts
//
// GET /api/mnemo/health/latest — composite "current health" view that
// the Inspector KPI strip + sidebar both consume.
//
// Pre-v1.6 this route returned `{ snapshot: <mnemo_health row> }` and
// the UI unwrapped under the `snapshot` key, but:
//   1. The persisted snapshot only has `factCountActive / Archived /
//      Embedded` — no pinned, no forgotten, no total. The KPI tiles
//      need those four counts so they were all permanently 0.
//   2. Cold-start workspaces have no `mnemo_health` row until the
//      cron has run, so every fresh workspace saw all-zero KPIs.
//
// We now ALWAYS return live counts (cheap — single COUNT pass with
// FILTER), and merge in the latest persisted snapshot for the chart
// fields (recall_hit_rate_30d, capturedAt). Both shapes are emitted
// so callers can read either `snapshot.factCountTotal` (legacy) or
// the flat fields at the top level.
//
// RBAC: admin+.
import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { getHealthSnapshot, withMnemoTx } from "@orchester/mnemosyne";
import { requireAuth, isAuthContext } from "@/lib/auth-guards";

export const dynamic = "force-dynamic";

interface LiveCounts {
  active: number;
  forgotten: number;
  merged: number;
  pinned: number;
  embedded: number;
  total: number;
}

export async function GET() {
  const ctx = await requireAuth({ minRole: "admin" });
  if (!isAuthContext(ctx)) return ctx;

  // 1. Live counts via a single COUNT(*) FILTER pass. Even on
  //    workspaces with millions of facts this is sub-millisecond
  //    given the indexes on `(workspace_id, status)` and `pinned`.
  const counts = await withMnemoTx(ctx.workspace.id, async (tx) => {
    const rows = (await tx.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE status = 'active')::int     AS active,
        COUNT(*) FILTER (WHERE status = 'forgotten')::int  AS forgotten,
        COUNT(*) FILTER (WHERE status = 'merged')::int     AS merged,
        COUNT(*) FILTER (WHERE pinned = TRUE)::int         AS pinned,
        COUNT(*) FILTER (WHERE embedding IS NOT NULL)::int AS embedded,
        COUNT(*)::int                                       AS total
      FROM mnemo_fact
      WHERE workspace_id = ${ctx.workspace.id}
    `)) as unknown as LiveCounts[];
    return rows[0] ?? { active: 0, forgotten: 0, merged: 0, pinned: 0, embedded: 0, total: 0 };
  });

  // 2. Persisted snapshot (chart fields). Best-effort — when no row
  //    exists yet we still serve live counts so the KPIs are useful.
  const persisted = await getHealthSnapshot({ workspaceId: ctx.workspace.id });

  const capturedAt = persisted?.snapshotAt
    ? persisted.snapshotAt instanceof Date
      ? persisted.snapshotAt.toISOString()
      : new Date(persisted.snapshotAt as unknown as string).toISOString()
    : new Date().toISOString();

  // Flat shape matches `HealthSnapshot` in `use-brain-facts.ts`. The
  // Inspector reads these top-level keys directly — no `.snapshot`
  // unwrap needed.
  const flat = {
    capturedAt,
    factCountActive: counts.active,
    factCountForgotten: counts.forgotten,
    factCountMerged: counts.merged,
    factCountPinned: counts.pinned,
    factCountEmbedded: counts.embedded,
    factCountTotal: counts.total,
    recallHitRate30d: persisted?.recallHitRate30d ?? 0,
    extractionJobsFailed7d: persisted?.extractionJobsFailed7d ?? 0,
    extractionJobsDeferred: persisted?.extractionJobsDeferred ?? 0,
  };

  return NextResponse.json(flat);
}
