// apps/web/__tests__/recall-debug-hot-path-regression.test.ts
//
// Inspector UI v2 — production hot-path safety regression.
//
// The `captureTrace` flag is intentionally a debug-only switch:
//   - It surfaces verbatim fact-statement previews (200 chars each).
//   - It adds ~1-2 KB of payload + ~2-5 ms of overhead per recall.
//   - The agent-runtime hot path runs on EVERY agent turn — even a
//     small per-call cost compounds significantly across a session.
//
// The Inspector UI v2 design doc explicitly calls out:
//   "captureTrace budget impact. Estimated 2-5ms + 500B per call.
//    Acceptable for debug endpoint, do NOT enable it for the agent-
//    runtime hot path. Add a regression test asserting the production
//    path doesn't pass captureTrace."
//
// This file IS that regression test. It reads the source files that
// compose the production recall path and asserts none of them set
// `captureTrace: true`. A textual scan (rather than runtime
// instrumentation) catches the regression at CI time before any real
// recall executes.

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";

// Files that compose the production recall hot path. Each MUST NOT
// contain a truthy `captureTrace:` literal.
const PRODUCTION_RECALL_PATHS = [
  "apps/web/lib/agent-runtime.ts",
  "apps/web/lib/recall-unified.ts",
  "apps/web/app/api/mnemo/recall-unified/route.ts",
  "apps/web/app/api/mnemo/facts/route.ts",
];

const REPO_ROOT = resolve(__dirname, "..", "..", "..");

describe("Inspector UI v2 — production hot-path safety", () => {
  it.each(PRODUCTION_RECALL_PATHS)(
    "%s does NOT enable captureTrace on any recall call",
    async (relPath) => {
      const abs = resolve(REPO_ROOT, relPath);
      const src = await readFile(abs, "utf8");

      const dangerous = [/captureTrace\s*:\s*true\b/, /captureTrace\s*:\s*1\b/];

      for (const re of dangerous) {
        const match = re.exec(src);
        if (match) {
          throw new Error(
            `[${relPath}] forbidden captureTrace usage in production recall path:\n` +
              `  matched: "${match[0]}" at offset ${match.index}\n` +
              `  Inspector UI v2 captureTrace is debug-only — see ` +
              `docs/specs/2026-05-30-inspector-ui-v2-design.md.`
          );
        }
      }
    }
  );

  // Sanity: the debug endpoint DOES set captureTrace=true (otherwise
  // the funnel is empty). Pin it as a positive control so the
  // assertion above isn't trivially passing because the entire
  // feature is gone.
  it("/api/mnemo/recall-debug DOES enable captureTrace (positive control)", async () => {
    const abs = resolve(REPO_ROOT, "apps/web/app/api/mnemo/recall-debug/route.ts");
    const src = await readFile(abs, "utf8");
    expect(src).toMatch(/captureTrace\s*:\s*true/);
  });
});
