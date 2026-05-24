// apps/web/lib/feature-flags/cache.ts
//
// In-process cache for per-workspace feature flag lookups. A 60s TTL is
// short enough that operator toggles propagate quickly without making
// `isEnabled` hammer the DB on every hot-path call.
//
// Each app pod has its own copy of the map. Mutations (setFlag) call
// `invalidateFlag` to clear the local entry; other pods catch up after
// the TTL expires. That's acceptable since flags rarely toggle and
// staleness on the order of seconds is harmless for gating logic.
const TTL_MS = 60_000;
const cache = new Map<string, { value: boolean; expiresAt: number }>();

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
  cache.delete(key(workspaceId, flagKey));
}

export function invalidateAll(workspaceId: string): void {
  for (const k of cache.keys()) {
    if (k.startsWith(`${workspaceId}:`)) cache.delete(k);
  }
}
