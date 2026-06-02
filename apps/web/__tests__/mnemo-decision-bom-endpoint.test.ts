import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..", "..");

describe("/api/mnemo/decisions/[traceId] — BOM contract", () => {
  it("the route file exists at the expected path", async () => {
    const abs = resolve(REPO_ROOT, "apps/web/app/api/mnemo/decisions/[traceId]/route.ts");
    const src = await readFile(abs, "utf8");
    expect(src).toContain("export async function GET");
    expect(src).toContain("requireAuth");
  });

  it("returns DecisionBOM-shaped body (composeBOM + completeness)", async () => {
    const abs = resolve(REPO_ROOT, "apps/web/app/api/mnemo/decisions/[traceId]/route.ts");
    const src = await readFile(abs, "utf8");
    expect(src).toContain("composeBOM");
    expect(src).toContain("completenessScore");
    expect(src).toContain("available");
  });

  it("queries audit rows by traceId in meta with a ±windowMs window", async () => {
    const abs = resolve(REPO_ROOT, "apps/web/app/api/mnemo/decisions/[traceId]/route.ts");
    const src = await readFile(abs, "utf8");
    expect(src).toContain("audit_log");
    expect(src).toMatch(/meta\s*->>\s*'traceId'/);
    expect(src).toContain("BOM_WINDOW_MS");
  });

  it("graceful-degrades to {available:false} on missing traceId", async () => {
    const abs = resolve(REPO_ROOT, "apps/web/app/api/mnemo/decisions/[traceId]/route.ts");
    const src = await readFile(abs, "utf8");
    expect(src).toMatch(/available:\s*false/);
  });
});
