// apps/web/app/api/mnemo/review/[id]/resolve/route.ts
//
// POST /api/mnemo/review/[id]/resolve — close a queue row.
//
// Body: { resolution: 'kept' | 'edited' | 'forgotten' | 'dismissed' }
//
// Cascade rules:
//   'kept'       — no cascade. The fact is fine as-is; this is the
//                  reviewer marking "I looked at it, it's correct."
//   'edited'     — no cascade. The reviewer used PATCH /facts/[id]
//                  separately; this just closes the queue row. The
//                  separate PATCH call provides the audit trail.
//   'forgotten'  — cascade to mnemo_fact.status='forgotten' so the
//                  fact leaves the recall pool. Atomic with the
//                  resolve write (the mnemosyne server performs the
//                  cascade in a single transaction).
//   'dismissed'  — no cascade; the reviewer chose "don't show me
//                  this again". The fact remains as-is.
//
// The handler delegates to `resolveWorkspaceReview()`, which dispatches
// through the @mnemosyne/server SDK. The response carries `cascaded`
// so the audit log captures it deterministically.
//
// RBAC: editor+.
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, isAuthContext } from "@/lib/auth-guards";
import { parseBody } from "@/lib/validation";
import { logAudit } from "@/lib/audit";
import { resolveWorkspaceReview } from "@/lib/mnemo/review";

export const dynamic = "force-dynamic";

const resolveSchema = z.object({
  resolution: z.enum(["kept", "edited", "forgotten", "dismissed"]),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuth({ minRole: "editor" });
  if (!isAuthContext(ctx)) return ctx;
  const { id } = await params;
  const parsed = await parseBody(req, resolveSchema);
  if (!parsed.ok) return parsed.response;
  const { resolution } = parsed.data;

  try {
    const { mode, data, alreadyResolved } = await resolveWorkspaceReview(
      ctx.workspace.id,
      id,
      { resolution },
      ctx.user.id
    );

    if (!data) {
      // Disambiguate via the `alreadyResolved` flag the helper
      // surfaced — preserves the legacy 404 vs 409 contract.
      if (alreadyResolved) {
        return NextResponse.json(
          { error: "Already resolved" },
          { status: 409, headers: { "X-Mnemo-Mode": mode } }
        );
      }
      return NextResponse.json(
        { error: "Not found" },
        { status: 404, headers: { "X-Mnemo-Mode": mode } }
      );
    }

    await logAudit({
      workspaceId: ctx.workspace.id,
      userId: ctx.user.id,
      action: "mnemo.review.resolve",
      resource: "mnemo_review_queue",
      resourceId: id,
      after: { resolution, factId: data.factId, cascade: data.cascaded },
    });

    return NextResponse.json(
      { id, resolution, factId: data.factId },
      { headers: { "X-Mnemo-Mode": mode } }
    );
  } catch (e) {
    console.error("[mnemo/review/:id/resolve] failed", e);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
