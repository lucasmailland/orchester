import { NextResponse } from "next/server";
import { requireAuth, isAuthContext } from "@/lib/auth-guards";
import { computeBlockers, loadFlowDeleteContext } from "@/lib/flows/delete-impact";

/** What deleting this flow would destroy, and what currently prevents it. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuth({ minRole: "editor" });
  if (!isAuthContext(ctx)) return ctx;
  const { id } = await params;
  const del = await loadFlowDeleteContext(ctx.workspace.id, id);
  if (!del) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({
    flow: { id: del.flow.id, name: del.flow.name },
    counts: del.counts,
    blockers: computeBlockers(del),
  });
}
