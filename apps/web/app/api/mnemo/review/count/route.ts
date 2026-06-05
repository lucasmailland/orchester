// apps/web/app/api/mnemo/review/count/route.ts
//
// GET /api/mnemo/review/count — return `{ count: number }` of
// unresolved rows in `mnemo_review_queue` for the active workspace.
//
// Cheap COUNT(*) against the partial index
// `idx_mnemo_review_queue_workspace_unresolved` (migration 0032) so
// the Inspector header badge can poll without listing rows.
//
// As of the service-extraction Phase 2 (tramo 2), the handler
// delegates to `workspaceReviewCount()` (service vs library picked at
// runtime). The Inspector previously surfaced `factCountForgotten`
// as a placeholder for the review badge — wires here let it show the
// real queue depth. Default to 0 client-side on non-2xx so the UI
// degrades gracefully when the upstream service isn't reachable yet.
//
// RBAC: editor+ — same level as GET /api/mnemo/review.
import { NextResponse } from "next/server";
import { requireAuth, isAuthContext } from "@/lib/auth-guards";
import { workspaceReviewCount } from "@/lib/mnemo/review";

export const dynamic = "force-dynamic";

export async function GET() {
  const ctx = await requireAuth({ minRole: "editor" });
  if (!isAuthContext(ctx)) return ctx;

  try {
    const { mode, data } = await workspaceReviewCount(ctx.workspace.id);
    return NextResponse.json(data, { headers: { "X-Mnemo-Mode": mode } });
  } catch (e) {
    console.error("[mnemo/review/count] fetch failed", e);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
