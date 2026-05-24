import { NextResponse } from "next/server";
import { getDb, schema } from "@orchester/db";
import { eq, and, sql } from "drizzle-orm";
import { requireAuth, isAuthContext } from "@/lib/auth-guards";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuth();
  if (!isAuthContext(ctx)) return ctx;
  const { id } = await params;
  const db = getDb();
  // flow_run + flow_run_step are FORCE RLS — read under the workspace GUC
  // so the same connection carries it for both queries.
  const out = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.workspace_id', ${ctx.workspace.id}, true)`);
    await tx.execute(sql`SELECT set_config('app.user_id', ${ctx.user.id}, true)`);
    const runs = await tx
      .select()
      .from(schema.flowRuns)
      .where(and(eq(schema.flowRuns.id, id), eq(schema.flowRuns.workspaceId, ctx.workspace.id)))
      .limit(1);
    const run = runs[0];
    if (!run) return { kind: "not_found" as const };
    const steps = await tx
      .select()
      .from(schema.flowRunSteps)
      .where(eq(schema.flowRunSteps.runId, id))
      .orderBy(schema.flowRunSteps.startedAt);
    return { kind: "ok" as const, run, steps };
  });
  if (out.kind === "not_found") return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ run: out.run, steps: out.steps });
}
