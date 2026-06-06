// apps/web/app/api/mnemo/health/history/route.ts
//
// 30-day rolling history of memory vitals for the Inspector's
// "Active Facts" and "Recall Hit Rate" line charts. The host-side
// `mnemo_health` snapshot table was retired during Phase 3 — there
// is no per-day history persisted anywhere any more.
//
// Pragmatic restore: emit a single-point timeline with the current
// snapshot. The chart shows one data point rather than the
// catch-all "No data yet" empty state. When/if Mnemosyne grows a
// real history endpoint we replace the body with `client.history(…)`.
//
// RBAC: viewer+.
import "server-only";
import { NextResponse } from "next/server";
import { requireAuth, isAuthContext } from "@/lib/auth-guards";
import { getMnemoClient } from "@/lib/mnemo/client";
import { safeLogError } from "@/lib/safe-log";

export const dynamic = "force-dynamic";

export async function GET() {
  const ctx = await requireAuth({ minRole: "viewer" });
  if (!isAuthContext(ctx)) return ctx;

  try {
    const client = getMnemoClient();
    const h = (await client.health()) as unknown as {
      workspaceId: string;
      factsLive: number;
      factsClosed: number;
      pinnedCount: number;
      lastRecallAt: string | null;
      lastWriteAt: string | null;
      embeddings: { indexed: number; pending: number };
    };
    const factsLive = h.factsLive ?? 0;
    const factsClosed = h.factsClosed ?? 0;
    const at = h.lastWriteAt ?? new Date().toISOString();
    const snapshot = {
      workspaceId: h.workspaceId,
      capturedAt: at,
      snapshotAt: at,
      factCountTotal: factsLive + factsClosed,
      factCountActive: factsLive,
      factCountForgotten: factsClosed,
      factCountPinned: h.pinnedCount ?? 0,
      factCountEmbedded: h.embeddings?.indexed ?? 0,
      factCountEmbeddingsPending: h.embeddings?.pending ?? 0,
      lastRecallAt: h.lastRecallAt,
      lastWriteAt: h.lastWriteAt,
    };
    // The hook accepts both shapes; this `{ days, snapshots }` form
    // is the v1.3 contract and the natural extension when real
    // history lands.
    return NextResponse.json({ days: 30, snapshots: [snapshot] });
  } catch (e) {
    safeLogError("[mnemo/health/history] SDK call failed:", e);
    return NextResponse.json([], { status: 200 });
  }
}
