import { describe, it, expect } from "vitest";
import { checkMembership } from "@/lib/tenant/membership";

/**
 * Skipped until Task A.16 fixtures are in place. The negative case
 * (non-member returns null) is the only one that can run without seed
 * data; everything else needs known user+workspace ids.
 */
describe("tenant/membership", () => {
  it.skip("returns null when user is not a member", async () => {
    const m = await checkMembership("nonexistent_user", "nonexistent_ws");
    expect(m).toBeNull();
  });
});
