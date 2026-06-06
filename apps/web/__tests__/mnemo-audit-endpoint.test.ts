// apps/web/__tests__/mnemo-audit-endpoint.test.ts
//
// Pin the SHAPE of GET /api/mnemo/audit so the UndoClient's
// `UndoResponse` contract stays stable across refactors.
//
// Tramo 3 (2026-06-05) split the route into a thin dispatch shell +
// a helper at `apps/web/lib/mnemo/audit.ts` for the dual-mode work.
// The tests below check BOTH layers:
//
//   - The route file: only that it exists, runs requireAuth, and
//     hands off to the helper. Anything DB-touching is now in the
//     helper.
//   - The helper file: pin the wire shape, the camelCase mapping,
//     the union-all of forgotten + archived sources, and the
//     graceful-degrade `{available:false}` contract.
//
// The route itself does NO DB work — full integration coverage requires
// a testcontainer. This file exercises the schema + the dispatch
// shape without spinning a real DB.

import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..", "..");
const ROUTE_PATH = resolve(REPO_ROOT, "apps/web/app/api/mnemo/audit/route.ts");
const HELPER_PATH = resolve(REPO_ROOT, "apps/web/lib/mnemo/audit.ts");

describe("/api/mnemo/audit — UndoClient contract", () => {
  it("the route file exists and dispatches to the helper", async () => {
    const src = await readFile(ROUTE_PATH, "utf8");
    expect(src).toContain("export async function GET");
    expect(src).toContain("requireAuth");
    // Post-tramo 3: route is a thin dispatcher.
    expect(src).toContain("listWorkspaceAudit");
  });

  it("the helper returns the JSON shape UndoClient expects (items / total / available)", async () => {
    const src = await readFile(HELPER_PATH, "utf8");
    // The UndoClient defensive parser checks for these three keys.
    expect(src).toMatch(/items:/);
    expect(src).toMatch(/total:/);
    expect(src).toMatch(/available:/);
  });

  it("the helper maps DB columns to the camelCase shape the UI consumes", async () => {
    const src = await readFile(HELPER_PATH, "utf8");
    // The UI shape has factId / factStatement / factSubject / factKind
    // / actorKind / actorName / revertible. All must appear in the
    // mapping block.
    for (const key of [
      "factId:",
      "factStatement:",
      "factSubject:",
      "factKind:",
      "actorKind:",
      "actorName:",
      "revertible:",
    ]) {
      expect(src).toContain(key);
    }
  });

  it("the helper surfaces forgotten + archived events (the two derivable sources)", async () => {
    const src = await readFile(HELPER_PATH, "utf8");
    expect(src).toContain("mnemo_fact");
    expect(src).toContain("mnemo_fact_archive");
    expect(src).toContain("'forgotten'::text");
  });

  it("the helper graceful-degrades to {available:false} on error (UI shows coming-soon)", async () => {
    const src = await readFile(HELPER_PATH, "utf8");
    // Both modes (service and library) wrap in try/catch and log via
    // safeLogError, returning the degraded payload so the UI's
    // graceful-degrade path triggers instead of an error toast.
    expect(src).toMatch(/catch[\s\S]*safeLogError/);
    expect(src).toMatch(/available: false/);
  });

  it("the route stamps X-Mnemo-Mode so operators can observe service vs library", async () => {
    const src = await readFile(ROUTE_PATH, "utf8");
    expect(src).toContain("X-Mnemo-Mode");
  });

  it("UndoClient still fetches the canonical URL (regression: no path drift)", async () => {
    const abs = resolve(
      REPO_ROOT,
      "apps/web/app/[locale]/[workspaceSlug]/(shell)/brain/undo/UndoClient.tsx"
    );
    const src = await readFile(abs, "utf8");
    expect(src).toContain("/api/mnemo/audit");
  });
});
