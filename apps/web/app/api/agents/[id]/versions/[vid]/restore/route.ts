import { NextResponse } from "next/server";
import { getDb, schema } from "@orchester/db";
import { eq, and } from "drizzle-orm";
import { requireAuth, isAuthContext } from "@/lib/auth-guards";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string; vid: string }> }
) {
  const ctx = await requireAuth({ minRole: "editor" });
  if (!isAuthContext(ctx)) return ctx;
  const { id, vid } = await params;
  const db = getDb();
  const versions = await db
    .select()
    .from(schema.agentVersions)
    .where(
      and(
        eq(schema.agentVersions.id, vid),
        eq(schema.agentVersions.agentId, id),
        eq(schema.agentVersions.workspaceId, ctx.workspace.id)
      )
    )
    .limit(1);
  const v = versions[0];
  if (!v) return NextResponse.json({ error: "Version not found" }, { status: 404 });

  const updated = await db
    .update(schema.agents)
    .set({
      systemPrompt: v.systemPrompt,
      model: v.model,
      temperature: v.temperature ?? null,
      maxTokens: v.maxTokens ?? null,
      updatedAt: new Date(),
    })
    .where(and(eq(schema.agents.id, id), eq(schema.agents.workspaceId, ctx.workspace.id)))
    .returning();
  const row = updated[0];
  if (!row) return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  return NextResponse.json(row);
}
