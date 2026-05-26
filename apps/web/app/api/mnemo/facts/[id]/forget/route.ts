// apps/web/app/api/mnemo/facts/[id]/forget/route.ts
//
// POST /api/mnemo/facts/[id]/forget — soft-delete a fact.
// Sets `status='forgotten'` so the row is preserved for audit but
// removed from recall (the recall layer filters on status='active').
// Use the matching `/restore` route to bring it back.
//
// RBAC: editor+.
import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { schema } from "@orchester/db";
import { withMnemoTx } from "@orchester/mnemosyne";
import { requireAuth, isAuthContext } from "@/lib/auth-guards";
import { parseBody } from "@/lib/validation";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

const forgetBodySchema = z.object({}).loose();

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuth({ minRole: "editor" });
  if (!isAuthContext(ctx)) return ctx;
  const { id } = await params;
  const parsed = await parseBody(req, forgetBodySchema);
  if (!parsed.ok) return parsed.response;

  const updated = await withMnemoTx(ctx.workspace.id, async (tx) => {
    const rows = await tx
      .update(schema.mnemoFacts)
      .set({ status: "forgotten", updatedAt: new Date() })
      .where(and(eq(schema.mnemoFacts.id, id), eq(schema.mnemoFacts.workspaceId, ctx.workspace.id)))
      .returning({
        id: schema.mnemoFacts.id,
        status: schema.mnemoFacts.status,
      });
    return rows[0] ?? null;
  });
  if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await logAudit({
    workspaceId: ctx.workspace.id,
    userId: ctx.user.id,
    action: "mnemo.fact.forget",
    resource: "mnemo_fact",
    resourceId: updated.id,
  });
  return NextResponse.json(updated);
}
