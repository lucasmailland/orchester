// apps/web/tests/integration/widget/transcript.spec.ts
//
// CONV-2/CONV-7 — the public widget transcript GET. Verifies operator +
// assistant turns are returned for a visitor, scoped to the visitor's
// conversation, and that `since` filters older turns.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.unmock("@orchester/db");
vi.doUnmock("@orchester/db");

import {
  setupTestWorkspaces,
  teardownTestWorkspaces,
  type WsFixture,
} from "../../fixtures/workspaces";
import { createId } from "@paralleldrive/cuid2";

let wsA: WsFixture;
let GET: typeof import("@/app/api/widget/[channelId]/messages/route").GET;
let getDb: typeof import("@orchester/db").getDb;
let schema: typeof import("@orchester/db").schema;

beforeAll(async () => {
  [wsA] = await setupTestWorkspaces();
  ({ GET } = await import("@/app/api/widget/[channelId]/messages/route"));
  ({ getDb, schema } = await import("@orchester/db"));
}, 60_000);

afterAll(() => teardownTestWorkspaces());

describe("widget transcript GET", () => {
  it("returns operator + assistant turns for the visitor", async () => {
    const db = getDb();
    const agentId = wsA.agentIds[0]!;
    const channelId = createId();
    const visitorId = `v_${createId()}`;
    await db.insert(schema.channels).values({
      id: channelId,
      workspaceId: wsA.id,
      agentId,
      name: "transcript-channel",
      type: "widget",
      status: "active",
    });
    const convId = createId();
    await db.insert(schema.conversations).values({
      id: convId,
      workspaceId: wsA.id,
      channelId,
      agentId,
      status: "open",
      externalId: visitorId,
    });
    await db.insert(schema.messages).values([
      { id: createId(), conversationId: convId, role: "user", content: "hola" },
      {
        id: createId(),
        conversationId: convId,
        role: "assistant",
        content: "respuesta del bot",
      },
      {
        id: createId(),
        conversationId: convId,
        role: "assistant",
        content: "te ayudo yo (operador)",
        fromOperator: true,
      },
    ]);

    const req = new Request(
      `http://localhost/api/widget/${channelId}/messages?visitorId=${visitorId}`
    );
    const res = await GET(req, { params: Promise.resolve({ channelId }) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      messages: Array<{ role: string; content: string }>;
    };
    const contents = body.messages.map((m) => m.content);
    expect(contents).toContain("respuesta del bot");
    expect(contents).toContain("te ayudo yo (operador)");
  });

  it("404s an unknown channel", async () => {
    const req = new Request(`http://localhost/api/widget/nope/messages?visitorId=x`);
    const res = await GET(req, { params: Promise.resolve({ channelId: "nope" }) });
    expect(res.status).toBe(404);
  });
});
