import "server-only";
import { logWithContext } from "../observability";
import type { PauseNotification } from "./pause";

/**
 * Notifies a person that something is waiting for their decision.
 *
 * Why this exists. A pause nobody sees is as useless as not pausing: the run
 * stops and nobody finds out until someone checks manually. A human gate is
 * only useful if the person knows it is there.
 *
 * Never throws. If Telegram is down, the pause has already been saved in the
 * database and the notification can be resent; letting the error propagate
 * would instead make an intermittent channel fail otherwise healthy runs.
 */
export async function notifyPause(
  workspaceId: string,
  runId: string,
  token: string,
  message: string,
  notification: PauseNotification
): Promise<void> {
  const base = process.env["NEXT_PUBLIC_APP_URL"]?.replace(/\/+$/, "") ?? "";
  const link = base ? `${base}/approve/${token}` : `(falta NEXT_PUBLIC_APP_URL) token ${token}`;

  const [integrationId, action] = notification.integrationId.split("::");
  if (!integrationId || !action) {
    logWithContext("error", "pause notification misconfigured", {
      correlationId: runId,
      runId,
      integrationId: notification.integrationId,
    });
    return;
  }

  // The text is built here rather than in the flow: the link only exists
  // after generating the token, and asking the flow author to interpolate it
  // would require knowing a value that did not exist when they wrote it.
  const text = `${message}\n\nAprobar o rechazar: ${link}`;
  const input = { ...notification.input };
  for (const field of ["text", "message", "content", "body"]) {
    if (field in input) {
      input[field] = typeof input[field] === "string" ? `${input[field]}\n\n${text}` : text;
    }
  }
  // If the flow provided no text field, send something anyway: an empty
  // notification is worse than an ugly one.
  if (!["text", "message", "content", "body"].some((c) => c in input)) input["text"] = text;

  try {
    const { runIntegrationAction } = await import("../integrations/store");
    await runIntegrationAction(workspaceId, integrationId, action, input);
    logWithContext("info", "pause notification sent", {
      correlationId: runId,
      runId,
      integrationId: notification.integrationId,
    });
  } catch (e) {
    logWithContext("error", "failed to send pause notification", {
      correlationId: runId,
      runId,
      integrationId: notification.integrationId,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}
