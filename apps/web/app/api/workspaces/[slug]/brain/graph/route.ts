// GET /api/workspaces/[slug]/brain/graph — Memory Graph for the Brain Inspector.
//
// Phase 2 of the mnemosyne-service-extraction plan landed the
// `GET /v1/graph` upstream endpoint and the matching `client.graph()`
// SDK method. This handler now picks the data source at runtime via
// `fetchWorkspaceGraph()`:
//   - if `MNEMO_URL` + `MNEMO_API_KEY` are set, it goes over HTTP
//     against @mnemosyne/server (the canonical Phase 2 path);
//   - otherwise it falls back to the in-process `buildGraphQuery`
//     (legacy library mode — kept for environments where the
//     standalone service isn't running yet, e.g. solo-dev or CI
//     without docker compose).
//
// Both paths return the same `GraphResponse` shape, so the React hook
// in lib/hooks/use-brain-graph.ts is unchanged.
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
  // server side. Entity IDs are cuid2-based with a `ment_` prefix
  // (e.g. ment_<24 lowercase alphanumeric chars>). Anything that
  // doesn't match the pattern is rejected before we touch the data
  // path — this stops a stray param from reaching either the
  // in-process `buildGraphQuery` or the HTTP `?focus=` query string.
  const url = new URL(req.url);
  const focusParam = url.searchParams.get("focus");
  if (focusParam && !/^ment_[a-z0-9]{24}$/.test(focusParam)) {
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
