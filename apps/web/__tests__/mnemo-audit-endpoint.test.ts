// apps/web/__tests__/mnemo-audit-endpoint.test.ts
//
// Pin the SHAPE of GET /api/mnemo/audit so the UndoClient's
// `UndoResponse` contract stays stable across refactors.
//
// Tramo 3 split the route into a thin dispatch shell + a helper at
// `apps/web/lib/mnemo/audit.ts`. Phase 3 stripped the helper to
// HTTP-only — the camelCase mapping + UNION ALL across mnemo_fact /
// mnemo_fact_archive now live inside @mnemosyne/server, NOT on the
// orchester host.
//
// The tests below check the two layers we still own:
//   - The route file: it exists, runs requireAuth, dispatches to
//     `listWorkspaceAudit`, and stamps `X-Mnemo-Mode`.
//   - The helper file: it returns the discriminated envelope, calls
//     the SDK's `client.audit`, and graceful-degrades via try/catch
//     on transport errors.

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
    expect(src).toContain("listWorkspaceAudit");
  });

  it("the helper returns the JSON shape UndoClient expects (items / total / available)", async () => {
    const src = await readFile(HELPER_PATH, "utf8");
    // The UndoClient defensive parser checks for these three keys.
    expect(src).toMatch(/items:/);
    expect(src).toMatch(/total:/);
    expect(src).toMatch(/available:/);
  });

  it("the helper delegates to the @mnemosyne/client-ts SDK", async () => {
    const src = await readFile(HELPER_PATH, "utf8");
    // Post Phase 3: the helper is HTTP-only. The SQL + camelCase
    // mapping that lived here during the dual-mode era was moved into
    // @mnemosyne/server (which owns the `mnemo_fact` / `mnemo_fact_archive`
    // tables now). What we verify here is that the helper goes through
    // `getMnemoClient()` and calls `client.audit({ limit })`.
    expect(src).toContain("getMnemoClient");
    expect(src).toMatch(/client\.audit\(/);
  });

  it("the helper graceful-degrades to {available:false} on error (UI shows coming-soon)", async () => {
    const src = await readFile(HELPER_PATH, "utf8");
    // try/catch around the SDK call + safeLogError + degraded payload
    // is the contract the UndoClient relies on to render an empty-state
    // instead of an error toast when the service is unreachable.
    expect(src).toMatch(/catch[\s\S]*safeLogError/);
    expect(src).toMatch(/available: false/);
  });

  it("the route stamps X-Mnemo-Mode so operators can observe transport mode", async () => {
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
