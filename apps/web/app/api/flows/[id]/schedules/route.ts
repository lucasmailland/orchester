import { NextResponse } from "next/server";
import { createId } from "@paralleldrive/cuid2";
import { getDb, schema } from "@orchester/db";
import { eq, and, desc } from "drizzle-orm";
import { getCurrentWorkspace } from "@/lib/workspace";

// Bare-bones cron validation: allow 5 fields with digits, *, /, ,, -
const CRON_RE = /^(\S+\s+){4}\S+$/;

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ws = await getCurrentWorkspace();
  if (!ws) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.flowSchedules)
    .where(
      and(
        eq(schema.flowSchedules.flowId, id),
        eq(schema.flowSchedules.workspaceId, ws.workspace.id)
      )
    )
    .orderBy(desc(schema.flowSchedules.createdAt));
  return NextResponse.json(rows);
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ws = await getCurrentWorkspace();
  if (!ws) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const body = await req.json();
  const cron = (body?.cron as string)?.trim();
  if (!cron || !CRON_RE.test(cron))
    return NextResponse.json({ error: "Invalid cron expression (need 5 fields)" }, { status: 400 });
  const tz = (body?.timezone as string) || "UTC";
  const db = getDb();
  const inserted = await db
    .insert(schema.flowSchedules)
    .values({
      id: createId(),
      flowId: id,
      workspaceId: ws.workspace.id,
      cron,
      timezone: tz,
    })
    .returning();
  const row = inserted[0];
  if (!row) return NextResponse.json({ error: "Insert failed" }, { status: 500 });
  return NextResponse.json(row, { status: 201 });
}
