import { NextResponse } from "next/server";
import { z } from "zod";
import { createId } from "@paralleldrive/cuid2";
import { getDb, schema } from "@orchester/db";
import { eq, and, desc, sql } from "drizzle-orm";
import { requireAuth, isAuthContext } from "@/lib/auth-guards";
import { parseBody } from "@/lib/validation";
import { isValidCron, computeNextRun } from "@/lib/cron";

const createScheduleSchema = z.object({
  cron: z.string().optional(),
  timezone: z.string().optional(),
});

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuth();
  if (!isAuthContext(ctx)) return ctx;
  const { id } = await params;
  const db = getDb();
  // flow_schedule is FORCE RLS — needs workspace GUC on the connection.
  const rows = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.workspace_id', ${ctx.workspace.id}, true)`);
    await tx.execute(sql`SELECT set_config('app.user_id', ${ctx.user.id}, true)`);
    return tx
      .select()
      .from(schema.flowSchedules)
      .where(
        and(
          eq(schema.flowSchedules.flowId, id),
          eq(schema.flowSchedules.workspaceId, ctx.workspace.id)
        )
      )
      .orderBy(desc(schema.flowSchedules.createdAt));
  });
  return NextResponse.json(rows);
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuth({ minRole: "editor" });
  if (!isAuthContext(ctx)) return ctx;
  const { id } = await params;
  const parsed = await parseBody(req, createScheduleSchema);
  if (!parsed.ok) return parsed.response;
  const cron = parsed.data.cron?.trim();
  if (!cron || !isValidCron(cron))
    return NextResponse.json(
      { error: "Invalid cron expression (need a valid 5-field crontab)" },
      { status: 400 }
    );
  const tz = parsed.data.timezone || "UTC";
  const nextRunAt = computeNextRun(cron, tz);
  const db = getDb();
  const row = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.workspace_id', ${ctx.workspace.id}, true)`);
    await tx.execute(sql`SELECT set_config('app.user_id', ${ctx.user.id}, true)`);
    const inserted = await tx
      .insert(schema.flowSchedules)
      .values({
        id: createId(),
        flowId: id,
        workspaceId: ctx.workspace.id,
        cron,
        timezone: tz,
        nextRunAt,
      })
      .returning();
    return inserted[0];
  });
  if (!row) return NextResponse.json({ error: "Insert failed" }, { status: 500 });
  return NextResponse.json(row, { status: 201 });
}
