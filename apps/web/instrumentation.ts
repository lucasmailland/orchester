/**
 * Next.js Instrumentation hook — runs once at server boot.
 *
 * This file is compiled for BOTH the Node and Edge runtimes. Turbopack's
 * static analyzer flags any direct reference to Node-only APIs (`process.on`,
 * `node:*` imports, …) regardless of runtime guards. The canonical pattern
 * (per Next.js docs) is to keep this file edge-safe and dynamic-import a
 * sibling module that holds the Node-only logic. The Edge bundle never
 * traces that import, so `process.on` and friends never enter its module
 * graph.
 *
 * Doc: https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation
 */

export async function register(): Promise<void> {
  if (process.env["NEXT_RUNTIME"] !== "nodejs") return;
  await import("./instrumentation-node");

  // ── Defense-in-depth layer 2 (audit P0, 2026-05-24): fail-closed if the
  // deployed DATABASE_URL points at a SUPERUSER / BYPASSRLS role. Layer 1
  // (SET LOCAL ROLE app_user inside tx wrappers) covers the request path,
  // but this probe is the deploy-time tripwire that catches the connection
  // config itself. See apps/web/lib/db-role-check.ts and ADR-0010.
  const { assertSafeDbRole } = await import("./lib/db-role-check");
  if (process.env["NODE_ENV"] === "production") {
    // In prod we WANT a thrown error to propagate — failed boot is the
    // intended behaviour, signals to the orchestrator to mark the deploy
    // unhealthy.
    await assertSafeDbRole();
  } else {
    // Dev/test: a flaky check (e.g. pg not yet up during HMR boot) must
    // not break the developer's start. assertSafeDbRole already
    // downgrades to a warning in non-prod for the "unsafe role" path,
    // so this try/catch only swallows transport/IO failures.
    try {
      await assertSafeDbRole();
    } catch (e) {
      const { safeLogError } = await import("./lib/safe-log");
      safeLogError("[instrumentation] db-role-check probe failed", e);
    }
  }
}
