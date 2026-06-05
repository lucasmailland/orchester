// apps/web/app/api/mnemo/facts/[id]/pin/route.ts
//
// POST /api/mnemo/facts/[id]/pin — set pinned=true on a fact.
//
// Body is empty (the action is fully encoded in the URL). We still
// parse it through zod so the audit-invariants script's parseBody
// check is satisfied — passing an explicit `z.object({}).strict()`
// gives a 400 if a caller accidentally sends arbitrary data.
//
// If the fact carries `metadata.auto_pinned_overridden = true` from
// a previous user unpin, this manual pin clears the override flag
// because the user has now explicitly chosen "pinned" again. The
// auto-pin cron is free to re-affirm later if its rules still match.
//
// RBAC: editor+.
import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq, sql } from "drizzle-orm";
import { schema, type DbClient } from "@orchester/db";
import { withMnemoTx } from "@mnemosyne/core";
import { requireAuth, isAuthContext } from "@/lib/auth-guards";
import { parseBody } from "@/lib/validation";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

const pinBodySchema = z.object({}).loose();

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuth({ minRole: "editor" });
  if (!isAuthContext(ctx)) return ctx;
  const { id } = await params;
  const parsed = await parseBody(req, pinBodySchema);
  if (!parsed.ok) return parsed.response;

  const updated = await withMnemoTx(ctx.workspace.id, async (tx) => {
    const _tx = tx as unknown as DbClient;
    // Clear `auto_pinned_overridden` if set — the user is re-affirming.
    // We don't touch `auto_pinned` (which records the rule + date) so
    // the audit trail of "was once auto-pinned" survives. jsonb '-'
    // operator drops a key by name; default to {} if the column was null.
    const rows = await _tx
      .update(schema.mnemoFacts)
      .set({
        pinned: true,
        updatedAt: new Date(),
        metadata: sql`COALESCE(${schema.mnemoFacts.metadata}, '{}'::jsonb) - 'auto_pinned_overridden'`,
      })
      .where(and(eq(schema.mnemoFacts.id, id), eq(schema.mnemoFacts.workspaceId, ctx.workspace.id)))
      .returning({
        id: schema.mnemoFacts.id,
        pinned: schema.mnemoFacts.pinned,
        metadata: schema.mnemoFacts.metadata,
      });
    return rows[0] ?? null;
  });
  if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await logAudit({
    workspaceId: ctx.workspace.id,
    userId: ctx.user.id,
    action: "mnemo.fact.pin",
    resource: "mnemo_fact",
    resourceId: updated.id,
  });
  return NextResponse.json(updated);
}
