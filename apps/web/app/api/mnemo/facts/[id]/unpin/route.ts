// apps/web/app/api/mnemo/facts/[id]/unpin/route.ts
//
// POST /api/mnemo/facts/[id]/unpin — set pinned=false on a fact.
//
// If the fact had been auto-pinned (metadata.auto_pinned is set),
// this unpin stamps `metadata.auto_pinned_overridden = true` so the
// daily auto-pin cron won't re-pin it. The user's choice wins.
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

const unpinBodySchema = z.object({}).loose();

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuth({ minRole: "editor" });
  if (!isAuthContext(ctx)) return ctx;
  const { id } = await params;
  const parsed = await parseBody(req, unpinBodySchema);
  if (!parsed.ok) return parsed.response;

  const updated = await withMnemoTx(ctx.workspace.id, async (tx) => {
    const _tx = tx as unknown as DbClient;
    // Schema bridge: withMnemoTx types tx against @mnemosyne/core's schema, but this
    // file uses @orchester/db's schema objects. Drizzle's fluent builder (.update/.set/.where)
    // uses SQL column name strings, not schema identity, so generated SQL is identical.
    // Safe for fluent builder only — never use db.query.* on _tx. See instrumentation-node.ts.
    // Conditional override stamp: only set `auto_pinned_overridden`
    // when the fact had `auto_pinned` (i.e. the cron put it there).
    // A user-pinned fact getting unpinned is a normal action, not an
    // override of the cron.
    const rows = await _tx
      .update(schema.mnemoFacts)
      .set({
        pinned: false,
        updatedAt: new Date(),
        metadata: sql`
          CASE
            WHEN COALESCE(${schema.mnemoFacts.metadata}, '{}'::jsonb) ? 'auto_pinned'
              THEN COALESCE(${schema.mnemoFacts.metadata}, '{}'::jsonb)
                   || jsonb_build_object('auto_pinned_overridden', true)
            ELSE COALESCE(${schema.mnemoFacts.metadata}, '{}'::jsonb)
          END
        `,
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
    action: "mnemo.fact.unpin",
    resource: "mnemo_fact",
    resourceId: updated.id,
  });
  return NextResponse.json(updated);
}
