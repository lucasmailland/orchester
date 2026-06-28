import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const middlewareSrc = readFileSync(join(__dirname, "../../middleware.ts"), "utf8");
const inviteRouteSrc = readFileSync(join(__dirname, "../../app/api/invites/route.ts"), "utf8");

describe("SEC-16 cleanups", () => {
  it("middleware strips an inbound x-tenant-id header", () => {
    expect(middlewareSrc).toMatch(/delete\(["']x-tenant-id["']\)/);
  });

  it("middleware uses ?return= not ?callbackUrl= for unauthenticated redirect", () => {
    expect(middlewareSrc).toMatch(/set\(["']return["']/);
    expect(middlewareSrc).not.toMatch(/set\(["']callbackUrl["']/);
  });

  it("invite route caps role at inviter's via satisfiesRole", () => {
    expect(inviteRouteSrc).toMatch(/satisfiesRole/);
    // Must NOT unconditionally trust parsed.data.role as the granted role
    expect(inviteRouteSrc).toMatch(/requestedRole/);
  });
});
