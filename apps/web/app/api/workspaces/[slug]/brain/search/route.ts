// POST /api/workspaces/[slug]/brain/search — hybrid recall query
//
// @deprecated Use `/api/mnemo/recall-unified` instead. Backed by the
// legacy `brain_fact` recall path — see ../facts/route.ts for the
// deprecation rationale.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, isAuthContext } from "@/lib/auth-guards";
import { parseBody } from "@/lib/validation";
import { resolveBySlug } from "@/lib/tenant/resolve";
import { isAccessible } from "@/lib/tenant/lifecycle";
import { assertCan } from "@/lib/rbac";
import { searchBrain } from "@/lib/brain";

const SearchSchema = z.object({
  query: z.string().min(1).max(500),
  topK: z.number().min(1).max(20).default(5),
  agentId: z.string().optional(),
  scope: z.enum(["global", "conversation", "employee", "team"]).optional(),
  scopeRef: z.string().optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const ctx = await requireAuth({ minRole: "viewer" });
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
    assertCan(ctx.role, "brain.read");
  } catch {
    return NextResponse.json({ error: "role_insufficient" }, { status: 403 });
  }

  const parsed = await parseBody(req, SearchSchema);
  if (!parsed.ok) return parsed.response;

  const hits = await searchBrain({
    workspaceId: ws.id,
    query: parsed.data.query,
    topK: parsed.data.topK,
    ...(parsed.data.agentId ? { agentId: parsed.data.agentId } : {}),
    ...(parsed.data.scope ? { scope: parsed.data.scope } : {}),
    ...(parsed.data.scopeRef ? { scopeRef: parsed.data.scopeRef } : {}),
  });

  return NextResponse.json({
    hits: hits.map((h) => ({
      fact: { ...h.fact, embedding: undefined },
      score: h.score,
      reasons: h.reasons,
    })),
  });
}
