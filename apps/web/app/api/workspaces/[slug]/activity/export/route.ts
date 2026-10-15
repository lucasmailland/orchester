// apps/web/app/api/workspaces/[slug]/activity/export/route.ts
//
// GET /api/workspaces/[slug]/activity/export?<same filters as /activity>
//
// The activity timeline as CSV: newest first, at most 10,000 rows (a header
// `X-Activity-Truncated: true` says the range held more). Same audience as
// the timeline (`activity.read`: admin + owner). Every export is recorded in
// the workspace audit log as `activity.export` with its filters and row
// count; when that record cannot be written, the file is not handed out.
import { NextResponse } from "next/server";
import { resolveBySlug } from "@/lib/tenant/resolve";
import { checkMembership } from "@/lib/tenant/membership";
import { isAccessible } from "@/lib/tenant/lifecycle";
import { requireAuth } from "@/lib/auth-guards";
import { assertCan, ForbiddenError } from "@/lib/rbac";
import { appendAuditSync } from "@/lib/audit/log";
import { describeFilters, parseActivityQuery } from "@/lib/activity/filters";
import { exportActivity } from "@/lib/activity/query";
import { activityCsv } from "@/lib/activity/csv";
import { safeLogError } from "@/lib/safe-log";

export const dynamic = "force-dynamic";

/** `2026-03-01T00:00:00.000Z` → `20260301`. */
const day = (date: Date) => date.toISOString().slice(0, 10).replace(/-/g, "");

export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const ctx = await requireAuth({ workspaceOptional: true });
  if (ctx instanceof Response) return ctx;

  const { slug } = await params;
  const ws = await resolveBySlug(slug);
  if (!ws) {
    return NextResponse.json({ error: "workspace_not_found" }, { status: 404 });
  }

  const m = await checkMembership(ctx.user.id, ws.id);
  if (!m) return NextResponse.json({ error: "not_a_member" }, { status: 403 });

  const accessible = isAccessible(ws);
  if (!accessible.ok) {
    return NextResponse.json(
      { error: accessible.reason },
      { status: accessible.reason === "deleted" ? 410 : 423 }
    );
  }

  try {
    assertCan(m.role, "activity.read");
  } catch (e) {
    if (e instanceof ForbiddenError) {
      return NextResponse.json({ error: "role_insufficient" }, { status: 403 });
    }
    throw e;
  }

  const parsed = parseActivityQuery(new URL(req.url).searchParams);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error, field: parsed.field }, { status: 400 });
  }
  const { filters } = parsed.query;

  const { rows, truncated } = await exportActivity(ws.id, filters);

  try {
    await appendAuditSync(ws.id, {
      action: "activity.export",
      actorUserId: ctx.user.id,
      actorKind: "user",
      targetType: "workspace",
      targetId: ws.id,
      meta: { filters: describeFilters(filters), rows: rows.length, truncated },
    });
  } catch (e) {
    safeLogError("[activity] export audit entry failed:", e);
    return NextResponse.json({ error: "audit_failed" }, { status: 500 });
  }

  const safeSlug = ws.slug.replace(/[^a-z0-9-]/gi, "") || "workspace";
  const filename = `activity-${safeSlug}-${day(filters.from)}-${day(filters.to)}.csv`;
  return new Response(activityCsv(rows), {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...(truncated ? { "X-Activity-Truncated": "true" } : {}),
    },
  });
}
