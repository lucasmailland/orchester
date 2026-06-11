// GET /api/workspaces/[slug]/brain/graph — Memory Graph for the
// Brain Inspector.
//
// Delegates to `fetchWorkspaceGraph()`, which calls `client.graph()`
// on the @mnemosyne/server SDK. The returned `GraphResponse` matches
// what the React hook in lib/hooks/use-brain-graph.ts expects.
import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthContext } from "@/lib/auth-guards";
import { resolveBySlug } from "@/lib/tenant/resolve";
import { isAccessible } from "@/lib/tenant/lifecycle";
import { assertCan } from "@/lib/rbac";
import { fetchWorkspaceGraph } from "@/lib/mnemo/graph";

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

  // `focus` is validated both here (defence in depth) and on the
  // server side. Entity IDs carry a `ment_` prefix followed by either a
  // 24-char cuid2 (production) or an underscore-separated slug (seed
  // data, e.g. ment_seed_tvlds3k6_acme). Anything else is rejected
  // before we touch the data path — this stops a stray param from
  // reaching either the in-process `buildGraphQuery` or the HTTP
  // `?focus=` query string.
  const url = new URL(req.url);
  const focusParam = url.searchParams.get("focus");
  if (focusParam && !/^ment_[a-z0-9_]{1,64}$/.test(focusParam)) {
    return NextResponse.json({ error: "invalid_focus_param" }, { status: 400 });
  }

  try {
    const { mode, graph } = await fetchWorkspaceGraph(ws.id, focusParam ?? undefined);
    return NextResponse.json(graph, {
      headers: {
        "Cache-Control": "private, max-age=30",
        // Surface the data source so an operator can curl the endpoint
        // and confirm a deploy is using the service path (not the
        // legacy library fallback). Strictly informational.
        "X-Mnemo-Mode": mode,
      },
    });
  } catch (e) {
    console.error("[brain/graph] failed to build graph", e);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
