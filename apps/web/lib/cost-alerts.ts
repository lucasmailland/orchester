import "server-only";
import { getDb, schema, type DbClient } from "@orchester/db";
import { and, eq, gte, sql } from "drizzle-orm";
import { sendEmail } from "@/lib/email";
import { dispatchEvent, type WebhookEvent } from "@/lib/webhooks-out";
import { checkEmployeeBudget } from "@/lib/employee-budget";
import { safeLogError } from "@/lib/safe-log";

/**
 * Mismo razonamiento que en `billing/quotas` y `employee-budget`: aceptamos
 * un `tx` opcional para que callers que ya están dentro de una transacción
 * con `app.workspace_id` SET LOCAL (e.g. el router de canales) compartan la
 * misma conexión. Sin esto, `getDb()` toma cualquier conexión del pool y
 * post-FORCE RLS rechaza las reads.
 */
type WsDb = DbClient | Parameters<Parameters<DbClient["transaction"]>[0]>[0];

/** Error tipado para el spend guard (E3-1) — distinguible del resto. */
export class SpendGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SpendGuardError";
  }
}

function monthStartUtc(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/**
 * Suma del gasto month-to-date del workspace en USD (sum de
 * `usageEvents.costUsd` desde el 1ro del mes UTC). Best-effort: si falla, 0.
 */
async function monthToDateSpendUsd(workspaceId: string, tx?: WsDb): Promise<number> {
  const db = tx ?? getDb();
  const rows = await db
    .select({ total: sql<string>`coalesce(sum(${schema.usageEvents.costUsd}), 0)` })
    .from(schema.usageEvents)
    .where(
      and(
        eq(schema.usageEvents.workspaceId, workspaceId),
        gte(schema.usageEvents.createdAt, monthStartUtc())
      )
    );
  return Number(rows[0]?.total ?? 0);
}

/**
 * Guard pre-dispatch (E3-1). Tirar ANTES de cada llamada de IA para:
 *   1. Kill-switch global: `AI_DISABLED=1` corta toda la IA del deployment.
 *   2. Soft cap mensual: `AI_MONTHLY_SPEND_CAP_USD` (USD). Si el gasto
 *      month-to-date del workspace lo supera, corta. Sin la env (o <= 0) no
 *      hay tope.
 *
 * No agrega columnas: usa env + `usageEvents.costUsd` existente. Cualquier
 * fallo de LECTURA del gasto se loguea pero NO bloquea (fail-open en el sumado
 * para no romper la IA por un hipo de DB); el kill-switch y el cap sí cortan.
 */
export async function assertWithinSpend(workspaceId: string, tx?: WsDb): Promise<void> {
  if (process.env.AI_DISABLED === "1") {
    throw new SpendGuardError(
      "La IA está deshabilitada temporalmente (kill-switch global AI_DISABLED)."
    );
  }

  const capRaw = process.env.AI_MONTHLY_SPEND_CAP_USD;
  const cap = capRaw != null ? Number(capRaw) : NaN;
  if (!Number.isFinite(cap) || cap <= 0) return; // sin tope configurado

  let spent: number;
  try {
    spent = await monthToDateSpendUsd(workspaceId, tx);
  } catch (e) {
    // F-D9: metric breadcrumb so dashboards can alarm on a sudden
    // spike in fail-open events (which usually means the GUC isn't
    // set or RLS regressed on `usage_event`).
    safeLogError("[metric] cost_alert.spend_read_failed_total +1", { workspaceId });
    safeLogError("[cost-alerts] assertWithinSpend spend read failed:", e);

    // F-D8: differentiate by error code.
    //   - Permission / RLS denial → the spend cap is being silently
    //     bypassed (config bug), so fail CLOSED. Better to refuse a
    //     few AI calls than to silently disable the cap that exists
    //     specifically to prevent runaway spend.
    //   - Everything else (network blip, timeout, statement_timeout,
    //     transient pool exhaustion) → fail OPEN. The cap is a soft
    //     control; we don't want a DB hiccup to take the product down.
    //
    // Postgres maps permission errors to SQLSTATE 42501 (insufficient
    // privilege). RLS rejects on tables WITH `FORCE ROW LEVEL SECURITY`
    // also surface as 42501. Drizzle/postgres-js exposes the SQLSTATE
    // on the error's `code` field; some custom layers wrap it as
    // `RLS_DENIED` — we accept both.
    const isPermError =
      typeof e === "object" &&
      e !== null &&
      "code" in e &&
      typeof (e as { code?: unknown }).code === "string" &&
      ((e as { code: string }).code === "42501" || (e as { code: string }).code === "RLS_DENIED");
    if (isPermError) {
      throw new SpendGuardError(
        "spend cap check failed: permission denied (RLS or insufficient privilege)"
      );
    }
    return; // network/timeout: fail-open (AI continues)
  }

  if (spent >= cap) {
    throw new SpendGuardError(
      `Se alcanzó el tope de gasto mensual de IA ($${cap.toFixed(2)}). Gasto actual: $${spent.toFixed(2)}. Contactá a tu administrador.`
    );
  }
}

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
  employeeId: string | null | undefined,
  tx?: WsDb
): Promise<void> {
  if (!employeeId) return;

  // Read: budget status + employee row. If either read fails we can't
  // reason about which alert to fire, so we exit silently with a
  // distinct log prefix so on-call can tell apart from update/webhook/
  // email failures below.
  let status: Awaited<ReturnType<typeof checkEmployeeBudget>>;
  try {
    status = await checkEmployeeBudget(workspaceId, employeeId, tx);
  } catch (e) {
    safeLogError("[cost-alerts.read] checkEmployeeBudget failed:", e);
    return;
  }
  if (status.budgetUsd == null) return; // sin límite → nada que avisar

  const pct = (status.spentUsd / status.budgetUsd) * 100;
  const level = levelForPct(pct, status.allowed);
  if (!level) return;

  const db = tx ?? getDb();
  let emp:
    | {
        name: string;
        email: string;
        lastBudgetAlertLevel: string | null;
        lastBudgetAlertMonth: string | null;
      }
    | undefined;
  try {
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
    emp = empRows[0];
  } catch (e) {
    safeLogError("[cost-alerts.read] employee row read failed:", e);
    return;
  }
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
  // próximo round-trip lo va a ver consistente). Si el UPDATE falla, NO
  // disparamos avisos: dispararíamos infinitamente al próximo turno.
  try {
    await db
      .update(schema.employees)
      .set({ lastBudgetAlertLevel: level, lastBudgetAlertMonth: month })
      .where(eq(schema.employees.id, employeeId));
  } catch (e) {
    safeLogError("[cost-alerts.update] lastBudgetAlertLevel UPDATE failed:", e);
    return;
  }

  // Fire-and-forget: webhook + email en paralelo. Errores se loguean con
  // prefijos distintos para diagnosticar qué pata falló.
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

  await Promise.allSettled([
    dispatchEvent(workspaceId, event, payload, tx).catch((e) =>
      safeLogError("[cost-alerts.webhook] dispatchEvent failed:", e)
    ),
    sendBudgetEmail(emp.email, emp.name, level, status.spentUsd, status.budgetUsd, pct).catch((e) =>
      safeLogError("[cost-alerts.email] sendBudgetEmail failed:", e)
    ),
  ]);
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
