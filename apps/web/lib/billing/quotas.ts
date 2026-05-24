import "server-only";
import { getDb, schema, type DbClient } from "@orchester/db";
import { eq, and, gte, sum } from "drizzle-orm";
import { planLimits, type Plan } from "./plans";

/**
 * Quotas se llaman tanto desde rutas HTTP (que ya tienen su propia txn con
 * `app.workspace_id` SET LOCAL) como desde el router de canales `handleInbound`
 * (que thread-ea su propia txn para que el GUC propague post-FORCE RLS). Para
 * que las consultas internas usen la MISMA conexión (= mismo `app.workspace_id`
 * GUC), aceptamos un `tx` opcional. Si no se pasa, caemos a `getDb()` y
 * tomamos cualquier conexión del pool (comportamiento legacy).
 */
type WsDb = DbClient | Parameters<Parameters<DbClient["transaction"]>[0]>[0];

/**
 * En self-host (SELF_HOSTED=true o STRIPE_SECRET_KEY ausente), todos los
 * workspaces son plan "enterprise" → quotas ilimitadas. Sin esta degradación,
 * un user self-hosted choca con el límite Free de 100 conversaciones/mes.
 */
function isSelfHosted(): boolean {
  return process.env["SELF_HOSTED"] === "true" || !process.env["STRIPE_SECRET_KEY"];
}

export async function getWorkspacePlan(workspaceId: string, tx?: WsDb): Promise<Plan> {
  if (isSelfHosted()) return "enterprise";
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.workspaceBilling)
    .where(eq(schema.workspaceBilling.workspaceId, workspaceId))
    .limit(1);
  return (rows[0]?.plan ?? "free") as Plan;
}

/** Inicio del mes calendario UTC actual. Fallback cuando no hay suscripción. */
function calendarMonthStart(): Date {
  const start = new Date();
  start.setUTCDate(1);
  start.setUTCHours(0, 0, 0, 0);
  return start;
}

/**
 * Calcula el inicio de la ventana de uso actual.
 *
 * Si el workspace tiene suscripción Stripe (`currentPeriodEnd` presente),
 * la ventana se alinea al período de facturación: el inicio es el último
 * ancla mensual <= ahora, derivado restando meses a `currentPeriodEnd`.
 * Así un upgrade/uso a mitad de ciclo cuenta contra el período correcto y
 * no contra el mes calendario.
 *
 * Sin suscripción (plan free / self-host), usa el mes calendario UTC.
 */
async function getUsageWindowStart(workspaceId: string, tx?: WsDb): Promise<Date> {
  if (isSelfHosted()) return calendarMonthStart();
  const db = tx ?? getDb();
  const rows = await db
    .select({ currentPeriodEnd: schema.workspaceBilling.currentPeriodEnd })
    .from(schema.workspaceBilling)
    .where(eq(schema.workspaceBilling.workspaceId, workspaceId))
    .limit(1);
  const periodEnd = rows[0]?.currentPeriodEnd;
  if (!periodEnd) return calendarMonthStart();

  const now = Date.now();
  // El ancla `periodEnd` define el día/hora del ciclo. Retrocedemos en pasos
  // mensuales desde `periodEnd` hasta encontrar el último anchor <= ahora.
  const anchor = new Date(periodEnd);
  // Avanzamos primero si el período termina en el futuro: el inicio del
  // período actual es periodEnd menos un mes (caso típico).
  let candidate = new Date(anchor);
  candidate.setUTCMonth(candidate.getUTCMonth() - 1);
  // Asegurar que candidate sea el inicio de período más reciente <= ahora.
  while (candidate.getTime() > now) {
    candidate.setUTCMonth(candidate.getUTCMonth() - 1);
  }
  // Si el período venció (anchor en el pasado), avanzar hasta el ciclo vigente.
  while (true) {
    const next = new Date(candidate);
    next.setUTCMonth(next.getUTCMonth() + 1);
    if (next.getTime() > now) break;
    candidate = next;
  }
  return candidate;
}

