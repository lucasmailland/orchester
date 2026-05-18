import "server-only";
import { getDb, schema } from "@orchester/db";
import { and, eq } from "drizzle-orm";
import { sendEmail } from "@/lib/email";
import { dispatchEvent, type WebhookEvent } from "@/lib/webhooks-out";
import { checkEmployeeBudget } from "@/lib/employee-budget";
import { safeLogError } from "@/lib/safe-log";

/**
 * Niveles de alerta que disparamos. El orden importa para no "retroceder"
 * cuando ya enviamos un nivel mayor en el mismo mes calendario.
 */
type Level = "warn70" | "warn90" | "exceeded";

const RANK: Record<Level, number> = { warn70: 1, warn90: 2, exceeded: 3 };

function currentMonth(): string {
  const now = new Date();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${now.getUTCFullYear()}-${m}`;
}

function levelForPct(pct: number, allowed: boolean): Level | null {
  if (!allowed) return "exceeded";
  if (pct >= 90) return "warn90";
  if (pct >= 70) return "warn70";
  return null;
}

/**
 * Después de cobrar un mensaje, evaluá si el empleado cruzó un umbral nuevo
 * (70%, 90%, o ya excedió) y dispará email + webhook UNA SOLA VEZ por mes
 * y nivel. Si ya enviamos `warn90`, no volvemos a `warn70` aunque la lectura
 * vuelva a bajar (lo cual no debería pasar, pero defense-in-depth).
 *
 * Best-effort: cualquier excepción se loguea pero no rompe el flujo de
 * persistencia del mensaje.
 */
export async function maybeFireBudgetAlert(
  workspaceId: string,
  employeeId: string | null | undefined
): Promise<void> {
  if (!employeeId) return;
  try {
    const status = await checkEmployeeBudget(workspaceId, employeeId);
    if (status.budgetUsd == null) return; // sin límite → nada que avisar

    const pct = (status.spentUsd / status.budgetUsd) * 100;
    const level = levelForPct(pct, status.allowed);
    if (!level) return;

    const db = getDb();
    const empRows = await db
      .select({
        name: schema.employees.name,
        email: schema.employees.email,
        lastBudgetAlertLevel: schema.employees.lastBudgetAlertLevel,
        lastBudgetAlertMonth: schema.employees.lastBudgetAlertMonth,
      })
      .from(schema.employees)
      .where(
        and(eq(schema.employees.id, employeeId), eq(schema.employees.workspaceId, workspaceId))
      )
      .limit(1);
    const emp = empRows[0];
    if (!emp) return;

    const month = currentMonth();
    // Si el último mes registrado es el actual y ya disparamos un nivel >= al
    // que estamos por mandar, salir. Si el mes cambió, reseteamos.
    if (emp.lastBudgetAlertMonth === month) {
      const last = (emp.lastBudgetAlertLevel ?? null) as Level | null;
      if (last && RANK[last] >= RANK[level]) return;
    }

    // Persistir primero (idempotencia): si dos requests cruzan el umbral en
    // paralelo, sólo una gana el UPDATE (otro queda con datos viejos pero el
    // próximo round-trip lo va a ver consistente).
    await db
      .update(schema.employees)
      .set({ lastBudgetAlertLevel: level, lastBudgetAlertMonth: month })
      .where(eq(schema.employees.id, employeeId));

    // Fire-and-forget: webhook + email en paralelo.
    const event: WebhookEvent =
      level === "exceeded"
        ? "employee.budget.exceeded"
        : level === "warn90"
        ? "employee.budget.warn90"
        : "employee.budget.warn70";

    const payload = {
      employeeId,
      employeeName: emp.name,
      employeeEmail: emp.email,
      level,
      spentUsd: status.spentUsd,
      budgetUsd: status.budgetUsd,
      pct: Math.round(pct * 10) / 10,
      conversationCount: status.conversationCount,
      month,
    };

    await Promise.all([
      dispatchEvent(workspaceId, event, payload),
      sendBudgetEmail(emp.email, emp.name, level, status.spentUsd, status.budgetUsd, pct),
    ]);
  } catch (e) {
    safeLogError("[cost-alerts] maybeFireBudgetAlert failed:", e);
  }
}

async function sendBudgetEmail(
  to: string,
  name: string,
  level: Level,
  spent: number,
  budget: number,
  pct: number
): Promise<void> {
  const subject =
    level === "exceeded"
      ? `[Orchester] Excediste tu budget mensual ($${budget})`
      : level === "warn90"
      ? `[Orchester] Alcanzaste el 90% de tu budget mensual`
      : `[Orchester] Alcanzaste el 70% de tu budget mensual`;
  const text =
    `Hola ${name},\n\n` +
    (level === "exceeded"
      ? `Tu uso de Orchester este mes excedió el budget asignado. Las nuevas conversaciones recibirán un mensaje de fallback hasta el inicio del próximo mes o hasta que tu admin extienda el límite.\n\n`
      : `Te avisamos antes de que se corte el servicio: ya gastaste el ${pct.toFixed(0)}% de tu budget mensual.\n\n`) +
    `Gastado: $${spent.toFixed(4)}\n` +
    `Budget:   $${budget.toFixed(2)}\n\n` +
    `Si necesitás más, contactá a tu administrador.`;
  await sendEmail({ to, subject, text });
}
