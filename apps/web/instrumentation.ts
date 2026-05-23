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
}
