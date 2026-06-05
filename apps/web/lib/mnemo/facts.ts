// apps/web/lib/mnemo/facts.ts
//
// Dual-mode implementation of the fact-write surfaces orchester
// already exposes today (forget / restore / pin / unpin). This tramo
// (tramo 3) ships the `restore` helper. The other write surfaces
// stay on the in-process path for now — the upstream wire endpoints
// already exist, but the orchester routes carry orchester-specific
// audit logging that would need to be re-implemented around the SDK
// calls. They will land in a follow-up tramo.
//
// Pick HTTP (service mode) vs in-process (library mode) at runtime
// via `MNEMO_URL` + `MNEMO_API_KEY`.

import "server-only";
import type { DbClient } from "@orchester/db";
import type { RestoreFactResponse } from "@mnemosyne/client-ts";

export type MnemoMode = "service" | "library";

export function getMnemoMode(): MnemoMode {
  return process.env["MNEMO_URL"] && process.env["MNEMO_API_KEY"] ? "service" : "library";
}

/**
 * Restore a forgotten fact — flips `status` back to 'active' so it
 * rejoins the recall pool. Returns null in the data field when the
 * fact does not exist (route maps → 404).
 *
 * Service mode delegates to `client.restoreFact`; library mode does
 * the UPDATE inline (same query path as the legacy route, so the
 * SQL plan / RLS behaviour is unchanged in the fallback case).
 */
export async function restoreWorkspaceFact(
  workspaceId: string,
  id: string
): Promise<{ mode: MnemoMode; data: RestoreFactResponse | null }> {
  const mode = getMnemoMode();

  if (mode === "service") {
    const { getMnemoClient } = await import("@/lib/mnemo/client");
    const { MnemosyneAPIError } = await import("@mnemosyne/client-ts");
    const client = getMnemoClient();
    try {
      const data = await client.restoreFact(id);
      return { mode, data };
    } catch (e) {
      if (e instanceof MnemosyneAPIError && e.status === 404) {
        return { mode, data: null };
      }
      throw e;
    }
  }

  // Library path — mirrors the legacy /forget/restore route's UPDATE
  // verbatim. We use the @orchester/db schema (not @mnemosyne/core's)
  // because that's what the legacy route used; the fluent builder
  // produces identical SQL either way (column names are matched by
  // string, not schema identity).
  const { withMnemoTx } = await import("@mnemosyne/core");
  const { schema } = await import("@orchester/db");
  const { and, eq } = await import("drizzle-orm");

  const updated = await withMnemoTx(workspaceId, async (tx) => {
    // Schema bridge cast — same pattern the legacy route used.
    // withMnemoTx types tx against @mnemosyne/core's schema; we're
    // writing through @orchester/db's schema. The fluent
    // .update/.set/.where chain serialises to identical SQL either
    // way (column names are matched by string, not schema identity).
    // Safe for fluent builder only; never use db.query.* on _tx.
    const _tx = tx as unknown as DbClient;
    const rows = await _tx
      .update(schema.mnemoFacts)
      .set({ status: "active", updatedAt: new Date() })
      .where(and(eq(schema.mnemoFacts.id, id), eq(schema.mnemoFacts.workspaceId, workspaceId)))
      .returning({
        id: schema.mnemoFacts.id,
        status: schema.mnemoFacts.status,
      });
    return rows[0] ?? null;
  });

  if (!updated) return { mode, data: null };
  return {
    mode,
    data: { id: updated.id, status: "active" as const },
  };
}
