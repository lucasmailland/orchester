import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
vi.unmock("@orchester/db");
vi.doUnmock("@orchester/db");
import {
  setupTestWorkspaces,
  teardownTestWorkspaces,
  type WsFixture,
} from "../fixtures/workspaces";
import { createId } from "@paralleldrive/cuid2";
import { eq } from "drizzle-orm";

let wsA: WsFixture;
let getDb: typeof import("@orchester/db").getDb;
let schema: typeof import("@orchester/db").schema;

beforeAll(async () => {
  [wsA] = await setupTestWorkspaces();
  ({ getDb, schema } = await import("@orchester/db"));
}, 60_000);
afterAll(() => teardownTestWorkspaces());

describe("agent version snapshot/restore (ORCH-10)", () => {
  it("round-trips tools/variables/responseFormat (not just the 4 scalar fields)", async () => {
    const db = getDb();
    const agentId = wsA.agentIds[0]!;
    // Agent starts with a rich config.
    await db
      .update(schema.agents)
      .set({
        tools: ["calculator", "http_request"],
        variables: { brand: "Acme" },
        responseFormat: "json",
        outputSchema: { type: "object" },
        systemPrompt: "v1 prompt",
      })
      .where(eq(schema.agents.id, agentId));

    // Take a version snapshot (writes ALL the captured fields).
    const versionId = createId();
    await db.insert(schema.agentVersions).values({
      id: versionId,
      agentId,
      workspaceId: wsA.id,
      systemPrompt: "v1 prompt",
      model: "claude-sonnet-4-6",
      tools: ["calculator", "http_request"],
      variables: { brand: "Acme" },
      responseFormat: "json",
      outputSchema: { type: "object" },
    });

    // Drift the live agent away from the snapshot.
    await db
      .update(schema.agents)
      .set({
        tools: [],
        variables: {},
        responseFormat: "text",
        outputSchema: null,
        systemPrompt: "v2",
      })
      .where(eq(schema.agents.id, agentId));

    // Restore must bring back tools/variables/responseFormat, not just the scalars.
    const { restoreAgentVersion } = await import("@/lib/agents/restore");
    await restoreAgentVersion(wsA.id, agentId, versionId);

    const row = (
      await db.select().from(schema.agents).where(eq(schema.agents.id, agentId)).limit(1)
    )[0]!;
    expect(row.tools).toEqual(["calculator", "http_request"]);
    expect(row.variables).toEqual({ brand: "Acme" });
    expect(row.responseFormat).toBe("json");
    expect(row.outputSchema).toEqual({ type: "object" });
  });
});
