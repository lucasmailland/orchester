// apps/web/lib/mnemo/review.ts
//
// HTTP-only implementation of the workspace's active-learning review queue.
//
// Three helpers cover the three endpoints under /v1/review:
//   - listWorkspaceReview          → GET /api/mnemo/review
//   - workspaceReviewCount         → GET /api/mnemo/review/count
//   - resolveWorkspaceReview       → POST /api/mnemo/review/[id]/resolve
//
// The resolve helper preserves the legacy semantics: when
// `resolution='forgotten'` and the row is fact-sourced, the server
// atomically cascades the fact's status flip in the same tx. The wire
// response carries `cascaded` so the route handler can use it for the
// audit log entry.

import "server-only";
import type {
  ListReviewResponse,
  ResolveReviewInput,
  ResolveReviewResponse,
  ReviewCountResponse,
  ReviewReason,
} from "@mnemosyne/client-ts";
import { getMnemoMode, getMnemoClient, type MnemoMode } from "@/lib/mnemo/client";

export { getMnemoMode };
export type { MnemoMode };

export async function listWorkspaceReview(
  _workspaceId: string,
  opts: { reason?: ReviewReason; includeResolved?: boolean; limit: number }
): Promise<{ mode: MnemoMode; data: ListReviewResponse }> {
  const mode = getMnemoMode();
  const client = getMnemoClient();
  const data = await client.listReview({
    ...(opts.reason ? { reason: opts.reason } : {}),
    ...(opts.includeResolved !== undefined ? { all: opts.includeResolved } : {}),
    limit: opts.limit,
  });
  return { mode, data };
}

export async function workspaceReviewCount(
  _workspaceId: string
): Promise<{ mode: MnemoMode; data: ReviewCountResponse }> {
  const mode = getMnemoMode();
  const client = getMnemoClient();
  const data = await client.reviewCount();
  return { mode, data };
}

/**
 * Resolve a queue row. Returns `data:null` when the row does not
 * exist (route maps → 404) or when it was already resolved (route
 * maps → 409). The discriminant: `alreadyResolved` flag.
 */
export async function resolveWorkspaceReview(
  _workspaceId: string,
  reviewId: string,
  input: ResolveReviewInput,
  _resolvedByUserId: string
): Promise<{
  mode: MnemoMode;
  data: ResolveReviewResponse | null;
  alreadyResolved: boolean;
}> {
  const mode = getMnemoMode();
  const client = getMnemoClient();
  const { MnemosyneAPIError } = await import("@mnemosyne/client-ts");
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
