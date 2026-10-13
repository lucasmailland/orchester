import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

import { __resetOdooAuthCache } from "@/lib/integrations/odoo-client";
import { getConnector, type ActionContext } from "@/lib/integrations/registry";
import { parseAgentWriteProjects } from "@/lib/integrations/odoo-write-scope";

const BASE: Record<string, string> = {
  baseUrl: "https://example.odoo.com",
  db: "example",
  login: "bot@example.com",
  apiKey: "test-key",
};
const LIMITED = { ...BASE, agentWriteProjects: "12, 31" };

const AGENT: ActionContext = { caller: "agent" };
const FLOW: ActionContext = { caller: "flow" };

interface Exec {
  model: string;
  method: string;
  args: unknown[];
  kwargs: Record<string, unknown>;
}

// Task 7 is in project 12 (allowed), task 9 in project 40, task 11 in none.
const PROJECT_OF: Record<number, [number, string] | false> = {
  7: [12, "Sandbox"],
  9: [40, "Support"],
  11: false,
};

function mockOdoo() {
  const calls: Exec[] = [];
  const respond = (id: unknown, result: unknown) =>
    new Response(JSON.stringify({ jsonrpc: "2.0", id, result }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}"));
      const p = body.params ?? {};
      if (p.service === "common") return respond(body.id, 7);
      const [, , , model, method, args, kwargs] = p.args as [
        string,
        number,
        string,
        string,
        string,
        unknown[],
        Record<string, unknown>,
      ];
      const e: Exec = { model, method, args: args ?? [], kwargs: kwargs ?? {} };
      calls.push(e);
      if (model === "project.task" && method === "read") {
        const ids = (args?.[0] as number[]) ?? [];
        return respond(
          body.id,
          ids
            .filter((id) => id in PROJECT_OF)
            .map((id) => ({ id, project_id: PROJECT_OF[id], stage_id: [1, "New"] }))
        );
      }
      if (model === "project.tags") return respond(body.id, [{ id: 3, name: "ag:triaged" }]);
      if (model === "project.task.type") return respond(body.id, [{ id: 2, project_ids: [12] }]);
      if (model === "mail.message") return respond(body.id, []);
      return respond(body.id, 99);
    })
  );
  return calls;
}

const action = (name: string) => getConnector("odoo")!.actions[name]!;
const wrote = (calls: Exec[]) =>
  calls.some((c) => ["message_post", "write", "create"].includes(c.method));
const projectReads = (calls: Exec[]) =>
  calls.filter((c) => c.model === "project.task" && c.method === "read");

beforeEach(() => __resetOdooAuthCache());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("parseAgentWriteProjects", () => {
  it("reads ids separated by commas or spaces", () => {
    expect([...parseAgentWriteProjects("12, 31")!]).toEqual([12, 31]);
    expect([...parseAgentWriteProjects(" 12 31 ")!]).toEqual([12, 31]);
  });

  it("means no limit when empty", () => {
    expect(parseAgentWriteProjects(undefined)).toBeNull();
    expect(parseAgentWriteProjects("  ")).toBeNull();
  });

  it("refuses anything that is not a positive project id", () => {
    expect(() => parseAgentWriteProjects("12, abc")).toThrow(/project ids/);
    expect(() => parseAgentWriteProjects("0")).toThrow(/project ids/);
    expect(() => parseAgentWriteProjects("-3")).toThrow(/project ids/);
    expect(() => parseAgentWriteProjects("12.5")).toThrow(/project ids/);
  });
});

describe("post_note on a task, as an agent", () => {
  const note = { model: "project.task", body_markdown: "**finding**" };

  it("posts on a task of an allowed project", async () => {
    const calls = mockOdoo();
    await action("post_note").run(LIMITED, { ...note, id: 7 }, AGENT);
    expect(calls.some((c) => c.method === "message_post")).toBe(true);
  });

  it("refuses a task of another project before writing anything", async () => {
    const calls = mockOdoo();
    await expect(action("post_note").run(LIMITED, { ...note, id: 9 }, AGENT)).rejects.toThrow(
      "Agents may only write to tasks of project 12, 31; task 9 is in project 40."
    );
    expect(wrote(calls)).toBe(false);
  });

  it("refuses a task with no project, and one that does not exist", async () => {
    mockOdoo();
    await expect(action("post_note").run(LIMITED, { ...note, id: 11 }, AGENT)).rejects.toThrow(
      /task 11 is in no project/
    );
    await expect(action("post_note").run(LIMITED, { ...note, id: 404 }, AGENT)).rejects.toThrow(
      "Task 404 not found."
    );
  });

  it("counts a call that does not say who it is as an agent", async () => {
    const calls = mockOdoo();
    await expect(action("post_note").run(LIMITED, { ...note, id: 9 })).rejects.toThrow(
      /Agents may only write/
    );
    expect(wrote(calls)).toBe(false);
  });

  it("does not limit a flow step", async () => {
    const calls = mockOdoo();
    await action("post_note").run(LIMITED, { ...note, id: 9 }, FLOW);
    expect(projectReads(calls)).toHaveLength(0);
    expect(calls.some((c) => c.method === "message_post")).toBe(true);
  });

  it("does not limit anyone while the setting is empty", async () => {
    const calls = mockOdoo();
    await action("post_note").run(BASE, { ...note, id: 9 }, AGENT);
    expect(projectReads(calls)).toHaveLength(0);
    expect(calls.some((c) => c.method === "message_post")).toBe(true);
  });

  it("fails closed on a malformed setting", async () => {
    const calls = mockOdoo();
    await expect(
      action("post_note").run({ ...BASE, agentWriteProjects: "12;31" }, { ...note, id: 7 }, AGENT)
    ).rejects.toThrow(/project ids/);
    expect(wrote(calls)).toBe(false);
  });

  it("leaves helpdesk ticket notes alone", async () => {
    const calls = mockOdoo();
    await action("post_note").run(
      LIMITED,
      { model: "helpdesk.ticket", id: 9, body_text: "x" },
      AGENT
    );
    expect(projectReads(calls)).toHaveLength(0);
    expect(calls.some((c) => c.method === "message_post")).toBe(true);
  });
});

