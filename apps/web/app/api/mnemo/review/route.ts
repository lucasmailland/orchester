// apps/web/app/api/mnemo/review/route.ts
//
// GET /api/mnemo/review — list rows in the v1.3 active-learning
// queue (`mnemo_review_queue`, migration 0032).
//
// Query params:
//   ?limit=50  (default 50, max 200)
//   ?reason=low_confidence|contradiction|manual  (filter)
//   ?all=true  (include resolved rows; default false → open only)
//
// RBAC: editor+ — the queue is an operational concern, not just a
// viewer surface.
import { NextResponse } from "next/server";
import { listReview, withMnemoTx, type ReviewReason } from "@orchester/mnemosyne";
import { requireAuth, isAuthContext } from "@/lib/auth-guards";

export const dynamic = "force-dynamic";

const ALLOWED_REASONS = new Set<ReviewReason>(["low_confidence", "contradiction", "manual"]);

export async function GET(req: Request) {
  const ctx = await requireAuth({ minRole: "editor" });
  if (!isAuthContext(ctx)) return ctx;

  const url = new URL(req.url);
  const limitRaw = Number(url.searchParams.get("limit") ?? "50");
  const limit =
    Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(Math.floor(limitRaw), 200) : 50;

  const reasonParam = url.searchParams.get("reason");
  if (reasonParam && !ALLOWED_REASONS.has(reasonParam as ReviewReason)) {
    return NextResponse.json({ error: "Invalid reason" }, { status: 400 });
  }
  const reason = (reasonParam as ReviewReason | null) ?? undefined;
  const all = url.searchParams.get("all") === "true";

  const items = await withMnemoTx(ctx.workspace.id, (tx) =>
    listReview({
      workspaceId: ctx.workspace.id,
      // Only include the `reason` key when it's set — the package
      // is built with exactOptionalPropertyTypes, so undefined is
      // not assignable to ReviewReason.
      ...(reason ? { reason } : {}),
      includeResolved: all,
      limit,
      tx,
    })
  );

  return NextResponse.json({ items });
}
