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
      ["odoo_get_case", "get_case", { id: 7 }],
    ];
    // The notes tool hides tracking noise unless the model asks otherwise.
    const defaults: Record<string, Record<string, unknown>> = {
      odoo_get_task_notes: { exclude_tracking: true },
    };
    for (const [tool, action, input] of cases) {
      runIntegrationActionMock.mockClear();
      await executeTool(tool, input, CTX);
      const [, integrationId, calledAction, passed] = runIntegrationActionMock.mock.calls[0]!;
      expect(integrationId).toBe("odoo");
      expect(calledAction).toBe(action);
      expect(passed).toEqual({ ...defaults[tool], ...input });
    }
  });

  it("lets the model override the notes default and sees the new filters", async () => {
    runIntegrationActionMock.mockClear();
    await executeTool("odoo_get_task_notes", { id: 7, exclude_tracking: false }, CTX);
    expect(runIntegrationActionMock.mock.calls[0]![3]).toEqual({ id: 7, exclude_tracking: false });
    const [notes] = getToolDefinitions(["odoo_get_task_notes"]);
    expect(Object.keys(notes!.inputSchema.properties as object)).toEqual(
      expect.arrayContaining(["exclude_tracking", "subtype"])
    );
    const [search] = getToolDefinitions(["odoo_search_tasks"]);
    expect(Object.keys(search!.inputSchema.properties as object)).toEqual(
      expect.arrayContaining(["stage_ids", "closed_since", "name_prefix"])
    );
    const [post] = getToolDefinitions(["odoo_post_note"]);
    expect(Object.keys(post!.inputSchema.properties as object)).toContain("marker");
  });

  it("keeps the task tools read-only", () => {
    // Writing to a task goes through `odoo_post_note`, which only posts an
    // internal message. Nothing here should offer to change a task's fields:
    // an agent that can move a stage can close an incident nobody fixed.
    const names = listAllTools().map((t) => t.name);
    for (const forbidden of ["odoo_update_task", "odoo_create_task", "odoo_delete_task"]) {
      expect(names).not.toContain(forbidden);
    }
    // The context tools added later must not widen that: nothing named like a
    // mutation of a task may appear, whatever the verb.
    const mutation = /^odoo_(update|create|delete|move|write|unlink|set)_(task|stage|partner)/;
    expect(names.filter((n) => mutation.test(n))).toEqual([]);
  });

  it("exposes the context tools and routes each to its action", async () => {
    const cases: [string, string, Record<string, unknown>][] = [
      ["odoo_get_ticket", "get_ticket", { id: 42 }],
      ["odoo_get_task_attachments", "get_task_attachments", { id: 42 }],
      ["odoo_get_partner", "get_partner", { id: 42 }],
      ["odoo_list_stages", "list_stages", { project_id: 42 }],
    ];
    const names = listAllTools().map((t) => t.name);
    for (const [tool, action, input] of cases) {
      expect(names).toContain(tool);
      runIntegrationActionMock.mockClear();
      await executeTool(tool, input, CTX);
      const [, integrationId, calledAction, passed] = runIntegrationActionMock.mock.calls[0]!;
      expect(integrationId).toBe("odoo");
      expect(calledAction).toBe(action);
      expect(passed).toEqual(input);
    }
  });

  it("tells the model that a partner's vat is the link to the HR platform company", () => {
    const [def] = getToolDefinitions(["odoo_get_partner"]);
    expect(def!.description).toMatch(/vat/);
    expect(def!.description).toMatch(/fiscal code/i);
  });

  it("tells the model to list stages instead of hardcoding ids", () => {
    const [def] = getToolDefinitions(["odoo_list_stages"]);
    expect(def!.description).toMatch(/hardcod/i);
  });

  it("offers the new search_tasks filters to the model", () => {
    const [def] = getToolDefinitions(["odoo_search_tasks"]);
    const props = def!.inputSchema.properties as Record<string, unknown>;
    expect(Object.keys(props)).toEqual(
      expect.arrayContaining(["description_query", "tag_id", "user_id", "project_ids"])
    );
  });

  it("lets the model list a task's subtasks and siblings", () => {
    const [def] = getToolDefinitions(["odoo_search_tasks"]);
    const props = def!.inputSchema.properties as Record<string, unknown>;
    expect(Object.keys(props)).toContain("parent_id");
  });

  it("names the UTC trap in the date filter, where a wrong value matches nothing", () => {
    const [def] = getToolDefinitions(["odoo_search_tasks"]);
    const props = def!.inputSchema.properties as Record<string, { description?: string }>;
    expect(props.created_since?.description).toMatch(/UTC/);
  });
});
