// apps/web/app/api/mnemo/audit/route.ts
//
// GET /api/mnemo/audit — Memory Inspector "Undo log" feed.
//
// Returns the most recent fact-mutation events in the workspace,
// shaped for the `UndoClient` UI (see
// apps/web/app/[locale]/[workspaceSlug]/(shell)/brain/undo/UndoClient.tsx).
//
// As of the service-extraction Phase 2 (tramo 3), the handler
// delegates to `listWorkspaceAudit()` which picks the data source at
// runtime (service via `client.audit()` / library via in-process
// UNION). `X-Mnemo-Mode` surfaces which path served the request.
//
// PHILOSOPHY:
//   v1.6 / v2 do NOT maintain a per-mutation audit trail for facts
//   (the workspace-wide `audit_log` only tracks tenant-level events
//   like member.invite, workspace.transfer, etc. — not per-fact CRUD).
//   So we synthesise the undo feed from two stable signals:
//
//     1. `mnemo_fact.status = 'forgotten'` — the user clicked Forget.
//        Surfaced as a "forgotten" entry; reverting calls
//        POST /api/mnemo/facts/[id]/restore.
//     2. `mnemo_fact_archive` — the janitor merged / pruned a fact.
//        Surfaced as a "forgotten" entry tagged `actorKind: 'system'`;
//        reverting is NOT supported (archives are read-only).
//
//   Other actions (`created`, `updated`, `pinned`, `unpinned`,
//   `restored`) would require a write-ahead history table we don't
//   ship yet. The UI's `ChangeAction` enum carries all six values so
//   the contract stays stable — this endpoint only returns the two
//   we can derive today.
//
// QUERY PARAMS:
//   - `limit` (1-100, default 20) — page cap.
//
// RESPONSE shape matches the UndoClient's `UndoResponse`:
//   { items: ChangeEntry[], total: number, available: true|false }
//
// `available: false` is the graceful-degrade contract — when the
// underlying SDK call fails, the UI shows a friendly "coming soon"
// empty state instead of an error banner.

import "server-only";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, isAuthContext } from "@/lib/auth-guards";
import { listWorkspaceAudit } from "@/lib/mnemo/audit";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export async function GET(req: Request) {
  const ctx = await requireAuth({ minRole: "viewer" });
  if (!isAuthContext(ctx)) return ctx;

  const url = new URL(req.url);
  const parsed = querySchema.safeParse({
    limit: url.searchParams.get("limit") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_query", issues: parsed.error.issues },
      { status: 400 }
    );
  }
  const limit = parsed.data.limit ?? 20;

  const { mode, data } = await listWorkspaceAudit(ctx.workspace.id, { limit });
  return NextResponse.json(data, { headers: { "X-Mnemo-Mode": mode } });
}
