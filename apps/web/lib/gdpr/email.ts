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
 * Notify the export requester that their archive is ready.
 *
 * No throw on email failure — the export job itself has already
 * succeeded by the time we get here, and we don't want to flip the
 * job to "failed" because Resend had a hiccup. The signed URL is
 * persisted on the job row regardless, so the UI can recover by
 * showing the link.
 */
export async function sendExportReadyEmail(
  toEmail: string,
  signedUrl: string,
  expiresAt: Date
): Promise<void> {
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
    return;
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
    return;
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
  } catch (err) {
    // Don't bubble — the artefact is uploaded already, the user can
    // still recover via the GET endpoint that lists their jobs.
    const { safeLogError } = await import("../safe-log");
    safeLogError("[gdpr.email] resend send failed:", err);
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
