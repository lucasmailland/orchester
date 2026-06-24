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
  // ── Phase J.1 — opt-in Sentry init ────────────────────────────────────
  // Runs FIRST so the SDK is ready to capture errors thrown by the
  // subsequent boot probes (env validation, db-role-check). Guarded by
  // SENTRY_DSN: when unset, the @sentry/nextjs import is never resolved.
  // Both the Node and the Edge runtime hit this branch — we init in
  // both so server actions and middleware errors land in the same
  // project. The edge SDK is intentionally slimmer (no Node integrations).
  if (process.env["SENTRY_DSN"]) {
    if (process.env["NEXT_RUNTIME"] === "nodejs") {
      const Sentry = await import("@sentry/nextjs");
      Sentry.init({
        dsn: process.env["SENTRY_DSN"],
        tracesSampleRate: Number(process.env["SENTRY_TRACES_SAMPLE_RATE"] ?? 0.1),
        environment: process.env["NODE_ENV"],
        release: process.env["SENTRY_RELEASE"],
      });
    } else if (process.env["NEXT_RUNTIME"] === "edge") {
      const Sentry = await import("@sentry/nextjs");
      Sentry.init({
        dsn: process.env["SENTRY_DSN"],
        tracesSampleRate: Number(process.env["SENTRY_TRACES_SAMPLE_RATE"] ?? 0.1),
        environment: process.env["NODE_ENV"],
        release: process.env["SENTRY_RELEASE"],
      });
    }
  }

  if (process.env["NEXT_RUNTIME"] !== "nodejs") return;
  // `/* webpackIgnore: true */` prevents webpack from statically tracing
  // this import into the edge bundle. Without it webpack follows the string
  // literal at build time (ignoring the early-return guard above, which is
  // only a runtime check) and pulls in cluster-cache.ts → postgres →
  // perf_hooks, which doesn't exist in the edge runtime and fails the build.
  //
  // In development webpack mode (`next dev` without --turbopack), the
  // webpackIgnore hint causes webpack NOT to emit instrumentation-node.js to
  // .next/server/, so the runtime import fails with MODULE_NOT_FOUND. We
  // degrade gracefully in dev/test: log a warning and continue. In production
  // (`next build` with standalone output), the output-file tracer picks up
  // the file through the dependency graph and copies it correctly.
  try {
    await import(/* webpackIgnore: true */ "./instrumentation-node");
  } catch (e: unknown) {
    if (process.env["NODE_ENV"] === "production") throw e;
    const msg = e instanceof Error ? e.message : String(e);
    // Only suppress the expected MODULE_NOT_FOUND — re-throw anything else.
    if (!msg.includes("Cannot find module") && !msg.includes("MODULE_NOT_FOUND")) throw e;
    console.warn(
      "[instrumentation] instrumentation-node skipped in dev (webpack did not emit it). " +
        "Env validation, signal handlers and cluster-cache listener are inactive. " +
        "This is expected — use `next build` to verify production boot."
    );
  }

  // ── Mnemosyne auto-bootstrap ─────────────────────────────────────────────────
  // On first boot (mnemosyne has no API keys yet), registers MNEMO_API_KEY so
  // the operator doesn't need to manually provision it inside mnemosyne.
  // Idempotent: skipped when mnemosyne already has keys.
  try {
    const { bootstrapMnemo } = await import("./lib/mnemo/bootstrap");
    await bootstrapMnemo();
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!msg.includes("Cannot find module") && !msg.includes("MODULE_NOT_FOUND")) {
      console.warn("[instrumentation] mnemo bootstrap error:", e);
    }
  }

  // ── Defense-in-depth layer 2 (audit P0, 2026-05-24): fail-closed if the
  // deployed DATABASE_URL points at a SUPERUSER / BYPASSRLS role. Layer 1
  // (SET LOCAL ROLE app_user inside tx wrappers) covers the request path,
  // but this probe is the deploy-time tripwire that catches the connection
  // config itself. See apps/web/lib/db-role-check.ts and ADR-0010.
  //
  // webpackIgnore: db-role-check → @orchester/db → postgres → perf_hooks
  // (Node builtin absent from edge runtime). Same reasoning as above.
  //
  // Same dev-mode degradation as instrumentation-node above: webpack does not
  // emit db-role-check.js in dev, so the import fails with MODULE_NOT_FOUND.
  // We catch and warn rather than crashing the dev server.
  try {
    const { assertSafeDbRole } = await import(/* webpackIgnore: true */ "./lib/db-role-check");
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
  } catch (e: unknown) {
    if (process.env["NODE_ENV"] === "production") throw e;
    const msg = e instanceof Error ? e.message : String(e);
    if (!msg.includes("Cannot find module") && !msg.includes("MODULE_NOT_FOUND")) throw e;
    console.warn(
      "[instrumentation] db-role-check skipped in dev (webpack did not emit it). " +
        "DB role check inactive. This is expected — use `next build` to verify production boot."
    );
  }
}

/**
 * Next.js 15 server-error hook. Fires for errors thrown in route
 * handlers, server actions, and React Server Components. We forward to
 * Sentry only when SENTRY_DSN is set — same lazy-import pattern as
 * register() above, so the SDK is never loaded for self-hosts that
 * don't opt in.
 *
 * Doc: https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation#onrequesterror-optional
 */
export async function onRequestError(
  err: unknown,
  request: Readonly<{
    path: string;
    method: string;
    headers: { [key: string]: string | undefined };
  }>,
  context: Readonly<{
    routerKind: "Pages Router" | "App Router";
    routePath: string;
    routeType: "render" | "route" | "action" | "middleware";
    renderSource?: "react-server-components" | "react-server-components-payload" | undefined;
    revalidateReason?: "on-demand" | "stale" | undefined;
    renderType?: "dynamic" | "dynamic-resume" | undefined;
  }>
): Promise<void> {
  if (!process.env["SENTRY_DSN"]) return;
  try {
    const Sentry = await import("@sentry/nextjs");
    // Next exposes a helper that maps the request+context shape directly
    // to a Sentry event with the right tags (route, method, …).
    const captureFn = (
      Sentry as unknown as {
        captureRequestError?: (e: unknown, req: unknown, ctx: unknown) => void;
      }
    ).captureRequestError;
    if (typeof captureFn === "function") {
      captureFn(err, request, context);
    } else {
      Sentry.captureException(err);
    }
  } catch {
    /* never throw from the error hook itself */
  }
}
