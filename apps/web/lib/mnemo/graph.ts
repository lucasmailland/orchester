// apps/web/lib/mnemo/graph.ts
//
// HTTP-only implementation of the workspace's Memory Graph fetch + the
// Wave-2 navigation primitives (multi-hop traversal, shortest path).
//
// Lives in lib/mnemo (NOT under /api/) because Next collects .ts files
// under app/ as build artefacts and our /api/workspaces/[slug]/brain/graph*
// routes use these directly.
//
// Post Phase 3/4: every fetch goes through `getMnemoClient(workspaceId).graph()`
// against the running @mnemosyne/server. The orchester process keeps
// zero coupling to the in-process query layer; the data round-trips
// over HTTP.
//
// The returned shape matches the canonical `GraphResponse` from
// @mnemo-ai/client-ts. The hook + component in
// apps/web/components/brain/graph/ are unchanged.

import "server-only";
import type { GraphResponse as ClientGraphResponse } from "@mnemo-ai/client-ts";
import { getMnemoMode, getMnemoClient, type MnemoMode } from "@/lib/mnemo/client";
import { filterGraphToIds } from "@/lib/memory/graph-canvas";

// `GraphMode` was a tramo-1-era local alias — kept so existing callers
// don't break; new code should use `MnemoMode` from `@/lib/mnemo/client`.
export type GraphMode = MnemoMode;
export { getMnemoMode };

/**
 * Full (or 1-hop focus) workspace graph. `asOf` (ISO 8601) reconstructs the
 * graph as it stood at that instant — forwarded to the SDK's `graph()` query.
 */
export async function fetchWorkspaceGraph(
  workspaceId: string,
  focusEntityId?: string,
  asOf?: string
): Promise<{ mode: GraphMode; graph: ClientGraphResponse }> {
  const mode = getMnemoMode();
  const client = getMnemoClient(workspaceId);
  const graph = await client.graph({
    ...(focusEntityId ? { focus: focusEntityId } : {}),
    ...(asOf ? { asOf } : {}),
  });
  return { mode, graph };
}

/**
 * Multi-hop focus. Gathers the node-id set within `depth` hops of `rootId`
 * via `graphTraverse`, then projects the full workspace graph down to that
 * neighbourhood (root + hits). `asOf` reconstructs both the traversal and the
 * base graph at a past instant.
 *
 * We fetch the base graph (for node/edge attributes) and the traversal (for
 * reachability) and intersect them client-side — `graphTraverse` returns only
 * ids + hop/relevance, not the rich node payload the renderer needs.
 */
export async function fetchWorkspaceTraverse(
  workspaceId: string,
  rootId: string,
  depth: number,
  asOf?: string
): Promise<{ mode: GraphMode; graph: ClientGraphResponse }> {
  const mode = getMnemoMode();
  const client = getMnemoClient(workspaceId);
  const [base, traversal] = await Promise.all([
    client.graph(asOf ? { asOf } : {}),
    client.graphTraverse({ root: rootId, maxHops: depth, ...(asOf ? { asOf } : {}) }),
  ]);
  const keep = new Set<string>([rootId, ...traversal.hits.map((h) => h.id)]);
  const graph = filterGraphToIds(base, keep);
  return { mode, graph };
}

/**
 * Shortest path between two entities. Returns the path node ids + the exact
 * relation edges traversed, for highlight overlay in the renderers.
 */
export async function fetchWorkspacePath(
  workspaceId: string,
  from: string,
  to: string,
  asOf?: string
): Promise<{
  mode: GraphMode;
  path: { path: string[]; edges: Array<{ source: string; target: string; relation: string }> };
}> {
  const mode = getMnemoMode();
  const client = getMnemoClient(workspaceId);
  const path = await client.graphPath({ from, to, ...(asOf ? { asOf } : {}) });
  return { mode, path };
}
