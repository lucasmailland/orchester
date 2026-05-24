import { NextResponse } from "next/server";
import { snapshotCounts } from "@/lib/tenant/telemetry";
import { getCurrentSession } from "@/lib/workspace";
import { isSystemAdmin } from "@/lib/rbac";

// In-process counters reset on cold start, so a static response would lie.
export const dynamic = "force-dynamic";

/**
 * Read-only telemetry endpoint for Phase B observability.
 *
 * Returns `{ set, missing, ratio }` for the tenant-context counters. Gated
 * by `ADMIN_EMAILS` (comma-separated, via `isSystemAdmin`). If the env
 * var is empty/unset, NO email is treated as admin — the endpoint
 * returns 403 to everyone. That is the safe default; production should
 * set the var explicitly.
 *
 * The Phase B output gate is `ratio < 0.01` (less than 1% of requests
 * miss tenant context) sustained over a sample window.
 */
export async function GET() {
  const session = await getCurrentSession();
  if (!session) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  if (!isSystemAdmin(session.user.email)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  return NextResponse.json(snapshotCounts());
}
