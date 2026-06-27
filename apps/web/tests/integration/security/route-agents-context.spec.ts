// apps/web/tests/integration/security/route-agents-context.spec.ts
//
// SEC-2 Task 7: agents route GET/POST run inside requireAction — queries
// execute under SET LOCAL ROLE app_user + app.workspace_id GUC so RLS
// enforces workspace isolation without an explicit WHERE clause.
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";

vi.unmock("@orchester/db");
vi.doUnmock("@orchester/db");

const mockGetCurrentSession = vi.fn();
const mockGetCurrentWorkspace = vi.fn();

vi.mock("@/lib/workspace", () => ({
  getCurrentSession: () => mockGetCurrentSession(),
  getCurrentWorkspace: () => mockGetCurrentWorkspace(),
  getCurrentWorkspaceBySlug: vi.fn().mockResolvedValue(null),
}));

vi.mock("next/server", () => ({
  NextResponse: {
    json: (body: unknown, init?: ResponseInit) =>
      new Response(JSON.stringify(body), {
        ...init,
        headers: { "content-type": "application/json" },
      }),
  },
}));

vi.mock("@/lib/audit", () => ({ logAudit: vi.fn().mockResolvedValue(undefined) }));

import {
  setupTestWorkspaces,
  teardownTestWorkspaces,
  type WsFixture,
} from "../../fixtures/workspaces";

let wsA: WsFixture;
let GET: () => Promise<Response>;
let POST: (req: Request) => Promise<Response>;

beforeAll(async () => {
  [wsA] = await setupTestWorkspaces();

  mockGetCurrentSession.mockResolvedValue({
    user: { id: wsA.ownerId, email: wsA.ownerEmail, name: "Test" },
    session: { id: "s_test" },
  });
  mockGetCurrentWorkspace.mockResolvedValue({
    workspace: { id: wsA.id, name: wsA.name, slug: wsA.slug },
    role: "owner",
  });

  ({ GET, POST } = await import("@/app/api/agents/route"));
}, 90_000);

afterAll(() => teardownTestWorkspaces());

describe("SEC-2: agents route uses requireAction (tenant-scoped)", () => {
  it("GET returns only wsA agents (RLS isolates wsB)", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const rows = (await res.json()) as Array<{ workspaceId: string }>;
    expect(rows.length).toBe(wsA.agentCount);
    for (const r of rows) expect(r.workspaceId).toBe(wsA.id);
  });

  it("GET returns 401 when no session", async () => {
    mockGetCurrentSession.mockResolvedValueOnce(null);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("GET returns 403 when role insufficient", async () => {
    // viewer can GET agents (minRole for GET is undefined = any auth)
    // so let's use a POST with viewer to test 403
    mockGetCurrentWorkspace.mockResolvedValueOnce({
      workspace: { id: wsA.id, name: wsA.name, slug: wsA.slug },
      role: "viewer",
    });
    const req = new Request("http://localhost/api/agents", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "x", role: "r", systemPrompt: "sp" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(403);
  });

  it("POST creates agent in wsA workspace (scoped via GUC)", async () => {
    const req = new Request("http://localhost/api/agents", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Test Agent", role: "assistant", systemPrompt: "You help." }),
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
    const agent = (await res.json()) as { workspaceId: string; name: string };
    expect(agent.workspaceId).toBe(wsA.id);
    expect(agent.name).toBe("Test Agent");
  });
});
