// apps/web/lib/mnemo/audit.ts
//
// HTTP-only implementation of the workspace's "Undo log" surface.
// All orchester /api/mnemo/* helpers run in service mode after the
// Phase 3/4 cut-over — there is no in-process library fallback.
//
// One helper covers GET /api/mnemo/audit. Returns a discriminated
// `{ mode, data }` envelope so the route can stamp `X-Mnemo-Mode`
// on the response.
//
// Wire shape matches the legacy UndoClient contract (`UndoResponse`):
//   { items: ChangeEntry[], total: number, available: true|false }
//
// `available: false` is the UI's graceful-degrade signal — we surface
// it via try/catch around the SDK call so a transient HTTP error
// shows an empty-state instead of a 500 toast.

import "server-only";
import type { AuditResponse } from "@mnemosyne/client-ts";
import { safeLogError } from "@/lib/safe-log";
import { getMnemoMode, getMnemoClient, type MnemoMode } from "@/lib/mnemo/client";

// Re-export so existing callers keep working.
export { getMnemoMode };
export type { MnemoMode };

/**
 * Wider response type. Service-mode failures degrade to
 * `available:false` via try/catch, mirroring the contract the
 * legacy UndoClient relied on.
 */
export type AuditEnvelope =
  | { items: AuditResponse["items"]; total: number; available: true }
  | { items: []; total: 0; available: false };

export async function listWorkspaceAudit(
  _workspaceId: string,
  opts: { limit: number }
): Promise<{ mode: MnemoMode; data: AuditEnvelope }> {
  const mode = getMnemoMode();
  const client = getMnemoClient();
  try {
    const data = await client.audit({ limit: opts.limit });
    return { mode, data };
  } catch (e) {
    safeLogError("[mnemo/audit] HTTP failed; degrading", e);
    return { mode, data: { items: [], total: 0, available: false } };
  }
}
