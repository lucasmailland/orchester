import { NextResponse } from "next/server";
import { schema } from "@orchester/db";
import { eq } from "drizzle-orm";
import { handleInbound } from "@/lib/channels/router";
import { withCrossTenantAdmin } from "@/lib/tenant/cron";
import {
  decodeSlackCredentials,
  slackSend,
  slackReact,
  slackSetThinkingStatus,
  verifySlackSignature,
  type SlackEventEnvelope,
} from "@/lib/channels/slack";

/**
 * Public Slack webhook. Configurar en la app de Slack:
 *   Event Subscriptions → Request URL = https://tu-dominio.com/api/channels/slack/webhook/{secret}
 *
 * El `{secret}` lo genera Orchester al crear el canal y vive en `channel.secret`.
 * Slack además firma cada request — verificamos con `signing_secret`.
 *
 * Eventos procesados: `message.im` (DM al bot) y `app_mention` (@bot en canal).
 * Los `bot_message` se ignoran para evitar loops.
 */
export async function POST(req: Request, { params }: { params: Promise<{ secret: string }> }) {
  const { secret } = await params;
  // Channel lookup by webhook secret. The Slack URL embeds the
  // secret as the only routing key — the workspace isn't known
  // until the row resolves. Cross-tenant bypass (audit-logged).
  const channel = await withCrossTenantAdmin("slack.webhook.channel_lookup", async (tx) => {
    const rows = await tx
      .select()
      .from(schema.channels)
      .where(eq(schema.channels.secret, secret))
      .limit(1);
    return rows[0];
  });
  if (!channel || channel.type !== "slack" || channel.status !== "active") {
    return NextResponse.json({ ok: false, error: "channel not found" }, { status: 404 });
  }

  const creds = decodeSlackCredentials(channel.credentialsEncrypted);
  if (!creds) {
    return NextResponse.json({ ok: false, error: "channel missing credentials" }, { status: 500 });
  }

  // Slack firma usando el rawBody, no el JSON parseado.
  const rawBody = await req.text();
  const ok = verifySlackSignature({
    signingSecret: creds.signingSecret,
    timestampHeader: req.headers.get("x-slack-request-timestamp"),
    signatureHeader: req.headers.get("x-slack-signature"),
    rawBody,
  });
  if (!ok) {
    return NextResponse.json({ ok: false, error: "invalid signature" }, { status: 401 });
  }

  let envelope: SlackEventEnvelope;
  try {
    envelope = JSON.parse(rawBody) as SlackEventEnvelope;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }

  // Slack pide un challenge response al configurar el endpoint
  if (envelope.type === "url_verification") {
    return NextResponse.json({ challenge: envelope.challenge });
  }

  if (envelope.type !== "event_callback" || !envelope.event) {
    return NextResponse.json({ ok: true });
  }

  const ev = envelope.event;
  // Anti-loop: ignorá mensajes propios y subtypes "bot_message"
  if (ev.bot_id || ev.subtype === "bot_message") {
    return NextResponse.json({ ok: true });
  }
  // Sólo procesamos message en DM o menciones explícitas
  if (ev.type !== "message" && ev.type !== "app_mention") {
    return NextResponse.json({ ok: true });
  }
  if (!ev.text || !ev.channel || !ev.user) {
    return NextResponse.json({ ok: true });
  }

  // UX: feedback inmediato al usuario antes de invocar el LLM (puede tardar
  // segundos). 1) reacción 👀 al mensaje original. 2) status "Pensando…" en el
  // thread (si el workspace es Slack AI app). Ambos son best-effort.
  const slackChannel = ev.channel;
  const replyThreadTs = ev.thread_ts ?? ev.ts;
  const ackPromise = (async () => {
    const tasks: Array<Promise<unknown>> = [];
    if (ev.ts) {
      tasks.push(slackReact(creds.botToken, slackChannel, ev.ts, "eyes").catch(() => undefined));
    }
    if (replyThreadTs) {
      tasks.push(slackSetThinkingStatus(creds.botToken, slackChannel, replyThreadTs));
    }
    await Promise.all(tasks);
  })();

  try {
    const result = await handleInbound(channel.workspaceId, {
      channelId: channel.id,
      // externalId combina canal+thread para que cada thread sea su propia conversación
      externalId: `${slackChannel}:${replyThreadTs ?? ev.user}`,
      text: ev.text,
      metadata: {
        source: "slack",
        slackUser: ev.user,
        slackChannel,
        threadTs: replyThreadTs,
      },
    });

    // Esperá que el ack haya llegado a Slack antes de mandar la respuesta —
    // así el orden visible es: msg-user → 👀 → "pensando…" → respuesta.
    await ackPromise;

    if (result.reply) {
      await slackSend(creds.botToken, slackChannel, result.reply, replyThreadTs);
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    await ackPromise.catch(() => undefined);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
