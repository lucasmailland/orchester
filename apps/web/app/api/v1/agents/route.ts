import { NextResponse } from "next/server";
import { getDb, schema } from "@orchester/db";
import { and, eq, gt, sql } from "drizzle-orm";
import { z } from "zod";
import { authenticateApiKey } from "@/lib/api-auth/key";
import { hasScope } from "@/lib/api-auth/scopes";
import { rateLimit } from "@/lib/rate-limit";
import { parseBody } from "@/lib/validation";
import { createId } from "@paralleldrive/cuid2";
import { checkQuota } from "@/lib/billing/quotas";
import { logAudit } from "@/lib/audit";

const AGENT_FIELDS = {
  id: schema.agents.id,
  name: schema.agents.name,
  role: schema.agents.role,
  kind: schema.agents.kind,
  model: schema.agents.model,
  status: schema.agents.status,
};

async function auth401(req: Request, scope: string) {
  const a = await authenticateApiKey(req.headers.get("authorization"));
  if (!a)
    return {
      auth: null,
      err: NextResponse.json({ error: "Invalid or missing API key" }, { status: 401 }),
    };
  if (!hasScope(a.scopes, scope))
    return {
      auth: null,
      err: NextResponse.json({ error: `insufficient_scope: ${scope} required` }, { status: 403 }),
    };
  const rl = await rateLimit(`api:${a.workspaceId}`, { capacity: 60, refillPerSec: 1 });
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
  return { auth: a, err: null };
}

export async function GET(req: Request) {
  const { auth, err } = await auth401(req, "agents:read");
  if (err) return err;

  const url = new URL(req.url);
  // 1..100; anything unparseable falls back to the default page size.
  const limit = Math.min(
    Math.max(Math.trunc(Number(url.searchParams.get("limit") ?? 25)) || 25, 1),
    100
  );
  const cursor = url.searchParams.get("cursor") ?? null;

  const db = getDb();
  const rows = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.workspace_id', ${auth!.workspaceId}, true)`);
    const conditions = cursor
      ? and(eq(schema.agents.workspaceId, auth!.workspaceId), gt(schema.agents.id, cursor))
      : eq(schema.agents.workspaceId, auth!.workspaceId);
    return tx
      .select(AGENT_FIELDS)
      .from(schema.agents)
      .where(conditions)
      .orderBy(schema.agents.id)
      .limit(limit + 1);
  });

  const hasMore = rows.length > limit;
  const data = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore ? data[data.length - 1]!.id : null;
  return NextResponse.json({ data, nextCursor });
}

const createAgentSchema = z.object({
  name: z.string().min(1).max(200),
  role: z.string().min(1).max(200),
  systemPrompt: z.string().min(1),
  model: z.string().optional(),
});

export async function POST(req: Request) {
  const { auth, err } = await auth401(req, "agents:write");
  if (err) return err;

  const parsed = await parseBody(req, createAgentSchema);
  if (!parsed.ok) return parsed.response;

  // Same plan limit as POST /api/agents: an API key is not a way around it.
  const quota = await checkQuota(auth!.workspaceId, "agents");
  if (!quota.allowed) {
    return NextResponse.json(
      { error: quota.reason ?? "Agent quota exceeded for your plan" },
      { status: 402 }
    );
  }

  const db = getDb();
  const id = createId();
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.workspace_id', ${auth!.workspaceId}, true)`);
    await tx.insert(schema.agents).values({
      id,
      workspaceId: auth!.workspaceId,
      name: parsed.data.name,
      role: parsed.data.role,
      systemPrompt: parsed.data.systemPrompt,
      ...(parsed.data.model ? { model: parsed.data.model } : {}),
      status: "draft",
    } as never);
  });

  await logAudit({
    workspaceId: auth!.workspaceId,
    action: "agent.create",
    resource: "agent",
    resourceId: id,
    actorKind: "api_key",
    after: { name: parsed.data.name, role: parsed.data.role },
  });
  return NextResponse.json({ data: { id, status: "draft" } }, { status: 201 });
}
