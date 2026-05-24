// apps/web/lib/gdpr/email.ts
//
// Outbound email adapter for GDPR export notifications. Real
// integration ships with Resend / SES in a follow-up; this stub logs
// the intent so the worker pipeline is observable today.
import "server-only";

export async function sendExportReadyEmail(
  toEmail: string,
  signedUrl: string,
  expiresAt: Date
): Promise<void> {
  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify({
      level: "info",
      msg: "gdpr.email.send",
      toEmail,
      signedUrl,
      expiresAt: expiresAt.toISOString(),
    })
  );
}
