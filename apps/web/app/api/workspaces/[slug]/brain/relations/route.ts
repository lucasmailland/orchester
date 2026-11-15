// GET  /api/workspaces/[slug]/brain/relations?status=pending&limit=50
// POST /api/workspaces/[slug]/brain/relations   (manual edge draw — Phase 3)
//
// GET  → viewer+ (brain.read). Lists relations by judgmentStatus.
// POST → editor+ (brain.write). Creates a user-marked relation.
import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthContext } from "@/lib/auth-guards";
import { resolveBySlug } from "@/lib/tenant/resolve";
import { isAccessible } from "@/lib/tenant/lifecycle";
import { assertCan } from "@/lib/rbac";
import { parseBody } from "@/lib/validation";
import { logAudit } from "@/lib/audit";
import { listWorkspaceRelations, createWorkspaceRelation } from "@/lib/mnemo/relations";
import { relationVerbEnum, relationKindEnum } from "@/lib/mnemo/relation-verbs";
import { z } from "zod";

export const dynamic = "force-dynamic";

const JUDGMENT_STATUSES = new Set(["pending", "judged", "dismissed"]);

const createRelationSchema = z.object({
  sourceKind: relationKindEnum,
  sourceId: z.string().min(1),
  targetKind: relationKindEnum,
  targetId: z.string().min(1),
  relation: relationVerbEnum,
  reason: z.string().max(2000).optional(),
  confidence: z.number().min(0).max(1).optional(),
});

async function resolveWs(slug: string, ctx: { workspace: { id: string }; role: string }) {
  const ws = await resolveBySlug(slug);
  if (!ws) return { error: NextResponse.json({ error: "workspace_not_found" }, { status: 404 }) };
  if (ws.id !== ctx.workspace.id)
    return { error: NextResponse.json({ error: "forbidden" }, { status: 403 }) };
  const access = isAccessible(ws);
  if (!access.ok)
    return {
      error: NextResponse.json(
        { error: access.reason },
        { status: access.reason === "deleted" ? 410 : 423 }
      ),
    };
  return { ws };
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const ctx = await requireAuth({ minRole: "viewer" });
  if (!isAuthContext(ctx)) return ctx;
  const { slug } = await params;
  const r = await resolveWs(slug, ctx);
  if (r.error) return r.error;
  try {
    assertCan(ctx.role, "brain.read");
  } catch {
    return NextResponse.json({ error: "role_insufficient" }, { status: 403 });
  }

  const url = new URL(req.url);
  const statusRaw = url.searchParams.get("status") ?? "pending";
  if (!JUDGMENT_STATUSES.has(statusRaw)) {
    return NextResponse.json({ error: "invalid_status" }, { status: 400 });
  }
  const limitRaw = Number(url.searchParams.get("limit") ?? "50");
  const limit =
    Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(Math.floor(limitRaw), 200) : 50;

  try {
    const { mode, data } = await listWorkspaceRelations(ctx.workspace.id, {
      judgmentStatus: statusRaw as "pending" | "judged" | "dismissed",
      limit,
    });
    return NextResponse.json(data, { headers: { "X-Mnemo-Mode": mode } });
  } catch (e) {
    console.error("[brain/relations] list failed", e);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const ctx = await requireAuth({ minRole: "editor" });
  if (!isAuthContext(ctx)) return ctx;
  const { slug } = await params;
  const r = await resolveWs(slug, ctx);
  if (r.error) return r.error;
  try {
    assertCan(ctx.role, "brain.write");
  } catch {
    return NextResponse.json({ error: "role_insufficient" }, { status: 403 });
  }

  const parsed = await parseBody(req, createRelationSchema);
  if (!parsed.ok) return parsed.response;
  const b = parsed.data;

  try {
    const { mode, data: created } = await createWorkspaceRelation(ctx.workspace.id, {
      sourceKind: b.sourceKind,
      sourceId: b.sourceId,
      targetKind: b.targetKind,
      targetId: b.targetId,
      relation: b.relation,
      // Manual draws are user-judged immediately (no pending queue round-trip).
      judgmentStatus: "judged",
      markedByKind: "user",
      markedByUserId: ctx.user.id,
      ...(b.reason !== undefined ? { reason: b.reason } : {}),
      ...(b.confidence !== undefined ? { confidence: b.confidence } : {}),
    });
    await logAudit({
      workspaceId: ctx.workspace.id,
      userId: ctx.user.id,
      action: "mnemo.relation.create",
      resource: "mnemo_relation",
      resourceId: created.id,
      after: {
        relation: created.relation,
        source: `${created.sourceKind}:${created.sourceId}`,
        target: `${created.targetKind}:${created.targetId}`,
      },
    });
    return NextResponse.json(created, { status: 201, headers: { "X-Mnemo-Mode": mode } });
  } catch (e) {
    console.error("[brain/relations] create failed", e);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
