// apps/web/tests/integration/tenant/membership.spec.ts
//
// Membership check contract — runs against a real testcontainer-backed
// postgres with seeded workspaces + owner. Replaces the long-skipped
// placeholder in tests/unit/tenant/membership.spec.ts.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.unmock("@orchester/db");
vi.doUnmock("@orchester/db");

import {
  setupTestWorkspaces,
  teardownTestWorkspaces,
  type WsFixture,
} from "../../fixtures/workspaces";

let wsA: WsFixture;
let checkMembership: typeof import("@/lib/tenant/membership").checkMembership;
let invalidateMembership: typeof import("@/lib/tenant/membership").invalidateMembership;

beforeAll(async () => {
  [wsA] = await setupTestWorkspaces();
  ({ checkMembership, invalidateMembership } = await import("@/lib/tenant/membership"));
});
afterAll(() => teardownTestWorkspaces());

describe("tenant/membership", () => {
  it("returns null when user is not a member", async () => {
    const m = await checkMembership("nonexistent_user", "nonexistent_ws");
    expect(m).toBeNull();
  });

  it("returns the row for a real (owner, workspace) pair", async () => {
    const m = await checkMembership(wsA.ownerId, wsA.id);
    expect(m).not.toBeNull();
    expect(m?.userId).toBe(wsA.ownerId);
    expect(m?.workspaceId).toBe(wsA.id);
    expect(m?.role).toBe("owner");
  });

  it("caches the result (second call returns same reference)", async () => {
    invalidateMembership(wsA.ownerId, wsA.id);
    const a = await checkMembership(wsA.ownerId, wsA.id);
    const b = await checkMembership(wsA.ownerId, wsA.id);
    expect(a).toBe(b);
  });

  it("invalidateMembership clears the cache entry", async () => {
    const a = await checkMembership(wsA.ownerId, wsA.id);
    invalidateMembership(wsA.ownerId, wsA.id);
    const b = await checkMembership(wsA.ownerId, wsA.id);
    expect(a).not.toBe(b); // re-fetched
    expect(a?.id).toBe(b?.id); // same row
  });
});
