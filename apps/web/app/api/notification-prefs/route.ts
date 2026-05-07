import { NextResponse } from "next/server";
import { createId } from "@paralleldrive/cuid2";
import { getDb, schema } from "@orchester/db";
import { and, eq, isNull, or } from "drizzle-orm";
import { getCurrentSession, getCurrentWorkspace } from "@/lib/workspace";

/**
 * Notification preferences API.
 *
 * Modelo:
 *   - Cada `key` (e.g. "conv_escalated") tiene un default global (NOTIFICATION_KEYS),
 *     puede sobreescribirse a nivel workspace (ningún user_id) o por user.
 *   - El resolver final lee user-pref → workspace-pref → default.
 *
 *   GET  /api/notification-prefs                    → todas las prefs effective del caller
 *   PATCH /api/notification-prefs { key, enabled }  → upsert pref del caller (user-level)
 */

/** Catálogo central de keys conocidas. Extender acá cuando agregues una pref nueva. */
const NOTIFICATION_KEYS = {
  conv_escalated: { label: "Conversation escalated", description: "When an agent escalates a conversation", defaultOn: true },
  agent_down: { label: "Agent goes offline", description: "When an active agent becomes unavailable", defaultOn: true },
  weekly_report: { label: "Weekly usage report", description: "Summary of token consumption every Monday", defaultOn: false },
  new_member: { label: "New workspace member", description: "When someone joins your workspace", defaultOn: true },
} as const;

type Key = keyof typeof NOTIFICATION_KEYS;

function isKnownKey(k: string): k is Key {
  return Object.prototype.hasOwnProperty.call(NOTIFICATION_KEYS, k);
}

export async function GET() {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const ws = await getCurrentWorkspace();
  if (!ws) return NextResponse.json({ error: "No workspace" }, { status: 404 });

  const db = getDb();
  // Traemos prefs user-level Y workspace-level en una sola query.
  const rows = await db
    .select()
    .from(schema.notificationPrefs)
    .where(
      and(
        eq(schema.notificationPrefs.workspaceId, ws.workspace.id),
        or(
          eq(schema.notificationPrefs.userId, session.user.id),
          isNull(schema.notificationPrefs.userId)
        )!
      )
    );

  // Resolver: user > workspace > default.
  const userMap = new Map<string, boolean>();
  const wsMap = new Map<string, boolean>();
  for (const r of rows) {
    if (r.userId === session.user.id) userMap.set(r.key, r.enabled);
    else if (r.userId === null) wsMap.set(r.key, r.enabled);
  }

  const prefs = (Object.entries(NOTIFICATION_KEYS) as Array<[Key, (typeof NOTIFICATION_KEYS)[Key]]>).map(
    ([key, meta]) => {
      const userVal = userMap.get(key);
      const wsVal = wsMap.get(key);
      const enabled = userVal ?? wsVal ?? meta.defaultOn;
      const source: "user" | "workspace" | "default" =
        userVal !== undefined ? "user" : wsVal !== undefined ? "workspace" : "default";
      return { key, label: meta.label, description: meta.description, enabled, source };
    }
  );

  return NextResponse.json({ prefs });
}

export async function PATCH(req: Request) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const ws = await getCurrentWorkspace();
  if (!ws) return NextResponse.json({ error: "No workspace" }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as { key?: string; enabled?: boolean };
  if (!body.key || !isKnownKey(body.key)) {
    return NextResponse.json(
      { error: `key required, must be one of: ${Object.keys(NOTIFICATION_KEYS).join(", ")}` },
      { status: 400 }
    );
  }
  if (typeof body.enabled !== "boolean") {
    return NextResponse.json({ error: "enabled (boolean) required" }, { status: 400 });
  }

  const db = getDb();
  const existing = await db
    .select()
    .from(schema.notificationPrefs)
    .where(
      and(
        eq(schema.notificationPrefs.workspaceId, ws.workspace.id),
        eq(schema.notificationPrefs.userId, session.user.id),
        eq(schema.notificationPrefs.key, body.key)
      )
    )
    .limit(1);

  if (existing[0]) {
    await db
      .update(schema.notificationPrefs)
      .set({ enabled: body.enabled, updatedAt: new Date() })
      .where(eq(schema.notificationPrefs.id, existing[0].id));
  } else {
    await db.insert(schema.notificationPrefs).values({
      id: createId(),
      workspaceId: ws.workspace.id,
      userId: session.user.id,
      key: body.key,
      enabled: body.enabled,
    });
  }
  return NextResponse.json({ ok: true });
}
