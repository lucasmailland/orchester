// GET /api/workspaces/[slug]/brain/conflicts?limit=<=20  — viewer+ (brain.read)
import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthContext } from "@/lib/auth-guards";
import { resolveBySlug } from "@/lib/tenant/resolve";
import { isAccessible } from "@/lib/tenant/lifecycle";
import { assertCan } from "@/lib/rbac";
import { listWorkspaceConflicts } from "@/lib/mnemo/judge";

export const dynamic = "force-dynamic";

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
  const limitRaw = Number(url.searchParams.get("limit") ?? "20");
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(Math.floor(limitRaw), 20) : 20;

  try {
    const { mode, data } = await listWorkspaceConflicts(ctx.workspace.id, { limit });
    return NextResponse.json(data, { headers: { "X-Mnemo-Mode": mode } });
  } catch (e) {
    console.error("[brain/conflicts] list failed", e);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
