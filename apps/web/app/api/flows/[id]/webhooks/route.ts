import { NextResponse } from "next/server";
import { z } from "zod";
import { createId } from "@paralleldrive/cuid2";
import crypto from "node:crypto";
import { getDb, schema } from "@orchester/db";
import { eq, and, desc } from "drizzle-orm";
import { getCurrentWorkspace } from "@/lib/workspace";
import { requireAuth, isAuthContext } from "@/lib/auth-guards";
import { parseBody } from "@/lib/validation";

const createFlowWebhookSchema = z.object({
  hmac: z.boolean().optional(),
});

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ws = await getCurrentWorkspace();
  if (!ws) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.flowWebhooks)
    .where(
      and(
        eq(schema.flowWebhooks.flowId, id),
        eq(schema.flowWebhooks.workspaceId, ws.workspace.id)
      )
    )
    .orderBy(desc(schema.flowWebhooks.createdAt));
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
  const inserted = await db
    .insert(schema.flowWebhooks)
    .values({
      id: createId(),
      flowId: id,
      workspaceId: ctx.workspace.id,
      secret: crypto.randomBytes(24).toString("hex"),
      hmacKey: useHmac ? crypto.randomBytes(32).toString("hex") : null,
    })
    .returning();
  const row = inserted[0];
  if (!row) return NextResponse.json({ error: "Insert failed" }, { status: 500 });
  return NextResponse.json(row, { status: 201 });
}
