import "server-only";
import { randomBytes, timingSafeEqual } from "crypto";
import { decrypt } from "@/lib/encryption";
import { fetchWithTimeout } from "@/lib/http-util";

const TELEGRAM_TIMEOUT_MS = 15_000;

export interface TelegramCredentials {
  botToken: string;
  /**
   * Shared secret Telegram echoes back in the
   * `X-Telegram-Bot-Api-Secret-Token` header of every update.
   *
   * Optional because channels registered before this existed do not have one.
   * It lives in the encrypted credentials and **not** in `channel.secret`: the
   * URL secret is already in the path, so demanding it back in a header proves
   * nothing — whoever knows the URL can set the header too. Two different
   * values is the whole point.
   */
  webhookSecret?: string;
}

/**
 * A fresh webhook secret. Hex, because Telegram only accepts
 * `A-Z a-z 0-9 _ -` in `secret_token`.
 */
export function newWebhookSecret(): string {
  return randomBytes(24).toString("hex");
}

/**
 * Three outcomes, not a boolean, on purpose.
 *
 * A boolean would have to return `true` for "this channel has no secret
 * configured", and a caller reading `true` as "verified" is how an unguarded
 * channel starts looking guarded. The caller has to name the third case to
 * handle it.
 */
export type WebhookSecretCheck = "ok" | "mismatch" | "unconfigured";

export function checkWebhookSecret(
  expected: string | undefined,
  header: string | null
): WebhookSecretCheck {
  if (!expected) return "unconfigured";
  if (!header) return "mismatch";
  const a = Buffer.from(header, "utf8");
  const b = Buffer.from(expected, "utf8");
  // timingSafeEqual throws on differing lengths, and the throw-vs-no-throw path
  // leaks the length by itself, so the length check comes first.
  if (a.length !== b.length) return "mismatch";
  return timingSafeEqual(a, b) ? "ok" : "mismatch";
}

export function decodeTelegramCredentials(encrypted: string | null): TelegramCredentials | null {
  if (!encrypted) return null;
  try {
    const json = decrypt(encrypted);
    return JSON.parse(json) as TelegramCredentials;
  } catch {
    return null;
  }
}

/** Send a message to a Telegram chat. */
export async function telegramSend(
  botToken: string,
  chatId: string | number,
  text: string
): Promise<void> {
  if (!text) return;
  const r = await fetchWithTimeout(
    `https://api.telegram.org/bot${botToken}/sendMessage`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "Markdown" }),
    },
    TELEGRAM_TIMEOUT_MS
  );
  if (!r.ok) {
    const err = await r.text().catch(() => "");
    throw new Error(`Telegram sendMessage ${r.status}: ${err}`);
  }
}

/**
 * Configure the Telegram webhook for a bot.
 *
 * `secretToken` is what Telegram will send back in
 * `X-Telegram-Bot-Api-Secret-Token`. Until this existed, the only thing
 * authenticating an inbound update was the secret in the URL — and a URL leaks
 * into places a header does not: proxy logs, browser history, a screenshot of
 * the channel settings.
 */
export async function telegramSetWebhook(
  botToken: string,
  webhookUrl: string,
  secretToken?: string
): Promise<void> {
  const r = await fetchWithTimeout(
    `https://api.telegram.org/bot${botToken}/setWebhook`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        url: webhookUrl,
        allowed_updates: ["message"],
        ...(secretToken ? { secret_token: secretToken } : {}),
      }),
    },
    TELEGRAM_TIMEOUT_MS
  );
  if (!r.ok) {
    throw new Error(`setWebhook ${r.status}: ${await r.text()}`);
  }
}

export async function telegramGetMe(
  botToken: string
): Promise<{ ok: boolean; result?: { username?: string; id?: number } }> {
  const r = await fetchWithTimeout(
    `https://api.telegram.org/bot${botToken}/getMe`,
    undefined,
    TELEGRAM_TIMEOUT_MS
  );
  return r.json();
}
