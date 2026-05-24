// apps/web/lib/gdpr/email.ts
//
// Outbound email adapter for GDPR export notifications.
//
// Production deployments set `RESEND_API_KEY` and we send via Resend.
// When the key is missing — dev, self-host without SMTP, CI — we log
// the intent as structured JSON so the worker pipeline stays
// observable without raising. Same when the optional `resend` dep
// can't be resolved (offline / partial install).
//
// The "from" address falls back to a sane default so existing dev envs
// don't need to set it. Override with `RESEND_FROM` to brand the
// notification per tenant later (currently single-app deploy).
import "server-only";

const SIGNED_URL_TTL_DAYS = 7;

/**
 * Result envelope. `ok=true` means the email landed at Resend (or the
 * stub-log path ran because RESEND_API_KEY is unset / resend dep is
 * missing — both are intentional dev/self-host paths and treated as
 * success). `ok=false` carries the human-readable provider message in
 * `error` so the caller can persist it on the job row.
 */
export interface SendEmailResult {
  ok: boolean;
  error?: string;
}

/**
 * Notify the export requester that their archive is ready.
 *
 * Never throws on Resend failures — the export job has already produced
 * a downloadable artefact by the time we get here, and we don't want to
 * flip the whole job to "failed" because the email provider hiccuped.
 * Instead we return `{ ok: false, error }` so the worker can persist
 * the failure on the job row (`error` column) while leaving the
 * download link reachable.
 */
export async function sendExportReadyEmail(
  toEmail: string,
  signedUrl: string,
  expiresAt: Date
): Promise<SendEmailResult> {
  const apiKey = process.env["RESEND_API_KEY"];
  if (!apiKey) {
    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify({
        level: "info",
        msg: "gdpr.email.stub",
        toEmail,
        signedUrl,
        expiresAt: expiresAt.toISOString(),
      })
    );
    // Stub path is an intentional dev/self-host mode, not a failure.
    return { ok: true };
  }

  // Dynamic import + catch so a missing `resend` package degrades to
  // the stub-log path rather than crashing the worker. The build
  // doesn't require the dep at compile time, which keeps `pnpm i`
  // optional for self-host bring-up.
  const mod = await import("resend").catch(() => null as { Resend?: unknown } | null);
  const Resend = (mod as { Resend?: new (k: string) => unknown } | null)?.Resend;
  if (!Resend) {
    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify({
        level: "warn",
        msg: "gdpr.email.resend_missing",
        toEmail,
      })
    );
    // Missing optional dep is a deploy-shape choice, not a failure.
    return { ok: true };
  }

  const from = process.env["RESEND_FROM"] ?? "Orchester <no-reply@orchester.app>";
  const subject = "Your Orchester data export is ready";
  const html = `
    <p>Your workspace export is ready to download.</p>
    <p><a href="${escapeAttr(signedUrl)}">Download (expires ${escapeText(
      expiresAt.toUTCString()
    )})</a></p>
    <p>The link expires in ${SIGNED_URL_TTL_DAYS} days. If you didn't request this export, contact security@orchester.app.</p>
  `.trim();

  try {
    const resend = new (Resend as new (k: string) => {
      emails: { send: (args: Record<string, unknown>) => Promise<unknown> };
    })(apiKey);
    await resend.emails.send({ from, to: toEmail, subject, html });
    return { ok: true };
  } catch (err) {
    // Don't bubble — the artefact is uploaded already, the user can
    // still recover via the GET endpoint that lists their jobs. We do
    // surface the message back to the caller so it can be persisted on
    // the job row alongside the (still-valid) download URL.
    const { safeLogError } = await import("../safe-log");
    safeLogError("[gdpr.email] resend send failed:", err);
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
}

/**
 * Minimal HTML escaping for attribute values. Resend renders the
 * `html` field as-is, so we MUST defend against the signedUrl
 * containing characters that would break the `href=""` boundary or
 * inject markup.
 */
function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function escapeText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
