import { NextResponse } from "next/server";
import { z } from "zod";
import { createId } from "@paralleldrive/cuid2";
import { getDb, schema } from "@orchester/db";
import { eq, and, desc } from "drizzle-orm";
import { getCurrentWorkspace } from "@/lib/workspace";
import { requireAuth, isAuthContext } from "@/lib/auth-guards";
import { parseBody } from "@/lib/validation";

const createAgentVersionSchema = z.object({
  systemPrompt: z.string().min(1, "systemPrompt and model required"),
  model: z.string().min(1, "systemPrompt and model required"),
  temperature: z.union([z.number(), z.string()]).optional(),
  maxTokens: z.number().optional(),
  label: z.string().optional(),
});

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ws = await getCurrentWorkspace();
  if (!ws) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.agentVersions)
    .where(
      and(
        eq(schema.agentVersions.agentId, id),
        eq(schema.agentVersions.workspaceId, ws.workspace.id)
      )
    )
    .orderBy(desc(schema.agentVersions.createdAt));
  return NextResponse.json(rows);
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuth({ minRole: "editor" });
  if (!isAuthContext(ctx)) return ctx;
  const { id } = await params;
  const parsed = await parseBody(req, createAgentVersionSchema);
  if (!parsed.ok) return parsed.response;
  const { systemPrompt, model, temperature, maxTokens, label } = parsed.data;
  const db = getDb();
  const inserted = await db
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
    })
    .returning();
  const v = inserted[0];
  if (!v) return NextResponse.json({ error: "Insert failed" }, { status: 500 });
  return NextResponse.json(v, { status: 201 });
}
