// apps/web/lib/tenant/cluster-cache.ts
//
// Cluster-wide cache invalidation via Postgres LISTEN/NOTIFY.
//
// Each app pod boots a single LISTEN connection (dedicated postgres-js
// client with max:1) on a shared channel. Mutations on any pod call
// `broadcastInvalidation(...)` which issues a NOTIFY on the regular app
// pool; the listener on every pod (including the originating one)
// receives the payload and dispatches to all registered local handlers.
//
// Why dedicated connection: postgres-js holds the LISTEN connection
// open for the lifetime of the listener; if it were shared with the
// app pool, the pool wouldn't be able to recycle the socket and would
// silently lose throughput. `max:1` + `idle_timeout:0` keeps the
// socket pinned without affecting the main pool.
//
// Re-entrancy: Postgres delivers NOTIFY to every listener on the
// channel, including the one whose connection originated the NOTIFY.
// So the originating pod will receive its own broadcast back. That's
// fine — the local purge happens IMMEDIATELY (synchronously) before
// the broadcast, and re-purging a missing LRU key is a no-op.
//
// Best-effort semantics: a broadcast failure (DB unreachable, channel
// throttled, etc.) never throws. The originating pod's local purge is
// the source of truth for the originating pod; other pods get the
// invalidation via NOTIFY OR after their own per-cache TTL elapses.
import "server-only";
import postgres from "postgres";
import { safeLogError } from "@/lib/safe-log";

export type Invalidation =
  | { kind: "workspace"; key: string }
  | { kind: "membership"; userId: string; workspaceId: string }
  | { kind: "feature-flag"; workspaceId: string; flagKey: string };

type Handler = (msg: Invalidation) => void;

const CHANNEL = "tenant_cache_invalidation";
const handlers: Handler[] = [];

// One LISTEN connection per process. The connection holds a single
// dedicated socket — do NOT share with the app pool. postgres-js
// `listen()` reconnects automatically on disconnect.
let listenerStarted = false;
let listenerSql: ReturnType<typeof postgres> | null = null;

/**
 * Start the LISTEN connection. Idempotent — safe to call from every
 * module that wants to receive invalidations. Returns immediately;
 * the actual LISTEN registration happens asynchronously.
 *
 * Silently disables itself when DATABASE_URL is missing so test
 * harnesses that don't boot the listener (or builds that bundle the
 * file without provisioning a DB) don't crash.
 */
export function startListener(): void {
  if (listenerStarted) return;
  const url = process.env["DATABASE_URL"];
  if (!url) {
    safeLogError("[cluster-cache] DATABASE_URL missing, listener disabled", null);
    return;
  }
  listenerStarted = true;
  // Dedicated connection — postgres-js keeps a single socket open for
  // LISTEN. idle_timeout:0 prevents the client from recycling it.
  listenerSql = postgres(url, { max: 1, idle_timeout: 0, connect_timeout: 10 });
  listenerSql
    .listen(
      CHANNEL,
      (payload) => {
        try {
          const msg = JSON.parse(payload) as Invalidation;
          for (const h of handlers) {
            try {
              h(msg);
            } catch (e) {
              safeLogError("[cluster-cache] handler error:", e);
            }
          }
        } catch (e) {
          safeLogError("[cluster-cache] invalid payload:", { payload, error: e });
        }
      },
      () => {
        console.log("[cluster-cache] listening on", CHANNEL);
      }
    )
    .catch((e) => {
      safeLogError("[cluster-cache] listen failed:", e);
      listenerStarted = false;
    });
}

/**
 * Register a handler called for every invalidation received on the
 * shared channel (regardless of `kind` — handlers filter themselves).
 * Returns an unsubscribe fn for tests/HMR cleanup.
 */
export function onInvalidation(handler: Handler): () => void {
  handlers.push(handler);
  return () => {
    const i = handlers.indexOf(handler);
    if (i >= 0) handlers.splice(i, 1);
  };
}

/**
 * Broadcast an invalidation to all listeners on the channel via a
 * NOTIFY on the dedicated listener connection. We use the listener
 * connection (not the app pool) because postgres-js exposes
 * `.notify()` directly on the client and the listener socket already
 * has the right credentials.
 *
 * Best-effort: any error is logged, never thrown. The originating
 * pod's local purge is the source of truth — the broadcast just
 * helps other pods catch up faster than their own TTL.
 *
 * Not transactional: NOTIFY in a txn doesn't deliver until COMMIT,
 * which would defeat the "millisecond propagation" goal. Calling
 * outside any txn (default for `.notify()`) sends immediately.
 */
export async function broadcastInvalidation(msg: Invalidation): Promise<void> {
  const url = process.env["DATABASE_URL"];
  if (!url) return; // best effort, no DB — nothing to broadcast
  try {
    // Lazily create the connection if startListener() hasn't run yet
    // (e.g. tests that exercise broadcast in isolation). Reuse the
    // same dedicated client so we don't spin up another pool.
    if (!listenerSql) {
      listenerSql = postgres(url, { max: 1, idle_timeout: 0, connect_timeout: 10 });
    }
    await listenerSql.notify(CHANNEL, JSON.stringify(msg));
  } catch (e) {
    safeLogError("[cluster-cache] broadcast failed:", e);
  }
}

/**
 * Tear down the listener. Used by tests for clean shutdown between
 * suites and by graceful-shutdown handlers.
 */
export async function stopListener(): Promise<void> {
  if (listenerSql) {
    try {
      await listenerSql.end({ timeout: 5 });
    } catch (e) {
      safeLogError("[cluster-cache] stop failed:", e);
    }
    listenerSql = null;
  }
  listenerStarted = false;
}

/**
 * Test-only: drop all registered handlers. Use between test cases so
 * earlier subscribers don't observe later test broadcasts.
 */
export function _resetHandlersForTest(): void {
  handlers.length = 0;
}
