import { NextResponse } from "next/server";
import { z } from "zod";
import { createId } from "@paralleldrive/cuid2";
import { getDb, schema } from "@orchester/db";
import { eq, and, desc, sql } from "drizzle-orm";
import { requireAuth, isAuthContext } from "@/lib/auth-guards";
import { parseBody } from "@/lib/validation";

const createAgentVersionSchema = z.object({
  systemPrompt: z.string().min(1, "systemPrompt and model required"),
  model: z.string().min(1, "systemPrompt and model required"),
  temperature: z.union([z.number(), z.string()]).optional(),
  maxTokens: z.number().optional(),
  label: z.string().optional(),
  tools: z.array(z.string()).optional(),
  variables: z.record(z.string(), z.string()).optional(),
  responseFormat: z.enum(["text", "json"]).optional(),
  outputSchema: z.record(z.string(), z.unknown()).optional(),
});

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  // agent_version is FORCE RLS — read under the workspace GUC.
  const ctx = await requireAuth();
  if (!isAuthContext(ctx)) return ctx;
  const { id } = await params;
  const db = getDb();
  const rows = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.workspace_id', ${ctx.workspace.id}, true)`);
    await tx.execute(sql`SELECT set_config('app.user_id', ${ctx.user.id}, true)`);
    return tx
      .select()
      .from(schema.agentVersions)
      .where(
        and(
          eq(schema.agentVersions.agentId, id),
          eq(schema.agentVersions.workspaceId, ctx.workspace.id)
        )
      )
      .orderBy(desc(schema.agentVersions.createdAt));
  });
  return NextResponse.json(rows);
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuth({ minRole: "editor" });
  if (!isAuthContext(ctx)) return ctx;
  const { id } = await params;
  const parsed = await parseBody(req, createAgentVersionSchema);
  if (!parsed.ok) return parsed.response;
  const {
    systemPrompt,
    model,
    temperature,
    maxTokens,
    label,
    tools,
    variables,
    responseFormat,
    outputSchema,
  } = parsed.data;
  const db = getDb();
  const v = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.workspace_id', ${ctx.workspace.id}, true)`);
    await tx.execute(sql`SELECT set_config('app.user_id', ${ctx.user.id}, true)`);
    // Read the live agent to capture any fields the caller didn't supply.
    const liveRows = await tx
      .select()
      .from(schema.agents)
      .where(and(eq(schema.agents.id, id), eq(schema.agents.workspaceId, ctx.workspace.id)))
      .limit(1);
    const live = liveRows[0];
    const inserted = await tx
      .insert(schema.agentVersions)
      .values({
        id: createId(),
        agentId: id,
        workspaceId: ctx.workspace.id,
        systemPrompt,
        model,
        temperature: temperature !== undefined ? String(temperature) : null,
        maxTokens: maxTokens ?? null,
        label: label ?? null,
        tools: (tools ?? live?.tools ?? []) as string[],
        variables: (variables ?? live?.variables ?? {}) as Record<string, string>,
        responseFormat: responseFormat ?? live?.responseFormat ?? "text",
        outputSchema: (outputSchema ?? live?.outputSchema ?? null) as Record<
          string,
          unknown
        > | null,
      })
      .returning();
    return inserted[0];
  });
  if (!v) return NextResponse.json({ error: "Insert failed" }, { status: 500 });
  return NextResponse.json(v, { status: 201 });
}
