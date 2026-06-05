// apps/web/lib/brain/index.ts
//
// LEGACY — Brain Core sub-spec 2 (`brain_fact` table).
//
// **DEPRECATED 2026-06-05.** This module is the v1.x predecessor of
// the canonical cognitive memory layer, which now lives in
// `@mnemosyne/core` (`mnemo_*` tables). The Memory Inspector UI, the
// agent-runtime recall path, and every new write target `mnemo_fact`
// — not `brain_fact`.
//
// What still uses this barrel:
//   • Five REST routes under `/api/workspaces/[slug]/brain/*`
//     (facts, facts/[id], stats, search). They are kept for backwards
//     compatibility with any external integration that pinned to the
//     legacy URL surface; the handlers are tagged `@deprecated` in their
//     comments and return an `X-Deprecated` response header.
//   • Two cron job handlers (`JOB_BRAIN_COMPACTION`, `JOB_BRAIN_DECAY`)
//     whose `schedule()` calls were commented out in `worker/index.ts`
//     on the same date — they have no remaining work because nothing
//     new writes to `brain_fact`.
//
// What does NOT use this barrel:
//   • The Memory Inspector (`BrainInspectorClient.tsx`) — reads
//     `/api/mnemo/facts` exclusively.
//   • The agent-runtime — calls `recallUnified()` from `@mnemosyne/core`.
//   • The Memory Graph view (`/brain/graph`) — uses `buildGraphQuery`
//     from `@mnemosyne/core/graph/server`.
//
// New code MUST import from `@mnemosyne/core` instead. This barrel
// will be removed in a future sweep once the legacy URLs have a
// retirement notice timeline.

export * from "./types";
export * from "./store";
export { embedBrain, invalidateEmbedding } from "./embed";
