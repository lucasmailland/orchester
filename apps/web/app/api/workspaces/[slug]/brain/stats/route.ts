// GET /api/workspaces/[slug]/brain/stats
// Workspace-wide brain statistics: counts by kind, top subjects, recall rate.
import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { requireAuth, isAuthContext } from "@/lib/auth-guards";
import { resolveBySlug } from "@/lib/tenant/resolve";
import { isAccessible } from "@/lib/tenant/lifecycle";
import { assertCan } from "@/lib/rbac";
import { withBrainTx } from "@/lib/brain";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const ctx = await requireAuth({ minRole: "viewer" });
  if (!isAuthContext(ctx)) return ctx;
  const { slug } = await params;
  const ws = await resolveBySlug(slug);
  if (!ws) return NextResponse.json({ error: "workspace_not_found" }, { status: 404 });
  if (ws.id !== ctx.workspace.id) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const access = isAccessible(ws);
  if (!access.ok) {
    return NextResponse.json(
      { error: access.reason },
      { status: access.reason === "deleted" ? 410 : 423 }
    );
  }
  try {
    assertCan(ctx.role, "brain.read");
  } catch {
    return NextResponse.json({ error: "role_insufficient" }, { status: 403 });
  }

  const stats = await withBrainTx(ws.id, async (tx) => {
    const byKind = await tx.execute(sql`
      SELECT kind, count(*)::int AS n
      FROM brain_fact
      WHERE workspace_id = ${ws.id} AND status = 'active'
      GROUP BY kind
      ORDER BY n DESC
    `);

    const topSubjects = await tx.execute(sql`
      SELECT subject, count(*)::int AS n
      FROM brain_fact
      WHERE workspace_id = ${ws.id} AND status = 'active'
      GROUP BY subject
      ORDER BY n DESC
      LIMIT 10
    `);

    const totals = await tx.execute(sql`
      SELECT
        count(*) FILTER (WHERE status = 'active')::int AS total_active,
        count(*) FILTER (WHERE status = 'forgotten')::int AS total_forgotten,
        count(*) FILTER (WHERE status = 'merged')::int AS total_merged,
        count(*) FILTER (WHERE pinned = true AND status = 'active')::int AS total_pinned,
        COALESCE(sum(hit_count), 0)::int AS total_recalls,
        COALESCE(avg(confidence), 0)::float AS avg_confidence,
        COALESCE(avg(relevance), 0)::float AS avg_relevance
      FROM brain_fact
      WHERE workspace_id = ${ws.id}
    `);

    type ByKindRow = { kind: string; n: number };
    type TopSubjectRow = { subject: string; n: number };
    type TotalsRow = {
      total_active: number;
      total_forgotten: number;
      total_merged: number;
      total_pinned: number;
      total_recalls: number;
      avg_confidence: number;
      avg_relevance: number;
    };
    const totalsRow = (totals as unknown as TotalsRow[])[0] ?? {
      total_active: 0,
      total_forgotten: 0,
      total_merged: 0,
      total_pinned: 0,
      total_recalls: 0,
      avg_confidence: 0,
      avg_relevance: 0,
    };

    return {
      totals: totalsRow,
      byKind: (byKind as unknown as ByKindRow[]) ?? [],
      topSubjects: (topSubjects as unknown as TopSubjectRow[]) ?? [],
    };
  });

  return NextResponse.json(stats);
}
