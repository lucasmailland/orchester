import { NextResponse } from "next/server";
import { getDb, schema } from "@orchester/db";
import { eq, and } from "drizzle-orm";
import { getCurrentWorkspace } from "@/lib/workspace";
import { encrypt } from "@/lib/encryption";
import { telegramSetWebhook, telegramGetMe } from "@/lib/channels/telegram";
import { slackAuthTest } from "@/lib/channels/slack";
import { logAudit } from "@/lib/audit";
import { getCurrentSession } from "@/lib/workspace";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ws = await getCurrentWorkspace();
  if (!ws) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.channels)
    .where(and(eq(schema.channels.id, id), eq(schema.channels.workspaceId, ws.workspace.id)))
    .limit(1);
  const row = rows[0];
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { credentialsEncrypted, ...rest } = row;
  return NextResponse.json({ ...rest, hasCredentials: Boolean(credentialsEncrypted) });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ws = await getCurrentWorkspace();
  if (!ws) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const body = await req.json();
  const db = getDb();

  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (body.name !== undefined) set.name = body.name;
  if (body.status !== undefined) set.status = body.status;
  if (body.agentId !== undefined) set.agentId = body.agentId || null;
  if (body.config !== undefined) set.config = body.config;

  // For credentials: accept plaintext, encrypt and store. For Telegram, also auto-config webhook.
  if (body.credentials !== undefined) {
    const json = JSON.stringify(body.credentials);
    set.credentialsEncrypted = encrypt(json);
  }

  const updated = await db
    .update(schema.channels)
    .set(set)
    .where(and(eq(schema.channels.id, id), eq(schema.channels.workspaceId, ws.workspace.id)))
    .returning();
  const row = updated[0];
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Telegram: auto-register webhook when credentials updated
  if (
    row.type === "telegram" &&
    body.credentials?.botToken &&
    row.secret &&
    process.env["NEXT_PUBLIC_APP_URL"]
  ) {
    try {
      const url = `${process.env["NEXT_PUBLIC_APP_URL"]}/api/channels/telegram/webhook/${row.secret}`;
      const me = await telegramGetMe(body.credentials.botToken);
      if (!me.ok) {
        return NextResponse.json({ ...row, webhookSet: false, error: "Invalid bot token" });
      }
      await telegramSetWebhook(body.credentials.botToken, url);
      const { credentialsEncrypted, ...rest } = row;
      return NextResponse.json({
        ...rest,
        hasCredentials: true,
        webhookSet: true,
        botUsername: me.result?.username,
      });
    } catch (e) {
      const { credentialsEncrypted, ...rest } = row;
      return NextResponse.json({
        ...rest,
        hasCredentials: true,
        webhookSet: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  // Slack: validar credenciales con auth.test cuando se actualizan.
  // No auto-configuramos el Event Subscriptions URL porque eso requiere que el
  // operador lo pegue manualmente en https://api.slack.com/apps/<app>/event-subscriptions.
  if (
    row.type === "slack" &&
    body.credentials?.botToken &&
    body.credentials?.signingSecret
  ) {
    try {
      const me = await slackAuthTest(body.credentials.botToken);
      if (!me.ok) {
        const { credentialsEncrypted, ...rest } = row;
        return NextResponse.json({
          ...rest,
          hasCredentials: true,
          webhookSet: false,
          error: me.error ?? "Invalid Slack bot token",
        });
      }
      const webhookUrl = process.env["NEXT_PUBLIC_APP_URL"]
        ? `${process.env["NEXT_PUBLIC_APP_URL"]}/api/channels/slack/webhook/${row.secret}`
        : null;
      const { credentialsEncrypted, ...rest } = row;
      return NextResponse.json({
        ...rest,
        hasCredentials: true,
        webhookSet: true,
        slackTeam: me.team,
        slackUser: me.user,
        slackBotId: me.bot_id,
        webhookUrl, // el operador la pega en api.slack.com → Event Subscriptions
      });
    } catch (e) {
      const { credentialsEncrypted, ...rest } = row;
      return NextResponse.json({
        ...rest,
        hasCredentials: true,
        webhookSet: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  const { credentialsEncrypted, ...rest } = row;
  return NextResponse.json({ ...rest, hasCredentials: Boolean(credentialsEncrypted) });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ws = await getCurrentWorkspace();
  const session = await getCurrentSession();
  if (!ws || !session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const db = getDb();
  // Snapshot before delete para el audit log.
  const before = (
    await db
      .select({ name: schema.channels.name, type: schema.channels.type })
      .from(schema.channels)
      .where(and(eq(schema.channels.id, id), eq(schema.channels.workspaceId, ws.workspace.id)))
      .limit(1)
  )[0];
  const deleted = await db
    .delete(schema.channels)
    .where(and(eq(schema.channels.id, id), eq(schema.channels.workspaceId, ws.workspace.id)))
    .returning({ id: schema.channels.id });
  if (!deleted[0]) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await logAudit({
    workspaceId: ws.workspace.id,
    userId: session.user.id,
    action: "channel.delete",
    resource: "channel",
    resourceId: id,
    before: before ? { name: before.name, type: before.type } : undefined,
  });
  return NextResponse.json({ ok: true });
}
