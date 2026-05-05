import { NextResponse } from "next/server";
import { getDb, schema } from "@orchester/db";
import { eq } from "drizzle-orm";
import { authenticateApiKey } from "@/lib/api-auth/key";
import { rateLimit } from "@/lib/rate-limit";

export async function GET(req: Request) {
  const auth = await authenticateApiKey(req.headers.get("authorization"));
  if (!auth) return NextResponse.json({ error: "Invalid API key" }, { status: 401 });
  const rl = rateLimit(`api:${auth.workspaceId}`, { capacity: 60, refillPerSec: 1 });
  if (!rl.ok) return NextResponse.json({ error: "Rate limited" }, { status: 429 });
  const db = getDb();
  const rows = await db
    .select({
      id: schema.flows.id,
      name: schema.flows.name,
      description: schema.flows.description,
      status: schema.flows.status,
      version: schema.flows.version,
    })
    .from(schema.flows)
    .where(eq(schema.flows.workspaceId, auth.workspaceId));
  return NextResponse.json({ data: rows });
}
