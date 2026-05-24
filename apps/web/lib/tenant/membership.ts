import "server-only";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@orchester/db";
import type { WorkspaceMember } from "@orchester/db";
import { broadcastInvalidation, onInvalidation, startListener } from "./cluster-cache";

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

// Cluster-wide LISTEN bootstrap. Subscribes a handler that purges this
// pod's membership cache whenever ANY pod broadcasts a membership
// invalidation. Same re-entrancy considerations as resolve.ts: the
// originating pod gets its own NOTIFY back; Map.delete on a missing
// key is a no-op so it's safe.
startListener();
onInvalidation((msg) => {
  if (msg.kind !== "membership") return;
  cache.delete(cacheKey(msg.userId, msg.workspaceId));
});

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
 * Drop a single (user, workspace) entry locally and broadcast the
 * invalidation cluster-wide. Call after role changes, member removal,
 * or fresh invites.
 *
 * The broadcast is best-effort — local purge happens first so this pod
 * is consistent regardless of broadcast success.
 */
export function invalidateMembership(userId: string, workspaceId: string): void {
  cache.delete(cacheKey(userId, workspaceId));
  void broadcastInvalidation({ kind: "membership", userId, workspaceId });
}

/**
 * Drop every entry for a user. Useful when a user is deleted, locked
 * out, or their session is revoked — we want every workspace they
 * could possibly hit to re-validate on the next call.
 *
 * Broadcasts one invalidation per (user, workspaceId) currently cached
 * on this pod. Other pods don't see the same set of keys, so they
 * won't all be purged via broadcast; they rely on the per-key TTL
 * (60s) to catch up. For a true cluster-wide user-wide purge an
 * operator should bounce the pods. This trade-off keeps the broadcast
 * channel cheap (no O(users*workspaces) NOTIFYs).
 */
export function invalidateAllMembershipFor(userId: string): void {
  const prefix = `${userId}:`;
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) {
      cache.delete(key);
      // key shape is `${userId}:${workspaceId}` — broadcast each so
      // other pods that DO have the entry can purge it too.
      const workspaceId = key.slice(prefix.length);
      void broadcastInvalidation({ kind: "membership", userId, workspaceId });
    }
  }
}
