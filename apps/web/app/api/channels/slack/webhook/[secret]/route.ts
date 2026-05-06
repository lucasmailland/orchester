import { NextResponse } from "next/server";
import { getDb, schema } from "@orchester/db";
import { eq } from "drizzle-orm";
import { handleInbound } from "@/lib/channels/router";
import {
  decodeSlackCredentials,
  slackSend,
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
export async function POST(
  req: Request,
  { params }: { params: Promise<{ secret: string }> }
) {
  const { secret } = await params;
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.channels)
    .where(eq(schema.channels.secret, secret))
    .limit(1);
  const channel = rows[0];
  if (!channel || channel.type !== "slack" || channel.status !== "active") {
    return NextResponse.json({ ok: false, error: "channel not found" }, { status: 404 });
  }

  const creds = decodeSlackCredentials(channel.credentialsEncrypted);
  if (!creds) {
    return NextResponse.json(
      { ok: false, error: "channel missing credentials" },
      { status: 500 }
    );
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

  try {
    const result = await handleInbound(channel.workspaceId, {
      channelId: channel.id,
      // externalId combina canal+thread para que cada thread sea su propia conversación
      externalId: `${ev.channel}:${ev.thread_ts ?? ev.ts ?? ev.user}`,
      text: ev.text,
      metadata: {
        source: "slack",
        slackUser: ev.user,
        slackChannel: ev.channel,
        threadTs: ev.thread_ts ?? ev.ts,
      },
    });

    if (result.reply) {
      await slackSend(creds.botToken, ev.channel, result.reply, ev.thread_ts ?? ev.ts);
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
