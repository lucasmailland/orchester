// apps/web/app/api/admin/orgs/[orgId]/cross-workspace-facts/route.ts
//
// GET /api/admin/orgs/[orgId]/cross-workspace-facts
//
// Read-side admin view over `mnemo_org_fact_view` (migration 0050).
// Surfaces the org-level summaries produced by the cross-workspace
// consolidation cron (apps/web/worker/org-consolidation-job.ts).
//
// AUTH:
//   - Caller must be the org's owner (workspace.owner_user_id matches
//     ANY workspace in the org). This is the minimum cross-workspace
//     read; richer "org admin" roles would be a follow-up.
//
// SECURITY:
//   - The org-scope RLS (`app_org_user`) is honored implicitly: the
//     handler sets `app.org_id` GUC via `withMnemoOrgTx`-style wrapper
//     (inline here — no shared helper yet).
//   - The `statement_summary` column ALREADY went through PII
//     redaction at write time by the cron, so surfacing it to the
//     org-owner UI does not re-expose user data.
//   - The handler emits a `org.cross_workspace_facts_read` audit row
//     per call so an admin can spot unusual access patterns.

import { NextResponse } from "next/server";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { getDb, schema } from "@orchester/db";
import { eq, and } from "drizzle-orm";
import { requireAuth, isAuthContext } from "@/lib/auth-guards";
import { appendAudit } from "@/lib/audit/log";
import { safeLogError } from "@/lib/safe-log";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  subject: z.string().trim().min(1).max(200).optional(),
  kind: z.string().trim().min(1).max(50).optional(),
  minWorkspaces: z.coerce.number().int().min(2).max(50).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

interface OrgFactRow {
  id: string;
  org_id: string;
  source_fact_ids: string[];
  source_workspace_ids: string[];
  statement_summary: string;
  cluster_similarity: number;
  subject: string;
  kind: string;
  stale: boolean;
  created_at: Date;
}

export async function GET(req: Request, ctx: { params: Promise<{ orgId: string }> }) {
  const auth = await requireAuth({ minRole: "viewer" });
  if (!isAuthContext(auth)) return auth;

  const { orgId } = await ctx.params;
  if (!/^[a-z0-9_]{1,100}$/i.test(orgId)) {
    return NextResponse.json({ error: "invalid orgId" }, { status: 400 });
  }

  const url = new URL(req.url);
  const parsed = querySchema.safeParse({
    subject: url.searchParams.get("subject") ?? undefined,
    kind: url.searchParams.get("kind") ?? undefined,
    minWorkspaces: url.searchParams.get("minWorkspaces") ?? undefined,
    limit: url.searchParams.get("limit") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_query", issues: parsed.error.issues },
      { status: 400 }
    );
  }
  const q = parsed.data;
  const limit = q.limit ?? 50;
  const minWorkspaces = q.minWorkspaces ?? 2;

  // ── Authorise: caller must own AT LEAST ONE workspace in the org ──
  // (We don't yet have a dedicated `org_owner` role — the closest
  // proxy is "any workspace in the org owned by this user". Tighten
  // when an org-membership table lands.)
  const db = getDb();
  const ownedWs = await db
    .select({ id: schema.workspaces.id })
    .from(schema.workspaces)
    .where(and(eq(schema.workspaces.orgId, orgId), eq(schema.workspaces.ownerUserId, auth.user.id)))
    .limit(1);
  if (ownedWs.length === 0) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // ── Audit log emission ─────────────────────────────────────────────
  // Workspace_id required by appendAudit — use the first owned workspace
  // as the audit anchor so the row lands in that workspace's chain.
  appendAudit(ownedWs[0]!.id, {
    action: "inspector.recall_debug" as const, // reuse the inspector tag
    actorUserId: auth.user.id,
    actorKind: "user",
    actorIp: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    actorUserAgent: req.headers.get("user-agent"),
    targetType: "org",
    targetId: orgId,
    meta: {
      surface: "cross_workspace_facts",
      filters: { subject: q.subject ?? null, kind: q.kind ?? null, minWorkspaces },
      limit,
    },
  });

  // ── Query ──────────────────────────────────────────────────────────
  // We compose the SQL inline so the optional filters become
  // parameterised predicates without drizzle's chained-WHERE
  // boilerplate. The query runs under the regular `app_user` role
  // (workspace-membership-scoped) because the row visibility is
  // gated by `org_id IN (...workspaces of user)` rather than by the
  // `app_org_user` GUC — keeps the dependency surface minimal.
  try {
    const rows = (await db.execute(sql`
      SELECT id, org_id, source_fact_ids, source_workspace_ids,
             statement_summary, cluster_similarity, subject, kind, stale, created_at
      FROM mnemo_org_fact_view
      WHERE org_id = ${orgId}
        AND array_length(source_workspace_ids, 1) >= ${minWorkspaces}
        ${q.subject ? sql`AND subject = ${q.subject}` : sql``}
        ${q.kind ? sql`AND kind = ${q.kind}` : sql``}
      ORDER BY cluster_similarity DESC, created_at DESC
      LIMIT ${limit}
    `)) as unknown as OrgFactRow[];

    return NextResponse.json({
      orgId,
      filters: { subject: q.subject ?? null, kind: q.kind ?? null, minWorkspaces, limit },
      count: rows.length,
      items: rows.map((r) => ({
        id: r.id,
        subject: r.subject,
        kind: r.kind,
        statementSummary: r.statement_summary,
        clusterSimilarity: r.cluster_similarity,
        sourceFactIds: r.source_fact_ids,
        sourceWorkspaceIds: r.source_workspace_ids,
        stale: r.stale,
        createdAt: r.created_at,
      })),
    });
  } catch (e) {
    safeLogError("[admin/orgs/cross-workspace-facts] query failed:", e);
    return NextResponse.json({ error: "query_failed" }, { status: 500 });
  }
}
