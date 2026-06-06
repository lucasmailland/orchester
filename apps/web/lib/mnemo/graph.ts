// apps/web/lib/mnemo/graph.ts
//
// HTTP-only implementation of the workspace's Memory Graph fetch.
//
// Lives in lib/mnemo (NOT under /api/) because Next collects .ts files
// under app/ as build artefacts and our /api/workspaces/[slug]/brain/graph
// route uses this directly.
//
// Post Phase 3/4: every fetch goes through `getMnemoClient().graph()`
// against the running @mnemosyne/server. The orchester process keeps
// zero coupling to the in-process query layer; the data round-trips
// over HTTP.
//
// The returned shape matches the canonical `GraphResponse` from
// @mnemosyne/client-ts. The hook + component in
// apps/web/components/brain/graph/ are unchanged.

import "server-only";
import type { GraphResponse as ClientGraphResponse } from "@mnemosyne/client-ts";
import { getMnemoMode, getMnemoClient, type MnemoMode } from "@/lib/mnemo/client";

// `GraphMode` was a tramo-1-era local alias — kept as a type alias
// so existing callers don't break, but new code should use the
// canonical `MnemoMode` from `@/lib/mnemo/client`.
export type GraphMode = MnemoMode;
export { getMnemoMode };

export async function fetchWorkspaceGraph(
  _workspaceId: string,
  focusEntityId?: string
): Promise<{ mode: GraphMode; graph: ClientGraphResponse }> {
  const mode = getMnemoMode();
  const client = getMnemoClient();
  const graph = await client.graph(focusEntityId ? { focus: focusEntityId } : {});
  return { mode, graph };
}
