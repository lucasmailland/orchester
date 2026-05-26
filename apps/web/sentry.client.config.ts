/**
 * Sentry client-side init (Phase J.1).
 *
 * IMPORTANT: this file is NOT auto-imported by Next.js. It is referenced
 * from `components/providers/SentryClientInit.tsx`, which:
 *
 *   1. Returns null (renders nothing) when `NEXT_PUBLIC_SENTRY_DSN` is
 *      not defined at BUILD TIME. Because the literal `false` collapses
 *      to dead code, the entire `import("./sentry.client.config")`
 *      branch is tree-shaken out of the client bundle — `@sentry/nextjs`
 *      does NOT ship to the browser unless the public DSN is set when
 *      `next build` runs.
 *
 *   2. Lazy-imports this module from a `useEffect` so the SDK lands in
 *      a separate chunk and is fetched only after first paint.
 *
 * Bundle-weight contract: confirm with `next build && grep -r sentry
 * .next/static` after every Sentry release — no Sentry symbols in the
 * client bundle when `NEXT_PUBLIC_SENTRY_DSN` is unset at build time.
 */
export async function initClientSentry(): Promise<void> {
  // Defense-in-depth: even though the caller already guards on the
  // build-time literal, re-check the runtime value so the module can be
  // dynamically imported in tests / storybook without forcing init.
  const dsn = process.env["NEXT_PUBLIC_SENTRY_DSN"];
  if (!dsn) return;
  const Sentry = await import("@sentry/nextjs");
  Sentry.init({
    dsn,
    tracesSampleRate: Number(process.env["NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE"] ?? 0.1),
    environment: process.env["NODE_ENV"],
    release: process.env["NEXT_PUBLIC_SENTRY_RELEASE"],
    // Reasonable defaults — replay/perf are opt-in via subsequent PRs.
    integrations: [],
  });
}
