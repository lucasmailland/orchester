import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb, schema } from "@orchester/db";
import { eq, and } from "drizzle-orm";
import { getCurrentSession, getCurrentWorkspace } from "@/lib/workspace";
import { requireAuth, isAuthContext } from "@/lib/auth-guards";
import { parseBody } from "@/lib/validation";
import { logAudit } from "@/lib/audit";
import { getFlow, updateFlow, serviceErrorResponse } from "@/lib/flows/service";

const updateFlowSchema = z.object({
  name: z.string().optional(),
  description: z.string().nullable().optional(),
  spec: z.string().nullable().optional(),
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
  const ws = await getCurrentWorkspace();
  if (!ws) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const flow = await getFlow(
      { kind: "user", workspaceId: ws.workspace.id, userId: session.user.id },
      id
    );
    return NextResponse.json(flow);
  } catch (e) {
    return serviceErrorResponse(e);
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuth({ minRole: "editor" });
  if (!isAuthContext(ctx)) return ctx;
  const { id } = await params;
  const parsed = await parseBody(req, updateFlowSchema);
  if (!parsed.ok) return parsed.response;
  try {
    const { flow } = await updateFlow(
      { kind: "user", workspaceId: ctx.workspace.id, userId: ctx.user.id },
      id,
      parsed.data
    );
    return NextResponse.json(flow);
  } catch (e) {
    return serviceErrorResponse(e);
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuth({ minRole: "editor" });
  if (!isAuthContext(ctx)) return ctx;
  const { id } = await params;
  const db = getDb();
  const before = (
    await db
      .select({ name: schema.flows.name })
      .from(schema.flows)
      .where(and(eq(schema.flows.id, id), eq(schema.flows.workspaceId, ctx.workspace.id)))
      .limit(1)
  )[0];
  const deleted = await db
    .delete(schema.flows)
    .where(and(eq(schema.flows.id, id), eq(schema.flows.workspaceId, ctx.workspace.id)))
    .returning({ id: schema.flows.id });
  if (!deleted[0]) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await logAudit({
    workspaceId: ctx.workspace.id,
    userId: ctx.user.id,
    action: "flow.delete",
    resource: "flow",
    resourceId: id,
    before: before ? { name: before.name } : undefined,
  });
  return NextResponse.json({ ok: true });
}
