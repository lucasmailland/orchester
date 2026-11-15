import { NextResponse } from "next/server";
import { getDb, schema } from "@orchester/db";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { authenticateApiKey } from "@/lib/api-auth/key";
import { hasScope } from "@/lib/api-auth/scopes";
import { rateLimit } from "@/lib/rate-limit";
import { parseBody } from "@/lib/validation";

async function withAuth(req: Request, scope: string) {
  const auth = await authenticateApiKey(req.headers.get("authorization"));
  if (!auth)
    return {
      auth: null,
      err: NextResponse.json({ error: "Invalid or missing API key" }, { status: 401 }),
    };
  if (!hasScope(auth.scopes, scope))
    return {
      auth: null,
      err: NextResponse.json({ error: `insufficient_scope: ${scope} required` }, { status: 403 }),
    };
  const rl = await rateLimit(`api:${auth.workspaceId}`, { capacity: 60, refillPerSec: 1 });
  if (!rl.ok) {
    const retryAfterMs = rl.retryAfterMs ?? 1000;
    return {
      auth: null,
      err: NextResponse.json(
        { error: "Rate limited" },
        { status: 429, headers: { "retry-after": String(Math.ceil(retryAfterMs / 1000)) } }
      ),
    };
  }
  return { auth, err: null };
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { auth, err } = await withAuth(req, "agents:read");
  if (err) return err;
  const { id } = await params;

  const db = getDb();
  const row = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.workspace_id', ${auth!.workspaceId}, true)`);
    const rows = await tx
      .select()
      .from(schema.agents)
      .where(and(eq(schema.agents.id, id), eq(schema.agents.workspaceId, auth!.workspaceId)))
      .limit(1);
    return rows[0] ?? null;
  });

  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ data: row });
}

const patchAgentSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  role: z.string().min(1).max(200).optional(),
  systemPrompt: z.string().min(1).optional(),
  model: z.string().optional(),
  status: z.enum(["draft", "active", "inactive"]).optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { auth, err } = await withAuth(req, "agents:write");
  if (err) return err;
  const { id } = await params;

  const parsed = await parseBody(req, patchAgentSchema);
  if (!parsed.ok) return parsed.response;

  const db = getDb();
  const updated = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.workspace_id', ${auth!.workspaceId}, true)`);
    const rows = await tx
      .update(schema.agents)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(and(eq(schema.agents.id, id), eq(schema.agents.workspaceId, auth!.workspaceId)))
      .returning({ id: schema.agents.id, status: schema.agents.status });
    return rows[0] ?? null;
  });

  if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ data: updated });
}
