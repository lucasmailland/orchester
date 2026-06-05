import { NextResponse } from "next/server";
import { z } from "zod";
import { createId } from "@paralleldrive/cuid2";
import { getDb, schema } from "@orchester/db";
import { eq, and, desc, sql } from "drizzle-orm";
import { requireAuth, isAuthContext } from "@/lib/auth-guards";
import { parseBody } from "@/lib/validation";

const createFlowVersionSchema = z.object({
  label: z.string().nullable().optional(),
});

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuth();
  if (!isAuthContext(ctx)) return ctx;
  const { id } = await params;
  const db = getDb();
  // flow_version is FORCE RLS — needs workspace GUC on the connection.
  const rows = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.workspace_id', ${ctx.workspace.id}, true)`);
    await tx.execute(sql`SELECT set_config('app.user_id', ${ctx.user.id}, true)`);
    return tx
      .select()
      .from(schema.flowVersions)
      .where(
        and(
          eq(schema.flowVersions.flowId, id),
          eq(schema.flowVersions.workspaceId, ctx.workspace.id)
        )
      )
      .orderBy(desc(schema.flowVersions.createdAt));
  });
  return NextResponse.json(rows);
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuth({ minRole: "editor" });
  if (!isAuthContext(ctx)) return ctx;
  const { id } = await params;
  const parsed = await parseBody(req, createFlowVersionSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;
  const db = getDb();

  // Lookup → bump → snapshot all live in one transaction so the GUC carries
  // across every statement and the version bump is atomic with the insert.
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.workspace_id', ${ctx.workspace.id}, true)`);
    await tx.execute(sql`SELECT set_config('app.user_id', ${ctx.user.id}, true)`);

    const flowRows = await tx
      .select()
      .from(schema.flows)
      .where(and(eq(schema.flows.id, id), eq(schema.flows.workspaceId, ctx.workspace.id)))
      .limit(1);
    const flow = flowRows[0];
    if (!flow) return { kind: "not_found" as const };

    // Bump flow.version, snapshot the current state into flow_version
    const newVersion = (flow.version ?? 1) + 1;
    await tx.update(schema.flows).set({ version: newVersion }).where(eq(schema.flows.id, id));

    const inserted = await tx
      .insert(schema.flowVersions)
      .values({
        id: createId(),
        flowId: id,
        workspaceId: ctx.workspace.id,
        version: flow.version ?? 1,
        label: body.label ?? null,
        nodes: flow.nodes ?? [],
        edges: flow.edges ?? [],
        variables: flow.variables ?? {},
      })
      .returning();
    return { kind: "ok" as const, row: inserted[0] };
  });

  if (result.kind === "not_found")
    return NextResponse.json({ error: "Flow not found" }, { status: 404 });
  if (!result.row) return NextResponse.json({ error: "Insert failed" }, { status: 500 });
  return NextResponse.json(result.row, { status: 201 });
}
