import "server-only";
import { LRUCache } from "lru-cache";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@orchester/db";
import type { Workspace } from "@orchester/db";

/**
 * In-process LRU cache for workspace lookups.
 *
 * Why two caches keyed by slug and id: lookups happen from both directions
 * (URL → slug, header → id). Keeping a single cache keyed by one and
 * scanning the other on lookup would be O(N); the second cache buys O(1)
 * at the cost of ~5000 extra references (≈ negligible).
 *
 * TTL 5min strikes the balance between freshness (a renamed slug or
 * suspended workspace propagates within 5 min) and avoiding hammering
 * the DB on hot pages. Mutations (rename, suspend, delete) MUST call
 * invalidateCache() to bypass the TTL.
 *
 * The cache lives in the Node process, so each app pod has its own
 * copy — stale entries on a pod that didn't observe an invalidation
 * resolve themselves after 5 min. That's acceptable for workspace
 * metadata, which is rarely mutated.
 */
const CACHE_MAX = 5000;
const CACHE_TTL_MS = 1000 * 60 * 5;

const slugCache = new LRUCache<string, Workspace>({
  max: CACHE_MAX,
  ttl: CACHE_TTL_MS,
});
const idCache = new LRUCache<string, Workspace>({
  max: CACHE_MAX,
  ttl: CACHE_TTL_MS,
});

/**
 * Resolve a workspace by slug. Returns `null` if no workspace exists
 * with that slug. Does NOT filter by lifecycle status — callers that
 * care about active-vs-suspended should inspect `workspace.status`.
 *
 * Slug match is exact (case-sensitive). URL slugs are conventionally
 * lowercase ASCII so callers should normalize before calling.
 */
export async function resolveBySlug(slug: string): Promise<Workspace | null> {
  const cached = slugCache.get(slug);
  if (cached) return cached;

  const db = getDb();
  const rows = await db
    .select()
    .from(schema.workspaces)
    .where(eq(schema.workspaces.slug, slug))
    .limit(1);
  const ws = rows[0];
  if (ws) {
    slugCache.set(slug, ws);
    idCache.set(ws.id, ws);
  }
  return ws ?? null;
}

/**
 * Resolve a workspace by id. Same semantics as resolveBySlug: returns
 * null on miss, does not filter by lifecycle status.
 */
export async function resolveById(id: string): Promise<Workspace | null> {
  const cached = idCache.get(id);
  if (cached) return cached;

  const db = getDb();
  const rows = await db
    .select()
    .from(schema.workspaces)
    .where(eq(schema.workspaces.id, id))
    .limit(1);
  const ws = rows[0];
  if (ws) {
    idCache.set(id, ws);
    slugCache.set(ws.slug, ws);
  }
  return ws ?? null;
}

/**
 * Drop a workspace from the cache (both slug- and id-indexed copies).
 *
 * Pass `"*"` to flush everything (use sparingly — really only useful
 * for tests or after a bulk migration).
 *
 * For a specific workspace pass either its slug OR its id; the cross
 * key is scrubbed too via a best-effort scan of the other cache. The
 * scan is O(N) over CACHE_MAX (5000) which is fine for the
 * once-per-mutation cost.
 */
export function invalidateCache(workspaceIdOrSlugOrStar: string): void {
  if (workspaceIdOrSlugOrStar === "*") {
    slugCache.clear();
    idCache.clear();
    return;
  }
  slugCache.delete(workspaceIdOrSlugOrStar);
  idCache.delete(workspaceIdOrSlugOrStar);
  // Best-effort cross-key invalidation: the caller may have only known
  // one of (slug, id), so scan the other cache for entries pointing at
  // the same workspace.
  for (const [slug, ws] of slugCache.entries()) {
    if (ws.id === workspaceIdOrSlugOrStar) slugCache.delete(slug);
  }
  for (const [id, ws] of idCache.entries()) {
    if (ws.slug === workspaceIdOrSlugOrStar) idCache.delete(id);
  }
}
