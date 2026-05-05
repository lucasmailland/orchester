import { NextResponse } from "next/server";
import { getDb, schema } from "@orchester/db";
import { eq } from "drizzle-orm";
import { authenticateApiKey } from "@/lib/api-auth/key";
import { rateLimit } from "@/lib/rate-limit";

export async function GET(req: Request) {
  const auth = await authenticateApiKey(req.headers.get("authorization"));
  if (!auth)
    return NextResponse.json(
      { error: "Invalid or missing API key" },
      { status: 401 }
    );
  const rl = rateLimit(`api:${auth.workspaceId}`, { capacity: 60, refillPerSec: 1 });
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Rate limited" },
      { status: 429, headers: { "retry-after": String(Math.ceil(rl.retryAfterMs / 1000)) } }
    );
  }
  const db = getDb();
  const rows = await db
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
  return NextResponse.json({ data: rows });
}
