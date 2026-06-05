// apps/web/app/api/mnemo/audit/route.ts
//
// GET /api/mnemo/audit — Memory Inspector "Undo log" feed.
//
// Returns the most recent fact-mutation events in the workspace,
// shaped for the `UndoClient` UI (see
// apps/web/app/[locale]/[workspaceSlug]/(shell)/brain/undo/UndoClient.tsx).
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
//   { items: ChangeEntry[], total: number, available: true }

import "server-only";
import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { withMnemoTx } from "@orchester/mnemosyne";
import { requireAuth, isAuthContext } from "@/lib/auth-guards";
import { safeLogError } from "@/lib/safe-log";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

interface ChangeEntryRow {
  id: string;
  fact_id: string;
  fact_statement: string;
  fact_subject: string;
  fact_kind: string;
  action: "forgotten";
  actor_kind: "user" | "system";
  actor_name: string | null;
  timestamp: Date;
  revertible: boolean;
}

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

  try {
    const items = await withMnemoTx(ctx.workspace.id, async (tx) => {
      // UNION across the two sources:
      //   - mnemo_fact rows currently in 'forgotten' state (user
      //     clicked Forget; reversible via /restore).
      //   - mnemo_fact_archive rows that originated as forgotten OR
      //     merged (system action; not reversible).
      //
      // Order by the most-recent timestamp (mnemo_fact.updated_at for
      // user forgets, mnemo_fact_archive.archived_at for janitor
      // events) and cap to `limit`. UNION ALL is safe — the two
      // sources never overlap (an archived fact is no longer in
      // `mnemo_fact`).
      const rows = (await tx.execute(sql`
        SELECT * FROM (
          SELECT
            'forget_' || f.id          AS id,
            f.id                        AS fact_id,
            f.statement                 AS fact_statement,
            f.subject                   AS fact_subject,
            f.kind                      AS fact_kind,
            'forgotten'::text           AS action,
            'user'::text                AS actor_kind,
            NULL::text                  AS actor_name,
            f.updated_at                AS timestamp,
            true                        AS revertible
          FROM mnemo_fact f
          WHERE f.workspace_id = ${ctx.workspace.id}
            AND f.status = 'forgotten'
          UNION ALL
          SELECT
            'archive_' || a.id          AS id,
            a.id                        AS fact_id,
            a.statement                 AS fact_statement,
            a.subject                   AS fact_subject,
            a.kind                      AS fact_kind,
            'forgotten'::text           AS action,
            'system'::text              AS actor_kind,
            NULL::text                  AS actor_name,
            a.archived_at               AS timestamp,
            false                       AS revertible
          FROM mnemo_fact_archive a
          WHERE a.workspace_id = ${ctx.workspace.id}
        ) merged
        ORDER BY timestamp DESC
        LIMIT ${limit}
      `)) as unknown as ChangeEntryRow[];
      return rows;
    });

    return NextResponse.json({
      items: items.map((r) => ({
        id: r.id,
        factId: r.fact_id,
        factStatement: r.fact_statement,
        factSubject: r.fact_subject,
        factKind: r.fact_kind,
        action: r.action,
        actorKind: r.actor_kind,
        actorName: r.actor_name,
        timestamp:
          r.timestamp instanceof Date ? r.timestamp.toISOString() : String(r.timestamp ?? ""),
        revertible: r.revertible,
      })),
      total: items.length,
      available: true,
    });
  } catch (e) {
    safeLogError("[mnemo/audit] query failed:", e);
    // Match the UndoClient's graceful-degrade shape — return
    // `available: false` rather than a 500 so the UI shows the
    // friendly "coming soon" empty state instead of an error banner.
    return NextResponse.json({ items: [], total: 0, available: false });
  }
}
