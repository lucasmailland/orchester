import "server-only";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@orchester/db";
import type { WorkspaceMember } from "@orchester/db";

/**
 * Membership check with a tiny in-process cache.
 *
 * Why this exists separately from the resolver: membership is checked
 * on EVERY request that touches a workspace (every middleware run,
 * every API call). Going to the DB each time would be ~50µs of
 * round-trip per request just to confirm a known fact. A 60s cache
 * cuts that to ~0 for the warm case.
 *
 * Why 60s (not 5min like resolve): role changes need to propagate
 * quickly. If an admin demotes a user to viewer, that user should
 * lose write access within a minute, not 5. The mutation paths that
 * change roles MUST call invalidateMembership() too, but the TTL is
 * the belt to the suspenders.
 *
 * Why Map instead of LRU: the working set per process is bounded by
 * (active users × workspaces they touch in 60s) which in practice
 * is small. We bound growth via the TTL eviction in checkMembership
 * itself; if cardinality grows we can swap in LRUCache later.
 */
const TTL_MS = 60_000;
const cache = new Map<string, { value: WorkspaceMember | null; expiresAt: number }>();

function cacheKey(userId: string, workspaceId: string) {
  return `${userId}:${workspaceId}`;
}

/**
 * Returns the `workspace_member` row if the user belongs to the
 * workspace, otherwise null. Non-members are cached as `null` too —
 * that's intentional, since a user spamming a workspace they aren't
 * in shouldn't be allowed to DoS the DB with membership lookups.
 *
 * The cached row reflects the role at the time of the lookup. After
 * a role change, callers MUST invalidate the entry (or wait the
 * 60s TTL) before role-gated checks become accurate again.
 */
export async function checkMembership(
  userId: string,
  workspaceId: string
): Promise<WorkspaceMember | null> {
  const key = cacheKey(userId, workspaceId);
  const now = Date.now();
  const cached = cache.get(key);
  if (cached && cached.expiresAt > now) return cached.value;

  const db = getDb();
  const rows = await db
    .select()
    .from(schema.workspaceMembers)
    .where(
      and(
        eq(schema.workspaceMembers.userId, userId),
        eq(schema.workspaceMembers.workspaceId, workspaceId)
      )
    )
    .limit(1);

  const result = rows[0] ?? null;
  cache.set(key, { value: result, expiresAt: now + TTL_MS });
  return result;
}

/**
 * Drop a single (user, workspace) entry. Call after role changes,
 * member removal, or fresh invites.
 */
export function invalidateMembership(userId: string, workspaceId: string): void {
  cache.delete(cacheKey(userId, workspaceId));
}

/**
 * Drop every entry for a user. Useful when a user is deleted, locked
 * out, or their session is revoked — we want every workspace they
 * could possibly hit to re-validate on the next call.
 */
export function invalidateAllMembershipFor(userId: string): void {
  const prefix = `${userId}:`;
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) cache.delete(key);
  }
}
