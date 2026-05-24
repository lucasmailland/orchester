import { describe, it, expect } from "vitest";
import { slugify } from "@/components/workspace/CreateWorkspaceModal";

/**
 * B4.3 — slugify must NFD-normalize so accented characters fold to
 * their ASCII base instead of being stripped (producing trailing
 * hyphens or empty slugs).
 */
describe("slugify", () => {
  it("normalizes accented Latin chars to their ASCII base", () => {
    expect(slugify("Café")).toBe("cafe");
    expect(slugify("Niño")).toBe("nino");
    expect(slugify("Ñandú")).toBe("nandu");
    expect(slugify("Crème Brûlée")).toBe("creme-brulee");
  });

  it("lowercases and collapses non-alphanumeric runs to a single hyphen", () => {
    expect(slugify("Acme Co.")).toBe("acme-co");
    expect(slugify("Foo   Bar  Baz")).toBe("foo-bar-baz");
    expect(slugify("a__b//c")).toBe("a-b-c");
  });

  it("strips leading and trailing hyphens", () => {
    expect(slugify("  Hello  ")).toBe("hello");
    expect(slugify("---x---")).toBe("x");
  });

  it("caps the slug at 40 characters", () => {
    const out = slugify("a".repeat(80));
    expect(out.length).toBe(40);
  });

  it("returns empty string for input with no slug-safe characters", () => {
    expect(slugify("   ")).toBe("");
    expect(slugify("!!!")).toBe("");
  });
});
