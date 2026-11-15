import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/safe-log", () => ({ safeLogError: vi.fn() }));
import { warnOnPublicDefaultPassword } from "@/lib/db-role-check";

describe("warnOnPublicDefaultPassword", () => {
  it("flags the public default app_user password", () => {
    expect(warnOnPublicDefaultPassword("postgresql://app_user:app@postgres:5432/orchester")).toBe(
      true
    );
  });
  it("is quiet for a rotated password or another role", () => {
    expect(
      warnOnPublicDefaultPassword("postgresql://app_user:s3cret@postgres:5432/orchester")
    ).toBe(false);
    expect(warnOnPublicDefaultPassword("postgresql://orchester:app@postgres:5432/orchester")).toBe(
      false
    );
    expect(warnOnPublicDefaultPassword(undefined)).toBe(false);
  });
});
