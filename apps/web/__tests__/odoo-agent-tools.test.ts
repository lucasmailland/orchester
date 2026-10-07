import { describe, it, expect, beforeEach, vi } from "vitest";

// `vi.mock` factories are hoisted above module evaluation, so the spy has to be
// created inside `vi.hoisted`. Same convention as phase-f1-tool-loop-tx.
const { runIntegrationActionMock } = vi.hoisted(() => ({
  runIntegrationActionMock: vi.fn(
    async (
      _workspaceId: string,
      _integrationId: string,
      _action: string,
      _input: Record<string, unknown>
    ) => ({ ok: true, ticket_id: 4321 })
  ),
}));

vi.mock("@/lib/integrations/store", () => ({
  runIntegrationAction: runIntegrationActionMock,
}));

import { getToolDefinitions, listAllTools, executeTool } from "@/lib/tools";

const CTX = { workspaceId: "ws_1", variables: {}, agentId: "agent_1" };

beforeEach(() => {
  runIntegrationActionMock.mockClear();
});

describe("odoo tools are first-class, typed tools", () => {
  it("are listed in the catalog", () => {
    const names = listAllTools().map((t) => t.name);
    expect(names).toContain("odoo_create_ticket");
    expect(names).toContain("odoo_post_note");
    expect(names).toContain("odoo_search_tickets");
  });

  it("publish a typed contract to the model, not a bare object", () => {
    const [def] = getToolDefinitions(["odoo_create_ticket"]);
    expect(def).toBeDefined();
    const props = def!.inputSchema.properties as Record<string, { enum?: string[] }>;
    // The whole point: the model sees the actual fields. `run_integration`
    // exposes `input: {type: "object"}` with no properties — this must not.
    expect(Object.keys(props)).toEqual(
      expect.arrayContaining(["name", "description_text", "priority"])
    );
    expect(def!.inputSchema.required).toContain("name");
  });

  it("constrain priority to the Odoo selection so the model cannot invent one", () => {
    const [def] = getToolDefinitions(["odoo_create_ticket"]);
    const props = def!.inputSchema.properties as Record<string, { enum?: string[] }>;
    expect(props.priority?.enum).toEqual(["low", "medium", "high", "urgent"]);
  });

  it("do not leak the raw execute_kw escape hatch to the model", () => {
    const names = listAllTools().map((t) => t.name);
    expect(names).not.toContain("odoo_execute");
  });
});

describe("odoo tool execution", () => {
  it("routes create_ticket to the odoo connector action", async () => {
    const input = { name: "500 en user-service", description_text: "traza", priority: "urgent" };
    const out = await executeTool("odoo_create_ticket", input, CTX);

    expect(runIntegrationActionMock).toHaveBeenCalledTimes(1);
    const [workspaceId, integrationId, action, passed] = runIntegrationActionMock.mock.calls[0]!;
    expect(workspaceId).toBe("ws_1");
    expect(integrationId).toBe("odoo");
    expect(action).toBe("create_ticket");
    expect(passed).toEqual(input);
    expect(out).toEqual({ ok: true, ticket_id: 4321 });
  });

  it("routes post_note to the odoo connector action", async () => {
    await executeTool("odoo_post_note", { id: 1, body_text: "informe" }, CTX);
    const [, integrationId, action] = runIntegrationActionMock.mock.calls[0]!;
    expect(integrationId).toBe("odoo");
    expect(action).toBe("post_note");
  });

  it("routes search_tickets to the odoo connector action", async () => {
    await executeTool("odoo_search_tickets", { query: "user-service" }, CTX);
    const [, integrationId, action] = runIntegrationActionMock.mock.calls[0]!;
    expect(integrationId).toBe("odoo");
    expect(action).toBe("search_tickets");
  });

  it("still rejects a genuinely unknown tool", async () => {
    await expect(executeTool("odoo_delete_everything", {}, CTX)).rejects.toThrow(/Unknown tool/);
  });
});

describe("project tasks are reachable without the escape hatch", () => {
  // A project task is not a helpdesk ticket: different model, different
  // columns. Until these existed, an agent working on tasks had only
  // `run_integration` + Odoo's `execute`, which calls any method on any model.
  // Reading one project meant holding a write primitive for the database.
  it("exposes read tools for tasks and their notes", () => {
    const names = listAllTools().map((t) => t.name);
    expect(names).toContain("odoo_get_task");
    expect(names).toContain("odoo_search_tasks");
    expect(names).toContain("odoo_get_task_notes");
  });

  it("routes each to its connector action", async () => {
    const cases: [string, string, Record<string, unknown>][] = [
      ["odoo_get_task", "get_task", { id: 7 }],
      ["odoo_search_tasks", "search_tasks", { project_id: 9 }],
      ["odoo_get_task_notes", "get_task_notes", { id: 7 }],
    ];
    for (const [tool, action, input] of cases) {
      runIntegrationActionMock.mockClear();
      await executeTool(tool, input, CTX);
      const [, integrationId, calledAction, passed] = runIntegrationActionMock.mock.calls[0]!;
      expect(integrationId).toBe("odoo");
      expect(calledAction).toBe(action);
      expect(passed).toEqual(input);
    }
  });

  it("keeps the task tools read-only", () => {
    // Writing to a task goes through `odoo_post_note`, which only posts an
    // internal message. Nothing here should offer to change a task's fields:
    // an agent that can move a stage can close an incident nobody fixed.
    const names = listAllTools().map((t) => t.name);
    for (const forbidden of ["odoo_update_task", "odoo_create_task", "odoo_delete_task"]) {
      expect(names).not.toContain(forbidden);
    }
  });

  it("names the UTC trap in the date filter, where a wrong value matches nothing", () => {
    const [def] = getToolDefinitions(["odoo_search_tasks"]);
    const props = def!.inputSchema.properties as Record<string, { description?: string }>;
    expect(props.created_since?.description).toMatch(/UTC/);
  });
});
