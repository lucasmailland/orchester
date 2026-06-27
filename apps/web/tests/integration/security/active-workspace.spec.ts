// apps/web/tests/integration/security/active-workspace.spec.ts
//
// SEC-10: verify getCurrentWorkspace resolves the signed orch-active-workspace
// cookie slug before falling back to the oldest-membership default.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";

vi.unmock("@orchester/db");
vi.doUnmock("@orchester/db");

const mockGetSession = vi.fn();
vi.mock("@/lib/auth", () => ({
  // wrap so the binding is resolved at call time, not at factory-hoist time
  auth: { api: { getSession: (args: unknown) => mockGetSession(args) } },
}));

const mockCookieStore = { get: vi.fn() };
vi.mock("next/headers", () => ({
  headers: vi.fn(() => new Map()),
  // lazy closure — mockCookieStore is read when cookies() is called, not at hoist
  cookies: vi.fn(() => Promise.resolve(mockCookieStore)),
}));

import { createId } from "@paralleldrive/cuid2";
import { setupIsolation, teardownIsolation, type IsolationFixture } from "../../isolation/helpers";
import { teardownTestWorkspaces } from "../../fixtures/workspaces";
import { signValue } from "@/lib/cookies";
import { getCurrentWorkspace } from "@/lib/workspace";

let f: IsolationFixture;

beforeAll(async () => {
  f = await setupIsolation();
  // wsA.ownerId gets added to wsB as a viewer so the user belongs to BOTH
  // workspaces. wsA was seeded first (lower created_at) so the no-cookie
  // fallback (ORDER BY created_at ASC) returns wsA.
  await f.sql.unsafe(
    `INSERT INTO workspace_member (id, workspace_id, user_id, role)
     VALUES ($1, $2, $3, 'viewer')`,
    [createId(), f.wsB.id, f.wsA.ownerId]
  );
}, 90_000);

afterAll(async () => {
  await teardownIsolation(f);
  await teardownTestWorkspaces();
});

beforeEach(() => {
  mockGetSession.mockReset();
  mockCookieStore.get.mockReset();
});

describe("SEC-10: getCurrentWorkspace honors orch-active-workspace cookie", () => {
  it("resolves to wsB when cookie carries the signed wsB slug", async () => {
    mockGetSession.mockResolvedValue({ user: { id: f.wsA.ownerId } });
    const signed = await signValue(f.wsB.slug);
    mockCookieStore.get.mockImplementation((name: string) =>
      name === "orch-active-workspace" ? { value: signed } : undefined
    );

    const ctx = await getCurrentWorkspace();

    expect(ctx?.workspace.id).toBe(f.wsB.id);
  });

  it("falls back to wsA (oldest membership) when no cookie is present", async () => {
    mockGetSession.mockResolvedValue({ user: { id: f.wsA.ownerId } });
    mockCookieStore.get.mockReturnValue(undefined);

    const ctx = await getCurrentWorkspace();

    expect(ctx?.workspace.id).toBe(f.wsA.id);
  });
});
