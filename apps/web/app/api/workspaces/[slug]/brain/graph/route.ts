// GET  /api/workspaces/[slug]/brain/graph   — entity-relationship graph for Brain Inspector
import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthContext } from "@/lib/auth-guards";
import { resolveBySlug } from "@/lib/tenant/resolve";
import { isAccessible } from "@/lib/tenant/lifecycle";
import { assertCan } from "@/lib/rbac";
import { withMnemoTx, buildGraphQuery } from "@orchester/mnemosyne";

export const dynamic = "force-dynamic";

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
  const focusParam = url.searchParams.get("focus");
  // Entity IDs are cuid2-based with a "ment_" prefix (e.g. ment_<24 lowercase alphanumeric chars>).
  // Reject anything that doesn't match to prevent injection / unexpected query shapes.
  if (focusParam && !/^ment_[a-z0-9]{24}$/.test(focusParam)) {
    return NextResponse.json({ error: "invalid_focus_param" }, { status: 400 });
  }
  const graphOpts = focusParam ? { focusEntityId: focusParam } : {};

  try {
    const graph = await withMnemoTx(ws.id, (tx) => buildGraphQuery(tx, ws.id, graphOpts));
    return NextResponse.json(graph, {
      headers: { "Cache-Control": "private, max-age=30" },
    });
  } catch (e) {
    console.error("[brain/graph] failed to build graph", e);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
