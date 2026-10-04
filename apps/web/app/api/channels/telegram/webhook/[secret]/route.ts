import { isSenderAllowed } from "@/lib/channels/allowlist";
import { NextResponse } from "next/server";
import { schema } from "@orchester/db";
import { eq } from "drizzle-orm";
import { handleInbound } from "@/lib/channels/router";
import { withCrossTenantAdmin } from "@/lib/tenant/cron";
import {
  checkWebhookSecret,
  decodeTelegramCredentials,
  telegramSend,
} from "@/lib/channels/telegram";
import { logWithContext } from "@/lib/observability";

/**
 * Public Telegram webhook. Telegram POSTs incoming messages here.
 * URL: /api/channels/telegram/webhook/{secret}
 */
export async function POST(req: Request, { params }: { params: Promise<{ secret: string }> }) {
  const { secret } = await params;
  // Channel lookup by webhook secret — secret IS the auth here.
  // The URL has no workspace context, so this lookup uses the
  // cross-tenant bypass (audit-logged).
  const channel = await withCrossTenantAdmin("telegram.webhook.channel_lookup", async (tx) => {
    const rows = await tx
      .select()
      .from(schema.channels)
      .where(eq(schema.channels.secret, secret))
      .limit(1);
    return rows[0];
  });
  if (!channel || channel.type !== "telegram" || channel.status !== "active") {
    return NextResponse.json({ ok: false, error: "channel not found" }, { status: 404 });
  }

  // Is this really Telegram? The URL secret alone cannot answer that: a URL
  // leaks into proxy logs, browser history and screenshots, and anyone holding
  // it can post whatever they like straight to the agent. Telegram echoes back
  // the `secret_token` we registered, which a leaked URL does not carry.
  const creds = decodeTelegramCredentials(channel.credentialsEncrypted);
  const check = checkWebhookSecret(
    creds?.webhookSecret,
    req.headers.get("x-telegram-bot-api-secret-token")
  );
  if (check === "mismatch") {
    return NextResponse.json({ ok: false, error: "channel not found" }, { status: 404 });
  }
  if (check === "unconfigured") {
    // The channel predates the check. It keeps working —breaking every existing
    // Telegram channel is worse— but it is not silent: re-saving the bot token
    // registers a secret and closes this.
    logWithContext("warn", "telegram webhook without a secret token", {
      correlationId: channel.id,
      channelId: channel.id,
      workspaceId: channel.workspaceId,
    });
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
    if (
      !isSenderAllowed(channel.config, {
        id: String(chatId),
        username: message?.from?.username,
      })
    ) {
      if (creds?.botToken) {
        await telegramSend(creds.botToken, chatId, `You do not have access. Your ID: ${chatId}.`);
      }
      return NextResponse.json({ ok: true });
    }

    const result = await handleInbound(channel.workspaceId, {
      channelId: channel.id,
      externalId: String(chatId),
      text: String(text),
      customerName: message?.from?.first_name ?? undefined,
      metadata: { source: "telegram", chatId, messageId: message?.message_id },
    });

    if (result.reply) {
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
