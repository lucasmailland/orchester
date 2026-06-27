// apps/web/tests/integration/security/require-action.spec.ts
//
// SEC-2: requireAction wires requireAuth role gate + withTenantContext GUC
// setup. Tests run against a real testcontainer DB so the SET LOCAL ROLE /
// GUC path is exercised end-to-end.
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";

vi.unmock("@orchester/db");
vi.doUnmock("@orchester/db");

// Hoist mutable mock fns so the vi.mock factory can close over them.
const mockGetCurrentSession = vi.fn();
const mockGetCurrentWorkspace = vi.fn();

vi.mock("@/lib/workspace", () => ({
  getCurrentSession: () => mockGetCurrentSession(),
  getCurrentWorkspace: () => mockGetCurrentWorkspace(),
  getCurrentWorkspaceBySlug: vi.fn().mockResolvedValue(null),
  recordTenantContextSet: vi.fn(),
  recordTenantContextMissing: vi.fn(),
}));

// next/server is not available in test environment; stub the response factory.
vi.mock("next/server", () => ({
  NextResponse: {
    json: (body: unknown, init?: ResponseInit) =>
      new Response(JSON.stringify(body), {
        ...init,
        headers: { "content-type": "application/json" },
      }),
  },
}));

import {
  setupTestWorkspaces,
  teardownTestWorkspaces,
  type WsFixture,
} from "../../fixtures/workspaces";

let wsA: WsFixture;
let requireAction: typeof import("@/lib/auth-guards").requireAction;

beforeAll(async () => {
  [wsA] = await setupTestWorkspaces();

  // Point mocks at the seeded fixture so requireAuth passes AND
  // withTenantContext can verify membership against the real DB.
  mockGetCurrentSession.mockResolvedValue({
    user: { id: wsA.ownerId, email: wsA.ownerEmail, name: "Test User" },
    session: { id: "s_test" },
  });
  mockGetCurrentWorkspace.mockResolvedValue({
    workspace: { id: wsA.id, name: wsA.name, slug: wsA.slug },
    role: "viewer",
  });

  // Dynamic import AFTER DB + mocks are set up.
  ({ requireAction } = await import("@/lib/auth-guards"));
}, 90_000);

afterAll(() => teardownTestWorkspaces());

describe("SEC-2: requireAction", () => {
  it("sets app.workspace_id GUC inside the run callback", async () => {
    const { sql } = await import("drizzle-orm");

    const wid = await requireAction({
      minRole: "viewer",
      run: async ({ tx }) => {
        const r = await tx.execute(sql`SELECT current_workspace_id() AS wid`);
        return (r as unknown as Array<{ wid: string }>)[0]?.wid ?? null;
      },
    });

    expect(wid).toBe(wsA.id);
  });

  it("returns 403 Response when caller role is below minRole", async () => {
    // The mock returns role "viewer" — requiring "admin" must short-circuit.
    const result = await requireAction({
      minRole: "admin",
      run: async () => "should-not-run",
    });

    expect(result instanceof Response).toBe(true);
    expect((result as Response).status).toBe(403);
  });

  it("passes ctx.workspace and user to the run callback", async () => {
    const captured: { workspaceId: string; userId: string } = {
      workspaceId: "",
      userId: "",
    };

    await requireAction({
      minRole: "viewer",
      run: async ({ ctx, user }) => {
        captured.workspaceId = ctx.workspace.id;
        captured.userId = user.id;
      },
    });

    expect(captured.workspaceId).toBe(wsA.id);
    expect(captured.userId).toBe(wsA.ownerId);
  });

  it("returns 401 when no session exists", async () => {
    mockGetCurrentSession.mockResolvedValueOnce(null);

    const result = await requireAction({
      run: async () => "unreachable",
    });

    expect(result instanceof Response).toBe(true);
    expect((result as Response).status).toBe(401);
  });
});
