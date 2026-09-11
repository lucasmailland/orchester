import { NextResponse } from "next/server";
import { getDb, schema } from "@orchester/db";
import { eq, and } from "drizzle-orm";
import { getCurrentWorkspace } from "@/lib/workspace";
import { requireAuth, isAuthContext } from "@/lib/auth-guards";
import { parseBody } from "@/lib/validation";
import { updateAgentSchema } from "@/lib/agents/schemas";
import { logAudit } from "@/lib/audit";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const workspace = await getCurrentWorkspace();
  if (!workspace) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.agents)
    .where(and(eq(schema.agents.id, id), eq(schema.agents.workspaceId, workspace.workspace.id)))
    .limit(1);
  const agent = rows[0];
  if (!agent) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(agent);
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuth({ minRole: "editor" });
  if (!isAuthContext(ctx)) return ctx;

  const { id } = await params;
  const parsed = await parseBody(req, updateAgentSchema);
  if (!parsed.ok) return parsed.response;
  const {
    name,
    role,
    systemPrompt,
    model,
    status,
    teamId,
    temperature,
    maxTokens,
    kind,
    flowId,
    tools,
    variables,
    greeting,
    fallback,
    starters,
    avatarUrl,
    color,
    maxTurns,
    responseFormat,
    outputSchema,
  } = parsed.data;

  const db = getDb();
  const updated = await db
    .update(schema.agents)
    .set({
      name: name.trim(),
      role: role.trim(),
      ...(systemPrompt !== undefined && { systemPrompt: systemPrompt.trim() }),
      ...(model !== undefined && { model }),
      ...(status !== undefined && { status }),
      ...(teamId !== undefined && { teamId: teamId || null }),
      ...(temperature !== undefined && { temperature: String(temperature) }),
      ...(maxTokens !== undefined && { maxTokens }),
      ...(kind !== undefined && { kind }),
      ...(flowId !== undefined && { flowId: flowId || null }),
      ...(tools !== undefined && { tools }),
      ...(variables !== undefined && { variables }),
      ...(greeting !== undefined && { greeting: greeting || null }),
      ...(fallback !== undefined && { fallback: fallback || null }),
      ...(starters !== undefined && { starters }),
      ...(avatarUrl !== undefined && { avatarUrl: avatarUrl || null }),
      ...(color !== undefined && { color }),
      ...(maxTurns !== undefined && { maxTurns }),
      ...(responseFormat !== undefined && { responseFormat }),
      ...(outputSchema !== undefined && { outputSchema }),
      updatedAt: new Date(),
    })
    .where(and(eq(schema.agents.id, id), eq(schema.agents.workspaceId, ctx.workspace.id)))
    .returning();

  const agent = updated[0];
  if (!agent) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await logAudit({
    workspaceId: ctx.workspace.id,
    userId: ctx.user.id,
    action: "agent.update",
    resource: "agent",
    resourceId: agent.id,
    after: { name: agent.name, role: agent.role },
  });
  return NextResponse.json(agent);
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuth({ minRole: "editor" });
  if (!isAuthContext(ctx)) return ctx;

  const { id } = await params;
  const db = getDb();
  const before = (
    await db
      .select({ name: schema.agents.name })
      .from(schema.agents)
      .where(and(eq(schema.agents.id, id), eq(schema.agents.workspaceId, ctx.workspace.id)))
      .limit(1)
  )[0];
  const deleted = await db
    .delete(schema.agents)
    .where(and(eq(schema.agents.id, id), eq(schema.agents.workspaceId, ctx.workspace.id)))
    .returning({ id: schema.agents.id });

  if (!deleted[0]) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await logAudit({
    workspaceId: ctx.workspace.id,
    userId: ctx.user.id,
    action: "agent.delete",
    resource: "agent",
    resourceId: id,
    before: before ? { name: before.name } : undefined,
  });
  return NextResponse.json({ ok: true });
}
