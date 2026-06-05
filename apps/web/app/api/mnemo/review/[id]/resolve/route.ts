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
//                  fact leaves the recall pool.
//   'dismissed'  — no cascade; the reviewer chose "don't show me
//                  this again". The fact remains as-is.
//
// RBAC: editor+.
import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { schema } from "@orchester/db";
import { resolveReview, withMnemoTx } from "@orchester/mnemosyne";
import { requireAuth, isAuthContext } from "@/lib/auth-guards";
import { parseBody } from "@/lib/validation";
import { logAudit } from "@/lib/audit";

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

  const result = await withMnemoTx(ctx.workspace.id, async (tx) => {
    const r = await resolveReview({
      workspaceId: ctx.workspace.id,
      reviewId: id,
      resolvedByUserId: ctx.user.id,
      resolution,
      tx,
    });

    // Cascade on 'forgotten' — same tx so the audit-log entry below
    // can reference both sides without a race. Other resolutions
    // don't touch the fact.
    if (r.resolved && resolution === "forgotten" && r.factId) {
      await tx
        .update(schema.mnemoFacts)
        .set({ status: "forgotten", updatedAt: new Date() })
        .where(
          and(
            eq(schema.mnemoFacts.id, r.factId),
            eq(schema.mnemoFacts.workspaceId, ctx.workspace.id)
          )
        );
    }
    return r;
  });

  if (!result.resolved) {
    // Already resolved or doesn't exist. Disambiguate via factId:
    // null → never existed (404); non-null → already resolved (409).
    if (result.factId === null) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ error: "Already resolved", factId: result.factId }, { status: 409 });
  }

  await logAudit({
    workspaceId: ctx.workspace.id,
    userId: ctx.user.id,
    action: "mnemo.review.resolve",
    resource: "mnemo_review_queue",
    resourceId: id,
    after: { resolution, factId: result.factId, cascade: resolution === "forgotten" },
  });

  return NextResponse.json({
    id,
    resolution,
    factId: result.factId,
  });
}
