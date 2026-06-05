import { describe, it, expect } from "vitest";
import { routing } from "../i18n/routing";

describe("i18n routing", () => {
  it("supports exactly three locales", () => {
    expect(routing.locales).toEqual(["en", "pt", "es"]);
  });

  it("defaults to English", () => {
    expect(routing.defaultLocale).toBe("en");
  });

  it("includes all required locales", () => {
    expect(routing.locales).toContain("en");
    expect(routing.locales).toContain("pt");
    expect(routing.locales).toContain("es");
  });
});
