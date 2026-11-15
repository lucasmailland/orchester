// GET /api/workspaces/[slug]/brain/decisions?status=&limit=  — viewer+ (brain.read)
import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthContext } from "@/lib/auth-guards";
import { resolveBySlug } from "@/lib/tenant/resolve";
import { isAccessible } from "@/lib/tenant/lifecycle";
import { assertCan } from "@/lib/rbac";
import { listWorkspaceDecisions } from "@/lib/mnemo/decisions";

export const dynamic = "force-dynamic";

const STATUSES = new Set(["active", "superseded", "withdrawn"]);

export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const ctx = await requireAuth({ minRole: "viewer" });
  if (!isAuthContext(ctx)) return ctx;
  const { slug } = await params;
  const ws = await resolveBySlug(slug);
  if (!ws) return NextResponse.json({ error: "workspace_not_found" }, { status: 404 });
  if (ws.id !== ctx.workspace.id) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const access = isAccessible(ws);
  if (!access.ok)
    return NextResponse.json(
      { error: access.reason },
      { status: access.reason === "deleted" ? 410 : 423 }
    );
  try {
    assertCan(ctx.role, "brain.read");
  } catch {
    return NextResponse.json({ error: "role_insufficient" }, { status: 403 });
  }

  const url = new URL(req.url);
  const statusRaw = url.searchParams.get("status");
  if (statusRaw && !STATUSES.has(statusRaw)) {
    return NextResponse.json({ error: "invalid_status" }, { status: 400 });
  }
  const limitRaw = Number(url.searchParams.get("limit") ?? "100");
  const limit =
    Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(Math.floor(limitRaw), 500) : 100;

  try {
    const { mode, data } = await listWorkspaceDecisions(ctx.workspace.id, {
      ...(statusRaw ? { status: statusRaw as "active" | "superseded" | "withdrawn" } : {}),
      limit,
    });
    return NextResponse.json(data, { headers: { "X-Mnemo-Mode": mode } });
  } catch (e) {
    console.error("[brain/decisions] list failed", e);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
