import { NextResponse } from "next/server";
import { z } from "zod";
import { schema } from "@orchester/db";
import { eq, and } from "drizzle-orm";
import { requireAction } from "@/lib/auth-guards";
import { parseBody } from "@/lib/validation";
import { checkEmployeeBudget } from "@/lib/employee-budget";
import { dispatchEvent } from "@/lib/webhooks-out";

const updateConversationSchema = z.object({
  status: z.enum(["open", "closed", "escalated"]).optional(),
  tags: z.array(z.string()).optional(),
  csat: z.number().optional(),
  summary: z.string().optional(),
  assignedToUserId: z.string().nullable().optional(),
});

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await requireAction({
    run: async ({ ctx, tx }) => {
      const convs = await tx
        .select()
        .from(schema.conversations)
        .where(
          and(
            eq(schema.conversations.id, id),
            eq(schema.conversations.workspaceId, ctx.workspace.id)
          )
        )
        .limit(1);
      const conv = convs[0];
      if (!conv) return { _err: "Not found", _status: 404 };
      const messages = await tx
        .select()
        .from(schema.messages)
        .where(eq(schema.messages.conversationId, id))
        .orderBy(schema.messages.createdAt);

      // Si la conversation está atada a un employee con budget, exponemos el estado
      // mensual para que la UI del operador muestre cuánto gastó y cuánto le queda.
      // Si no hay employeeId → budget=null y el panel no muestra la sección.
      const budget = conv.employeeId
        ? await checkEmployeeBudget(ctx.workspace.id, conv.employeeId)
        : null;
      return { conversation: conv, messages, budget };
    },
  });
  if (result instanceof Response) return result;
  if ("_err" in result)
    return NextResponse.json({ error: result._err }, { status: result._status as number });
  return NextResponse.json(result);
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = await parseBody(req, updateConversationSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  const result = await requireAction({
    minRole: "editor",
    run: async ({ ctx, tx }) => {
      const set: Record<string, unknown> = {};
      if (body.status !== undefined) set.status = body.status;
      if (body.tags !== undefined) set.tags = body.tags;
      if (body.csat !== undefined) set.csat = body.csat;
      if (body.summary !== undefined) set.summary = body.summary;
      if (body.assignedToUserId !== undefined) set.assignedToUserId = body.assignedToUserId;
      const updated = await tx
        .update(schema.conversations)
        .set(set)
        .where(
          and(
            eq(schema.conversations.id, id),
            eq(schema.conversations.workspaceId, ctx.workspace.id)
          )
        )
        .returning();
      const row = updated[0];
      if (!row) return { _err: "Not found", _status: 404 };
      return { row };
    },
  });
  if (result instanceof Response) return result;
  if ("_err" in result)
    return NextResponse.json({ error: result._err }, { status: result._status as number });
  const { row } = result;
  if (body.status === "closed") {
    void dispatchEvent(row.workspaceId, "conversation.closed", { conversationId: id });
  }
  if (body.csat !== undefined) {
    void dispatchEvent(row.workspaceId, "conversation.csat", {
      conversationId: id,
      csat: body.csat,
    });
  }
  return NextResponse.json(row);
}
