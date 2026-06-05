import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb, schema } from "@orchester/db";
import { and, eq } from "drizzle-orm";
import { getCurrentWorkspace } from "@/lib/workspace";
import { requireAuth, isAuthContext } from "@/lib/auth-guards";
import { parseBody } from "@/lib/validation";
import { checkEmployeeBudget } from "@/lib/employee-budget";

const updateBudgetSchema = z.object({
  monthlyBudgetUsd: z.number().nonnegative().nullable(),
});

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
  const ctx = await requireAuth({ minRole: "admin" });
  if (!isAuthContext(ctx)) return ctx;
  const { id } = await params;
  const parsed = await parseBody(req, updateBudgetSchema);
  if (!parsed.ok) return parsed.response;
  const value = parsed.data.monthlyBudgetUsd;

  const db = getDb();
  const updated = await db
    .update(schema.employees)
    .set({ monthlyBudgetUsd: value == null ? null : String(value) })
    .where(and(eq(schema.employees.id, id), eq(schema.employees.workspaceId, ctx.workspace.id)))
    .returning({ id: schema.employees.id, monthlyBudgetUsd: schema.employees.monthlyBudgetUsd });
  const row = updated[0];
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(row);
}
