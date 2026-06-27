// apps/web/tests/unit/auth-cookie-cache.spec.ts
//
// PERF-8: session.cookieCache must be enabled so most navigations skip the
// session-table lookup. vitest.setup.ts mocks @/lib/auth globally, so we
// verify by inspecting the source text directly.
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

describe("PERF-8 — session.cookieCache", () => {
  it("auth.ts configures session.cookieCache with enabled: true", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "../../lib/auth.ts"), "utf8");
    expect(src).toMatch(/cookieCache/);
    expect(src).toMatch(/enabled:\s*true/);
  });
});
