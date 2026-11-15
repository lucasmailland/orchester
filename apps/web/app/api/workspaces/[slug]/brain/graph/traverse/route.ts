// GET /api/workspaces/[slug]/brain/graph/traverse — multi-hop focus.
//
// Returns the subgraph within `depth` hops of `root`, reconstructed `asOf` an
// optional past instant. Delegates to `fetchWorkspaceTraverse`, which calls the
// Mnemosyne SDK's `graphTraverse` + `graph` and intersects them. The response
// shape is the SAME `GraphResponse` the React hook already consumes.
import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthContext } from "@/lib/auth-guards";
import { resolveBySlug } from "@/lib/tenant/resolve";
import { isAccessible } from "@/lib/tenant/lifecycle";
import { assertCan } from "@/lib/rbac";
import { fetchWorkspaceTraverse } from "@/lib/mnemo/graph";

export const dynamic = "force-dynamic";

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

  // `root` is an entity id — same shape rule as `?focus=` on the base route:
  // `ment_` + 1..64 of [a-z0-9_]. Reject anything else before touching the SDK.
  const root = url.searchParams.get("root");
  if (!root || !/^ment_[a-z0-9_]{1,64}$/.test(root)) {
    return NextResponse.json({ error: "invalid_root_param" }, { status: 400 });
  }

  // `depth` is the hop count: 1..3 (the slider range). Clamp out-of-range /
  // non-numeric to the [1,3] window so a stray param never reaches the SDK.
  const depthRaw = Number(url.searchParams.get("depth") ?? "1");
  const depth = Number.isFinite(depthRaw) ? Math.min(3, Math.max(1, Math.trunc(depthRaw))) : 1;

  // `asOf` (optional) must be a valid ISO 8601 instant.
  const asOfParam = url.searchParams.get("asOf");
  if (asOfParam && Number.isNaN(Date.parse(asOfParam))) {
    return NextResponse.json({ error: "invalid_asof_param" }, { status: 400 });
  }

  try {
    const { mode, graph } = await fetchWorkspaceTraverse(
      ws.id,
      root,
      depth,
      asOfParam ?? undefined
    );
    return NextResponse.json(graph, {
      headers: {
        "Cache-Control": "private, max-age=30",
        "X-Mnemo-Mode": mode,
      },
    });
  } catch (e) {
    console.error("[brain/graph/traverse] failed to build traversal", e);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
