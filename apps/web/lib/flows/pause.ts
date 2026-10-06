import { createId } from "@paralleldrive/cuid2";

/**
 * Signals that a run reached a `wait_human` and must wait for a person.
 *
 * Why an exception rather than a return value. Node traversal (`runFromNode`)
 * is **recursive**: the flow's position lives on the JavaScript stack, not in
 * a counter. Returning "pause" would require each recursion level to propagate
 * it manually, and forgetting just one would let the flow continue — exactly
 * the bug we are fixing. Throwing unwinds the stack automatically and cannot
 * be forgotten.
 *
 * This follows the same path as `AbortError`, which the engine already handles
 * separately to classify a run as `cancelled` rather than `failed`.
 */
export class PauseRequested extends Error {
  readonly nodeId: string;
  readonly approvalMessage: string;
  readonly notification: PauseNotification | undefined;

  constructor(nodeId: string, approvalMessage: string, notification?: PauseNotification) {
    super(`wait_human: ${approvalMessage}`);
    this.name = "PauseRequested";
    this.nodeId = nodeId;
    this.approvalMessage = approvalMessage;
    this.notification = notification;
  }
}

/**
 * Who to notify that something is waiting. A pause nobody sees is as useless
 * as not pausing: the run stops and nobody finds out until someone checks
 * manually.
 */
export interface PauseNotification {
  /** `telegram::send_message`, `discord::send_message`, … */
  integrationId: string;
  /**
   * Destination config, in the format expected by that integration.
   */
  input: Record<string, unknown>;
}

/**
 * Separates the workspace from the secret. Does not occur in a cuid2 (alphanumeric).
 */
const SEPARATOR = ".";

/**
 * The secret carried in the approval link.
 *
 * Without it, approval would depend on guessing a `runId` — and the other side
 * of that decision could be a production merge. It is single-use: resolving
 * the pause clears it, so a link forwarded by email cannot be used twice.
 *
 * **Why the workspace comes first.** The approver has no session: the token is
 * all they bring. But finding the run requires querying `flow_run`, and with
 * FORCE RLS a query without `app.workspace_id` returns no rows — the first
 * version stored an opaque token and queried with a bare `getDb()`, so EVERY
 * approval on a deployment with RLS enabled would have answered "this link is
 * invalid", without an error or a trace. With the workspace first, the route
 * establishes context before touching the database.
 *
 * The workspace is not the permission: the lookup still compares the entire
 * token, so knowing a workspaceId — present in any application URL — gets
 * nobody closer to guessing the secret's two cuid2 values.
 */
export function createApprovalToken(workspaceId: string): string {
  return `apr_${workspaceId}${SEPARATOR}${createId()}${createId()}`;
}

/**
 * Which workspace this token belongs to, so the database can be queried with context.
 *
 * Returns `undefined` if the token does not have the expected shape — a link
 * truncated by an email client, or a fabricated one. The caller treats this
 * like "does not exist": it never queries without a workspace.
 */
export function workspaceFromApprovalToken(token: string): string | undefined {
  if (!token.startsWith("apr_")) return undefined;
  const separatorIndex = token.indexOf(SEPARATOR);
  if (separatorIndex <= "apr_".length) return undefined;
  const ws = token.slice("apr_".length, separatorIndex);
  // A secret without a workspace, or a workspace without a secret, is unusable.
  return ws && token.length > separatorIndex + 1 ? ws : undefined;
}

/**
 * The only two responses the engine understands.
 */
export type ApprovalDecision = "aprobado" | "rechazado";

export function isApprovalDecision(v: unknown): v is ApprovalDecision {
  return v === "aprobado" || v === "rechazado";
}
