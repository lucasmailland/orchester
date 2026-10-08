import { NextResponse } from "next/server";
import { getDb, schema } from "@orchester/db";
import { eq, and } from "drizzle-orm";
import { getCurrentWorkspace } from "@/lib/workspace";
import { requireAuth, isAuthContext } from "@/lib/auth-guards";
import { parseBody } from "@/lib/validation";
import { updateAgentSchema } from "@/lib/agents/schemas";
import { deleteAgent } from "@/lib/agents/admin-service";
import { mergeAgentConfig } from "@/lib/agents/tool-call-cap";
import { adminErrorResponse } from "@/lib/workspace-admin";
import { unknownKbIds, withAgentKbIds } from "@/lib/agents/knowledge-bases";
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
    knowledgeBaseIds,
    variables,
    greeting,
    fallback,
    starters,
    avatarUrl,
    color,
    maxTurns,
    maxToolCalls,
    responseFormat,
    outputSchema,
  } = parsed.data;

  const db = getDb();
  // `config` is shared by several settings (knowledge bases, tool-call cap):
  // each one is merged into the stored object instead of replacing it.
  let config: Record<string, unknown> | undefined;
  if (knowledgeBaseIds !== undefined) {
    const unknown = await unknownKbIds(ctx.workspace.id, knowledgeBaseIds);
    if (unknown.length)
      return NextResponse.json(
        { error: `Unknown knowledge bases: ${unknown.join(", ")}` },
        { status: 400 }
      );
  }
  if (knowledgeBaseIds !== undefined || maxToolCalls !== undefined) {
    const [current] = await db
      .select({ config: schema.agents.config })
      .from(schema.agents)
      .where(and(eq(schema.agents.id, id), eq(schema.agents.workspaceId, ctx.workspace.id)))
      .limit(1);
    if (!current) return NextResponse.json({ error: "Not found" }, { status: 404 });
    let next: Record<string, unknown> | unknown = current.config;
    if (knowledgeBaseIds !== undefined) next = withAgentKbIds(next, knowledgeBaseIds);
    if (maxToolCalls !== undefined) next = mergeAgentConfig(next, { maxToolCalls });
    config = next as Record<string, unknown>;
  }
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
      ...(config !== undefined && { config }),
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
  try {
    return NextResponse.json(
      await deleteAgent({ kind: "user", workspaceId: ctx.workspace.id, userId: ctx.user.id }, id)
    );
  } catch (e) {
    return adminErrorResponse(e);
  }
}
