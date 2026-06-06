// apps/web/lib/mnemo/audit.ts
//
// Dual-mode implementation of the workspace's "Undo log" surface.
// Mirrors the other helpers under lib/mnemo/: pick HTTP (service
// mode) vs in-process (library mode) at runtime via `MNEMO_URL` +
// `MNEMO_API_KEY`.
//
// One helper covers GET /api/mnemo/audit. Returns a discriminated
// `{ mode, data }` envelope so the route can stamp `X-Mnemo-Mode`
// on the response.
//
// Wire shape matches the legacy UndoClient contract (`UndoResponse`):
//   { items: ChangeEntry[], total: number, available: true|false }
//
// `available: false` is used by the orchester UI as a graceful-
// degrade signal — we surface it via try/catch (any uncaught error
// in library mode used to produce `available: false`; service mode
// preserves that semantic).

import "server-only";
import type { AuditResponse } from "@mnemosyne/client-ts";
import { safeLogError } from "@/lib/safe-log";
import { getMnemoMode, type MnemoMode } from "@/lib/mnemo/client";

// Re-export so existing callers keep working while we centralise the
// mode logic in `@/lib/mnemo/client`. New code should import from
// there directly.
export { getMnemoMode };
export type { MnemoMode };

/**
 * The UndoClient's wider response type — service mode always returns
 * `available:true` because failures bubble as HTTP errors instead of
 * the degraded payload. We surface a union here so the route handler
 * can normalize both modes onto the same shape.
 */
export type AuditEnvelope =
  | { items: AuditResponse["items"]; total: number; available: true }
  | { items: []; total: 0; available: false };

export async function listWorkspaceAudit(
  workspaceId: string,
  opts: { limit: number }
): Promise<{ mode: MnemoMode; data: AuditEnvelope }> {
  const mode = getMnemoMode();

  if (mode === "service") {
    const { getMnemoClient } = await import("@/lib/mnemo/client");
    const client = getMnemoClient();
    try {
      const data = await client.audit({ limit: opts.limit });
      return { mode, data };
    } catch (e) {
      // Service mode failure → graceful degrade. The UndoClient
      // renders an empty-state when `available: false`; the alternative
      // (HTTP 500 surfaced to the user) is uglier.
      safeLogError("[mnemo/audit] service mode failed; degrading", e);
      return { mode, data: { items: [], total: 0, available: false } };
    }
  }

  // Library path mirrors the legacy orchester audit/route.ts logic
  // verbatim — UNION ALL across mnemo_fact 'forgotten' rows and
  // mnemo_fact_archive entries, newest first, capped by limit. We
  // also wrap in try/catch to preserve the same `available:false`
  // degrade contract the legacy route relied on.
  try {
    const { withMnemoTx } = await import("@mnemosyne/core");
    const { sql } = await import("drizzle-orm");
    const items = await withMnemoTx(workspaceId, async (tx) => {
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
          WHERE f.workspace_id = ${workspaceId}
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
          WHERE a.workspace_id = ${workspaceId}
        ) merged
        ORDER BY timestamp DESC
        LIMIT ${opts.limit}
      `)) as unknown as Array<{
        id: string;
        fact_id: string;
        fact_statement: string;
        fact_subject: string;
        fact_kind: string;
        action: "forgotten";
        actor_kind: "user" | "system";
        actor_name: string | null;
        timestamp: Date | string;
        revertible: boolean;
      }>;
      return rows.map((r) => ({
        id: r.id,
        factId: r.fact_id,
        factStatement: r.fact_statement,
        factSubject: r.fact_subject,
        factKind: r.fact_kind,
        action: r.action,
        actorKind: r.actor_kind,
        actorName: r.actor_name,
        timestamp: r.timestamp instanceof Date ? r.timestamp.toISOString() : String(r.timestamp),
        revertible: r.revertible,
      }));
    });

    return {
      mode,
      data: { items, total: items.length, available: true as const },
    };
  } catch (e) {
    safeLogError("[mnemo/audit] library mode failed; degrading", e);
    return { mode, data: { items: [], total: 0, available: false } };
  }
}
