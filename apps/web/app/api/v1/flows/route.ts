import { NextResponse } from "next/server";
import { getDb, schema } from "@orchester/db";
import { and, eq, gt, sql } from "drizzle-orm";
import { authenticateApiKey } from "@/lib/api-auth/key";
import { hasScope } from "@/lib/api-auth/scopes";
import { rateLimit } from "@/lib/rate-limit";

export async function GET(req: Request) {
  const auth = await authenticateApiKey(req.headers.get("authorization"));
  if (!auth) return NextResponse.json({ error: "Invalid API key" }, { status: 401 });
  if (!hasScope(auth.scopes, "flows:read")) {
    return NextResponse.json({ error: "insufficient_scope: flows:read required" }, { status: 403 });
  }
  const rl = await rateLimit(`api:${auth.workspaceId}`, { capacity: 60, refillPerSec: 1 });
  if (!rl.ok) return NextResponse.json({ error: "Rate limited" }, { status: 429 });

  const url = new URL(req.url);
  const limit = Math.min(Number(url.searchParams.get("limit") ?? "25"), 100);
  const cursor = url.searchParams.get("cursor") ?? null;

  const db = getDb();
  const rows = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.workspace_id', ${auth.workspaceId}, true)`);
    const conditions = cursor
      ? and(eq(schema.flows.workspaceId, auth.workspaceId), gt(schema.flows.id, cursor))
      : eq(schema.flows.workspaceId, auth.workspaceId);
    return tx
      .select({
        id: schema.flows.id,
        name: schema.flows.name,
        description: schema.flows.description,
        status: schema.flows.status,
        version: schema.flows.version,
      })
      .from(schema.flows)
      .where(conditions)
      .orderBy(schema.flows.id)
      .limit(limit + 1);
  });

  const hasMore = rows.length > limit;
  const data = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore ? data[data.length - 1]!.id : null;
  return NextResponse.json({ data, nextCursor });
}
