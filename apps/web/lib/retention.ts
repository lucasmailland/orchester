import "server-only";
import { getDb, schema } from "@orchester/db";
import { and, lt, sql } from "drizzle-orm";
import { safeLogError } from "./safe-log";

/**
 * Retención de datos (finding G1-1).
 *
 * Barre periódicamente las tablas que crecen de forma ilimitada y no tienen
 * valor histórico más allá de unas semanas:
 *   - flow_run        → borra runs viejos. flow_run_step cae por cascade FK
 *                       (onDelete: "cascade" en schema/flows.ts).
 *   - webhook_delivery → borra entregas viejas (log de auditoría de webhooks).
 *
 * Thresholds configurables por env:
 *   RETENTION_RUNS_DAYS        (default 30) — antigüedad de flow_run a purgar
 *   RETENTION_DELIVERIES_DAYS  (default 30) — antigüedad de webhook_delivery
 *
 * ── Media generada (finding E4-1) ──────────────────────────────────────────
 * La media generada por nodos AI se guarda en object storage bajo los prefijos
 * `${workspaceId}/ai-images/...` y `${workspaceId}/ai-audio/...` (ver
 * lib/ai/run.ts → makeKey). NO existe un índice en la DB que asocie cada objeto
 * a un run concreto ni a su fecha de creación, así que NO podemos atribuir de
 * forma segura un objeto a un run expirado para borrarlo desde acá.
 *
 * Decisión: el TTL de media se delega a **reglas de lifecycle de S3** (o del
 * bucket compatible), que expiran objetos por edad de forma nativa y barata —
 * la herramienta correcta para expiry de objetos. Configurar p.ej. una regla
 * de expiración a 30 días sobre los prefijos `ai-images/` y `ai-audio/`.
 * Acá NO borramos media a ciegas: hacerlo arriesga eliminar objetos aún
 * referenciados por runs vigentes. La limpieza por workspace sí ocurre en el
 * delete del workspace (M4-1, deleteByPrefix).
 */

