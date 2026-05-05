import { NextResponse } from "next/server";
import { getDb, schema } from "@orchester/db";
import { eq } from "drizzle-orm";
import { handleInbound } from "@/lib/channels/router";
import { decodeTelegramCredentials, telegramSend } from "@/lib/channels/telegram";

/**
 * Public Telegram webhook. Telegram POSTs incoming messages here.
 * URL: /api/channels/telegram/webhook/{secret}
 */
export async function POST(req: Request, { params }: { params: Promise<{ secret: string }> }) {
  const { secret } = await params;
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.channels)
    .where(eq(schema.channels.secret, secret))
    .limit(1);
  const channel = rows[0];
  if (!channel || channel.type !== "telegram" || channel.status !== "active") {
    return NextResponse.json({ ok: false, error: "channel not found" }, { status: 404 });
  }

  const update = await req.json().catch(() => null);
  const message = update?.message;
  const chatId = message?.chat?.id;
  const text = message?.text;
  if (!chatId || !text) {
    // Acknowledge non-message updates so Telegram stops retrying
    return NextResponse.json({ ok: true });
  }

  try {
    const result = await handleInbound(channel.workspaceId, {
      channelId: channel.id,
      externalId: String(chatId),
      text: String(text),
      customerName: message?.from?.first_name ?? undefined,
      metadata: { source: "telegram", chatId, messageId: message?.message_id },
    });

    if (result.reply) {
      const creds = decodeTelegramCredentials(channel.credentialsEncrypted);
      if (creds?.botToken) {
        await telegramSend(creds.botToken, chatId, result.reply);
      }
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
