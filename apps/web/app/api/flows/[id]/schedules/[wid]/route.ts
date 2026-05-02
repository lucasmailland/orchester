import { NextResponse } from "next/server";
import { getDb, schema } from "@orchester/db";
import { eq, and } from "drizzle-orm";
import { getCurrentWorkspace } from "@/lib/workspace";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; wid: string }> }
) {
  const ws = await getCurrentWorkspace();
  if (!ws) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { wid } = await params;
  const body = await req.json();
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
        eq(schema.flowSchedules.workspaceId, ws.workspace.id)
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
  const ws = await getCurrentWorkspace();
  if (!ws) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { wid } = await params;
  const db = getDb();
  const deleted = await db
    .delete(schema.flowSchedules)
    .where(
      and(
        eq(schema.flowSchedules.id, wid),
        eq(schema.flowSchedules.workspaceId, ws.workspace.id)
      )
    )
    .returning({ id: schema.flowSchedules.id });
  if (!deleted[0]) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
