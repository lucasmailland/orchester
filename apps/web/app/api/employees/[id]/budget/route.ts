import { NextResponse } from "next/server";
import { z } from "zod";
import { schema } from "@orchester/db";
import { and, eq } from "drizzle-orm";
import { requireAction } from "@/lib/auth-guards";
import { parseBody } from "@/lib/validation";
import { checkEmployeeBudget } from "@/lib/employee-budget";
import { logAudit } from "@/lib/audit";

const updateBudgetSchema = z.object({
  monthlyBudgetUsd: z.number().nonnegative().nullable(),
});

/**
 * GET /api/employees/[id]/budget
 * Devuelve estado de budget mensual del empleado (gastado, configurado, %)
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await requireAction({
    run: async ({ ctx }) => {
      return checkEmployeeBudget(ctx.workspace.id, id);
    },
  });
  if (result instanceof Response) return result;
  return NextResponse.json(result);
}

/**
 * PATCH /api/employees/[id]/budget
 * Body: { monthlyBudgetUsd: number | null }
 * Setea o limpia el budget mensual.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = await parseBody(req, updateBudgetSchema);
  if (!parsed.ok) return parsed.response;
  const value = parsed.data.monthlyBudgetUsd;

  const result = await requireAction({
    minRole: "admin",
    run: async ({ ctx, user, tx }) => {
      const updated = await tx
        .update(schema.employees)
        .set({ monthlyBudgetUsd: value == null ? null : String(value) })
        .where(and(eq(schema.employees.id, id), eq(schema.employees.workspaceId, ctx.workspace.id)))
        .returning({
          id: schema.employees.id,
          monthlyBudgetUsd: schema.employees.monthlyBudgetUsd,
        });
      const row = updated[0];
      if (!row) return { _err: "Not found", _status: 404 };
      await logAudit({
        workspaceId: ctx.workspace.id,
        userId: user.id,
        action: "employee.budget_update",
        resource: "employee",
        resourceId: id,
        after: { monthlyBudgetUsd: row.monthlyBudgetUsd },
      });
      return { row };
    },
  });
  if (result instanceof Response) return result;
  if ("_err" in result)
    return NextResponse.json({ error: result._err }, { status: result._status as number });
  return NextResponse.json(result.row);
}
