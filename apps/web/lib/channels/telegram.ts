import "server-only";
import { randomBytes, timingSafeEqual } from "crypto";
import { and, eq } from "drizzle-orm";
import { schema, type DbClient } from "@orchester/db";
import { decrypt, encrypt } from "@/lib/encryption";
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

type WsDb = DbClient | Parameters<Parameters<DbClient["transaction"]>[0]>[0];

export class InvalidTelegramBotTokenError extends Error {
  constructor() {
    super("Invalid bot token");
  }
}

/**
 * Register the webhook with a fresh `secret_token` and store it with the
 * credentials. Returns the secret.
 *
 * `credentials` are the rest of the stored credentials to keep next to the
 * new secret (the PATCH route passes the body, the backfill script the decoded
 * row). The order matters: the secret is saved only **after** Telegram accepted
 * it. If `setWebhook` fails on a transient error and the secret were already in
 * the database, the webhook that is still live would send updates without it
 * and all of them would be rejected, killing a channel that worked.
 */
export async function registerTelegramWebhook(
  row: { id: string; secret: string; workspaceId: string },
  botToken: string,
  tx: WsDb,
  credentials: object = {}
): Promise<{ secret: string; botUsername?: string | undefined }> {
  const registered = await setTelegramWebhookSecret(row, botToken);
  await storeTelegramWebhookSecret(row, botToken, registered.secret, tx, credentials);
  return registered;
}

/** Network half: validate the token and make Telegram use a fresh secret_token. */
export async function setTelegramWebhookSecret(
  row: { secret: string },
  botToken: string
): Promise<{ secret: string; botUsername?: string | undefined }> {
  const appUrl = process.env["NEXT_PUBLIC_APP_URL"];
  if (!appUrl) throw new Error("NEXT_PUBLIC_APP_URL is not set");
  const me = await telegramGetMe(botToken);
  if (!me.ok) throw new InvalidTelegramBotTokenError();
  const secret = newWebhookSecret();
  await telegramSetWebhook(
    botToken,
    `${appUrl}/api/channels/telegram/webhook/${row.secret}`,
    secret
  );
  return { secret, botUsername: me.result?.username };
}

/** Database half: store the secret next to the rest of the credentials. */
export async function storeTelegramWebhookSecret(
  row: { id: string; workspaceId: string },
  botToken: string,
  webhookSecret: string,
  tx: WsDb,
  credentials: object = {}
): Promise<void> {
  await tx
    .update(schema.channels)
    .set({
      credentialsEncrypted: encrypt(JSON.stringify({ ...credentials, botToken, webhookSecret })),
      updatedAt: new Date(),
    })
    .where(and(eq(schema.channels.id, row.id), eq(schema.channels.workspaceId, row.workspaceId)));
}

export type BackfillResult = {
  updated: string[];
  /** Undecodable credentials, no bot token or no URL secret: nothing was attempted. */
  skipped: string[];
  /** `reason` is a code, never an error message (those can carry the token). */
  failed: { id: string; reason: "invalid_token" | "set_webhook_failed" | "write_failed" }[];
};

/**
 * Backfill for channels created before the secret token existed: register one
 * on every active Telegram channel that lacks it.
 *
 * Telegram applies a new secret the moment `setWebhook` returns, so each
 * channel's credential write must commit on its own, right after its own call.
 * One transaction around the whole loop would roll back earlier channels on any
 * later failure while Telegram kept their new secrets, and those channels would
 * then reject every update. The network calls stay outside any transaction.
 * If a write fails after Telegram accepted the secret, the channel is reported
 * as `write_failed` and re-running the script fixes it (it still lacks a secret).
 */
export async function registerMissingTelegramSecrets(
  withTx: <T>(fn: (tx: WsDb) => Promise<T>) => Promise<T>
): Promise<BackfillResult> {
  const rows = await withTx((tx) =>
    tx
      .select()
      .from(schema.channels)
      .where(and(eq(schema.channels.type, "telegram"), eq(schema.channels.status, "active")))
  );
  const result: BackfillResult = { updated: [], skipped: [], failed: [] };
  for (const row of rows) {
    const creds = decodeTelegramCredentials(row.credentialsEncrypted);
    if (creds?.webhookSecret) continue;
    if (!creds?.botToken || !row.secret) {
      result.skipped.push(row.id);
      continue;
    }
    let registered: { secret: string };
    try {
      registered = await setTelegramWebhookSecret({ secret: row.secret }, creds.botToken);
    } catch (e) {
      result.failed.push({
        id: row.id,
        reason: e instanceof InvalidTelegramBotTokenError ? "invalid_token" : "set_webhook_failed",
      });
      continue;
    }
    try {
      await withTx((tx) =>
        storeTelegramWebhookSecret(row, creds.botToken, registered.secret, tx, creds)
      );
      result.updated.push(row.id);
    } catch {
      result.failed.push({ id: row.id, reason: "write_failed" });
    }
  }
  return result;
}
