import { describe, it, expect } from "vitest";
import { buildSwitchTarget } from "@/components/workspace/WorkspaceMenu";

/**
 * B4.1 — switching from one workspace to another must NOT carry the
 * deeper, tenant-scoped path segments (typically IDs) across, since
 * those resolve against the *previous* tenant and 403/404 under FORCE
 * RLS.
 */
describe("buildSwitchTarget", () => {
  it("drops deep IDs and keeps only the top-level section", () => {
    expect(buildSwitchTarget("/en/old/agents/abc123", "en", "old", "new")).toBe("/en/new/agents");
  });

  it("preserves the section when there is no deeper path", () => {
    expect(buildSwitchTarget("/en/old/agents", "en", "old", "new")).toBe("/en/new/agents");
  });

  it("returns just the slug root when on the workspace root", () => {
    expect(buildSwitchTarget("/en/old", "en", "old", "new")).toBe("/en/new");
  });

  it("returns the slug root when activeSlug is null", () => {
    expect(buildSwitchTarget("/en/whatever/x/y", "en", null, "new")).toBe("/en/new");
  });

  it("guards against substring-prefix collisions ('old' vs 'old-extra')", () => {
    expect(buildSwitchTarget("/en/old-extra/agents/abc", "en", "old", "new")).toBe("/en/new");
  });

  it("returns the slug root when the current path doesn't start with the locale+slug prefix", () => {
    expect(buildSwitchTarget("/fr/somewhere/x", "en", "old", "new")).toBe("/en/new");
  });

  it("handles multi-segment sections by keeping only the first one", () => {
    expect(buildSwitchTarget("/en/old/settings/feature-flags/key123", "en", "old", "new")).toBe(
      "/en/new/settings"
    );
  });

  it("returns the slug root for an empty path", () => {
    expect(buildSwitchTarget("", "en", "old", "new")).toBe("/en/new");
  });

  it("works with non-en locales", () => {
    expect(buildSwitchTarget("/es/acme/agents/x", "es", "acme", "foo")).toBe("/es/foo/agents");
  });
});
