// apps/web/tests/integration/security/route-list-context.spec.ts
//
// SEC-2 Task 8: verify that the 3 highest-value list routes (conversations,
// flows, knowledge-bases) don't leak cross-tenant rows. wsA caller never
// sees wsB rows even though both exist in the same DB.
//
// Also asserts statically (source-scan) that every converted route no longer
// imports getCurrentWorkspace and does import requireAction.
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

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
import { schema } from "@orchester/db";
import { sql } from "drizzle-orm";

let wsA: WsFixture;
let wsB: WsFixture;
let convGET: (req: Request) => Promise<Response>;
let flowsGET: () => Promise<Response>;
let kbGET: () => Promise<Response>;

const API_ROOT = join(__dirname, "..", "..", "..", "app", "api");

// Seed one conversation in wsB so it exists in the DB but should be
// invisible to a wsA-scoped caller.
async function seedWsBConversation(wsBId: string) {
  const { getDb } = await import("@orchester/db");
  const { createId } = await import("@paralleldrive/cuid2");
  const db = getDb();
  const id = createId();
  await db.execute(
    sql`INSERT INTO conversation (id, workspace_id, status, started_at, created_at)
        VALUES (${id}, ${wsBId}, 'open', now(), now())`
  );
}

async function seedWsBFlow(wsBId: string) {
  const { getDb } = await import("@orchester/db");
  const { createId } = await import("@paralleldrive/cuid2");
  const db = getDb();
  await db.insert(schema.flows).values({
    id: createId(),
    workspaceId: wsBId,
    name: "wsB flow (should not be visible to wsA)",
    nodes: [],
    edges: [],
  });
}

async function seedWsBKb(wsBId: string) {
  const { getDb } = await import("@orchester/db");
  const { createId } = await import("@paralleldrive/cuid2");
  const db = getDb();
  await db.insert(schema.knowledgeBases).values({
    id: createId(),
    workspaceId: wsBId,
    name: "wsB KB (should not be visible to wsA)",
  });
}

beforeAll(async () => {
  [wsA, wsB] = await setupTestWorkspaces();

  // Seed wsB data that should NOT be visible to wsA.
  await Promise.all([seedWsBConversation(wsB.id), seedWsBFlow(wsB.id), seedWsBKb(wsB.id)]);

  // Scope all calls to wsA.
  mockGetCurrentSession.mockResolvedValue({
    user: { id: wsA.ownerId, email: wsA.ownerEmail, name: "wsA owner" },
    session: { id: "s_wsa" },
  });
  mockGetCurrentWorkspace.mockResolvedValue({
    workspace: { id: wsA.id, name: wsA.name, slug: wsA.slug },
    role: "owner",
  });

  ({ GET: convGET } = await import("@/app/api/conversations/route"));
  ({ GET: flowsGET } = await import("@/app/api/flows/route"));
  ({ GET: kbGET } = await import("@/app/api/knowledge-bases/route"));
}, 90_000);

afterAll(() => teardownTestWorkspaces());

// ── Static source checks ──────────────────────────────────────────────────

const CONVERTED_ROUTES = [
  "ai/models/route.ts",
  "tools/route.ts",
  "flow-templates/route.ts",
  "conversations/route.ts",
  "conversations/[id]/route.ts",
  "conversation-labels/route.ts",
  "billing/usage/route.ts",
  "org-graph/route.ts",
  "agents/[id]/route.ts",
  "agents/[id]/memory/route.ts",
  "channels/route.ts",
  "channels/[id]/route.ts",
  "flows/route.ts",
  "flows/[id]/route.ts",
  "flows/[id]/runs/route.ts",
  "knowledge-bases/route.ts",
  "knowledge-bases/[id]/route.ts",
  "knowledge-bases/[id]/docs/route.ts",
  "notification-prefs/route.ts",
  "employees/[id]/budget/route.ts",
  "api-keys/route.ts",
  "integrations/route.ts",
  "providers/route.ts",
  "webhooks-out/route.ts",
  "webhooks-out/events/route.ts",
  "workspace-members/route.ts",
];

describe("SEC-2: converted routes — static source checks", () => {
  it.each(CONVERTED_ROUTES)("%s does not import getCurrentWorkspace", (rel) => {
    const src = readFileSync(join(API_ROOT, rel), "utf8");
    expect(src, `${rel} should not contain getCurrentWorkspace`).not.toContain(
      "getCurrentWorkspace"
    );
  });

  it.each(CONVERTED_ROUTES)("%s imports requireAction", (rel) => {
    const src = readFileSync(join(API_ROOT, rel), "utf8");
    expect(src, `${rel} should contain requireAction`).toContain("requireAction");
  });
});

// ── Cross-tenant isolation checks ─────────────────────────────────────────

describe("SEC-2: list routes return only wsA data (no wsB leak)", () => {
  it("GET /api/conversations returns only wsA conversations (pagination envelope)", async () => {
    const req = new Request("http://localhost/api/conversations");
    const res = await convGET(req);
    expect(res.status).toBe(200);
    // conversations route returns { rows, hasMore, nextOffset } pagination envelope
    const body = (await res.json()) as { rows: Array<{ id: string }>; hasMore: boolean };
    expect(Array.isArray(body.rows)).toBe(true);
    // wsA has 0 conversations seeded; wsB has 1 — if RLS works, wsA sees 0.
    expect(body.rows.length).toBe(0);
  });

  it("GET /api/flows returns only wsA flows", async () => {
    const res = await flowsGET();
    expect(res.status).toBe(200);
    const rows = (await res.json()) as Array<{ workspaceId: string }>;
    // wsA has 0 flows initially, wsB has 1 seeded — if wsB row leaked, length > 0
    for (const r of rows) expect(r.workspaceId).toBe(wsA.id);
  });

  it("GET /api/knowledge-bases returns only wsA knowledge bases", async () => {
    const res = await kbGET();
    expect(res.status).toBe(200);
    const rows = (await res.json()) as Array<{ workspaceId: string }>;
    for (const r of rows) expect(r.workspaceId).toBe(wsA.id);
  });
});
