// apps/web/app/api/mnemo/admin/run-summary-refresh/route.ts
//
// POST /api/mnemo/admin/run-summary-refresh — admin "run now" for
// the Mnemosyne v1.1 summary refresh cron, scoped to THIS
// (workspace, agent, [user]).
//
// The summary cron normally fires nightly at 05:00 UTC and walks every
// workspace that produced facts in the last 7 days, pre-distilling a
// fresh per-(workspace,agent,user) summary cached in `mnemo_summary`
// (24h TTL). This route lets an admin trigger an immediate refresh for
// a SPECIFIC agent (and optionally a specific user) so the next chat
// turn doesn't pay the LLM round-trip.
//
// Body:
//   { agentId: string, userId?: string }
//
// RBAC: admin+.
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, isAuthContext } from "@/lib/auth-guards";
import { parseBody } from "@/lib/validation";
import { enqueue, JOB_MNEMO_SUMMARY } from "@/lib/queue";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  agentId: z.string().min(1),
  userId: z.string().min(1).optional(),
});

export async function POST(req: Request) {
  const ctx = await requireAuth({ minRole: "admin" });
  if (!isAuthContext(ctx)) return ctx;
  const parsed = await parseBody(req, bodySchema);
  if (!parsed.ok) return parsed.response;

  const { agentId, userId } = parsed.data;
  const payload: { workspaceId: string; agentId: string; userId?: string } = {
    workspaceId: ctx.workspace.id,
    agentId,
  };
  if (userId) payload.userId = userId;

  const jobId = await enqueue(JOB_MNEMO_SUMMARY, payload);

  await logAudit({
    workspaceId: ctx.workspace.id,
    userId: ctx.user.id,
    action: "mnemo.admin.run-summary-refresh",
    resource: "mnemo_cron",
    resourceId: JOB_MNEMO_SUMMARY,
    after: { agentId, ...(userId ? { userId } : {}) },
  });

  return NextResponse.json({ enqueued: true, jobId });
}
