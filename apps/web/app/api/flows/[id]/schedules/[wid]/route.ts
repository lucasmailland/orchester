import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb, schema } from "@orchester/db";
import { eq, and } from "drizzle-orm";
import { requireAuth, isAuthContext } from "@/lib/auth-guards";
import { parseBody } from "@/lib/validation";

const updateScheduleSchema = z.object({
  cron: z.string().optional(),
  timezone: z.string().optional(),
  enabled: z.boolean().optional(),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; wid: string }> }
) {
  const ctx = await requireAuth({ minRole: "editor" });
  if (!isAuthContext(ctx)) return ctx;
  const { wid } = await params;
  const parsed = await parseBody(req, updateScheduleSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;
  const db = getDb();
  const updated = await db
    .update(schema.flowSchedules)
    .set({
      ...(body.cron !== undefined && { cron: body.cron }),
      ...(body.timezone !== undefined && { timezone: body.timezone }),
      ...(body.enabled !== undefined && { enabled: !!body.enabled }),
    })
    .where(
      and(
        eq(schema.flowSchedules.id, wid),
        eq(schema.flowSchedules.workspaceId, ctx.workspace.id)
      )
    )
    .returning();
  const row = updated[0];
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(row);
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; wid: string }> }
) {
  const ctx = await requireAuth({ minRole: "editor" });
  if (!isAuthContext(ctx)) return ctx;
  const { wid } = await params;
  const db = getDb();
  const deleted = await db
    .delete(schema.flowSchedules)
    .where(
      and(
        eq(schema.flowSchedules.id, wid),
        eq(schema.flowSchedules.workspaceId, ctx.workspace.id)
      )
    )
    .returning({ id: schema.flowSchedules.id });
  if (!deleted[0]) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
