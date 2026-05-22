import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb, schema } from "@orchester/db";
import { eq, and } from "drizzle-orm";
import { getCurrentWorkspace } from "@/lib/workspace";
import { requireAuth, isAuthContext } from "@/lib/auth-guards";
import { parseBody } from "@/lib/validation";
import { checkEmployeeBudget } from "@/lib/employee-budget";

const updateConversationSchema = z.object({
  status: z.enum(["open", "closed", "escalated"]).optional(),
  tags: z.array(z.string()).optional(),
  csat: z.number().optional(),
  summary: z.string().optional(),
  assignedToUserId: z.string().nullable().optional(),
});

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ws = await getCurrentWorkspace();
  if (!ws) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const db = getDb();
  const convs = await db
    .select()
    .from(schema.conversations)
    .where(
      and(eq(schema.conversations.id, id), eq(schema.conversations.workspaceId, ws.workspace.id))
    )
    .limit(1);
  const conv = convs[0];
  if (!conv) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const messages = await db
    .select()
    .from(schema.messages)
    .where(eq(schema.messages.conversationId, id))
    .orderBy(schema.messages.createdAt);

  // Si la conversation está atada a un employee con budget, exponemos el estado
  // mensual para que la UI del operador muestre cuánto gastó y cuánto le queda.
  // Si no hay employeeId → budget=null y el panel no muestra la sección.
  const budget = conv.employeeId ? await checkEmployeeBudget(ws.workspace.id, conv.employeeId) : null;
  return NextResponse.json({ conversation: conv, messages, budget });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuth({ minRole: "editor" });
  if (!isAuthContext(ctx)) return ctx;
  const { id } = await params;
  const parsed = await parseBody(req, updateConversationSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;
  const db = getDb();
  const set: Record<string, unknown> = {};
  if (body.status !== undefined) set.status = body.status;
  if (body.tags !== undefined) set.tags = body.tags;
  if (body.csat !== undefined) set.csat = body.csat;
  if (body.summary !== undefined) set.summary = body.summary;
  if (body.assignedToUserId !== undefined) set.assignedToUserId = body.assignedToUserId;
  const updated = await db
    .update(schema.conversations)
    .set(set)
    .where(
      and(eq(schema.conversations.id, id), eq(schema.conversations.workspaceId, ctx.workspace.id))
    )
    .returning();
  const row = updated[0];
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(row);
}
