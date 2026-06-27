import { NextResponse } from "next/server";
import { getDb, schema } from "@orchester/db";
import { eq, sql } from "drizzle-orm";
import { authenticateApiKey } from "@/lib/api-auth/key";
import { hasScope } from "@/lib/api-auth/scopes";
import { rateLimit } from "@/lib/rate-limit";

export async function GET(req: Request) {
  const auth = await authenticateApiKey(req.headers.get("authorization"));
  if (!auth) return NextResponse.json({ error: "Invalid or missing API key" }, { status: 401 });
  if (!hasScope(auth.scopes, "agents:read")) {
    return NextResponse.json(
      { error: "insufficient_scope: agents:read required" },
      { status: 403 }
    );
  }
  const rl = await rateLimit(`api:${auth.workspaceId}`, { capacity: 60, refillPerSec: 1 });
  if (!rl.ok) {
    const retryAfterMs = rl.retryAfterMs ?? 1000;
    return NextResponse.json(
      { error: "Rate limited" },
      { status: 429, headers: { "retry-after": String(Math.ceil(retryAfterMs / 1000)) } }
    );
  }
  const db = getDb();
  // API-key-authenticated public endpoint: the key tells us the
  // workspace. Set the GUC inside a tx so FORCE RLS on `agent`
  // passes for this caller.
  const rows = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.workspace_id', ${auth.workspaceId}, true)`);
    return tx
      .select({
        id: schema.agents.id,
        name: schema.agents.name,
        role: schema.agents.role,
        kind: schema.agents.kind,
        model: schema.agents.model,
        status: schema.agents.status,
      })
      .from(schema.agents)
      .where(eq(schema.agents.workspaceId, auth.workspaceId));
  });
  return NextResponse.json({ data: rows });
}
