import { NextResponse } from "next/server";
import { z } from "zod";
import { createId } from "@paralleldrive/cuid2";
import { getDb, schema } from "@orchester/db";
import { eq, and, sql } from "drizzle-orm";
import { requireAuth, isAuthContext } from "@/lib/auth-guards";
import { parseBody } from "@/lib/validation";
import { decodeTelegramCredentials, telegramSend } from "@/lib/channels/telegram";
import { decodeSlackCredentials, slackSend } from "@/lib/channels/slack";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { safeLogError } from "@/lib/safe-log";

const replySchema = z.object({
  text: z.string().optional(),
});

/**
 * POST /api/conversations/[id]/reply
 * Body: { text: string }
 * Manual operator reply. Persists message + sends through the channel
 * if it's a real outbound channel (Telegram). For widget the customer's
 * page polls the conversation transcript via the public messages API.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuth({ minRole: "editor" });
  if (!isAuthContext(ctx)) return ctx;

  const limited = await enforceRateLimit(
    `reply:${ctx.workspace.id}:${ctx.user.id}`,
    RATE_LIMITS.MUTATION
  );
  if (limited) return limited;

  const { id } = await params;
  const parsed = await parseBody(req, replySchema);
  if (!parsed.ok) return parsed.response;
  const text = String(parsed.data.text ?? "").trim();
  if (!text) return NextResponse.json({ error: "text required" }, { status: 400 });

  const db = getDb();
  // Wrap every tenant-scoped read/write in a single tx with the
  // workspace GUC set. conversation / message / channel are all RLS-
  // forced; without the GUC the conversation lookup returns empty.
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.workspace_id', ${ctx.workspace.id}, true)`);
    await tx.execute(sql`SELECT set_config('app.user_id', ${ctx.user.id}, true)`);
    const convs = await tx
      .select()
      .from(schema.conversations)
      .where(
        and(eq(schema.conversations.id, id), eq(schema.conversations.workspaceId, ctx.workspace.id))
      )
      .limit(1);
    const conv = convs[0];
    if (!conv) return { kind: "not_found" as const };

    const msgId = createId();
    await tx.insert(schema.messages).values({
      id: msgId,
      conversationId: conv.id,
      role: "assistant",
      content: text,
      fromOperator: true,
      authorUserId: ctx.user.id,
    });
    await tx
      .update(schema.conversations)
      .set({ messageCount: (conv.messageCount ?? 0) + 1 })
      .where(eq(schema.conversations.id, conv.id));

    let channel: typeof schema.channels.$inferSelect | undefined;
    if (conv.channelId) {
      const chs = await tx
        .select()
        .from(schema.channels)
        .where(eq(schema.channels.id, conv.channelId))
        .limit(1);
      channel = chs[0];
    }
    return { kind: "ok" as const, conv, channel, msgId };
  });

  if (result.kind === "not_found") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const { conv, channel } = result;

  // Send through outbound adapters (outside the tx — network calls
  // shouldn't hold a DB connection / transaction open).
  if (conv.channelId) {
    // Note: we already loaded `channel` inside the tx above; the
    // legacy code path expected a fresh lookup but we reuse it here.
    if (channel?.type === "telegram" && conv.externalId) {
      const creds = decodeTelegramCredentials(channel.credentialsEncrypted);
      if (creds?.botToken) {
        try {
          await telegramSend(creds.botToken, conv.externalId, text);
        } catch (e) {
          safeLogError("Telegram send failed:", e);
        }
      }
    } else if (channel?.type === "slack" && conv.externalId) {
      // externalId = "<slackChannel>:<threadTs>" — split para mandar al thread
      const creds = decodeSlackCredentials(channel.credentialsEncrypted);
      if (creds?.botToken) {
        const [slackChannel, threadTs] = conv.externalId.split(":");
        try {
          if (slackChannel) {
            await slackSend(creds.botToken, slackChannel, text, threadTs);
          }
        } catch (e) {
          safeLogError("Slack send failed:", e);
        }
      }
    }
  }

  return NextResponse.json({
    ok: true,
    message: {
      id: result.msgId,
      role: "assistant",
      content: text,
      fromOperator: true,
      createdAt: new Date().toISOString(),
      costUsd: null,
      tokensUsed: null,
      model: null,
    },
  });
}
