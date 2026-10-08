import "server-only";
import { and, eq } from "drizzle-orm";
import { schema } from "@orchester/db";
import { resumePausedFlow, withFlowTx } from "../flow-engine";
import { isDryRunSource } from "./dry-run";
import { workspaceFromApprovalToken, type ApprovalDecision } from "./pause";

/**
 * Finds the run for a pause with workspace context established.
 *
 * The workspace comes from the token itself (see `createApprovalToken`),
 * because the approver has no session. Without this, the query ran outside
 * `withFlowTx` and returned no rows under FORCE RLS: every approval would have
 * answered "this link is invalid".
 *
 * The `WHERE` compares the entire token, so the workspace prefix weakens
 * nothing: the secret remains the permission.
 */
async function findRunByApprovalToken(token: string) {
  const workspaceId = workspaceFromApprovalToken(token);
  if (!workspaceId) return undefined;
  const rows = await withFlowTx(workspaceId, (tx) =>
    tx.select().from(schema.flowRuns).where(eq(schema.flowRuns.approvalToken, token)).limit(1)
  );
  return rows[0];
}

/**
 * Resumes a run that was waiting for a person.
 *
 * The token is the only permission: it travels in the approval link and is
 * not stored anywhere on the approver's side. Looking up by token rather than
 * runId is **deliberate** — a runId can be guessed, and the other side of this
 * decision could be a production merge.
 */
/**
 * What is about to be approved, without changing anything.
 *
 * Deliberately separate from `resumeByToken`: a function that decides cannot
 * also serve as a read operation. The route's first version implemented GET
 * by calling resume with "aprobado" — a GET that approved.
 */
export async function getApprovalByToken(
  token: string
): Promise<
  | { ok: true; runId: string; flowId: string; message: string; pausedAt: Date | null }
  | { ok: false }
> {
  const run = await findRunByApprovalToken(token);
  if (!run || run.status !== "paused") return { ok: false };
  const vars = (run.pausedVariables ?? {}) as Record<string, unknown>;
  const pend = vars["_pendingApproval"] as { message?: string } | undefined;
  return {
    ok: true,
    runId: run.id,
    flowId: run.flowId,
    message: pend?.message ?? "Se necesita una aprobación",
    pausedAt: run.pausedAt ?? null,
  };
}

export async function resumeByToken(
  token: string,
  decision: ApprovalDecision,
  resolvedBy: string
): Promise<
  | { ok: true; runId: string; status: string }
  | { ok: false; reason: "not-found" | "already-resolved" }
> {
  const run = await findRunByApprovalToken(token);
  if (!run) return { ok: false, reason: "not-found" };

  // A link forwarded by email must not work twice. If the run is no longer
  // paused, someone already decided: it is not the approver's fault, but
  // the run must not execute again either.
  if (run.status !== "paused") return { ok: false, reason: "already-resolved" };

  // The token is cleared in the same operation that records the decision.
  // With two simultaneous clicks, the second finds `status !== paused` and fails.
  const updatedRows = await withFlowTx(run.workspaceId, (tx) =>
    tx
      .update(schema.flowRuns)
      .set({
        status: "running",
        approvalToken: null,
        resolvedBy: resolvedBy,
        resolvedDecision: decision,
      })
      .where(and(eq(schema.flowRuns.id, run.id), eq(schema.flowRuns.status, "paused")))
      .returning({ id: schema.flowRuns.id })
  );
  if (updatedRows.length === 0) return { ok: false, reason: "already-resolved" };

  const r = await resumePausedFlow({
    runId: run.id,
    workspaceId: run.workspaceId,
    flowId: run.flowId,
    fromNodeId: run.pausedNodeId ?? "",
    variables: (run.pausedVariables ?? {}) as Record<string, unknown>,
    decision,
    dryRun: isDryRunSource(run.triggerSource),
  });
  return { ok: true, runId: run.id, status: r.status };
}
