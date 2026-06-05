import { describe, it, expect } from "vitest";
import {
  PROTECTED_PATHS,
  AUTH_PATHS,
  extractLocalePath,
  isProtectedPath,
} from "../lib/middleware-utils";

describe("middleware route classification", () => {
  it("dashboard is a protected path", () => {
    expect(PROTECTED_PATHS.some((p) => "/".startsWith(p))).toBe(true);
  });

  it("login is an auth path", () => {
    expect(AUTH_PATHS.some((p) => "/login".startsWith(p))).toBe(true);
  });

  it("extractLocalePath strips locale prefix", () => {
    expect(extractLocalePath("/en/teams")).toBe("/teams");
    expect(extractLocalePath("/pt-BR/settings")).toBe("/settings");
    expect(extractLocalePath("/es")).toBe("/");
  });

  it("api routes are not classified as protected", () => {
    expect(isProtectedPath("/api/auth/get-session")).toBe(false);
  });
});
