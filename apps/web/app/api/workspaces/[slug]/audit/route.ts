// apps/web/app/api/workspaces/[slug]/audit/route.ts
//
// GET /api/workspaces/[slug]/audit
//
// Cursor-paginated read of the tamper-evident audit log for a single
// workspace. Limited to roles with the `audit.read` action (today:
// admin + owner — see lib/rbac.ts).
//
// The cursor is the `seq` of the oldest entry returned on the previous
// page; pages are ordered DESC. Default page size 50, max 100.
import { NextResponse, type NextRequest } from "next/server";
import { desc, eq, and, lt } from "drizzle-orm";
import { getDb, schema } from "@orchester/db";
import { resolveBySlug } from "@/lib/tenant/resolve";
import { checkMembership } from "@/lib/tenant/membership";
import { isAccessible } from "@/lib/tenant/lifecycle";
import { requireAuth } from "@/lib/auth-guards";
import { assertCan, ForbiddenError } from "@/lib/rbac";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const ctx = await requireAuth({ workspaceOptional: true });
  if (ctx instanceof Response) return ctx;

  const { slug } = await params;
  const url = new URL(req.url);
  const limitRaw = parseInt(url.searchParams.get("limit") ?? "50", 10);
  const limit = Math.min(Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : 50, 100);
  const cursor = url.searchParams.get("cursor");

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
    assertCan(m.role, "audit.read");
  } catch (e) {
    if (e instanceof ForbiddenError) {
      return NextResponse.json({ error: "role_insufficient" }, { status: 403 });
    }
    throw e;
  }

  const db = getDb();
  let cursorSeq: bigint | null = null;
  if (cursor) {
    try {
      cursorSeq = BigInt(cursor);
    } catch {
      return NextResponse.json({ error: "invalid_cursor" }, { status: 400 });
    }
  }

  const conditions = cursorSeq
    ? and(eq(schema.auditLog.workspaceId, ws.id), lt(schema.auditLog.seq, cursorSeq))
    : eq(schema.auditLog.workspaceId, ws.id);

  const entries = await db
    .select()
    .from(schema.auditLog)
    .where(conditions)
    .orderBy(desc(schema.auditLog.seq))
    .limit(limit + 1);

  const hasMore = entries.length > limit;
  const items = entries.slice(0, limit);
  const last = items[items.length - 1];
  const nextCursor = hasMore && last ? last.seq.toString() : null;

  // bigint values can't be JSON-serialised directly. Map seq → string.
  const serialisable = items.map((e) => ({ ...e, seq: e.seq.toString() }));

  return NextResponse.json({ entries: serialisable, nextCursor });
}
