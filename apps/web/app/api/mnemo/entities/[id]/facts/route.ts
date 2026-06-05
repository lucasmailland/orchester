// apps/web/app/api/mnemo/entities/[id]/facts/route.ts
//
// Mnemosyne v1.6 G2 — paginated facts linked to a specific entity.
//
// GET /api/mnemo/entities/[id]/facts?limit=100
//
// The reverse of `mnemo_fact.entity_id → mnemo_entity.id`. Powers the
// entity-detail page in the inspector: "show me everything this
// person/org/project has been mentioned in".
//
// Returns active facts only — forgotten/merged facts stay hidden from
// the entity-detail view; the global facts route has the "show
// forgotten" toggle.
//
// RBAC: viewer+.
// RLS: read goes through `withMnemoTx(workspace.id, ...)` so
// `app.workspace_id` is set and the role is downgraded to app_user.
// The mnemo_entity row is verified to exist in the workspace before
// the fact query runs — a tighter 404 than relying on "RLS returns []".
import { NextResponse } from "next/server";
import { getEntity, listFactsForEntity, withMnemoTx } from "@mnemosyne/core";
import { requireAuth, isAuthContext } from "@/lib/auth-guards";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuth({ minRole: "viewer" });
  if (!isAuthContext(ctx)) return ctx;

  const { id } = await params;
  if (!id || id.length < 4) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const url = new URL(req.url);
  const limitRaw = Number(url.searchParams.get("limit") ?? "100");
  const limit =
    Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(Math.floor(limitRaw), 500) : 100;

  const result = await withMnemoTx(ctx.workspace.id, async (tx) => {
    const entity = await getEntity(ctx.workspace.id, id, tx);
    if (!entity) return null;
    const facts = await listFactsForEntity({
      workspaceId: ctx.workspace.id,
      entityId: id,
      limit,
      tx,
    });
    return { entity, facts };
  });

  if (!result) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(result);
}
