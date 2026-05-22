import "server-only";
import { getDb, schema } from "@orchester/db";
import { lt } from "drizzle-orm";
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
}

export async function purgeOldData(opts?: {
  runsDays?: number;
  deliveriesDays?: number;
}): Promise<PurgeResult> {
  const runsDays = opts?.runsDays ?? envDays("RETENTION_RUNS_DAYS", 30);
  const deliveriesDays = opts?.deliveriesDays ?? envDays("RETENTION_DELIVERIES_DAYS", 30);
  const db = getDb();

  const result: PurgeResult = { runsDeleted: 0, deliveriesDeleted: 0 };

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

  return result;
}
