import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
vi.unmock("@orchester/db");
vi.doUnmock("@orchester/db");
import { eq } from "drizzle-orm";
import {
  setupTestWorkspaces,
  teardownTestWorkspaces,
  type WsFixture,
} from "../../fixtures/workspaces";
import { createId } from "@paralleldrive/cuid2";

let wsA: WsFixture;
let executeTool: typeof import("@/lib/tools").executeTool;
let getToolDefinitions: typeof import("@/lib/tools").getToolDefinitions;
let agentRuntime: typeof import("@/lib/agent-runtime");
let getDb: typeof import("@orchester/db").getDb;
let schema: typeof import("@orchester/db").schema;

beforeAll(async () => {
  [wsA] = await setupTestWorkspaces();
  ({ executeTool, getToolDefinitions } = await import("@/lib/tools"));
  agentRuntime = await import("@/lib/agent-runtime");
  ({ getDb, schema } = await import("@orchester/db"));
}, 60_000);
afterAll(() => teardownTestWorkspaces());

describe("agent_call tool", () => {
  it("is registered and surfaced by getToolDefinitions", () => {
    const defs = getToolDefinitions(["agent_call"]);
    expect(defs).toHaveLength(1);
    expect(defs[0]!.name).toBe("agent_call");
    expect(defs[0]!.inputSchema).toMatchObject({ required: ["agentId", "task"] });
  });

  it("runs the specialist via runAgent and returns its output to the caller", async () => {
    const spy = vi.spyOn(agentRuntime, "runAgent").mockResolvedValue({
      content: "SPECIALIST_ANSWER",
      tokensUsed: 7,
      model: "claude-haiku-4-5",
    } as never);
    const caller = wsA.agentIds[0]!;
    const specialist = wsA.agentIds[1]!;
    const out = (await executeTool(
      "agent_call",
      { agentId: specialist, task: "Summarize Q3" },
      { workspaceId: wsA.id, variables: {}, agentId: caller }
    )) as { output: string; agentId: string };
    expect(out.output).toBe("SPECIALIST_ANSWER");
    expect(out.agentId).toBe(specialist);
    expect(spy).toHaveBeenCalledTimes(1);
    const passed = spy.mock.calls[0]![0] as {
      agent: { id: string };
      messages: Array<{ content: string }>;
    };
    expect(passed.agent.id).toBe(specialist);
    expect(passed.messages.at(-1)!.content).toContain("Summarize Q3");
    spy.mockRestore();
  });

  it("rejects delegating to yourself", async () => {
    const caller = wsA.agentIds[0]!;
    await expect(
      executeTool(
        "agent_call",
        { agentId: caller, task: "x" },
        { workspaceId: wsA.id, variables: {}, agentId: caller }
      )
    ).rejects.toThrow(/yourself/i);
  });

  it("enforces the team allowlist: cannot call an agent in a different team", async () => {
    const db = getDb();
    const teamA = createId();
    const teamB = createId();
    await db.insert(schema.teams).values([
      { id: teamA, workspaceId: wsA.id, name: "A" },
      { id: teamB, workspaceId: wsA.id, name: "B" },
    ]);
    await db
      .update(schema.agents)
      .set({ teamId: teamA })
      .where(eq(schema.agents.id, wsA.agentIds[0]!));
    await db
      .update(schema.agents)
      .set({ teamId: teamB })
      .where(eq(schema.agents.id, wsA.agentIds[1]!));
    await expect(
      executeTool(
        "agent_call",
        { agentId: wsA.agentIds[1]!, task: "x" },
        { workspaceId: wsA.id, variables: {}, agentId: wsA.agentIds[0]! }
      )
    ).rejects.toThrow(/not in your team|not allowed/i);
  });
});
