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
// The handler delegates to `listWorkspaceEntityFacts()`, which calls
// the @mnemosyne/server SDK.
//
// Returns active facts only — forgotten/merged facts stay hidden from
// the entity-detail view; the global facts route has the "show
// forgotten" toggle.
//
// RBAC: viewer+.
import { NextResponse } from "next/server";
import { requireAuth, isAuthContext } from "@/lib/auth-guards";
import { listWorkspaceEntityFacts } from "@/lib/mnemo/entities";

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

  try {
    const { mode, data } = await listWorkspaceEntityFacts(ctx.workspace.id, id, { limit });
    if (!data) {
      return NextResponse.json(
        { error: "Not found" },
        { status: 404, headers: { "X-Mnemo-Mode": mode } }
      );
    }
    return NextResponse.json(data, { headers: { "X-Mnemo-Mode": mode } });
  } catch (e) {
    console.error("[mnemo/entities/:id/facts] fetch failed", e);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
