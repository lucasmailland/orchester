import { NextResponse } from "next/server";
import { z } from "zod";
import { workspaceFromApprovalToken } from "@/lib/flows/pause";
import { getApprovalByToken, resumeByToken } from "@/lib/flows/resume";
import { logWithContext } from "@/lib/observability";
import { parseBody } from "@/lib/validation";

/**
 * A flow's human gate: approve or reject what a `wait_human` left waiting.
 *
 * **Why it does not require a session.** Identity comes from the token, not
 * from the runId, and the token travels in the link delivered to the person
 * by Telegram, Discord, or email. The approver may not have an orchester
 * account, just like someone triggering a webhook. This is the same trust
 * model as `/api/webhooks/[secret]`, so it appears in the same exception list
 * in `audit-invariants.sh`, with a name and reason, rather than silently
 * bypassing the rule.
 *
 * **It does resolve the tenant.** Not requiring a session is not the same as
 * querying without a workspace: `workspaceFromApprovalToken` extracts the
 * workspace from the token itself, and every database operation runs with
 * that context established. The first version looked up the run with a bare
 * `getDb()`, and under FORCE RLS that query returns no rows — every approval
 * would have answered "this link is invalid", without an error in any log.
 *
 * In return, the token is single-use: it is cleared in the same write that
 * records the decision, so a forwarded link cannot be used twice. Looking up
 * by token rather than runId is deliberate: a runId can be guessed, and the
 * other side of this decision could be a production merge.
 */
const decisionSchema = z.object({
  decision: z.enum(["aprobado", "rechazado"]),
  /**
   * Who decided. Not validated against users — the approver may not have an
   * account — but recorded: an approval without an author cannot be audited
   * later.
   */
  quien: z.string().trim().min(1).max(200).optional(),
});

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  // A token without a workspace cannot be queried with context, so it is not
  // queried: reject it here with the same text as a nonexistent token.
  if (!workspaceFromApprovalToken(token)) {
    return NextResponse.json({ error: "Este enlace no es válido." }, { status: 404 });
  }

  const parsed = await parseBody(req, decisionSchema);
  if (!parsed.ok) return parsed.response;
  const { decision } = parsed.data;
  const author = parsed.data.quien ?? "anónimo";

  const r = await resumeByToken(token, decision, author);

  if (!r.ok) {
    // Both reasons deliberately look the same from outside: a leaked link
    // must not reveal which runs exist.
    const message =
      r.reason === "already-resolved"
        ? "Esta aprobación ya fue resuelta."
        : "Este enlace no es válido.";
    return NextResponse.json({ error: message }, { status: 404 });
  }

  logWithContext("info", "flow run resumed by human", {
    correlationId: r.runId,
    runId: r.runId,
    decision,
    quien: author,
  });
  return NextResponse.json({ runId: r.runId, decision, status: r.status });
}

/**
 * What is about to be approved. Without this, the person would have to
 * decide blindly from a Telegram message.
 *
 * Uses a read-only function: the first version implemented GET by calling
 * `resumeByToken(token, "aprobado", …)` to peek — a GET that approved.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!workspaceFromApprovalToken(token)) {
    return NextResponse.json({ error: "Este enlace no es válido." }, { status: 404 });
  }
  const r = await getApprovalByToken(token);
  if (!r.ok) return NextResponse.json({ error: "Este enlace no es válido." }, { status: 404 });
  return NextResponse.json({
    runId: r.runId,
    flowId: r.flowId,
    mensaje: r.message,
    pausadoEn: r.pausedAt,
  });
}
