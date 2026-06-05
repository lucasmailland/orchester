// apps/web/app/api/mnemo/admin/run-dedup/route.ts
//
// POST /api/mnemo/admin/run-dedup — admin "run now" for the Mnemosyne
// v1.2 janitor dedup pass, scoped to THIS workspace.
//
// The weekly cron (Sunday 03:00 UTC) walks every workspace with at
// least one embedded fact and merges near-duplicates (cosine >= 0.92).
// This endpoint lets an admin enqueue an immediate run so the merge
// behaviour can be verified without waiting a week.
//
// The current handler in `apps/web/worker/index.ts` runs the
// cross-tenant sweep; the worker side will gate on `workspaceId` when
// v1.6 lands. We enqueue with `{ workspaceId }` either way so the
// payload is correct on day one.
//
// RBAC: admin+.
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, isAuthContext } from "@/lib/auth-guards";
import { parseBody } from "@/lib/validation";
import { enqueue, JOB_MNEMO_DEDUP } from "@/lib/queue";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

const bodySchema = z.object({}).loose();

export async function POST(req: Request) {
  const ctx = await requireAuth({ minRole: "admin" });
  if (!isAuthContext(ctx)) return ctx;
  const parsed = await parseBody(req, bodySchema);
  if (!parsed.ok) return parsed.response;

  const jobId = await enqueue(JOB_MNEMO_DEDUP, { workspaceId: ctx.workspace.id });

  await logAudit({
    workspaceId: ctx.workspace.id,
    userId: ctx.user.id,
    action: "mnemo.admin.run-dedup",
    resource: "mnemo_cron",
    resourceId: JOB_MNEMO_DEDUP,
  });

  return NextResponse.json({ enqueued: true, jobId });
}
