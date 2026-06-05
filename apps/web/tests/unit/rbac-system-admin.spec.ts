// apps/web/tests/unit/rbac-system-admin.spec.ts
//
// Unit tests for the system-admin gate (lib/rbac.ts) added for the
// workspace suspend endpoints + the consolidated tenant-telemetry
// route. The gate is env-driven (ADMIN_EMAILS), so the tests stub it
// per-case and reload the module to defeat any future memoization.
//
// The suspend route itself is a thin wrapper around suspend/unsuspend
// (lib/tenant/lifecycle) which already has integration coverage; the
// only NEW logic here is the system-admin gate and we cover it at the
// helper level instead of standing up a NextRequest harness.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("rbac system-admin gate", () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    vi.resetModules();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("isSystemAdmin", () => {
    it("returns false when ADMIN_EMAILS is unset (fail closed)", async () => {
      delete process.env["ADMIN_EMAILS"];
      const { isSystemAdmin } = await import("@/lib/rbac");
      expect(isSystemAdmin("anyone@anywhere.com")).toBe(false);
    });

    it("returns false when ADMIN_EMAILS is empty string", async () => {
      process.env["ADMIN_EMAILS"] = "";
      const { isSystemAdmin } = await import("@/lib/rbac");
      expect(isSystemAdmin("anyone@anywhere.com")).toBe(false);
    });

    it("returns true for an email on the allowlist", async () => {
      process.env["ADMIN_EMAILS"] = "ops@example.com,oncall@example.com";
      const { isSystemAdmin } = await import("@/lib/rbac");
      expect(isSystemAdmin("ops@example.com")).toBe(true);
      expect(isSystemAdmin("oncall@example.com")).toBe(true);
    });

    it("returns false for an email NOT on the allowlist", async () => {
      process.env["ADMIN_EMAILS"] = "ops@example.com";
      const { isSystemAdmin } = await import("@/lib/rbac");
      expect(isSystemAdmin("attacker@example.com")).toBe(false);
    });

    it("handles whitespace + empty entries in the allowlist", async () => {
      process.env["ADMIN_EMAILS"] = "  ops@example.com , , oncall@example.com  ,";
      const { isSystemAdmin } = await import("@/lib/rbac");
      expect(isSystemAdmin("ops@example.com")).toBe(true);
      expect(isSystemAdmin("oncall@example.com")).toBe(true);
    });

    it("returns false for null / undefined / empty caller", async () => {
      process.env["ADMIN_EMAILS"] = "ops@example.com";
      const { isSystemAdmin } = await import("@/lib/rbac");
      expect(isSystemAdmin(null)).toBe(false);
      expect(isSystemAdmin(undefined)).toBe(false);
      expect(isSystemAdmin("")).toBe(false);
    });

    it("is case-sensitive (no normalization)", async () => {
      // Email comparisons in this codebase keep the stored case; we do
      // NOT lowercase before compare because the user table also
      // doesn't (and we want this gate to match the actual session.user
      // .email value byte-for-byte to avoid the "looks-equal but isn't"
      // class of bug).
      process.env["ADMIN_EMAILS"] = "Ops@Example.com";
      const { isSystemAdmin } = await import("@/lib/rbac");
      expect(isSystemAdmin("Ops@Example.com")).toBe(true);
      expect(isSystemAdmin("ops@example.com")).toBe(false);
    });
  });

  describe("assertSystemAdmin", () => {
    it("throws SystemAdminRequiredError when caller not on the list", async () => {
      delete process.env["ADMIN_EMAILS"];
      const { assertSystemAdmin, SystemAdminRequiredError } = await import("@/lib/rbac");
      expect(() => assertSystemAdmin("nobody@nowhere.com")).toThrow(SystemAdminRequiredError);
    });

    it("error carries the actor email for forensic context", async () => {
      delete process.env["ADMIN_EMAILS"];
      const { assertSystemAdmin, SystemAdminRequiredError } = await import("@/lib/rbac");
      try {
        assertSystemAdmin("attacker@example.com");
        throw new Error("should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(SystemAdminRequiredError);
        expect((e as InstanceType<typeof SystemAdminRequiredError>).actor).toBe(
          "attacker@example.com"
        );
        expect((e as InstanceType<typeof SystemAdminRequiredError>).status).toBe(403);
      }
    });

    it("returns silently when caller is on the list", async () => {
      process.env["ADMIN_EMAILS"] = "ops@example.com";
      const { assertSystemAdmin } = await import("@/lib/rbac");
      expect(() => assertSystemAdmin("ops@example.com")).not.toThrow();
    });

    it("treats null/undefined as anonymous (still throws)", async () => {
      process.env["ADMIN_EMAILS"] = "ops@example.com";
      const { assertSystemAdmin, SystemAdminRequiredError } = await import("@/lib/rbac");
      expect(() => assertSystemAdmin(null)).toThrow(SystemAdminRequiredError);
      expect(() => assertSystemAdmin(undefined)).toThrow(SystemAdminRequiredError);
    });
  });
});
