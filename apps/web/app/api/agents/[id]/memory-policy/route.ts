// apps/web/app/api/agents/[id]/memory-policy/route.ts
//
// GET  /api/agents/[id]/memory-policy — read the agent's memory policy.
// PATCH /api/agents/[id]/memory-policy — partial update.
//
// The policy lives on `agent.memory_policy` (jsonb, migration 0036).
// Default values come from `DEFAULT_AGENT_MEMORY_POLICY` in the
// mnemosyne package. PATCH validates the shape via
// `parseAgentMemoryPolicy` BEFORE persisting so a malformed body can
// never corrupt the column.
//
// RBAC: GET = viewer+ (operators reading config). PATCH = editor+
// (config mutation gated to writers).
import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@orchester/db";
import {
  DEFAULT_AGENT_MEMORY_POLICY,
  parseAgentMemoryPolicy,
  type AgentMemoryPolicy,
} from "@mnemosyne/core";
import { requireAuth, isAuthContext } from "@/lib/auth-guards";
import { parseBody } from "@/lib/validation";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

// Zod-validate the body's *shape* first, then re-validate via
// `parseAgentMemoryPolicy` for the semantic invariants
// (non-empty read_scopes, etc). Two layers because zod gives nicer
// 400 messages for shape errors and parseAgentMemoryPolicy enforces
// the cross-field invariants (e.g. read_scopes can't be []).
const policyBodySchema = z.object({
  write_scope_default: z.enum(["workspace", "agent", "conversation"]).optional(),
  read_scopes: z.array(z.enum(["workspace", "agent", "conversation"])).optional(),
  sensitive_categories: z.array(z.string().trim().min(1).max(100)).optional(),
});

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuth({ minRole: "viewer" });
  if (!isAuthContext(ctx)) return ctx;
  const { id } = await params;

  const db = getDb();
  const rows = await db
    .select({
      id: schema.agents.id,
      memoryPolicy: schema.agents.memoryPolicy,
    })
    .from(schema.agents)
    .where(and(eq(schema.agents.id, id), eq(schema.agents.workspaceId, ctx.workspace.id)))
    .limit(1);

  const row = rows[0];
  if (!row) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  // Defensive fallback: if the column is somehow null (e.g. a row
  // predating the migration in a partially-rolled-out env), return
  // the canonical default rather than crashing the UI.
  const policy = (row.memoryPolicy as AgentMemoryPolicy | null) ?? DEFAULT_AGENT_MEMORY_POLICY;

  return NextResponse.json({ id: row.id, memoryPolicy: policy });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuth({ minRole: "editor" });
  if (!isAuthContext(ctx)) return ctx;
  const { id } = await params;

  const parsed = await parseBody(req, policyBodySchema);
  if (!parsed.ok) return parsed.response;
  const patch = parsed.data;

  // Need to read the current row first so we can merge against it —
  // PATCH semantics: partial update, unspecified fields are left alone.
  const db = getDb();
  const rows = await db
    .select({
      id: schema.agents.id,
      memoryPolicy: schema.agents.memoryPolicy,
    })
    .from(schema.agents)
    .where(and(eq(schema.agents.id, id), eq(schema.agents.workspaceId, ctx.workspace.id)))
    .limit(1);

  const row = rows[0];
  if (!row) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  const current: AgentMemoryPolicy =
    (row.memoryPolicy as AgentMemoryPolicy | null) ?? DEFAULT_AGENT_MEMORY_POLICY;
  const merged = {
    write_scope_default: patch.write_scope_default ?? current.write_scope_default,
    read_scopes: patch.read_scopes ?? current.read_scopes,
    sensitive_categories: patch.sensitive_categories ?? current.sensitive_categories,
  };

  // Validate the merged result. Throws on invariant violations
  // (e.g. read_scopes=[]) which we map to a 400.
  let validated: AgentMemoryPolicy;
  try {
    validated = parseAgentMemoryPolicy(merged);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Invalid memory_policy";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  await db
    .update(schema.agents)
    .set({ memoryPolicy: validated, updatedAt: new Date() })
    .where(and(eq(schema.agents.id, id), eq(schema.agents.workspaceId, ctx.workspace.id)));

  await logAudit({
    workspaceId: ctx.workspace.id,
    userId: ctx.user.id,
    action: "agent.memory_policy.update",
    resource: "agent",
    resourceId: id,
    after: { memoryPolicy: validated },
  });

  return NextResponse.json({ id, memoryPolicy: validated });
}