describe("the other task writes, as an agent", () => {
  it("set_task_tags refuses a task of another project", async () => {
    const calls = mockOdoo();
    await expect(
      action("set_task_tags").run(LIMITED, { task_id: 9, add: [3] }, AGENT)
    ).rejects.toThrow(/task 9 is in project 40/);
    expect(wrote(calls)).toBe(false);
  });

  it("set_task_tags still works on an allowed task", async () => {
    const calls = mockOdoo();
    await action("set_task_tags").run(LIMITED, { task_id: 7, add: [3] }, AGENT);
    expect(calls.some((c) => c.method === "write")).toBe(true);
  });

  it("move_task refuses a task of another project", async () => {
    const calls = mockOdoo();
    await expect(
      action("move_task").run(LIMITED, { task_id: 9, from_stage_id: 1, to_stage_id: 2 }, AGENT)
    ).rejects.toThrow(/task 9 is in project 40/);
    expect(wrote(calls)).toBe(false);
  });

  it("execute write refuses ids outside the allowed projects", async () => {
    const calls = mockOdoo();
    await expect(
      action("execute").run(
        LIMITED,
        { model: "project.task", method: "write", args: [[7, 9], { name: "x" }] },
        AGENT
      )
    ).rejects.toThrow(/task 9 is in project 40/);
    expect(wrote(calls)).toBe(false);
  });

  it("execute write refuses moving an allowed task to another project", async () => {
    const calls = mockOdoo();
    await expect(
      action("execute").run(
        LIMITED,
        { model: "project.task", method: "write", args: [[7], { project_id: 40 }] },
        AGENT
      )
    ).rejects.toThrow(/project 40 is not one/);
    expect(wrote(calls)).toBe(false);
  });

  it("execute message_post on a task is limited like post_note", async () => {
    mockOdoo();
    await expect(
      action("execute").run(
        LIMITED,
        { model: "project.task", method: "message_post", args: [9], kwargs: { body: "x" } },
        AGENT
      )
    ).rejects.toThrow(/task 9 is in project 40/);
  });

  it("execute create needs an allowed project on every new task", async () => {
    const calls = mockOdoo();
    await expect(
      action("execute").run(
        LIMITED,
        { model: "project.task", method: "create", args: [{ name: "x" }] },
        AGENT
      )
    ).rejects.toThrow(/the new task names no project/);
    await expect(
      action("execute").run(
        LIMITED,
        {
          model: "project.task",
          method: "create",
          args: [
            [
              { name: "a", project_id: 12 },
              { name: "b", project_id: 40 },
            ],
          ],
        },
        AGENT
      )
    ).rejects.toThrow(/project 40 is not one/);
    expect(wrote(calls)).toBe(false);

    await action("execute").run(
      LIMITED,
      { model: "project.task", method: "create", args: [{ name: "a", project_id: 12 }] },
      AGENT
    );
    expect(calls.some((c) => c.method === "create")).toBe(true);
  });

  it("execute reads are not limited", async () => {
    const calls = mockOdoo();
    await action("execute").run(
      LIMITED,
      { model: "project.task", method: "search_read", args: [[["id", "=", 9]]] },
      AGENT
    );
    expect(calls.some((c) => c.method === "search_read")).toBe(true);
  });
});

describe("the connection test", () => {
  it("reports a malformed setting before calling Odoo", async () => {
    mockOdoo();
    const result = await getConnector("odoo")!.test!({ ...BASE, agentWriteProjects: "x" });
    expect(result.ok).toBe(false);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("offers the setting as an optional field", () => {
    const field = getConnector("odoo")!.fields.find((f) => f.key === "agentWriteProjects");
    expect(field?.required).toBe(false);
  });
});
