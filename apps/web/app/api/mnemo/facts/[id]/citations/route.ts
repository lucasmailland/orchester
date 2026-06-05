// apps/web/app/api/mnemo/facts/[id]/citations/route.ts
//
// GET /api/mnemo/facts/[id]/citations — return the source messages
// that produced this fact. Reads `mnemo_fact.source_message_ids`
// then JOINs the message table for content + role + createdAt.
//
// Why two queries? `messages` lives outside the mnemo_* table set
// and isn't governed by `app.workspace_id`-keyed RLS; it scopes via
// `conversation_id → conversation.workspace_id`. We do the fact read
// inside `withMnemoTx` (so the fact's workspace is verified by the
// mnemo policies), then constrain the messages lookup by joining the
// conversation table to the same workspace_id. Two reads, both
// tenant-safe, no extra round trips beyond the unavoidable.
//
// RBAC: viewer+.
import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { withMnemoTx } from "@mnemosyne/core";
import { getDb } from "@orchester/db";
import { requireAuth, isAuthContext } from "@/lib/auth-guards";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuth({ minRole: "viewer" });
  if (!isAuthContext(ctx)) return ctx;
  const { id } = await params;

  // 1. Resolve the fact and grab source_message_ids. Inside
  //    withMnemoTx so RLS+FORCE verifies tenant ownership.
  const fact = await withMnemoTx(ctx.workspace.id, async (tx) => {
    const rows = (await tx.execute(sql`
      SELECT id, source_message_ids
      FROM mnemo_fact
      WHERE workspace_id = ${ctx.workspace.id} AND id = ${id}
      LIMIT 1
    `)) as unknown as Array<{ id: string; source_message_ids: string[] }>;
    return rows[0] ?? null;
  });

  if (!fact) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const ids = fact.source_message_ids ?? [];
  if (ids.length === 0) {
    return NextResponse.json({ citations: [] });
  }

  // 2. Fetch messages JOIN'd with conversation to enforce the
  //    tenant boundary. We can't go via withMnemoTx here because
  //    `message` isn't a mnemo_* table — but the JOIN predicate
  //    `c.workspace_id = $1` provides the same scoping guarantee at
  //    the row level: a message belonging to another workspace's
  //    conversation won't be returned.
  const db = getDb();
  const rows = (await db.execute(sql`
    SELECT m.id, m.role, m.content, m.conversation_id, m.created_at
    FROM message m
    INNER JOIN conversation c ON c.id = m.conversation_id
    WHERE c.workspace_id = ${ctx.workspace.id}
      AND m.id = ANY(${sql.param(ids)}::text[])
    ORDER BY m.created_at ASC
  `)) as unknown as Array<{
    id: string;
    role: string;
    content: string;
    conversation_id: string;
    created_at: Date;
  }>;

  return NextResponse.json({
    citations: rows.map((r) => ({
      id: r.id,
      role: r.role,
      content: r.content,
      conversationId: r.conversation_id,
      createdAt: r.created_at,
    })),
  });
}
