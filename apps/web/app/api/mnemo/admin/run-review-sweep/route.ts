// apps/web/app/api/mnemo/admin/run-review-sweep/route.ts
//
// POST /api/mnemo/admin/run-review-sweep — admin "run now" for the
// Mnemosyne v1.3 active-learning review-sweep cron, scoped to THIS
// workspace.
//
// Scans for low-confidence (< 0.5) unpinned facts not already in the
// queue and enqueues them with reason='low_confidence' (cap 50 per
// workspace per run). Daily cron at 04:00 UTC. Dedup against
// 'contradiction' rows is handled inside `enqueueReview`.
//
// RBAC: admin+.
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, isAuthContext } from "@/lib/auth-guards";
import { parseBody } from "@/lib/validation";
import { enqueue, JOB_MNEMO_REVIEW_SWEEP } from "@/lib/queue";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

const bodySchema = z.object({}).loose();

export async function POST(req: Request) {
  const ctx = await requireAuth({ minRole: "admin" });
  if (!isAuthContext(ctx)) return ctx;
  const parsed = await parseBody(req, bodySchema);
  if (!parsed.ok) return parsed.response;

  const jobId = await enqueue(JOB_MNEMO_REVIEW_SWEEP, { workspaceId: ctx.workspace.id });

  await logAudit({
    workspaceId: ctx.workspace.id,
    userId: ctx.user.id,
    action: "mnemo.admin.run-review-sweep",
    resource: "mnemo_cron",
    resourceId: JOB_MNEMO_REVIEW_SWEEP,
  });

  return NextResponse.json({ enqueued: true, jobId });
}
