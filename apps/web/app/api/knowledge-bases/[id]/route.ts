import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb, schema } from "@orchester/db";
import { eq, and } from "drizzle-orm";
import { getCurrentWorkspace } from "@/lib/workspace";
import { requireAuth, isAuthContext } from "@/lib/auth-guards";
import { parseBody } from "@/lib/validation";
import { logAudit } from "@/lib/audit";

const updateKbSchema = z.object({
  name: z.string().optional(),
  description: z.string().nullable().optional(),
  chunkSize: z.number().optional(),
  chunkOverlap: z.number().optional(),
});

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ws = await getCurrentWorkspace();
  if (!ws) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.knowledgeBases)
    .where(
      and(eq(schema.knowledgeBases.id, id), eq(schema.knowledgeBases.workspaceId, ws.workspace.id))
    )
    .limit(1);
  const row = rows[0];
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(row);
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuth({ minRole: "editor" });
  if (!isAuthContext(ctx)) return ctx;
  const { id } = await params;
  const parsed = await parseBody(req, updateKbSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;
  const db = getDb();
  const updated = await db
    .update(schema.knowledgeBases)
    .set({
      ...(body.name !== undefined && { name: body.name }),
      ...(body.description !== undefined && { description: body.description }),
      ...(body.chunkSize !== undefined && { chunkSize: body.chunkSize }),
      ...(body.chunkOverlap !== undefined && { chunkOverlap: body.chunkOverlap }),
      updatedAt: new Date(),
    })
    .where(
      and(eq(schema.knowledgeBases.id, id), eq(schema.knowledgeBases.workspaceId, ctx.workspace.id))
    )
    .returning();
  const row = updated[0];
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(row);
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuth({ minRole: "editor" });
  if (!isAuthContext(ctx)) return ctx;
  const { id } = await params;
  const db = getDb();
  const before = (
    await db
      .select({ name: schema.knowledgeBases.name })
      .from(schema.knowledgeBases)
      .where(
        and(
          eq(schema.knowledgeBases.id, id),
          eq(schema.knowledgeBases.workspaceId, ctx.workspace.id)
        )
      )
      .limit(1)
  )[0];
  const deleted = await db
    .delete(schema.knowledgeBases)
    .where(
      and(eq(schema.knowledgeBases.id, id), eq(schema.knowledgeBases.workspaceId, ctx.workspace.id))
    )
    .returning({ id: schema.knowledgeBases.id });
  if (!deleted[0]) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await logAudit({
    workspaceId: ctx.workspace.id,
    userId: ctx.user.id,
    action: "knowledge.delete",
    resource: "knowledge_base",
    resourceId: id,
    before: before ? { name: before.name } : undefined,
  });
  return NextResponse.json({ ok: true });
}
