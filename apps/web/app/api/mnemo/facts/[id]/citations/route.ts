// apps/web/app/api/mnemo/facts/[id]/citations/route.ts
//
// GET /api/mnemo/facts/[id]/citations — return the source messages
// that produced this fact. Hybrid by design: the source-message-id
// list comes from the mnemo side (in service mode through the SDK,
// in library mode through a raw query), then orchester JOINs its
// own `message` + `conversation` tables host-side to materialise the
// actual citation rows (role, content, conversation id, timestamps).
//
// `message` lives outside the mnemo_* tables and scopes via
// `conversation.workspace_id`, so the JOIN predicate
// `c.workspace_id = ${workspaceId}` enforces the tenant boundary at
// the row level.
//
// RBAC: viewer+.
import { NextResponse } from "next/server";
import { requireAuth, isAuthContext } from "@/lib/auth-guards";
import { getWorkspaceFactCitations } from "@/lib/mnemo/facts";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuth({ minRole: "viewer" });
  if (!isAuthContext(ctx)) return ctx;
  const { id } = await params;

  const result = await getWorkspaceFactCitations(ctx.workspace.id, id);
  if (!result.data) {
    const r = NextResponse.json({ error: "Not found" }, { status: 404 });
    r.headers.set("X-Mnemo-Mode", result.mode);
    return r;
  }
  const r = NextResponse.json(result.data);
  r.headers.set("X-Mnemo-Mode", result.mode);
  return r;
}
