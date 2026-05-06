import "server-only";
import crypto from "node:crypto";
import { decrypt } from "@/lib/encryption";

/**
 * Slack channel adapter — bot users via Slack Web API.
 *
 * Setup que hace el operador:
 *   1. Crear una Slack App en https://api.slack.com/apps
 *   2. OAuth scopes mínimos: `chat:write`, `app_mentions:read`, `channels:history`,
 *      `im:history`, `im:read`, `im:write`
 *   3. Event Subscriptions → request URL = https://tu-dominio.com/api/channels/slack/webhook?channelId=<id>
 *      eventos: `message.im`, `app_mention`
 *   4. Install to workspace → copiar el "Bot User OAuth Token" (xoxb-...)
 *   5. Settings → Basic Information → "Signing Secret" para validar requests
 *   6. Pegar bot token + signing secret en Orchester /channels (form Slack)
 */

export interface SlackCredentials {
  /** Bot User OAuth Token, format `xoxb-...` */
  botToken: string;
  /** Signing secret de la app para verificar requests */
  signingSecret: string;
}

export function decodeSlackCredentials(encrypted: string | null): SlackCredentials | null {
  if (!encrypted) return null;
  try {
    const json = decrypt(encrypted);
    const parsed = JSON.parse(json) as Partial<SlackCredentials>;
    if (!parsed.botToken || !parsed.signingSecret) return null;
    return { botToken: parsed.botToken, signingSecret: parsed.signingSecret };
  } catch {
    return null;
  }
}

/**
 * Verifica la firma `x-slack-signature` con HMAC SHA256.
 * Slack docs: https://api.slack.com/authentication/verifying-requests-from-slack
 *
 * NOTA: el rawBody DEBE ser exactamente lo recibido, sin parsear, porque
 * cualquier reordenamiento de claves rompe el HMAC.
 */
export function verifySlackSignature(params: {
  signingSecret: string;
  timestampHeader: string | null;
  signatureHeader: string | null;
  rawBody: string;
  /** Tolerancia de tiempo en segundos contra replay attacks. Default 5 min. */
  toleranceSeconds?: number;
}): boolean {
  const { signingSecret, timestampHeader, signatureHeader, rawBody } = params;
  if (!timestampHeader || !signatureHeader) return false;
  const tolerance = params.toleranceSeconds ?? 300;
  const ts = Number(timestampHeader);
  if (!Number.isFinite(ts)) return false;
  if (Math.abs(Math.floor(Date.now() / 1000) - ts) > tolerance) return false;

  const baseString = `v0:${timestampHeader}:${rawBody}`;
  const expected =
    "v0=" + crypto.createHmac("sha256", signingSecret).update(baseString).digest("hex");

  // timingSafeEqual requiere mismo length
  if (expected.length !== signatureHeader.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signatureHeader));
  } catch {
    return false;
  }
}

/** Send a message to a Slack channel/IM via chat.postMessage. */
export async function slackSend(
  botToken: string,
  channelId: string,
  text: string,
  threadTs?: string
): Promise<{ ts: string }> {
  if (!text) return { ts: "" };
  const r = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      "content-type": "application/json; charset=utf-8",
      Authorization: `Bearer ${botToken}`,
    },
    body: JSON.stringify({
      channel: channelId,
      text,
      thread_ts: threadTs,
    }),
  });
  const j = (await r.json()) as { ok: boolean; ts?: string; error?: string };
  if (!j.ok) {
    throw new Error(`Slack chat.postMessage failed: ${j.error ?? "unknown"}`);
  }
  return { ts: j.ts ?? "" };
}

/** Test que el bot token funcione (auth.test). */
export async function slackAuthTest(
  botToken: string
): Promise<{ ok: boolean; team?: string; user?: string; bot_id?: string; error?: string }> {
  const r = await fetch("https://slack.com/api/auth.test", {
    headers: { Authorization: `Bearer ${botToken}` },
  });
  return (await r.json()) as { ok: boolean; team?: string; user?: string; bot_id?: string; error?: string };
}

/**
 * Tipo de evento que Slack manda en el webhook.
 * Sólo nos interesan estos campos para el routing inbound.
 */
export interface SlackEventEnvelope {
  type: "url_verification" | "event_callback";
  /** Solo `url_verification` */
  challenge?: string;
  /** Solo `event_callback` */
  event?: {
    type: "message" | "app_mention";
    subtype?: string; // "bot_message" para evitar loops
    bot_id?: string;
    user?: string;
    text?: string;
    channel?: string;
    ts?: string;
    thread_ts?: string;
  };
}
