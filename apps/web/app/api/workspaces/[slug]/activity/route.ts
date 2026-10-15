// apps/web/app/api/workspaces/[slug]/activity/route.ts
//
// GET /api/workspaces/[slug]/activity?from&to&kinds&agentId&flowId&channelId
//     &integrationType&integrationId&outcome&ref&cursor&limit
//
// One timeline of what happened in a workspace: tool calls, metered model
// calls, flow runs, conversations and audit-log changes, newest first, with
// filters. Returns `{ rows, nextCursor, totals }`; `totals` only on the first
// page (no cursor). Limited to roles with `activity.read` (admin + owner).
//
// The query layer (`lib/activity/query.ts`) scopes every read to the
// workspace resolved here; the membership + role checks below are the
// authorization gate.
import { NextResponse } from "next/server";
import { resolveBySlug } from "@/lib/tenant/resolve";
import { checkMembership } from "@/lib/tenant/membership";
import { isAccessible } from "@/lib/tenant/lifecycle";
import { requireAuth } from "@/lib/auth-guards";
import { assertCan, ForbiddenError } from "@/lib/rbac";
import { encodeCursor, parseActivityQuery } from "@/lib/activity/filters";
import { activityTotals, queryActivity } from "@/lib/activity/query";
import type { ActivityResponse } from "@/lib/activity/types";

export const dynamic = "force-dynamic";

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
  const { filters, cursor, limit } = parsed.query;

  const page = await queryActivity(ws.id, filters, { cursor, limit });
  const totals = cursor ? null : await activityTotals(ws.id, filters);

  const body: ActivityResponse = {
    rows: page.rows,
    nextCursor: page.nextCursor ? encodeCursor(page.nextCursor) : null,
    totals,
  };
  return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
}
