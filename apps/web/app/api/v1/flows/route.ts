import { NextResponse } from "next/server";
import { getDb, schema } from "@orchester/db";
import { eq, sql } from "drizzle-orm";
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
  const db = getDb();
  const rows = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.workspace_id', ${auth.workspaceId}, true)`);
    return tx
      .select({
        id: schema.flows.id,
        name: schema.flows.name,
        description: schema.flows.description,
        status: schema.flows.status,
        version: schema.flows.version,
      })
      .from(schema.flows)
      .where(eq(schema.flows.workspaceId, auth.workspaceId));
  });
  return NextResponse.json({ data: rows });
}
