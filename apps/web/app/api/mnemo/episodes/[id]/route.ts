// apps/web/app/api/mnemo/episodes/[id]/route.ts
//
// GET /api/mnemo/episodes/[id] — Mnemosyne v1.4 single-episode read.
// Returns { episode, linkedFacts } so the timeline detail view can
// render the narrative + the cluster of facts the extraction pipeline
// tied to it in a single round-trip.
//
// As of the service-extraction Phase 2 (tramo 1), the handler
// delegates to `getWorkspaceEpisode()` which picks the data source at
// runtime (service vs library). `X-Mnemo-Mode` surfaces which path
// served the request.
//
// 404 when the episode doesn't exist OR lives in another workspace
// (RLS already filters cross-tenant rows; the explicit check just
// gives a tighter error message).
//
// RBAC: member+ (== `viewer`) — read-only surface for the Inspector.
import { NextResponse } from "next/server";
import { requireAuth, isAuthContext } from "@/lib/auth-guards";
import { getWorkspaceEpisode } from "@/lib/mnemo/episodes";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuth({ minRole: "viewer" });
  if (!isAuthContext(ctx)) return ctx;

  const { id } = await params;
  // Cheap guard — the cuid2 prefix is `mepi_`. We don't hard-validate
  // here (a clean 404 is plenty) but we do reject obviously empty ids.
  if (!id || id.length < 4) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  try {
    const { mode, data } = await getWorkspaceEpisode(ctx.workspace.id, id);
    if (!data) {
      return NextResponse.json(
        { error: "Not found" },
        { status: 404, headers: { "X-Mnemo-Mode": mode } }
      );
    }
    return NextResponse.json(data, { headers: { "X-Mnemo-Mode": mode } });
  } catch (e) {
    console.error("[mnemo/episodes/:id] fetch failed", e);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
