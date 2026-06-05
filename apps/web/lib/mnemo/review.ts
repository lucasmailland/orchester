// apps/web/lib/mnemo/review.ts
//
// Dual-mode implementation of the workspace's active-learning review
// queue surface. Mirrors `lib/mnemo/entities.ts` / `lib/mnemo/episodes.ts`
// / `lib/mnemo/graph.ts`: pick HTTP (service mode) vs in-process
// (library mode) at runtime via `MNEMO_URL` + `MNEMO_API_KEY`.
//
// Three helpers cover the three endpoints under /v1/review:
//   - listWorkspaceReview          → GET /api/mnemo/review
//   - workspaceReviewCount         → GET /api/mnemo/review/count
//   - resolveWorkspaceReview       → POST /api/mnemo/review/[id]/resolve
//
// Each returns a discriminated `{ mode, data }` envelope so the
// caller can stamp `X-Mnemo-Mode` on the response. Wire shape is the
// SDK shape regardless of mode — library Date fields are collapsed to
// strings at the helper boundary.
//
// The resolve helper preserves the legacy orchester semantic exactly:
// when `resolution='forgotten'` and the row is fact-sourced, the
// fact's status is atomically flipped to 'forgotten' in the same tx.
// In service mode the server does the cascade; in library mode the
// helper does it inline. The wire response carries `cascaded` so the
// route handler can use it for the audit log entry.

import "server-only";
import type {
  ListReviewResponse,
  ResolveReviewInput,
  ResolveReviewResponse,
  ReviewCountResponse,
  ReviewReason,
} from "@mnemosyne/client-ts";

export type MnemoMode = "service" | "library";

export function getMnemoMode(): MnemoMode {
  return process.env["MNEMO_URL"] && process.env["MNEMO_API_KEY"] ? "service" : "library";
}

/**
 * Collapse a library `ReviewQueueRow` (Date fields) onto the wire-
 * shape entry. Inline rather than in a shared util — the only callers
 * are this file's two list-style helpers, and keeping the Date↔string
 * boundary visible in the helper file beats a one-line import.
 */
function reviewRowToWire(r: {
  id: string;
  workspaceId: string;
  factId: string | null;
  decisionId: string | null;
  reason: ReviewReason;
  createdAt: Date;
  resolvedAt: Date | null;
  resolvedBy: string | null;
  resolution: "kept" | "edited" | "forgotten" | "dismissed" | null;
}): ListReviewResponse["items"][number] {
  return {
    id: r.id,
    workspaceId: r.workspaceId,
    factId: r.factId,
    decisionId: r.decisionId,
    reason: r.reason,
    createdAt: r.createdAt.toISOString(),
    resolvedAt: r.resolvedAt ? r.resolvedAt.toISOString() : null,
    resolvedBy: r.resolvedBy,
    resolution: r.resolution,
  };
}

export async function listWorkspaceReview(
  workspaceId: string,
  opts: { reason?: ReviewReason; includeResolved?: boolean; limit: number }
): Promise<{ mode: MnemoMode; data: ListReviewResponse }> {
  const mode = getMnemoMode();

  if (mode === "service") {
    const { getMnemoClient } = await import("@/lib/mnemo/client");
    const client = getMnemoClient();
    const data = await client.listReview({
      ...(opts.reason ? { reason: opts.reason } : {}),
      ...(opts.includeResolved !== undefined ? { all: opts.includeResolved } : {}),
      limit: opts.limit,
    });
    return { mode, data };
  }

  const { listReview, withMnemoTx } = await import("@mnemosyne/core");
  const items = await withMnemoTx(workspaceId, (tx) =>
    listReview({
      workspaceId,
      ...(opts.reason ? { reason: opts.reason } : {}),
      includeResolved: opts.includeResolved ?? false,
      limit: opts.limit,
      tx,
    })
  );
  return { mode, data: { items: items.map(reviewRowToWire) } };
}

export async function workspaceReviewCount(
  workspaceId: string
): Promise<{ mode: MnemoMode; data: ReviewCountResponse }> {
  const mode = getMnemoMode();

  if (mode === "service") {
    const { getMnemoClient } = await import("@/lib/mnemo/client");
    const client = getMnemoClient();
    const data = await client.reviewCount();
    return { mode, data };
  }

  const { withMnemoTx } = await import("@mnemosyne/core");
  const { sql } = await import("drizzle-orm");
  const count = await withMnemoTx(workspaceId, async (tx) => {
    const rows = (await tx.execute(sql`
      SELECT COUNT(*)::int AS n
      FROM mnemo_review_queue
      WHERE workspace_id = ${workspaceId}
        AND resolved_at IS NULL
    `)) as unknown as Array<{ n: number }>;
    return rows[0]?.n ?? 0;
  });
  return { mode, data: { count } };
}

/**
 * Resolve a queue row. Returns `data:null` when the row does not
 * exist (route maps → 404) or when it was already resolved (route
 * maps → 409). The discriminant: `alreadyResolved` flag.
 *
 * The legacy orchester route distinguished 404 vs 409 by inspecting
 * the `factId` field of the lib-level result; we surface a richer
 * envelope here so the route handler doesn't need to reverse-engineer
 * the same heuristic in both modes.
 */
export async function resolveWorkspaceReview(
  workspaceId: string,
  reviewId: string,
  input: ResolveReviewInput,
  resolvedByUserId: string
): Promise<{
  mode: MnemoMode;
  data: ResolveReviewResponse | null;
  alreadyResolved: boolean;
}> {
  const mode = getMnemoMode();

  if (mode === "service") {
    const { getMnemoClient } = await import("@/lib/mnemo/client");
    const { MnemosyneAPIError } = await import("@mnemosyne/client-ts");
    const client = getMnemoClient();
    try {
      const data = await client.resolveReview(reviewId, input);
      return { mode, data, alreadyResolved: false };
    } catch (e) {
      if (e instanceof MnemosyneAPIError) {
        if (e.status === 404) return { mode, data: null, alreadyResolved: false };
        if (e.status === 409) return { mode, data: null, alreadyResolved: true };
      }
      throw e;
    }
  }

  // Library mode — preserves the legacy orchester semantic exactly:
  // resolve + (if 'forgotten' and fact-sourced) cascade in the same
  // workspace-scoped tx so the audit log entry upstream can reference
  // both sides without a race.
  const { resolveReview, withMnemoTx } = await import("@mnemosyne/core");
  const { schema } = await import("@orchester/db");
  const { and, eq } = await import("drizzle-orm");

  const result = await withMnemoTx(workspaceId, async (tx) => {
    const r = await resolveReview({
      workspaceId,
      reviewId,
      resolvedByUserId,
      resolution: input.resolution,
      tx,
    });

    let cascaded = false;
    if (r.resolved && input.resolution === "forgotten" && r.factId) {
      await tx
        .update(schema.mnemoFacts)
        .set({ status: "forgotten", updatedAt: new Date() })
        .where(
          and(eq(schema.mnemoFacts.id, r.factId), eq(schema.mnemoFacts.workspaceId, workspaceId))
        );
      cascaded = true;
    }

    return { ...r, cascaded };
  });

  if (!result.resolved) {
    // factId/decisionId both null → never existed (404).
    // Otherwise → already resolved (409).
    if (result.factId === null && result.decisionId === null) {
      return { mode, data: null, alreadyResolved: false };
    }
    return { mode, data: null, alreadyResolved: true };
  }

  return {
    mode,
    data: {
      id: reviewId,
      resolution: input.resolution,
      factId: result.factId,
      cascaded: result.cascaded,
    },
    alreadyResolved: false,
  };
}
