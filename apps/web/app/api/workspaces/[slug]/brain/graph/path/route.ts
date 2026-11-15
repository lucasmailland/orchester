// GET /api/workspaces/[slug]/brain/graph/path — shortest path between two nodes.
//
// Returns `{ path: string[]; edges: Array<{ source; target; relation }> }` for
// the renderer to overlay. Delegates to `fetchWorkspacePath` → SDK `graphPath`.
import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthContext } from "@/lib/auth-guards";
import { resolveBySlug } from "@/lib/tenant/resolve";
import { isAccessible } from "@/lib/tenant/lifecycle";
import { assertCan } from "@/lib/rbac";
import { fetchWorkspacePath } from "@/lib/mnemo/graph";

export const dynamic = "force-dynamic";

const ENTITY_ID = /^ment_[a-z0-9_]{1,64}$/;

export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const ctx = await requireAuth({ minRole: "viewer" });
  if (!isAuthContext(ctx)) return ctx;

  const { slug } = await params;
  const ws = await resolveBySlug(slug);
  if (!ws) return NextResponse.json({ error: "workspace_not_found" }, { status: 404 });
  if (ws.id !== ctx.workspace.id) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

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

  const url = new URL(req.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  if (!from || !ENTITY_ID.test(from) || !to || !ENTITY_ID.test(to)) {
    return NextResponse.json({ error: "invalid_endpoint_param" }, { status: 400 });
  }
  if (from === to) {
    return NextResponse.json({ error: "same_endpoint" }, { status: 400 });
  }

  const asOfParam = url.searchParams.get("asOf");
  if (asOfParam && Number.isNaN(Date.parse(asOfParam))) {
    return NextResponse.json({ error: "invalid_asof_param" }, { status: 400 });
  }

  try {
    const { mode, path } = await fetchWorkspacePath(ws.id, from, to, asOfParam ?? undefined);
    return NextResponse.json(path, {
      headers: {
        "Cache-Control": "private, max-age=30",
        "X-Mnemo-Mode": mode,
      },
    });
  } catch (e) {
    console.error("[brain/graph/path] failed to compute path", e);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
