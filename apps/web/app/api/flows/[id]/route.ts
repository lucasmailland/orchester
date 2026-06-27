import { NextResponse } from "next/server";
import { z } from "zod";
import { schema } from "@orchester/db";
import { eq, and } from "drizzle-orm";
import { requireAction } from "@/lib/auth-guards";
import { parseBody } from "@/lib/validation";
import { logAudit } from "@/lib/audit";

const updateFlowSchema = z.object({
  name: z.string().optional(),
  description: z.string().nullable().optional(),
  status: z.enum(["draft", "active", "paused"]).optional(),
  trigger: z.enum(["manual", "webhook", "schedule", "conversation"]).optional(),
  // Configs y grafo del flujo son JSON dinámico: no los sobre-restringimos.
  triggerConfig: z.record(z.string(), z.unknown()).optional(),
  nodes: z.array(z.record(z.string(), z.unknown())).optional(),
  edges: z.array(z.record(z.string(), z.unknown())).optional(),
  variables: z.record(z.string(), z.unknown()).optional(),
  enabled: z.boolean().optional(),
});

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await requireAction({
    run: async ({ ctx, tx }) => {
      const rows = await tx
        .select()
        .from(schema.flows)
        .where(and(eq(schema.flows.id, id), eq(schema.flows.workspaceId, ctx.workspace.id)))
        .limit(1);
      const row = rows[0];
      if (!row) return { _err: "Not found", _status: 404 };
      return { row };
    },
  });
  if (result instanceof Response) return result;
  if ("_err" in result)
    return NextResponse.json({ error: result._err }, { status: result._status as number });
  return NextResponse.json(result.row);
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = await parseBody(req, updateFlowSchema);
  if (!parsed.ok) return parsed.response;
  const { name, description, status, trigger, triggerConfig, nodes, edges, variables, enabled } =
    parsed.data;

  const result = await requireAction({
    minRole: "editor",
    run: async ({ ctx, user, tx }) => {
      const updated = await tx
        .update(schema.flows)
        .set({
          ...(name !== undefined && { name: name.trim() }),
          ...(description !== undefined && { description }),
          ...(status !== undefined && { status }),
          ...(trigger !== undefined && { trigger }),
          ...(triggerConfig !== undefined && { triggerConfig }),
          ...(nodes !== undefined && { nodes: nodes as never }),
          ...(edges !== undefined && { edges: edges as never }),
          ...(variables !== undefined && { variables }),
          ...(enabled !== undefined && { enabled }),
          updatedAt: new Date(),
        })
        .where(and(eq(schema.flows.id, id), eq(schema.flows.workspaceId, ctx.workspace.id)))
        .returning();
      const row = updated[0];
      if (!row) return { _err: "Not found", _status: 404 };
      await logAudit({
        workspaceId: ctx.workspace.id,
        userId: user.id,
        action: "flow.update",
        resource: "flow",
        resourceId: row.id,
        after: { name: row.name },
      });
      return { row };
    },
  });
  if (result instanceof Response) return result;
  if ("_err" in result)
    return NextResponse.json({ error: result._err }, { status: result._status as number });
  return NextResponse.json(result.row);
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await requireAction({
    minRole: "editor",
    run: async ({ ctx, user, tx }) => {
      const before = (
        await tx
          .select({ name: schema.flows.name })
          .from(schema.flows)
          .where(and(eq(schema.flows.id, id), eq(schema.flows.workspaceId, ctx.workspace.id)))
          .limit(1)
      )[0];
      const deleted = await tx
        .delete(schema.flows)
        .where(and(eq(schema.flows.id, id), eq(schema.flows.workspaceId, ctx.workspace.id)))
        .returning({ id: schema.flows.id });
      if (!deleted[0]) return { _err: "Not found", _status: 404 };
      await logAudit({
        workspaceId: ctx.workspace.id,
        userId: user.id,
        action: "flow.delete",
        resource: "flow",
        resourceId: id,
        before: before ? { name: before.name } : undefined,
      });
      return { ok: true };
    },
  });
  if (result instanceof Response) return result;
  if ("_err" in result)
    return NextResponse.json({ error: result._err }, { status: result._status as number });
  return NextResponse.json(result);
}
