"use client";

import { useEffect } from "react";

/**
 * Client-side Sentry bootstrap (Phase J.1).
 *
 * The `NEXT_PUBLIC_SENTRY_DSN` literal is resolved at BUILD time. When
 * it's unset, this component renders null and the `import` below is
 * dead code → webpack tree-shakes `@sentry/nextjs` out of the client
 * bundle entirely. Verified by inspecting `.next/static/chunks` after a
 * production build with the var unset.
 *
 * When the var IS set, we lazy-import the config module from a
 * `useEffect` so SDK init happens AFTER first paint and lands in its
 * own chunk.
 */
export function SentryClientInit(): null {
  useEffect(() => {
    // The build-time guard. `process.env.NEXT_PUBLIC_*` is inlined by
    // Next as a string literal (or undefined) — when undefined, the
    // `if (false)` branch below is removed by the minifier and the
    // dynamic import never makes it into the bundle.
    if (!process.env["NEXT_PUBLIC_SENTRY_DSN"]) return;
    void import("../../sentry.client.config").then((m) => m.initClientSentry());
  }, []);
  return null;
}
