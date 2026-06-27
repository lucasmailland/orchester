import { NextResponse } from "next/server";
import { z } from "zod";
import { schema } from "@orchester/db";
import { eq, and } from "drizzle-orm";
import { requireAction } from "@/lib/auth-guards";
import { parseBody } from "@/lib/validation";
import { logAudit } from "@/lib/audit";

const updateAgentSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  role: z.string().trim().min(1, "Role is required"),
  systemPrompt: z.string().optional(),
  model: z.string().optional(),
  status: z.enum(["active", "inactive", "draft"]).optional(),
  teamId: z.string().nullable().optional(),
  temperature: z.union([z.number(), z.string()]).optional(),
  maxTokens: z.number().optional(),
  kind: z.enum(["conversational", "flow"]).optional(),
  flowId: z.string().nullable().optional(),
  tools: z.array(z.string()).optional(),
  variables: z.record(z.string(), z.string()).optional(),
  greeting: z.string().nullable().optional(),
  fallback: z.string().nullable().optional(),
  starters: z.array(z.string()).optional(),
  avatarUrl: z.string().nullable().optional(),
  color: z.string().optional(),
  maxTurns: z.number().optional(),
  responseFormat: z.enum(["text", "json", "markdown"]).optional(),
  // outputSchema es un JSON Schema arbitrario definido por el usuario.
  outputSchema: z.record(z.string(), z.unknown()).optional(),
});

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await requireAction({
    run: async ({ ctx, tx }) => {
      const rows = await tx
        .select()
        .from(schema.agents)
        .where(and(eq(schema.agents.id, id), eq(schema.agents.workspaceId, ctx.workspace.id)))
        .limit(1);
      const agent = rows[0];
      if (!agent) return { _err: "Not found", _status: 404 };
      return { agent };
    },
  });
  if (result instanceof Response) return result;
  if ("_err" in result)
    return NextResponse.json({ error: result._err }, { status: result._status as number });
  return NextResponse.json(result.agent);
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
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

  const result = await requireAction({
    minRole: "editor",
    run: async ({ ctx, user, tx }) => {
      const updated = await tx
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
      if (!agent) return { _err: "Not found", _status: 404 };
      await logAudit({
        workspaceId: ctx.workspace.id,
        userId: user.id,
        action: "agent.update",
        resource: "agent",
        resourceId: agent.id,
        after: { name: agent.name, role: agent.role },
      });
      return { agent };
    },
  });
  if (result instanceof Response) return result;
  if ("_err" in result)
    return NextResponse.json({ error: result._err }, { status: result._status as number });
  return NextResponse.json(result.agent);
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await requireAction({
    minRole: "editor",
    run: async ({ ctx, user, tx }) => {
      const before = (
        await tx
          .select({ name: schema.agents.name })
          .from(schema.agents)
          .where(and(eq(schema.agents.id, id), eq(schema.agents.workspaceId, ctx.workspace.id)))
          .limit(1)
      )[0];
      const deleted = await tx
        .delete(schema.agents)
        .where(and(eq(schema.agents.id, id), eq(schema.agents.workspaceId, ctx.workspace.id)))
        .returning({ id: schema.agents.id });

      if (!deleted[0]) return { _err: "Not found", _status: 404 };
      await logAudit({
        workspaceId: ctx.workspace.id,
        userId: user.id,
        action: "agent.delete",
        resource: "agent",
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
