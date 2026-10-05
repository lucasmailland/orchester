import { describe, expect, it, vi } from "vitest";
import { assertSignupAllowed, getSignupMode, SignupNotAllowedError } from "@/lib/signup-policy";

describe("getSignupMode", () => {
  it("defaults to open so a fresh install can create its first user", () => {
    expect(getSignupMode(undefined)).toBe("open");
    expect(getSignupMode("")).toBe("open");
  });

  it.each(["open", "invite", "closed", " Invite "])("accepts %s", (raw) => {
    expect(getSignupMode(raw)).toBe(raw.trim().toLowerCase());
  });

  it("treats an unknown value as closed", () => {
    expect(getSignupMode("invites")).toBe("closed");
  });
});

describe("assertSignupAllowed", () => {
  it("lets anyone in when signup is open", async () => {
    const hasPendingInvite = vi.fn();
    await expect(assertSignupAllowed("a@x.com", "open", hasPendingInvite)).resolves.toBeUndefined();
    expect(hasPendingInvite).not.toHaveBeenCalled();
  });

  it("lets nobody in when signup is closed", async () => {
    await expect(assertSignupAllowed("a@x.com", "closed", async () => true)).rejects.toThrow(
      SignupNotAllowedError
    );
  });

  it("lets an invited email in when signup is invite-only", async () => {
    const hasPendingInvite = vi.fn(async () => true);
    await expect(
      assertSignupAllowed("Ana@X.com", "invite", hasPendingInvite)
    ).resolves.toBeUndefined();
    expect(hasPendingInvite).toHaveBeenCalledWith("ana@x.com");
  });

  it("keeps an email without a pending invite out when signup is invite-only", async () => {
    await expect(assertSignupAllowed("a@x.com", "invite", async () => false)).rejects.toThrow(
      SignupNotAllowedError
    );
  });

  it("keeps an empty email out when signup is invite-only", async () => {
    const hasPendingInvite = vi.fn(async () => true);
    await expect(assertSignupAllowed("  ", "invite", hasPendingInvite)).rejects.toThrow(
      SignupNotAllowedError
    );
    expect(hasPendingInvite).not.toHaveBeenCalled();
  });
});
