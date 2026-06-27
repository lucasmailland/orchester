// apps/web/tests/unit/net-guard.spec.ts
//
// SEC-14: assertPublicUrlResolved resolves DNS and rejects hosts that
// map to private/link-local IPs (DNS-rebinding guard).
import { describe, it, expect, vi } from "vitest";

vi.mock("node:dns/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:dns/promises")>();
  return {
    ...actual,
    lookup: vi.fn(async () => [{ address: "169.254.169.254", family: 4 }]),
  };
});

describe("SEC-14: SSRF guard resolves DNS", () => {
  it("rejects a public hostname that resolves to a private IP", async () => {
    const { assertPublicUrlResolved } = await import("@/lib/net-guard");
    await expect(assertPublicUrlResolved("https://evil.example.com/x")).rejects.toThrow();
  });

  it("still allows a hostname that resolves to a public IP", async () => {
    const dns = await import("node:dns/promises");
    (dns.lookup as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { address: "93.184.216.34", family: 4 },
    ]);
    const { assertPublicUrlResolved } = await import("@/lib/net-guard");
    await expect(assertPublicUrlResolved("https://example.com/x")).resolves.toBeInstanceOf(URL);
  });
});
