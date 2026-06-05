import { NextResponse } from "next/server";
import { getDb } from "@orchester/db";
import { sql } from "drizzle-orm";

/**
 * GET /api/health — public health check.
 *
 * Devuelve 200 si el servicio puede atender requests, 503 si no.
 * NO requiere auth (lo usan load balancers, uptime monitors, k8s liveness).
 *
 * Checks:
 *   - DB pingable (`SELECT 1`)
 *   - DB schema aplicado (`workspace` table existe)
 *   - DB latency razonable (<1000ms warning, <5000ms fail)
 *
 * NO incluye business-level checks (provider keys, agent activity, etc.) —
 * para eso está `/api/admin/health-detailed` (auth-protected).
 *
 * Cache: respuestas no se cachean (siempre `Cache-Control: no-store`).
 */
export async function GET() {
  const start = Date.now();
  const checks: Record<string, { ok: boolean; latencyMs?: number; note?: string }> = {};

  // 1. DB ping
  try {
    const t = Date.now();
    await getDb().execute(sql`select 1`);
    const lat = Date.now() - t;
    checks["db_ping"] = {
      ok: lat < 5000,
      latencyMs: lat,
      ...(lat > 1000 ? { note: "high latency" } : {}),
    };
  } catch (e) {
    checks["db_ping"] = { ok: false, note: e instanceof Error ? e.message : "unknown" };
  }

  // 2. Schema applied
  try {
    await getDb().execute(sql`SELECT 1 FROM workspace LIMIT 1`);
    checks["db_schema"] = { ok: true };
  } catch {
    checks["db_schema"] = {
      ok: false,
      note: "workspace table missing — run pnpm --filter @orchester/db push",
    };
  }

  const allOk = Object.values(checks).every((c) => c.ok);
  const status = allOk ? "healthy" : "degraded";

  return NextResponse.json(
    {
      status,
      version: process.env["npm_package_version"] ?? "dev",
      uptime: Math.floor(process.uptime()),
      checks,
      ts: new Date().toISOString(),
      durationMs: Date.now() - start,
    },
    {
      status: allOk ? 200 : 503,
      headers: { "cache-control": "no-store, max-age=0" },
    }
  );
}
