import { describe, it, expect } from "vitest";
import { generateSlug } from "../lib/slug";

describe("generateSlug", () => {
  it("lowercases and hyphenates", () => {
    expect(generateSlug("Acme Inc")).toBe("acme-inc");
  });

  it("removes special chars", () => {
    expect(generateSlug("Acme & Co.")).toBe("acme-co");
  });

  it("trims to 48 chars", () => {
    const long = "A".repeat(60);
    expect(generateSlug(long).length).toBeLessThanOrEqual(48);
  });

  it("handles empty string", () => {
    expect(generateSlug("")).toBe("");
  });
});
