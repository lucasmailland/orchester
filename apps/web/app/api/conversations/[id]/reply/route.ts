import { NextResponse } from "next/server";
import { z } from "zod";
import { createId } from "@paralleldrive/cuid2";
import { getDb, schema } from "@orchester/db";
import { eq, and } from "drizzle-orm";
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
  const convs = await db
    .select()
    .from(schema.conversations)
    .where(
      and(eq(schema.conversations.id, id), eq(schema.conversations.workspaceId, ctx.workspace.id))
    )
    .limit(1);
  const conv = convs[0];
  if (!conv) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await db.insert(schema.messages).values({
    id: createId(),
    conversationId: conv.id,
    role: "assistant",
    content: text,
    fromOperator: true,
    authorUserId: ctx.user.id,
  });
  await db
    .update(schema.conversations)
    .set({ messageCount: (conv.messageCount ?? 0) + 1 })
    .where(eq(schema.conversations.id, conv.id));

  // Send through outbound adapters
  if (conv.channelId) {
    const chs = await db
      .select()
      .from(schema.channels)
      .where(eq(schema.channels.id, conv.channelId))
      .limit(1);
    const channel = chs[0];
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

  return NextResponse.json({ ok: true });
}
