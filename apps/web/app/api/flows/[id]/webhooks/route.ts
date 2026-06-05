import { NextResponse } from "next/server";
import { z } from "zod";
import { createId } from "@paralleldrive/cuid2";
import crypto from "node:crypto";
import { getDb, schema } from "@orchester/db";
import { eq, and, desc, sql } from "drizzle-orm";
import { requireAuth, isAuthContext } from "@/lib/auth-guards";
import { parseBody } from "@/lib/validation";

const createFlowWebhookSchema = z.object({
  hmac: z.boolean().optional(),
});

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuth();
  if (!isAuthContext(ctx)) return ctx;
  const { id } = await params;
  const db = getDb();
  // flow_webhook is FORCE RLS — needs workspace GUC on the connection.
  const rows = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.workspace_id', ${ctx.workspace.id}, true)`);
    await tx.execute(sql`SELECT set_config('app.user_id', ${ctx.user.id}, true)`);
    return tx
      .select()
      .from(schema.flowWebhooks)
      .where(
        and(
          eq(schema.flowWebhooks.flowId, id),
          eq(schema.flowWebhooks.workspaceId, ctx.workspace.id)
        )
      )
      .orderBy(desc(schema.flowWebhooks.createdAt));
  });
  return NextResponse.json(rows);
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuth({ minRole: "editor" });
  if (!isAuthContext(ctx)) return ctx;
  const { id } = await params;
  const parsed = await parseBody(req, createFlowWebhookSchema);
  if (!parsed.ok) return parsed.response;
  const useHmac = Boolean(parsed.data.hmac);
  const db = getDb();
  const row = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.workspace_id', ${ctx.workspace.id}, true)`);
    await tx.execute(sql`SELECT set_config('app.user_id', ${ctx.user.id}, true)`);
    const inserted = await tx
      .insert(schema.flowWebhooks)
      .values({
        id: createId(),
        flowId: id,
        workspaceId: ctx.workspace.id,
        secret: crypto.randomBytes(24).toString("hex"),
        hmacKey: useHmac ? crypto.randomBytes(32).toString("hex") : null,
      })
      .returning();
    return inserted[0];
  });
  if (!row) return NextResponse.json({ error: "Insert failed" }, { status: 500 });
  return NextResponse.json(row, { status: 201 });
}
