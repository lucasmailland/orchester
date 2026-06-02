// GET  /api/workspaces/[slug]/brain/facts        — paginated list, filters
// POST /api/workspaces/[slug]/brain/facts        — manually create a fact (admin)
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { requireAuth, isAuthContext } from "@/lib/auth-guards";
import { parseBody } from "@/lib/validation";
import { resolveBySlug } from "@/lib/tenant/resolve";
import { isAccessible } from "@/lib/tenant/lifecycle";
import { assertCan } from "@/lib/rbac";
import { getDb } from "@orchester/db";
import { PoisoningRejectedError } from "@orchester/mnemosyne";
import { createFact, listFacts, withBrainTx } from "@/lib/brain";
import { appendAudit } from "@/lib/audit/log";

const ListSchema = z.object({
  agent: z.string().optional(),
  scope: z.enum(["global", "conversation", "employee", "team"]).optional(),
  scopeRef: z.string().optional(),
  status: z.enum(["active", "forgotten", "all"]).default("active"),
  limit: z.coerce.number().min(1).max(200).default(50),
  offset: z.coerce.number().min(0).default(0),
});

export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const ctx = await requireAuth({ minRole: "viewer" });
  if (!isAuthContext(ctx)) return ctx;
  const { slug } = await params;
  const ws = await resolveBySlug(slug);
  if (!ws) return NextResponse.json({ error: "workspace_not_found" }, { status: 404 });
  if (ws.id !== ctx.workspace.id) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const access = isAccessible(ws);
  if (!access.ok) {
    return NextResponse.json(
      { error: access.reason },
      { status: access.reason === "deleted" ? 410 : 423 }
    );
  }
  try {
    assertCan(ctx.role, "brain.read");
  } catch {
    return NextResponse.json({ error: "role_insufficient" }, { status: 403 });
  }

  const url = new URL(req.url);
  const parsed = ListSchema.safeParse({
    agent: url.searchParams.get("agent") ?? undefined,
    scope: url.searchParams.get("scope") ?? undefined,
    scopeRef: url.searchParams.get("scopeRef") ?? undefined,
    status: url.searchParams.get("status") ?? undefined,
    limit: url.searchParams.get("limit") ?? undefined,
    offset: url.searchParams.get("offset") ?? undefined,
  });
  if (!parsed.success) {
    // zod v4: `.flatten()` is deprecated, use the standalone helper.
    return NextResponse.json(
      { error: "validation_failed", fields: z.flattenError(parsed.error).fieldErrors },
      { status: 400 }
    );
  }

  const facts = await withBrainTx(ws.id, async (tx) =>
    listFacts({
      workspaceId: ws.id,
      ...(parsed.data.agent ? { agentId: parsed.data.agent } : {}),
      ...(parsed.data.scope ? { scope: parsed.data.scope } : {}),
      ...(parsed.data.scopeRef ? { scopeRef: parsed.data.scopeRef } : {}),
      status: parsed.data.status,
      limit: parsed.data.limit,
      offset: parsed.data.offset,
      tx,
    })
  );

  // Strip embeddings from the response — they're huge and useless to the UI.
  const sanitized = facts.map((f) => ({ ...f, embedding: undefined }));
  return NextResponse.json({ facts: sanitized });
}

const CreateSchema = z.object({
  agentId: z.string().optional(),
  scope: z.enum(["global", "conversation", "employee", "team"]),
  scopeRef: z.string().optional(),
  kind: z.enum(["preference", "trait", "event", "relationship", "skill", "concern", "other"]),
  subject: z.string().min(1).max(80),
  statement: z.string().min(10).max(400),
  confidence: z.number().min(0).max(1).default(0.7),
  pinned: z.boolean().default(false),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const ctx = await requireAuth({ minRole: "admin" });
  if (!isAuthContext(ctx)) return ctx;
  const { slug } = await params;
  const ws = await resolveBySlug(slug);
  if (!ws) return NextResponse.json({ error: "workspace_not_found" }, { status: 404 });
  if (ws.id !== ctx.workspace.id) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const access = isAccessible(ws);
  if (!access.ok) {
    return NextResponse.json(
      { error: access.reason },
      { status: access.reason === "deleted" ? 410 : 423 }
    );
  }
  try {
    assertCan(ctx.role, "brain.write");
  } catch {
    return NextResponse.json({ error: "role_insufficient" }, { status: 403 });
  }
  const parsed = await parseBody(req, CreateSchema);
  if (!parsed.ok) return parsed.response;

  // Touch getDb just to make linter happy (sql is also imported above for future expansion).
  void getDb;
  void sql;

  try {
    const fact = await withBrainTx(ws.id, async (tx) =>
      createFact({
        workspaceId: ws.id,
        ...(parsed.data.agentId ? { agentId: parsed.data.agentId } : {}),
        scope: parsed.data.scope,
        ...(parsed.data.scopeRef ? { scopeRef: parsed.data.scopeRef } : {}),
        kind: parsed.data.kind,
        subject: parsed.data.subject,
        statement: parsed.data.statement,
        confidence: parsed.data.confidence,
        pinned: parsed.data.pinned,
        tx,
      })
    );

    appendAudit(ws.id, {
      action: "brain.fact.create",
      actorUserId: ctx.user.id,
      actorKind: "user",
      targetType: "brain_fact",
      targetId: fact.id,
      meta: { subject: fact.subject, kind: fact.kind, scope: fact.scope },
    });

    return NextResponse.json({ fact: { ...fact, embedding: undefined } }, { status: 201 });
  } catch (e) {
    if (e instanceof PoisoningRejectedError) {
      const enforce = process.env["MNEMO_REJECT_POISONING"] !== "false";
      appendAudit(ws.id, {
        action: enforce ? "mnemo.fact.rejected_poisoning" : "mnemo.fact.poisoning_shadow_hit",
        actorUserId: ctx.user.id,
        actorKind: "user",
        targetType: "mnemo_fact",
        targetId: "(rejected)",
        meta: {
          findings: e.scan.findings,
          bytes: e.scan.bytes,
          enforce,
        },
      });
      return NextResponse.json(
        {
          error: "poisoning_rejected",
          enforce,
          findings: e.scan.findings,
          bytes: e.scan.bytes,
        },
        { status: 422 }
      );
    }
    throw e;
  }
}
