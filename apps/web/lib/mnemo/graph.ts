// apps/web/app/[locale]/[workspaceSlug]/(shell)/brain/graph/dual-mode-impl.ts
//
// Dual-mode implementation of the workspace's Memory Graph fetch.
// Lives in the Inspector tree (NOT under /api/) because Next collects
// .ts files there as build artefacts and our parallel /api/workspaces
// route uses this directly.
//
// Two execution modes, picked at runtime by the presence of `MNEMO_URL`:
//
//   1. **Service mode** (preferred — Phase 2 of the service-extraction
//      plan). When `process.env.MNEMO_URL` is set, we hit the running
//      @mnemosyne/server via `getMnemoClient().graph()`. The
//      orchester process keeps zero coupling to the in-process query
//      layer; the data round-trips over HTTP.
//
//   2. **Library mode** (legacy, default until Phase 2 finishes
//      rolling out). When `MNEMO_URL` is unset, we fall back to the
//      original `buildGraphQuery` call against the local Postgres
//      pool — same code path that's been live since the route was
//      authored.
//
// The fall-back is intentional. Phase 2 lands incrementally; the dev
// environment that runs `apps/web` without first booting `docker
// compose up -d` should keep working (no orchestral cliff). When the
// service is the canonical runtime, the env var becomes required and
// the library branch is deleted in Phase 4.
//
// The returned shape is identical in both modes: the canonical
// `GraphResponse` defined in `@mnemosyne/core/graph`. The hook +
// component in apps/web/components/brain/graph/ are unchanged.

import "server-only";
import type { GraphResponse } from "@mnemosyne/core/graph";
import { getMnemoMode, type MnemoMode } from "@/lib/mnemo/client";

// `GraphMode` was a tramo-1-era local alias — kept as a type alias
// so existing callers don't break, but new code should use the
// canonical `MnemoMode` from `@/lib/mnemo/client`.
export type GraphMode = MnemoMode;
export { getMnemoMode };

export async function fetchWorkspaceGraph(
  workspaceId: string,
  focusEntityId?: string
): Promise<{ mode: GraphMode; graph: GraphResponse }> {
  const mode = getMnemoMode();

  if (mode === "service") {
    // SDK path. The singleton in lib/mnemo/client.ts handles env
    // checks + keep-alive + retry; we only translate from our
    // domain vocabulary (workspaceId, focusEntityId) to the SDK's
    // wire shape (focus).
    const { getMnemoClient } = await import("@/lib/mnemo/client");
    const client = getMnemoClient();
    const graph = await client.graph(focusEntityId ? { focus: focusEntityId } : {});
    return { mode, graph: graph as unknown as GraphResponse };
  }

  // Library path. Same code that's been running since the route's
  // original commit — kept verbatim so a side-by-side comparison is
  // the trivial diff `mode === "service" ? sdk : library`.
  const [{ withMnemoTx }, { buildGraphQuery }] = await Promise.all([
    import("@mnemosyne/core"),
    import("@mnemosyne/core/graph/server"),
  ]);
  const opts = focusEntityId ? { focusEntityId } : {};
  const graph = await withMnemoTx(workspaceId, (tx) => buildGraphQuery(tx, workspaceId, opts));
  return { mode, graph };
}
