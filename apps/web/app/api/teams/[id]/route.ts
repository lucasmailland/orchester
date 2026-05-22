import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb, schema } from "@orchester/db";
import { eq, and } from "drizzle-orm";
import { requireAuth, isAuthContext } from "@/lib/auth-guards";
import { parseBody } from "@/lib/validation";

const updateTeamSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  description: z.string().optional(),
  avatarColor: z.string().optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuth({ minRole: "admin" });
  if (!isAuthContext(ctx)) return ctx;

  const { id } = await params;
  const parsed = await parseBody(req, updateTeamSchema);
  if (!parsed.ok) return parsed.response;
  const { name, description, avatarColor } = parsed.data;

  const db = getDb();
  const [team] = await db
    .update(schema.teams)
    .set({
      name: name.trim(),
      description: description?.trim() || null,
      avatarColor: avatarColor || "#7C3AED",
      updatedAt: new Date(),
    })
    .where(and(eq(schema.teams.id, id), eq(schema.teams.workspaceId, ctx.workspace.id)))
    .returning();

  if (!team) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(team);
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuth({ minRole: "admin" });
  if (!isAuthContext(ctx)) return ctx;

  const { id } = await params;
  const db = getDb();
  const [deleted] = await db
    .delete(schema.teams)
    .where(and(eq(schema.teams.id, id), eq(schema.teams.workspaceId, ctx.workspace.id)))
    .returning({ id: schema.teams.id });

  if (!deleted) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
