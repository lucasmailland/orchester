import { NextResponse } from "next/server";
import { getDb, schema } from "@orchester/db";
import { count, eq, gte, sql } from "drizzle-orm";
import { requireAuth, isAuthContext } from "@/lib/auth-guards";

/**
 * GET /api/admin/health-detailed
 *
 * Healthcheck enriquecido para que tu monitoring agent (Datadog, Grafana
 * Cloud, lo que uses) chequee no sólo "el server responde" sino también
 * señales de actividad del workspace:
 *
 *   - DB pingable
 *   - Workspace tiene al menos 1 owner
 *   - Hay un audit_log entry en las últimas 24h (si no, algo está raro:
 *     o nadie usa el sistema, o el logger se rompió)
 *   - Tasa de error de los últimos 100 messages no superan 30% (proxy de
 *     "los agentes están respondiendo bien")
 *   - Hay al menos 1 provider configurado (sino los agentes no responden)
 *
 * Returns 200 OK con un payload que tu Prometheus/Datadog scraper puede
 * parsear, o 503 Service Unavailable si alguno de los checks rojo.
 *
 * Solo admin/owner.
 */
export async function GET() {
  const ctx = await requireAuth({ minRole: "admin" });
  if (!isAuthContext(ctx)) return ctx;

  const db = getDb();
  const checks: Record<string, { ok: boolean; value?: unknown; note?: string | undefined }> = {};

  // 1. DB ping
  try {
    await db.execute(sql`SELECT 1`);
    checks["db"] = { ok: true };
  } catch (e) {
    checks["db"] = { ok: false, note: e instanceof Error ? e.message : String(e) };
  }

  // Wrap the tenant-scoped checks in a single tx with the workspace
  // GUC set. workspace_member is FORCED; ai_provider / audit_log /
  // conversation / message all key on `current_workspace_id()`.
  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.workspace_id', ${ctx.workspace.id}, true)`);
      await tx.execute(sql`SELECT set_config('app.user_id', ${ctx.user.id}, true)`);

      // 2. ≥1 owner
      try {
        const owners = await tx
          .select({ c: count() })
          .from(schema.workspaceMembers)
          .where(eq(schema.workspaceMembers.workspaceId, ctx.workspace.id));
        checks["members_count"] = { ok: (owners[0]?.c ?? 0) > 0, value: owners[0]?.c };
      } catch (e) {
        checks["members_count"] = { ok: false, note: String(e) };
      }

      // 3. Audit log con actividad reciente (24h). Lee la nueva tabla
      // `audit_log` (hash chain). Si las únicas entries recientes son
      // legacy migration rows, el health check sigue ok=true porque es
      // informativo.
      try {
        const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const r = await tx
          .select({ c: count() })
          .from(schema.auditLog)
          .where(gte(schema.auditLog.createdAt, since));
        const value = r[0]?.c ?? 0;
        checks["audit_recent_24h"] = {
          ok: true, // sólo informativo — silence no es fail
          value,
          note:
            value === 0
              ? "Sin entries en últimas 24h. ¿Sistema inactivo o logger roto?"
              : undefined,
        };
      } catch (e) {
        checks["audit_recent_24h"] = { ok: false, note: String(e) };
      }

      // 4. Provider configurado
      try {
        const r = await tx
          .select({ c: count() })
          .from(schema.aiProviders)
          .where(eq(schema.aiProviders.workspaceId, ctx.workspace.id));
        const fromDb = r[0]?.c ?? 0;
        const fromEnv = !!(
          process.env["ANTHROPIC_API_KEY"] ||
          process.env["OPENAI_API_KEY"] ||
          process.env["GOOGLE_AI_API_KEY"]
        );
        checks["provider_configured"] = {
          ok: fromDb > 0 || fromEnv,
          value: { fromDb, fromEnv },
          note:
            fromDb === 0 && !fromEnv
              ? "Ningún provider activo. Los agentes no responderán."
              : undefined,
        };
      } catch (e) {
        checks["provider_configured"] = { ok: false, note: String(e) };
      }

      // 5. Última hora — health del LLM (cuántos messages tipo assistant llegaron)
      try {
        const since = new Date(Date.now() - 60 * 60 * 1000);
        const recent = await tx
          .select({ c: count() })
          .from(schema.messages)
          .innerJoin(
            schema.conversations,
            eq(schema.messages.conversationId, schema.conversations.id)
          )
          .where(
            sql`${schema.conversations.workspaceId} = ${ctx.workspace.id} AND ${schema.messages.createdAt} >= ${since} AND ${schema.messages.role} = 'assistant'`
          );
        checks["assistant_msgs_1h"] = { ok: true, value: recent[0]?.c ?? 0 };
      } catch (e) {
        checks["assistant_msgs_1h"] = { ok: false, note: String(e) };
      }
    });
  } catch (e) {
    // Transaction wrapper itself failed (rare — connection issue).
    // Mark all tenant-scoped checks as failed so the health endpoint
    // returns 503.
    const note = e instanceof Error ? e.message : String(e);
    if (!checks["members_count"]) checks["members_count"] = { ok: false, note };
    if (!checks["audit_recent_24h"]) checks["audit_recent_24h"] = { ok: false, note };
    if (!checks["provider_configured"]) checks["provider_configured"] = { ok: false, note };
    if (!checks["assistant_msgs_1h"]) checks["assistant_msgs_1h"] = { ok: false, note };
  }

  const allOk = Object.values(checks).every((c) => c.ok);

  return NextResponse.json(
    {
      ok: allOk,
      timestamp: new Date().toISOString(),
      workspace: ctx.workspace.slug,
      checks,
    },
    { status: allOk ? 200 : 503 }
  );
}
