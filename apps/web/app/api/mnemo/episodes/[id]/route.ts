// apps/web/app/api/mnemo/episodes/[id]/route.ts
//
// GET /api/mnemo/episodes/[id] — Mnemosyne v1.4 single-episode read.
// Returns { episode, linkedFacts } so the timeline detail view can
// render the narrative + the cluster of facts the extraction pipeline
// tied to it in a single round-trip.
//
// 404 when the episode doesn't exist OR lives in another workspace
// (RLS already filters cross-tenant rows; the explicit check just
// gives a tighter error message).
//
// RBAC: member+ (== `viewer`) — read-only surface for the Inspector.
import { NextResponse } from "next/server";
import { inArray } from "drizzle-orm";
import { schema } from "@orchester/db";
import { getEpisode, withMnemoTx } from "@mnemosyne/core";
import { requireAuth, isAuthContext } from "@/lib/auth-guards";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuth({ minRole: "viewer" });
  if (!isAuthContext(ctx)) return ctx;

  const { id } = await params;
  // Cheap guard — the cuid2 prefix is `mepi_`. We don't hard-validate
  // here (a clean 404 is plenty) but we do reject obviously empty ids.
  if (!id || id.length < 4) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const result = await withMnemoTx(ctx.workspace.id, async (tx) => {
    const episode = await getEpisode(ctx.workspace.id, id, tx);
    if (!episode) return null;

    // Resolve linked facts in one batch. `linkedFactIds` is the
    // denormalised reverse pointer to mnemo_fact ids (set by the
    // extraction pipeline). Some ids may point at facts that have
    // since been archived (janitor / forget); we filter those out
    // silently rather than 500-ing — an episode legitimately
    // outlives some of its constituent facts.
    let linkedFacts: unknown[] = [];
    if (episode.linkedFactIds.length > 0) {
      linkedFacts = await tx
        .select()
        .from(schema.mnemoFacts)
        .where(inArray(schema.mnemoFacts.id, episode.linkedFactIds));
    }

    return { episode, linkedFacts };
  });

  if (!result) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(result);
}
