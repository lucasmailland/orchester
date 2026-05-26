// apps/web/app/api/mnemo/health/latest/route.ts
//
// GET /api/mnemo/health/latest — proxy for the v1.2 health snapshot
// module. Returns the most recent persisted `mnemo_health` row for
// the workspace, or null when the cron hasn't snapshotted yet (cold
// start — the dashboard renders an empty state).
//
// We do NOT call `getHealthSnapshot({ fresh: true })` here because
// the daily cron handles refresh. If an admin wants an on-demand
// recompute, the v1.4 surface will add a POST /refresh — for v1.3
// we keep the GET cheap (single index lookup).
//
// RBAC: admin+.
import { NextResponse } from "next/server";
import { getHealthSnapshot } from "@orchester/mnemosyne";
import { requireAuth, isAuthContext } from "@/lib/auth-guards";

export const dynamic = "force-dynamic";

export async function GET() {
  const ctx = await requireAuth({ minRole: "admin" });
  if (!isAuthContext(ctx)) return ctx;

  // getHealthSnapshot opens its own withMnemoTx when no tx is passed,
  // so RLS+FORCE applies. fresh=false → read latest persisted row.
  const snap = await getHealthSnapshot({ workspaceId: ctx.workspace.id });
  return NextResponse.json({ snapshot: snap });
}
