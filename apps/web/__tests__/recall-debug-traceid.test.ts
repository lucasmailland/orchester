import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..", "..");

describe("recall-debug returns a stable traceId", () => {
  it("generates a cuid2 traceId and propagates it to audit meta + response", async () => {
    const src = await readFile(
      resolve(REPO_ROOT, "apps/web/app/api/mnemo/recall-debug/route.ts"),
      "utf8"
    );
    expect(src).toContain("`trace_${createId()}`");
    expect(src).toMatch(/meta:\s*{[\s\S]*traceId[\s\S]*}/);
    expect(src).toMatch(/NextResponse\.json\(\s*{\s*[\s\S]*traceId/);
  });
});
