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

export type SendEmailResult = { status: "sent" } | { status: "not_configured" };

/**
 * Email sender. Uses Resend if RESEND_API_KEY is set. Without it nothing is
 * sent and the result says so, so callers can tell the user. Throws when the
 * provider rejects the request.
 */
export async function sendEmail(params: SendEmailParams): Promise<SendEmailResult> {
  const apiKey = process.env["RESEND_API_KEY"];
  const from = params.from ?? process.env["EMAIL_FROM"] ?? "Orchester <onboarding@orchester.io>";
  if (!apiKey) {
    if (process.env["NODE_ENV"] === "production") {
      // No recipient, subject or body: the text can carry invite/reset URLs.
      console.warn("[email] RESEND_API_KEY is not set; email not sent");
    } else {
      // Dev-only: log so the user sees the invite/reset URL in the dev terminal.
      console.log("[email:dev]", { to: params.to, subject: params.subject, text: params.text });
    }
    return { status: "not_configured" };
  }
  const r = await fetchWithTimeout(
    "https://api.resend.com/emails",
    {
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
    },
    EMAIL_TIMEOUT_MS
  );
  if (!r.ok) {
    throw new Error(`Resend ${r.status}: ${await r.text()}`);
  }
  return { status: "sent" };
}
