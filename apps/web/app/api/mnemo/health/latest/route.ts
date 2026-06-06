// apps/web/app/api/mnemo/health/latest/route.ts
//
// Latest memory health snapshot for the Brain Inspector. Wraps the
// @mnemosyne/server SDK's `client.health()` into the field names the
// existing `useBrainHealthLatest` hook expects (`factCount*` columns).
//
// This route was retired during Phase 3 cleanup (the in-process v1.6
// implementation used a host-side `mnemo_health` table) and the
// Inspector silently 404'd as a result — TOTAL FACTS read 0 even
// though Mnemosyne held real rows. Restored as a thin SDK proxy.
//
// RBAC: viewer+ — same tier as the rest of the read-side Inspector.
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
    // Upstream SDK bug: `client.health()` is declared to return the
    // generic `HealthSnapshot` (status/version/timestamp) but the
    // live `/v1/health` endpoint actually emits per-workspace
    // `WorkspaceVitals`. Cast through unknown to read the real shape
    // until the SDK type catches up.
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
    return NextResponse.json({
      workspaceId: h.workspaceId,
      // `capturedAt` is what the hook + the MemoryHeartbeat banner read.
      // We previously emitted `snapshotAt` here, which is why the banner
      // got stuck on "Waiting for the first cycle…" even with 18 facts:
      // the field name didn't match. Keep `snapshotAt` as an alias for
      // backwards compatibility with any cached client bundles.
      capturedAt: h.lastWriteAt ?? new Date().toISOString(),
      snapshotAt: h.lastWriteAt ?? new Date().toISOString(),
      factCountTotal: factsLive + factsClosed,
      factCountActive: factsLive,
      factCountForgotten: factsClosed,
      factCountPinned: h.pinnedCount ?? 0,
      factCountEmbedded: h.embeddings?.indexed ?? 0,
      factCountEmbeddingsPending: h.embeddings?.pending ?? 0,
      lastRecallAt: h.lastRecallAt,
      lastWriteAt: h.lastWriteAt,
    });
  } catch (e) {
    safeLogError("[mnemo/health/latest] SDK call failed:", e);
    // Graceful fallback — hook treats null/404 as "no data yet"
    // rather than surfacing an error banner.
    return NextResponse.json(null, { status: 200 });
  }
}
