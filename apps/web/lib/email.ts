import "server-only";
import { fetchWithTimeout } from "./http-util";

const EMAIL_TIMEOUT_MS = 15_000;

interface SendEmailParams {
  to: string;
  subject: string;
  text: string;
  html?: string;
  from?: string;
}

/**
 * Email sender. Uses Resend if RESEND_API_KEY is set, otherwise no-op
 * (logs to console in dev so the link is visible).
 */
export async function sendEmail(params: SendEmailParams): Promise<void> {
  const apiKey = process.env["RESEND_API_KEY"];
  const from = params.from ?? process.env["EMAIL_FROM"] ?? "Orchester <onboarding@orchester.io>";
  if (!apiKey) {
    // Dev-only: log so the user sees the invite/reset URL in the dev terminal.
    console.log("[email:dev]", { to: params.to, subject: params.subject, text: params.text });
    return;
  }
  const r = await fetchWithTimeout("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [params.to],
      subject: params.subject,
      text: params.text,
      html: params.html,
    }),
  }, EMAIL_TIMEOUT_MS);
  if (!r.ok) {
    throw new Error(`Resend ${r.status}: ${await r.text()}`);
  }
}
