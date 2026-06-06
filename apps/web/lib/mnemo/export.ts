// apps/web/lib/mnemo/export.ts
//
// HTTP-only implementation of the workspace memory export.
//
// One helper covers GET /api/mnemo/export. Returns the raw 4-table
// payload (facts/decisions/relations/citations) so the route handler
// can decorate it with the `meta` block + Content-Disposition for
// download. Embeddings are excluded server-side.

import "server-only";
import { getMnemoMode, getMnemoClient, type MnemoMode } from "@/lib/mnemo/client";

export { getMnemoMode };
export type { MnemoMode };

export interface ExportPayload {
  facts: Array<Record<string, unknown>>;
  decisions: Array<Record<string, unknown>>;
  relations: Array<Record<string, unknown>>;
  citations: Array<Record<string, unknown>>;
}

export async function exportWorkspaceData(
  _workspaceId: string
): Promise<{ mode: MnemoMode; data: ExportPayload }> {
  const mode = getMnemoMode();
  const client = getMnemoClient();
  const resp = await client.exportWorkspace();
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
