import "server-only";
import { getDb, schema } from "@orchester/db";
import { and, eq, gte, sql } from "drizzle-orm";

/**
 * Per-employee budget enforcement.
 *
 * Si `employee.monthlyBudgetUsd` está seteado, sumamos el costo total de las
 * conversaciones del empleado en el mes calendario actual y rechazamos
 * nuevas con un mensaje configurable cuando excede.
 *
 * Es un soft-quota a nivel del agent_runtime: el handleInbound chequea
 * antes de invocar al LLM. Si excede, devuelve `fallback` o un mensaje
 * estándar y NO consume tokens del provider.
 */

export interface BudgetStatus {
  /** True = OK, puede continuar. False = budget excedido. */
  allowed: boolean;
  /** Budget mensual configurado, en USD. NULL = sin límite. */
  budgetUsd: number | null;
  /** Costo acumulado en el mes calendario actual. */
  spentUsd: number;
  /** Conversaciones del mes (informativo). */
  conversationCount: number;
}

/**
 * Devuelve el estado del budget para `employeeId`. Si no hay employee_id
 * (anonymous web visitor), allowed=true siempre.
 */
export async function checkEmployeeBudget(
  workspaceId: string,
  employeeId: string | null | undefined
): Promise<BudgetStatus> {
  if (!employeeId) {
    return { allowed: true, budgetUsd: null, spentUsd: 0, conversationCount: 0 };
  }

  const db = getDb();
  const empRows = await db
    .select({
      monthlyBudgetUsd: schema.employees.monthlyBudgetUsd,
    })
    .from(schema.employees)
    .where(
      and(
        eq(schema.employees.id, employeeId),
        eq(schema.employees.workspaceId, workspaceId)
      )
    )
    .limit(1);
  const emp = empRows[0];

  // Sin budget configurado → OK siempre. Igual reportamos el spentUsd para mostrar
  // en UI ("este empleado consumió $X" sin enforcement).
  const startOfMonth = new Date();
  startOfMonth.setUTCDate(1);
  startOfMonth.setUTCHours(0, 0, 0, 0);

  const agg = await db
    .select({
      total: sql<string>`coalesce(sum(${schema.conversations.totalCostUsd}), 0)`,
      count: sql<number>`count(*)::int`,
    })
    .from(schema.conversations)
    .where(
      and(
        eq(schema.conversations.workspaceId, workspaceId),
        eq(schema.conversations.employeeId, employeeId),
        gte(schema.conversations.startedAt, startOfMonth)
      )
    );

  const spent = Number(agg[0]?.total ?? 0);
  const count = agg[0]?.count ?? 0;
  const budget = emp?.monthlyBudgetUsd != null ? Number(emp.monthlyBudgetUsd) : null;

  return {
    allowed: budget == null || spent < budget,
    budgetUsd: budget,
    spentUsd: spent,
    conversationCount: count,
  };
}

/**
 * Persiste el costo de un message LLM y actualiza el agregado de la conversation.
 * Llamar después de `db.insert(schema.messages)` con el role=assistant.
 *
 * Después de la transacción, si el message está atado a un employee con budget,
 * dispara `maybeFireBudgetAlert` que manda email + webhook si cruzó 70/90/100%.
 * El alert es best-effort; cualquier error se loguea sin romper el flujo.
 */
export async function recordMessageCost(args: {
  messageId: string;
  conversationId: string;
  model: string;
  tokensUsed: number;
  costUsd: number;
}): Promise<void> {
  const db = getDb();
  await db.transaction(async (tx) => {
    await tx
      .update(schema.messages)
      .set({
        tokensUsed: args.tokensUsed,
        costUsd: String(args.costUsd),
        model: args.model,
      })
      .where(eq(schema.messages.id, args.messageId));

    await tx
      .update(schema.conversations)
      .set({
        totalCostUsd: sql`coalesce(${schema.conversations.totalCostUsd}, 0) + ${args.costUsd}`,
        totalTokens: sql`coalesce(${schema.conversations.totalTokens}, 0) + ${args.tokensUsed}`,
      })
      .where(eq(schema.conversations.id, args.conversationId));
  });

  // Después de cobrar, evaluar si crucé un umbral nuevo (70/90/exceeded).
  // Esto necesita workspace + employee del conversation; los buscamos acá
  // para mantener la API simple del caller.
  const convRows = await db
    .select({
      workspaceId: schema.conversations.workspaceId,
      employeeId: schema.conversations.employeeId,
    })
    .from(schema.conversations)
    .where(eq(schema.conversations.id, args.conversationId))
    .limit(1);
  const conv = convRows[0];
  if (conv?.employeeId) {
    const { maybeFireBudgetAlert } = await import("@/lib/cost-alerts");
    await maybeFireBudgetAlert(conv.workspaceId, conv.employeeId);
  }
}
