import { describe, it, expect } from "vitest";
import { safeReturnPath } from "@/lib/safe-return";

describe("safeReturnPath", () => {
  it.each(["/en", "/es/acme/flows?tab=runs", "/pt/invite/inv_abc"])("keeps %s", (p) => {
    expect(safeReturnPath(p)).toBe(p);
  });

  it.each([
    "/\t/evil.com",
    "/\n/evil.com",
    "//evil.com",
    "/\\evil.com",
    "https://evil.com",
    "/javascript:alert(1)",
    "/x\u0000",
  ])("refuses %j", (p) => {
    expect(safeReturnPath(p)).toBeNull();
  });
});
