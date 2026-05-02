import { NextResponse } from "next/server";
import { getDb } from "@orchester/db";
import { sql } from "drizzle-orm";

export async function GET() {
  const start = Date.now();
  let db: "ok" | "fail" = "ok";
  let dbLatencyMs: number | null = null;
  try {
    const t = Date.now();
    await getDb().execute(sql`select 1`);
    dbLatencyMs = Date.now() - t;
  } catch {
    db = "fail";
  }
  const status = db === "ok" ? "healthy" : "degraded";
  return NextResponse.json(
    {
      status,
      version: process.env["npm_package_version"] ?? "dev",
      uptime: Math.floor(process.uptime()),
      checks: { db, dbLatencyMs },
      ts: new Date().toISOString(),
      durationMs: Date.now() - start,
    },
    { status: status === "healthy" ? 200 : 503 }
  );
}