/**
 * Returns current month's usage for a workspace.
 *
 * La ventana se alinea al período de facturación de Stripe cuando hay
 * suscripción; sino cae al mes calendario UTC.
 */
export async function getMonthlyUsage(workspaceId: string, tx?: WsDb) {
  const db = tx ?? getDb();
  const start = await getUsageWindowStart(workspaceId, tx);
  const rows = await db
    .select({
      kind: schema.usageEvents.kind,
      total: sum(schema.usageEvents.amount).mapWith(Number),
    })
    .from(schema.usageEvents)
    .where(
      and(eq(schema.usageEvents.workspaceId, workspaceId), gte(schema.usageEvents.createdAt, start))
    )
    .groupBy(schema.usageEvents.kind);
  const byKind: Record<string, number> = {};
  for (const r of rows) byKind[r.kind] = r.total ?? 0;
  return {
    conversations: byKind["agent_message"] ?? 0,
    tokensIn: byKind["tokens_in"] ?? 0,
    tokensOut: byKind["tokens_out"] ?? 0,
    flowRuns: byKind["flow_run"] ?? 0,
    kbQueries: byKind["kb_query"] ?? 0,
    webhookCalls: byKind["webhook_call"] ?? 0,
  };
}

/**
 * Checks if the workspace can perform an action under its plan.
 * Returns null if allowed, or a string explaining the limit.
 */
export async function checkQuota(
  workspaceId: string,
  kind: "conversations" | "tokens" | "agents" | "flows" | "members" | "knowledgeBases",
  tx?: WsDb
): Promise<{
  allowed: boolean;
  limit?: number | undefined;
  current?: number | undefined;
  reason?: string | undefined;
}> {
  const plan = await getWorkspacePlan(workspaceId, tx);
  const limits = planLimits(plan);

  if (kind === "conversations") {
    const usage = await getMonthlyUsage(workspaceId, tx);
    if (usage.conversations >= limits.conversationsPerMonth) {
      return {
        allowed: false,
        limit: limits.conversationsPerMonth,
        current: usage.conversations,
        reason: `Plan ${plan} permite ${limits.conversationsPerMonth} conversaciones/mes`,
      };
    }
    return { allowed: true, limit: limits.conversationsPerMonth, current: usage.conversations };
  }

  if (kind === "tokens") {
    const usage = await getMonthlyUsage(workspaceId, tx);
    const total = usage.tokensIn + usage.tokensOut;
    if (total >= limits.tokensPerMonth) {
      return {
        allowed: false,
        limit: limits.tokensPerMonth,
        current: total,
        reason: `Plan ${plan} permite ${limits.tokensPerMonth} tokens/mes`,
      };
    }
    return { allowed: true, limit: limits.tokensPerMonth, current: total };
  }

  // Resource-count quotas
  const db = tx ?? getDb();
  let current = 0;
  if (kind === "agents") {
    const r = await db
      .select({ count: schema.agents.id })
      .from(schema.agents)
      .where(eq(schema.agents.workspaceId, workspaceId));
    current = r.length;
  } else if (kind === "flows") {
    const r = await db
      .select({ count: schema.flows.id })
      .from(schema.flows)
      .where(eq(schema.flows.workspaceId, workspaceId));
    current = r.length;
  } else if (kind === "members") {
    const r = await db
      .select({ count: schema.workspaceMembers.id })
      .from(schema.workspaceMembers)
      .where(eq(schema.workspaceMembers.workspaceId, workspaceId));
    current = r.length;
  } else if (kind === "knowledgeBases") {
    const r = await db
      .select({ count: schema.knowledgeBases.id })
      .from(schema.knowledgeBases)
      .where(eq(schema.knowledgeBases.workspaceId, workspaceId));
    current = r.length;
  }
  const limit =
    limits[kind === "knowledgeBases" ? "knowledgeBases" : (kind as keyof typeof limits)];
  if (typeof limit === "number" && current >= limit) {
    return {
      allowed: false,
      limit,
      current,
      reason: `Plan ${plan} permite ${limit} ${kind}`,
    };
  }
  return { allowed: true, limit: typeof limit === "number" ? limit : undefined, current };
}
