import { NextResponse } from "next/server";
import { getDb, schema } from "@orchester/db";
import { eq, and, sql } from "drizzle-orm";
import { requireAuth, isAuthContext } from "@/lib/auth-guards";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string; vid: string }> }
) {
  const ctx = await requireAuth({ minRole: "editor" });
  if (!isAuthContext(ctx)) return ctx;
  const { id, vid } = await params;
  const db = getDb();
  // Atomic read-then-update under the workspace GUC.
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.workspace_id', ${ctx.workspace.id}, true)`);
    await tx.execute(sql`SELECT set_config('app.user_id', ${ctx.user.id}, true)`);
    const versions = await tx
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
    if (!v) return { kind: "version_not_found" as const };

    const updated = await tx
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
    if (!row) return { kind: "agent_not_found" as const };
    return { kind: "ok" as const, row };
  });

  if (result.kind === "version_not_found")
    return NextResponse.json({ error: "Version not found" }, { status: 404 });
  if (result.kind === "agent_not_found")
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  return NextResponse.json(result.row);
}
