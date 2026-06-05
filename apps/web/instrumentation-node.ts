/**
 * Node-only instrumentation impl. Imported dynamically from `instrumentation.ts`
 * after its `NEXT_RUNTIME==='nodejs'` guard. The Edge bundle never sees this
 * file, so it's safe to use Node APIs (`process.on`, etc.) directly.
 *
 * Responsibilities:
 *   - Boot-time env validation (audit A6-1) — fail fast on misconfig.
 *   - SIGTERM / SIGINT handlers — log and exit cleanly.
 *   - Crash reporting — surface unhandledRejection / uncaughtException to
 *     observability and the safe error log.
 *
 * This file deliberately does NOT import lib/queue (pg-boss). pg-boss closes
 * its own connections when the Node process exits; pulling it in here would
 * chain pg → pgpass → split2 → node:crypto into the runtime trace.
 */

import { validateEnv } from "./lib/env";

// ── Mnemosyne v2.0 DI wiring ─────────────────────────────────────────────
// Register @mnemosyne/core's DB client before any request path runs.
// Delegates to the shared wireMnemoDb() helper so the worker entrypoint
// (worker/index.ts) and test fixtures (tests/fixtures/db.ts) call the
// same code path — single source of truth prevents "I forgot one
// entrypoint" bugs (regression: worker process used to crash on first
// cron tick because only the Next.js process called setDb).
{
  const { wireMnemoDb } = await import("./lib/mnemo/wire-di");
  const wired = await wireMnemoDb();
  if (wired) console.log("[instrumentation] @mnemosyne/core DI wiring complete");
}

// ── Boot-time env validation (audit A6-1) ────────────────────────────────
try {
  validateEnv();
  console.log("[instrumentation] env validation OK");
} catch (e) {
  console.error(
    "[instrumentation] FATAL: environment validation failed.\n" +
      (e instanceof Error ? e.message : String(e))
  );
  process.exit(1);
}

// ── Cluster-wide tenant cache invalidation ───────────────────────────────
// Boot the LISTEN connection up-front so the first request after deploy
// can already receive invalidations from sibling pods. startListener()
// is idempotent — the per-module imports in resolve/membership/feature
// flags also call it, but only one connection is opened per process.
{
  const { startListener } = await import("./lib/tenant/cluster-cache");
  startListener();
}

// ── Graceful shutdown ────────────────────────────────────────────────────
let shuttingDown = false;
function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[shutdown] received ${signal}, exiting cleanly`);
  // 5s grace period for in-flight requests to drain.
  setTimeout(() => process.exit(0), 5_000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// ── Crash reporting ──────────────────────────────────────────────────────
process.on("unhandledRejection", async (reason) => {
  const { safeLogError } = await import("./lib/safe-log");
  safeLogError("[unhandledRejection]", reason);
  const { captureException } = await import("./lib/observability");
  captureException(reason instanceof Error ? reason : new Error(String(reason)));
});

process.on("uncaughtException", async (err) => {
  const { safeLogError } = await import("./lib/safe-log");
  safeLogError("[uncaughtException]", err);
  const { captureException } = await import("./lib/observability");
  captureException(err);
});
