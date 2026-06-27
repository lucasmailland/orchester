// apps/web/lib/mnemo/export.ts
//
// HTTP-only implementation of the workspace memory export.
//
// One helper covers GET /api/mnemo/export. Returns the raw 4-table
// payload (facts/decisions/relations/citations) so the route handler
// can decorate it with the `meta` block + Content-Disposition for
// download. Embeddings are excluded server-side.

import "server-only";
import type { ExportResponse } from "@mnemosyne/client-ts";
import { getMnemoMode, getMnemoClient, type MnemoMode } from "@/lib/mnemo/client";

export { getMnemoMode };
export type { MnemoMode };

export interface ExportPayload {
  facts: Array<Record<string, unknown>>;
  decisions: Array<Record<string, unknown>>;
  relations: Array<Record<string, unknown>>;
  citations: Array<Record<string, unknown>>;
}

// The Mnemosyne SDK scopes by API key at construction time, not per request.
// This adapter forwards workspaceId so the contract is explicit and ready
// for when the SDK adds per-request workspace scoping.
type ScopedExportClient = {
  exportWorkspace(opts: { workspaceId: string }): Promise<ExportResponse>;
};

export async function exportWorkspaceData(
  workspaceId: string
): Promise<{ mode: MnemoMode; data: ExportPayload }> {
  const mode = getMnemoMode();
  const client = getMnemoClient() as unknown as ScopedExportClient;
  const resp = await client.exportWorkspace({ workspaceId });
  return {
    mode,
    data: {
      facts: resp.facts,
      decisions: resp.decisions,
      relations: resp.relations,
      citations: resp.citations,
    },
  };
}
