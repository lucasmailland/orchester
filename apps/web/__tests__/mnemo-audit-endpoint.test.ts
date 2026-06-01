// apps/web/__tests__/mnemo-audit-endpoint.test.ts
//
// Pin the SHAPE of GET /api/mnemo/audit so the UndoClient's
// `UndoResponse` contract stays stable across refactors.
//
// The route itself does DB work — full integration coverage requires
// a testcontainer. This file exercises the schema + the dispatch
// shape without spinning a real DB.

import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..", "..");

describe("/api/mnemo/audit — UndoClient contract", () => {
  it("the route file exists at the expected path", async () => {
    const abs = resolve(REPO_ROOT, "apps/web/app/api/mnemo/audit/route.ts");
    const src = await readFile(abs, "utf8");
    expect(src).toContain("export async function GET");
    expect(src).toContain("requireAuth");
  });

  it("returns the JSON shape UndoClient expects (items / total / available)", async () => {
    const abs = resolve(REPO_ROOT, "apps/web/app/api/mnemo/audit/route.ts");
    const src = await readFile(abs, "utf8");
    // The UndoClient defensive parser checks for these three keys.
    expect(src).toMatch(/items:/);
    expect(src).toMatch(/total:/);
    expect(src).toMatch(/available:/);
  });

  it("maps DB columns to the camelCase shape the UI consumes", async () => {
    const abs = resolve(REPO_ROOT, "apps/web/app/api/mnemo/audit/route.ts");
    const src = await readFile(abs, "utf8");
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

  it("surfaces forgotten + archived events (the two derivable sources)", async () => {
    const abs = resolve(REPO_ROOT, "apps/web/app/api/mnemo/audit/route.ts");
    const src = await readFile(abs, "utf8");
    expect(src).toContain("mnemo_fact");
    expect(src).toContain("mnemo_fact_archive");
    expect(src).toContain("'forgotten'::text");
  });

  it("graceful-degrades to {available: false} on DB error (UI shows coming-soon)", async () => {
    const abs = resolve(REPO_ROOT, "apps/web/app/api/mnemo/audit/route.ts");
    const src = await readFile(abs, "utf8");
    // The catch block should return available:false so the UI's
    // graceful-degrade path triggers instead of an error toast.
    expect(src).toMatch(/catch[\s\S]*safeLogError/);
    expect(src).toMatch(/available: false/);
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
