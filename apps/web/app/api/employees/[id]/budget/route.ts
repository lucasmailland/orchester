import { NextResponse } from "next/server";
import { getDb, schema } from "@orchester/db";
import { and, eq } from "drizzle-orm";
import { getCurrentWorkspace } from "@/lib/workspace";
import { checkEmployeeBudget } from "@/lib/employee-budget";

/**
 * GET /api/employees/[id]/budget
 * Devuelve estado de budget mensual del empleado (gastado, configurado, %)
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ws = await getCurrentWorkspace();
  if (!ws) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const status = await checkEmployeeBudget(ws.workspace.id, id);
  return NextResponse.json(status);
}

/**
 * PATCH /api/employees/[id]/budget
 * Body: { monthlyBudgetUsd: number | null }
 * Setea o limpia el budget mensual.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ws = await getCurrentWorkspace();
  if (!ws) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { monthlyBudgetUsd?: number | null };
  const value = body.monthlyBudgetUsd;
  if (value !== null && (typeof value !== "number" || value < 0 || !Number.isFinite(value))) {
    return NextResponse.json(
      { error: "monthlyBudgetUsd must be a non-negative number or null" },
      { status: 400 }
    );
  }

  const db = getDb();
  const updated = await db
    .update(schema.employees)
    .set({ monthlyBudgetUsd: value == null ? null : String(value) })
    .where(
      and(eq(schema.employees.id, id), eq(schema.employees.workspaceId, ws.workspace.id))
    )
    .returning({ id: schema.employees.id, monthlyBudgetUsd: schema.employees.monthlyBudgetUsd });
  const row = updated[0];
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(row);
}
