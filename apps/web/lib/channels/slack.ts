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

/**
 * Slack Block Kit block. Mantenemos el tipo abierto para evitar acoplarnos al
 * SDK; en runtime Slack valida la forma. Las que más usamos:
 *   - { type: "section", text: { type: "mrkdwn", text } }
 *   - { type: "divider" }
 *   - { type: "actions", elements: [{ type: "button", text: ..., action_id }] }
 */
export type SlackBlock = Record<string, unknown>;

export interface SlackSendOptions {
  /** Si se pasan blocks, el `text` se usa como fallback de notificación. */
  blocks?: SlackBlock[];
  threadTs?: string;
  /** "in_channel" (default) o "ephemeral" si la app lo soporta */
  responseType?: "in_channel" | "ephemeral";
}

/**
 * Convierte texto del agente (markdown estándar GitHub-flavored) al subset
 * `mrkdwn` que Slack entiende. Slack acepta:
 *   *bold*  →  *bold*  (Slack usa asterisco solo)
 *   _italic_  →  _italic_
 *   ~strike~  →  ~strike~
 *   `code`  →  `code`
 *   ```block```  →  ```block```
 *   [text](url)  →  <url|text>
 *
 * GH→Slack: `**bold**` → `*bold*`, `[t](u)` → `<u|t>`, headings → bold.
 */
export function markdownToSlackMrkdwn(md: string): string {
  if (!md) return "";
  let s = md;
  // ** GH bold → * Slack bold (preserva *italic* sin pisarlo)
  s = s.replace(/\*\*(.+?)\*\*/g, "*$1*");
  // [text](url) → <url|text>
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "<$2|$1>");
  // Headings (# Title) → *Title*
  s = s.replace(/^#{1,6}\s+(.+)$/gm, "*$1*");
  // Bullets `- ` y `* ` ya los respeta Slack como dashes; no los tocamos
  return s;
}

/** Send a message to a Slack channel/IM via chat.postMessage. */
export async function slackSend(
  botToken: string,
  channelId: string,
  text: string,
  threadTsOrOptions?: string | SlackSendOptions
): Promise<{ ts: string }> {
  if (!text && !(typeof threadTsOrOptions === "object" && threadTsOrOptions.blocks?.length)) {
    return { ts: "" };
  }
  const opts: SlackSendOptions =
    typeof threadTsOrOptions === "string" ? { threadTs: threadTsOrOptions } : threadTsOrOptions ?? {};

  const payload: Record<string, unknown> = {
    channel: channelId,
    text: markdownToSlackMrkdwn(text),
    mrkdwn: true,
  };
  if (opts.threadTs) payload["thread_ts"] = opts.threadTs;
  if (opts.blocks && opts.blocks.length > 0) payload["blocks"] = opts.blocks;

  const r = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      "content-type": "application/json; charset=utf-8",
      Authorization: `Bearer ${botToken}`,
    },
    body: JSON.stringify(payload),
  });
  const j = (await r.json()) as { ok: boolean; ts?: string; error?: string };
  if (!j.ok) {
    throw new Error(`Slack chat.postMessage failed: ${j.error ?? "unknown"}`);
  }
  return { ts: j.ts ?? "" };
}

/**
 * Reaction (emoji reaction) sobre un mensaje específico. Útil para señalar
 * que el agente recibió el mensaje (👀 inmediato), que está pensando (🤔)
 * o que ya respondió (✅).
 *
 * Requiere scope `reactions:write` en la app de Slack.
 */
export async function slackReact(
  botToken: string,
  channelId: string,
  messageTs: string,
  emojiName: string
): Promise<void> {
  const r = await fetch("https://slack.com/api/reactions.add", {
    method: "POST",
    headers: {
      "content-type": "application/json; charset=utf-8",
      Authorization: `Bearer ${botToken}`,
    },
    body: JSON.stringify({ channel: channelId, timestamp: messageTs, name: emojiName }),
  });
  const j = (await r.json()) as { ok: boolean; error?: string };
  // already_reacted no es un error real
  if (!j.ok && j.error !== "already_reacted") {
    throw new Error(`Slack reactions.add failed: ${j.error ?? "unknown"}`);
  }
}

/**
 * "Typing indicator" para apps de Slack AI: usa `assistant.threads.setStatus`.
 * Si la app no tiene scope `assistant:write` (o el workspace no es un AI App
 * habilitado), falla silencioso — la integración sigue andando sin el indicador.
 *
 * Como fallback degradable, podemos llamar `slackReact` con 🤔 al mensaje del
 * usuario para señalar "estoy pensando" — eso funciona con cualquier scope
 * normal.
 *
 * https://docs.slack.dev/messaging/sending-and-scheduling-messages#assistant-statuses
 */
export async function slackSetThinkingStatus(
  botToken: string,
  channelId: string,
  threadTs: string,
  status = "Pensando…"
): Promise<boolean> {
  try {
    const r = await fetch("https://slack.com/api/assistant.threads.setStatus", {
      method: "POST",
      headers: {
        "content-type": "application/json; charset=utf-8",
        Authorization: `Bearer ${botToken}`,
      },
      body: JSON.stringify({
        channel_id: channelId,
        thread_ts: threadTs,
        status,
      }),
    });
    const j = (await r.json()) as { ok: boolean; error?: string };
    return Boolean(j.ok);
  } catch {
    return false;
  }
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
