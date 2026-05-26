// apps/web/app/api/mnemo/admin/run-health/route.ts
//
// POST /api/mnemo/admin/run-health — admin-only "run now" trigger for
// the Mnemosyne v1.2 health-snapshot cron, scoped to THIS workspace.
//
// The cron normally fires daily at 06:00 UTC and walks every workspace
// (see `apps/web/worker/index.ts`). In dev / for support flows we need
// an on-demand path that lets an admin verify the cron is wired up
// without waiting 24h. We enqueue with `{ workspaceId }` so the
// pg-boss handler can target just this workspace (see
// `healthJobHandler` — workspace-scoped payload short-circuits the
// cross-tenant sweep).
//
// Body is empty (the workspace is derived from the session). We still
// parse `{}` through zod so the audit-invariants script's parseBody
// check is satisfied for mutating routes.
//
// RBAC: admin+ — operational lever, not a viewer surface.
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, isAuthContext } from "@/lib/auth-guards";
import { parseBody } from "@/lib/validation";
import { enqueue, JOB_MNEMO_HEALTH } from "@/lib/queue";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

const bodySchema = z.object({}).loose();

export async function POST(req: Request) {
  const ctx = await requireAuth({ minRole: "admin" });
  if (!isAuthContext(ctx)) return ctx;
  const parsed = await parseBody(req, bodySchema);
  if (!parsed.ok) return parsed.response;

  const jobId = await enqueue(JOB_MNEMO_HEALTH, { workspaceId: ctx.workspace.id });

  await logAudit({
    workspaceId: ctx.workspace.id,
    userId: ctx.user.id,
    action: "mnemo.admin.run-health",
    resource: "mnemo_cron",
    resourceId: JOB_MNEMO_HEALTH,
  });

  return NextResponse.json({ enqueued: true, jobId });
}
