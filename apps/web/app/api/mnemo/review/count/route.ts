// apps/web/app/api/mnemo/review/count/route.ts
//
// GET /api/mnemo/review/count — return `{ count: number }` of
// unresolved rows in `mnemo_review_queue` for the active workspace.
//
// Cheap COUNT(*) against the partial index
// `idx_mnemo_review_queue_workspace_unresolved` (migration 0032) so
// the Inspector header badge can poll without listing rows.
//
// The Inspector previously surfaced `factCountForgotten` as a
// placeholder for the review badge — wires here let it show the real
// queue depth. Default to 0 client-side if this returns 404 so the UI
// degrades gracefully when migrations 0032+ haven't run.
//
// RBAC: editor+ — same level as GET /api/mnemo/review.
import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { withMnemoTx } from "@orchester/mnemosyne";
import { requireAuth, isAuthContext } from "@/lib/auth-guards";

export const dynamic = "force-dynamic";

export async function GET() {
  const ctx = await requireAuth({ minRole: "editor" });
  if (!isAuthContext(ctx)) return ctx;

  const count = await withMnemoTx(ctx.workspace.id, async (tx) => {
    const rows = (await tx.execute(sql`
      SELECT COUNT(*)::int AS n
      FROM mnemo_review_queue
      WHERE workspace_id = ${ctx.workspace.id}
        AND resolved_at IS NULL
    `)) as unknown as Array<{ n: number }>;
    return rows[0]?.n ?? 0;
  });

  return NextResponse.json({ count });
}
