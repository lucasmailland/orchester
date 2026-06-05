// apps/web/app/api/mnemo/facts/[id]/restore/route.ts
//
// POST /api/mnemo/facts/[id]/restore — reverse of /forget.
// Sets `status='active'` so the fact rejoins the recall pool.
//
// This path is *param-only* by design (no body) — the audit-invariants
// script exempts `/restore/route.ts$` from the parseBody check.
// We still gate with `requireAuth` (RBAC: editor+).
import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { schema, type DbClient } from "@orchester/db";
import { withMnemoTx } from "@mnemosyne/core";
import { requireAuth, isAuthContext } from "@/lib/auth-guards";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuth({ minRole: "editor" });
  if (!isAuthContext(ctx)) return ctx;
  const { id } = await params;

  const updated = await withMnemoTx(ctx.workspace.id, async (tx) => {
    const _tx = tx as unknown as DbClient;
    const rows = await _tx
      .update(schema.mnemoFacts)
      .set({ status: "active", updatedAt: new Date() })
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
    action: "mnemo.fact.restore",
    resource: "mnemo_fact",
    resourceId: updated.id,
  });
  return NextResponse.json(updated);
}
