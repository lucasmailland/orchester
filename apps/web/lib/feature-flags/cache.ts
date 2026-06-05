// apps/web/lib/feature-flags/cache.ts
//
// In-process cache for per-workspace feature flag lookups. A 60s TTL is
// short enough that operator toggles propagate quickly without making
// `isEnabled` hammer the DB on every hot-path call.
//
// Each app pod has its own copy of the map. Mutations (setFlag) call
// `invalidateFlag` to clear the local entry AND broadcast a NOTIFY
// (see lib/tenant/cluster-cache) so other pods purge within
// milliseconds. The 60s TTL is now a belt-and-suspenders fallback for
// the case where the broadcast was dropped.
import { broadcastInvalidation, onInvalidation, startListener } from "@/lib/tenant/cluster-cache";

const TTL_MS = 60_000;
const cache = new Map<string, { value: boolean; expiresAt: number }>();

// Cluster-wide LISTEN bootstrap. Subscribes a handler that purges this
// pod's flag cache when ANY pod broadcasts a feature-flag invalidation.
// Re-entrant: the originating pod receives its own NOTIFY back; the
// Map.delete on a missing key is a no-op.
startListener();
onInvalidation((msg) => {
  if (msg.kind !== "feature-flag") return;
  cache.delete(key(msg.workspaceId, msg.flagKey));
});

function key(workspaceId: string, flagKey: string) {
  return `${workspaceId}:${flagKey}`;
}

export function getCached(workspaceId: string, flagKey: string): boolean | undefined {
  const e = cache.get(key(workspaceId, flagKey));
  if (!e) return undefined;
  if (e.expiresAt < Date.now()) {
    cache.delete(key(workspaceId, flagKey));
    return undefined;
  }
  return e.value;
}

export function setCached(workspaceId: string, flagKey: string, value: boolean): void {
  cache.set(key(workspaceId, flagKey), {
    value,
    expiresAt: Date.now() + TTL_MS,
  });
}

export function invalidateFlag(workspaceId: string, flagKey: string): void {
  // Local purge first (immediate), then broadcast best-effort.
  cache.delete(key(workspaceId, flagKey));
  void broadcastInvalidation({ kind: "feature-flag", workspaceId, flagKey });
}

export function invalidateAll(workspaceId: string): void {
  // Purge + broadcast one NOTIFY per cached key on this pod. Other pods
  // get a heads-up for keys this pod knows about; their own TTL covers
  // the rest. Same trade-off rationale as invalidateAllMembershipFor.
  for (const k of cache.keys()) {
    if (k.startsWith(`${workspaceId}:`)) {
      cache.delete(k);
      const flagKey = k.slice(`${workspaceId}:`.length);
      void broadcastInvalidation({ kind: "feature-flag", workspaceId, flagKey });
    }
  }
}