function envDays(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function cutoff(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

export interface PurgeResult {
  runsDeleted: number;
  deliveriesDeleted: number;
  auditLogsDeleted: number;
  usageEventsDeleted: number;
  messagesDeleted: number;
  flowVersionsDeleted: number;
}

// Cross-tenant by design: deletes rows across every workspace. The caller
// MUST pass a tx opened by `withCrossTenantAdmin` — defensive `?? getDb()`
// fallback was masking future regressions where a refactor accidentally
// dropped the wrapper and the DELETEs silently no-op'd under FORCE RLS.
type DbOrTx =
  | ReturnType<typeof getDb>
  | Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

export async function purgeOldData(opts: {
  runsDays?: number;
  deliveriesDays?: number;
  auditLogsDays?: number;
  usageEventsDays?: number;
  messagesDays?: number;
  flowVersionsKeepLast?: number;
  db: DbOrTx;
}): Promise<PurgeResult> {
  const runsDays = opts.runsDays ?? envDays("RETENTION_RUNS_DAYS", 30);
  const deliveriesDays = opts.deliveriesDays ?? envDays("RETENTION_DELIVERIES_DAYS", 30);
  // Defaults conservadores y compliance-friendly:
  //  - audit_logs 365d (forensics)
  //  - usage_events 90d (billing investigations típicas)
  //  - messages 180d desde una conv CERRADA (conversations activas no se tocan)
  //  - flow_versions: mantenemos las últimas N por flow (20) en vez de por edad
  const auditLogsDays = opts.auditLogsDays ?? envDays("RETENTION_AUDIT_DAYS", 365);
  const usageEventsDays = opts.usageEventsDays ?? envDays("RETENTION_USAGE_DAYS", 90);
  const messagesDays = opts.messagesDays ?? envDays("RETENTION_MESSAGES_DAYS", 180);
  const flowVersionsKeepLast =
    opts.flowVersionsKeepLast ?? envDays("RETENTION_FLOW_VERSIONS_KEEP", 20);
  const db = opts.db;

  const result: PurgeResult = {
    runsDeleted: 0,
    deliveriesDeleted: 0,
    auditLogsDeleted: 0,
    usageEventsDeleted: 0,
    messagesDeleted: 0,
    flowVersionsDeleted: 0,
  };

  // ── flow_run (cascade borra flow_run_step) ──────────────────────────────
  // Filtramos por startedAt: un run iniciado hace >runsDays ya está terminado
  // de sobra (el reaper marca como failed los colgados en ≤5 min).
  try {
    const rows = await db
      .delete(schema.flowRuns)
      .where(lt(schema.flowRuns.startedAt, cutoff(runsDays)))
      .returning({ id: schema.flowRuns.id });
    result.runsDeleted = rows.length;
  } catch (e) {
    safeLogError("[retention] purge flow_runs failed:", e);
  }

  // ── webhook_delivery ─────────────────────────────────────────────────────
  try {
    const rows = await db
      .delete(schema.webhookDeliveries)
      .where(lt(schema.webhookDeliveries.createdAt, cutoff(deliveriesDays)))
      .returning({ id: schema.webhookDeliveries.id });
    result.deliveriesDeleted = rows.length;
  } catch (e) {
    safeLogError("[retention] purge webhook_deliveries failed:", e);
  }

  // ── audit_log + audit_log_legacy ────────────────────────────────────────
  // Default 365d para mantener trazabilidad forense de un año. Barremos las
  // dos tablas con el mismo umbral: la nueva `audit_log` (con hash chain,
  // ver lib/audit/log.ts) y la `audit_log_legacy` que sigue conteniendo las
  // entries pre-hash-chain hasta que se vacíen por edad.
  try {
    const newRows = await db
      .delete(schema.auditLog)
      .where(lt(schema.auditLog.createdAt, cutoff(auditLogsDays)))
      .returning({ id: schema.auditLog.id });
    const legacyRows = await db
      .delete(schema.auditLogsLegacy)
      .where(lt(schema.auditLogsLegacy.createdAt, cutoff(auditLogsDays)))
      .returning({ id: schema.auditLogsLegacy.id });
    result.auditLogsDeleted = newRows.length + legacyRows.length;
  } catch (e) {
    safeLogError("[retention] purge audit_logs failed:", e);
  }

  // ── usage_event ──────────────────────────────────────────────────────────
  // 90d alcanza para investigar billing del período anterior. Para histórico
  // largo plazo conviene un rollup mensual en una tabla aparte (TODO).
  try {
    const rows = await db
      .delete(schema.usageEvents)
      .where(lt(schema.usageEvents.createdAt, cutoff(usageEventsDays)))
      .returning({ id: schema.usageEvents.id });
    result.usageEventsDeleted = rows.length;
  } catch (e) {
    safeLogError("[retention] purge usage_events failed:", e);
  }

  // ── messages (sólo de conversations CERRADAS) ────────────────────────────
  // Nunca tocamos mensajes de conversations abiertas; conservar la conversation
  // viva no debería perder contexto. Borramos mensajes con createdAt < cutoff
  // cuya conversation está cerrada (`closedAt is not null`).
  try {
    const rows = await db
      .delete(schema.messages)
      .where(
        and(
          lt(schema.messages.createdAt, cutoff(messagesDays)),
          sql`${schema.messages.conversationId} IN (
            SELECT id FROM ${schema.conversations} WHERE ended_at IS NOT NULL
          )`
        )
      )
      .returning({ id: schema.messages.id });
    result.messagesDeleted = rows.length;
  } catch (e) {
    safeLogError("[retention] purge messages failed:", e);
  }

  // ── flow_version: mantener las últimas N por flow ───────────────────────
  // No vamos por edad: una flow estable puede tener una versión vieja vigente.
  // Mantenemos las últimas N (default 20) por flow.
  try {
    const deleted = await db.execute(sql`
      DELETE FROM ${schema.flowVersions}
      WHERE id IN (
        SELECT id FROM (
          SELECT id, ROW_NUMBER() OVER (
            PARTITION BY flow_id ORDER BY created_at DESC
          ) AS rn
          FROM ${schema.flowVersions}
        ) ranked
        WHERE ranked.rn > ${flowVersionsKeepLast}
      )
    `);
    // drizzle execute() devuelve un objeto del driver; el row count vive en .count
    // o en .rowCount según el driver. Best-effort, no rompemos si no está.
    const rc =
      (deleted as unknown as { count?: number; rowCount?: number }).count ??
      (deleted as unknown as { rowCount?: number }).rowCount ??
      0;
    result.flowVersionsDeleted = rc;
  } catch (e) {
    safeLogError("[retention] purge flow_versions failed:", e);
  }

  return result;
}
