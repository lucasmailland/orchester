import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

import {
  odooExecute,
  __resetOdooAuthCache,
  htmlFromText,
  x2manyReplace,
  TICKET_PRIORITY,
} from "@/lib/integrations/odoo-client";
import { getConnector } from "@/lib/integrations/registry";

const CONFIG: Record<string, string> = {
  baseUrl: "https://example.odoo.com",
  db: "example",
  login: "bot@example.com",
  apiKey: "test-key",
};

interface RpcCall {
  url: string;
  service: string;
  method: string;
  args: unknown[];
}

function jsonRpc(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/**
 * Odoo speaks JSON-RPC over a single endpoint, so the mock dispatches on
 * `params.service` rather than on the URL.
 */
function mockOdoo(handlers: {
  authenticate?: () => unknown;
  execute?: (
    model: string,
    method: string,
    args: unknown[],
    kwargs: Record<string, unknown>
  ) => unknown;
  rawError?: unknown;
}) {
  const calls: RpcCall[] = [];
  const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}"));
    const params = body.params ?? {};
    calls.push({
      url: String(url),
      service: params.service,
      method: params.method,
      args: params.args ?? [],
    });

    if (handlers.rawError !== undefined) {
      return jsonRpc({ jsonrpc: "2.0", id: body.id, error: handlers.rawError });
    }
    if (params.service === "common" && params.method === "authenticate") {
      const uid = handlers.authenticate ? handlers.authenticate() : 7;
      return jsonRpc({ jsonrpc: "2.0", id: body.id, result: uid });
    }
    if (params.service === "object" && params.method === "execute_kw") {
      const [, , , model, method, args, kwargs] = params.args as [
        string,
        number,
        string,
        string,
        string,
        unknown[],
        Record<string, unknown>,
      ];
      const result = handlers.execute
        ? handlers.execute(model, method, args ?? [], kwargs ?? {})
        : true;
      return jsonRpc({ jsonrpc: "2.0", id: body.id, result });
    }
    throw new Error(`unexpected RPC: ${params.service}.${params.method}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls, fetchMock };
}

beforeEach(() => {
  __resetOdooAuthCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("odoo JSON-RPC client", () => {
  it("hits /jsonrpc on the configured host", async () => {
    const { calls } = mockOdoo({});
    await odooExecute(CONFIG, "helpdesk.ticket", "search", [[]]);
    expect(calls.every((c) => c.url === "https://example.odoo.com/jsonrpc")).toBe(true);
  });

  it("authenticates once and reuses the uid across calls", async () => {
    const { calls } = mockOdoo({});
    await odooExecute(CONFIG, "helpdesk.ticket", "search", [[]]);
    await odooExecute(CONFIG, "helpdesk.ticket", "search", [[]]);
    const auths = calls.filter((c) => c.method === "authenticate");
    expect(auths).toHaveLength(1);
  });

  it("does not share a cached uid between different credentials", async () => {
    const { calls } = mockOdoo({});
    await odooExecute(CONFIG, "helpdesk.ticket", "search", [[]]);
    await odooExecute({ ...CONFIG, apiKey: "another-key" }, "helpdesk.ticket", "search", [[]]);
    const auths = calls.filter((c) => c.method === "authenticate");
    expect(auths).toHaveLength(2);
  });

  it("builds the execute_kw envelope with db, uid and key in order", async () => {
    const { calls } = mockOdoo({ authenticate: () => 42 });
    await odooExecute(CONFIG, "helpdesk.ticket", "create", [{ name: "x" }], {
      context: { lang: "es_AR" },
    });
    const call = calls.find((c) => c.method === "execute_kw")!;
    expect(call.args).toEqual([
      "example",
      42,
      "test-key",
      "helpdesk.ticket",
      "create",
      [{ name: "x" }],
      { context: { lang: "es_AR" } },
    ]);
  });

  it("throws when Odoo reports an error inside a 200 response", async () => {
    mockOdoo({
      rawError: {
        message: "Odoo Server Error",
        data: { message: "Record does not exist or has been deleted." },
      },
    });
    await expect(odooExecute(CONFIG, "helpdesk.ticket", "read", [[999]])).rejects.toThrow(
      /Record does not exist/
    );
  });

  it("throws a clear error when the credentials are rejected", async () => {
    mockOdoo({ authenticate: () => false });
    await expect(odooExecute(CONFIG, "helpdesk.ticket", "search", [[]])).rejects.toThrow(
      /authentication failed/i
    );
  });

  it("refuses a private base URL", async () => {
    mockOdoo({});
    await expect(
      odooExecute({ ...CONFIG, baseUrl: "http://10.0.0.5:8069" }, "res.partner", "search", [[]])
    ).rejects.toThrow();
  });
});

describe("odoo value helpers", () => {
  it("wraps ids in the x2many replace command", () => {
    expect(x2manyReplace([3, 9])).toEqual([[6, 0, [3, 9]]]);
  });

  it("escapes HTML and turns newlines into breaks", () => {
    expect(htmlFromText("a < b\nsecond & last")).toBe("a &lt; b<br/>second &amp; last");
  });

  it("maps priority names to the Odoo selection values", () => {
    expect(TICKET_PRIORITY.low).toBe("0");
    expect(TICKET_PRIORITY.urgent).toBe("3");
  });
});

describe("odoo connector", () => {
  it("is registered in the catalog", () => {
    expect(getConnector("odoo")).toBeDefined();
  });

  it("create_ticket sends tag_ids as an x2many command, not raw ids", async () => {
    const { calls } = mockOdoo({ execute: () => 1234 });
    const odoo = getConnector("odoo")!;
    await odoo.actions.create_ticket!.run(CONFIG, {
      name: "500 en punches-service",
      description_text: "Stack trace\ncon dos líneas",
      priority: "urgent",
      tag_ids: [5, 6],
    });
    const call = calls.find((c) => c.method === "execute_kw")!;
    const values = (call.args[5] as unknown[])[0] as Record<string, unknown>;
    expect(values.tag_ids).toEqual([[6, 0, [5, 6]]]);
    expect(values.priority).toBe("3");
    expect(values.description).toBe("Stack trace<br/>con dos líneas");
  });

  it("create_ticket returns the new ticket id", async () => {
    mockOdoo({ execute: () => 1234 });
    const odoo = getConnector("odoo")!;
    const out = (await odoo.actions.create_ticket!.run(CONFIG, { name: "x" })) as {
      ticket_id: number;
    };
    expect(out.ticket_id).toBe(1234);
  });

  it("post_note posts an internal note, never a customer-visible message", async () => {
    const { calls } = mockOdoo({ execute: () => 99 });
    const odoo = getConnector("odoo")!;
    await odoo.actions.post_note!.run(CONFIG, {
      model: "helpdesk.ticket",
      id: 1234,
      body_text: "informe del agente",
    });
    const call = calls.find((c) => c.method === "execute_kw")!;
    expect(call.args[4]).toBe("message_post");
    const kwargs = call.args[6] as Record<string, unknown>;
    expect(kwargs.subtype_xmlid).toBe("mail.mt_note");
  });

  it("get_task returns the parent and the subtasks, where a task's context often lives", async () => {
    // A support ticket filed per customer is usually a subtask of one parent that
    // groups them, and the parent's own description is often empty. Without
    // these two fields an agent reads an empty task and never finds the report.
    const { calls } = mockOdoo({ execute: () => [{ id: 7 }] });
    const odoo = getConnector("odoo")!;
    await odoo.actions.get_task!.run(CONFIG, { id: 7 });
    const call = calls.find((c) => c.method === "execute_kw")!;
    const kwargs = call.args[6] as { fields: string[] };
    expect(kwargs.fields).toEqual(expect.arrayContaining(["parent_id", "child_ids"]));
  });

  it("search_tasks narrows to the subtasks of one parent", async () => {
    const { calls } = mockOdoo({ execute: () => [] });
    const odoo = getConnector("odoo")!;
    await odoo.actions.search_tasks!.run(CONFIG, { parent_id: 4242 });
    const call = calls.find((c) => c.method === "execute_kw")!;
    const domain = (call.args[5] as unknown[])[0] as unknown[];
    expect(domain).toContainEqual(["parent_id", "=", 4242]);
  });

  describe("search_tasks follow-up filters", () => {
    async function search(input: Record<string, unknown>) {
      const { calls } = mockOdoo({ execute: () => [] });
      await getConnector("odoo")!.actions.search_tasks!.run(CONFIG, input);
      const call = calls.find((c) => c.method === "execute_kw")!;
      return {
        domain: (call.args[5] as unknown[])[0] as unknown[],
        kwargs: call.args[6] as { fields: string[] },
      };
    }

    it("filters by stage ids, never by name", async () => {
      const { domain } = await search({ stage_ids: [3, "5"] });
      expect(domain).toContainEqual(["stage_id", "in", [3, 5]]);
    });

    it("closed_since compares date_last_stage_update in UTC", async () => {
      const { domain } = await search({ closed_since: "2026-10-01T12:30:45.000Z" });
      expect(domain).toContainEqual(["date_last_stage_update", ">=", "2026-10-01 12:30:45"]);
    });

    it("rejects a closed_since that is not a date", async () => {
      mockOdoo({ execute: () => [] });
      await expect(
        getConnector("odoo")!.actions.search_tasks!.run(CONFIG, { closed_since: "yesterday" })
      ).rejects.toThrow(/closed_since/);
    });

    it("name_prefix matches the start of the title, escaping LIKE wildcards", async () => {
      const { domain } = await search({ name_prefix: "1.2_8%" });
      expect(domain).toContainEqual(["name", "=ilike", "1.2\\_8\\%%"]);
    });

    it("returns the active flag and the stage-change date", async () => {
      const { kwargs } = await search({});
      expect(kwargs.fields).toEqual(expect.arrayContaining(["active", "date_last_stage_update"]));
    });
  });

  describe("get_task_notes filters", () => {
    async function notes(input: Record<string, unknown>) {
      const { calls } = mockOdoo({ execute: () => [] });
      await getConnector("odoo")!.actions.get_task_notes!.run(CONFIG, { id: 7, ...input });
      const call = calls.find((c) => c.method === "execute_kw")!;
      return (call.args[5] as unknown[])[0] as unknown[];
    }

    it("keeps every message type by default, so existing flows are unchanged", async () => {
      const domain = await notes({});
      expect(domain).toEqual([
        ["model", "=", "project.task"],
        ["res_id", "=", 7],
      ]);
    });

    it("exclude_tracking keeps only comments and emails", async () => {
      const domain = await notes({ exclude_tracking: true });
      expect(domain).toContainEqual(["message_type", "in", ["comment", "email"]]);
    });

    it("filters by subtype id or name", async () => {
      expect(await notes({ subtype: 2 })).toContainEqual(["subtype_id", "=", 2]);
      expect(await notes({ subtype: "Note" })).toContainEqual(["subtype_id.name", "=", "Note"]);
    });
  });

  describe("post_note marker", () => {
    function run(input: Record<string, unknown>, existing: unknown[]) {
      const posts: Record<string, unknown>[] = [];
      const mock = mockOdoo({
        execute: (model, method, _args, kwargs) => {
          if (method === "search_read") return existing;
          if (method === "message_post") {
            posts.push(kwargs);
            return 99;
          }
          return true;
        },
      });
      const out = getConnector("odoo")!.actions.post_note!.run(CONFIG, input);
      return { out, posts, ...mock };
    }

    it("searches the record's messages for the marker before posting", async () => {
      const r = run({ model: "project.task", id: 7, body_text: "hi", marker: "triage-1" }, []);
      await r.out;
      const search = r.calls.find((c) => c.method === "execute_kw" && c.args[4] === "search_read")!;
      const domain = (search.args[5] as unknown[])[0] as unknown[];
      expect(domain).toEqual(
        expect.arrayContaining([
          ["model", "=", "project.task"],
          ["res_id", "=", 7],
          ["message_type", "=", "comment"],
          ["subtype_id.internal", "=", true],
          ["body", "=ilike", "%[[orchester:triage-1]]%"],
        ])
      );
    });

    it("posts with the marker as the first line when it is absent", async () => {
      const r = run({ model: "project.task", id: 7, body_text: "hi", marker: "triage-1" }, []);
      expect(await r.out).toMatchObject({ ok: true, message_id: 99 });
      expect(String(r.posts[0]!.body).startsWith("<p>[[orchester:triage-1]]</p>")).toBe(true);
      expect(r.posts[0]!.subtype_xmlid).toBe("mail.mt_note");
    });

    it("does nothing when the marker is already there", async () => {
      const r = run({ model: "project.task", id: 7, body_text: "hi", marker: "triage-1" }, [
        {
          id: 5,
          body: "<p>[[orchester:triage-1]]</p><p>hi</p>",
          message_type: "comment",
          subtype_id: [2, "Note"],
        },
      ]);
      expect(await r.out).toEqual({ posted: false, reason: "duplicate" });
      expect(r.posts).toHaveLength(0);
    });

    it("rejects a marker with characters that could break the format", async () => {
      const r = run({ id: 7, body_text: "hi", marker: "a]] <b>" }, []);
      await expect(r.out).rejects.toThrow(/marker/);
      expect(r.posts).toHaveLength(0);
    });

    it("without a marker it posts exactly as before, with no search", async () => {
      const r = run({ id: 7, body_text: "hi" }, []);
      await r.out;
      expect(r.calls.some((c) => c.args[4] === "search_read")).toBe(false);
      expect(r.posts).toHaveLength(1);
    });
  });

  describe("set_task_tags", () => {
    function setup() {
      const writes: { model: string; args: unknown[] }[] = [];
      const mock = mockOdoo({
        execute: (model, method, args) => {
          if (model === "project.tags" && method === "read") {
            const names: Record<number, string> = {
              1: "ag:fix-pending",
              2: "ag:done",
              3: "urgent",
            };
            return (args[0] as number[]).map((id) => ({ id, name: names[id] }));
          }
          if (method === "write") writes.push({ model, args });
          return true;
        },
      });
      return { ...mock, writes };
    }
    const tags = (input: Record<string, unknown>) =>
      getConnector("odoo")!.actions.set_task_tags!.run(CONFIG, input);

    it("adds and removes ag: tags, writing only tag_ids with x2many commands", async () => {
      const { writes } = setup();
      const out = await tags({ task_id: 4242, add: [1], remove: [2] });
      expect(out).toMatchObject({ ok: true, task_id: 4242 });
      expect(writes).toEqual([
        {
          model: "project.task",
          args: [
            [4242],
            {
              tag_ids: [
                [4, 1, 0],
                [3, 2, 0],
              ],
            },
          ],
        },
      ]);
    });

    it("refuses a tag that does not start with ag:, without writing", async () => {
      const { writes } = setup();
      await expect(tags({ task_id: 4242, add: [1, 3] })).rejects.toThrow(/ag:/);
      await expect(tags({ task_id: 4242, remove: [3] })).rejects.toThrow(/ag:/);
      expect(writes).toHaveLength(0);
    });

    it("refuses an unknown tag id and an empty request", async () => {
      const { writes } = setup();
      await expect(tags({ task_id: 4242, add: [99] })).rejects.toThrow();
      await expect(tags({ task_id: 4242 })).rejects.toThrow(/add or remove/);
      expect(writes).toHaveLength(0);
    });

    it("declares effect write so dry run simulates it", () => {
      expect(getConnector("odoo")!.actions.set_task_tags!.effect).toBe("write");
    });
  });

  describe("move_task", () => {
    // Fixture: task 4242 lives in project 7, currently in stage 100.
    // Stage 101 belongs to project 7, stage 900 to project 8.
    function board(taskStage = 100) {
      const writes: { model: string; args: unknown[] }[] = [];
      const mock = mockOdoo({
        execute: (model, method, args) => {
          if (model === "project.task" && method === "read") {
            return [{ id: 4242, project_id: [7, "P"], stage_id: [taskStage, "S"] }];
          }
          if (model === "project.task.type" && method === "read") {
            const id = (args[0] as number[])[0];
            return [{ id, project_ids: id === 900 ? [8] : [7, 9] }];
          }
          if (method === "write") writes.push({ model, args });
          return true;
        },
      });
      return { ...mock, writes };
    }
    const move = (input: Record<string, unknown>) =>
      getConnector("odoo")!.actions.move_task!.run(CONFIG, input);

    it("moves a task that is still in the expected stage, writing only stage_id", async () => {
      const { writes } = board(100);
      const out = await move({ task_id: 4242, from_stage_id: 100, to_stage_id: 101 });
      expect(out).toEqual({ moved: true, task_id: 4242, from_stage_id: 100, to_stage_id: 101 });
      expect(writes).toEqual([{ model: "project.task", args: [[4242], { stage_id: 101 }] }]);
    });

    it("does not move or write when a person already moved the task", async () => {
      const { writes } = board(105);
      const out = await move({ task_id: 4242, from_stage_id: 100, to_stage_id: 101 });
      expect(out).toEqual({ moved: false, reason: "not_in_expected_stage", current_stage_id: 105 });
      expect(writes).toHaveLength(0);
    });

    it("refuses a destination stage from another project, without writing", async () => {
      const { writes } = board(100);
      await expect(move({ task_id: 4242, from_stage_id: 100, to_stage_id: 900 })).rejects.toThrow(
        /project/i
      );
      expect(writes).toHaveLength(0);
    });

    it("requires from_stage_id", async () => {
      const { writes } = board(100);
      await expect(move({ task_id: 4242, to_stage_id: 101 })).rejects.toThrow(/from_stage_id/);
      expect(writes).toHaveLength(0);
    });

    it("declares effect write so dry run simulates it", () => {
      expect(getConnector("odoo")!.actions.move_task!.effect).toBe("write");
    });

    it("does not widen the execute allowlist", async () => {
      mockOdoo({ execute: () => true });
      const odoo = getConnector("odoo")!;
      await expect(
        odoo.actions.execute!.run(CONFIG, { model: "project.task.type", method: "write", args: [] })
      ).rejects.toThrow(/not allowed/i);
    });
  });

  describe("execute allowlist", () => {
    // `execute` runs with the integration user's credentials, which are admin
    // in practice. Without a guard an agent holding it can write to any model
    // or delete records, so the pair is checked before any RPC leaves.
    it("lets an allowed model/method pair through", async () => {
      const { calls } = mockOdoo({ execute: () => [{ id: 42 }] });
      const odoo = getConnector("odoo")!;
      const out = await odoo.actions.execute!.run(CONFIG, {
        model: "project.task",
        method: "search_read",
        args: [[]],
      });
      expect(out).toEqual({ result: [{ id: 42 }] });
      expect(calls.some((c) => c.method === "execute_kw")).toBe(true);
    });

    it.each([
      ["res.users", "write"],
      ["project.task", "unlink"],
      ["account.move", "search_read"],
      ["mail.message", "write"],
    ])("rejects %s.%s before any RPC", async (model, method) => {
      const { calls } = mockOdoo({ execute: () => true });
      const odoo = getConnector("odoo")!;
      await expect(odoo.actions.execute!.run(CONFIG, { model, method, args: [] })).rejects.toThrow(
        /not allowed/i
      );
      expect(calls.filter((c) => c.method === "execute_kw")).toHaveLength(0);
    });
  });

  it("get_task_attachments lists metadata only, never the file contents", async () => {
    const { calls } = mockOdoo({ execute: () => [{ id: 1 }] });
    const odoo = getConnector("odoo")!;
    await odoo.actions.get_task_attachments!.run(CONFIG, { id: 4242 });
    const call = calls.find((c) => c.method === "execute_kw")!;
    expect(call.args[3]).toBe("ir.attachment");
    expect(call.args[4]).toBe("search_read");
    expect((call.args[5] as unknown[])[0]).toEqual([
      ["res_model", "=", "project.task"],
      ["res_id", "=", 4242],
    ]);
    const kwargs = call.args[6] as { fields: string[] };
    expect(kwargs.fields).toEqual(["id", "name", "mimetype", "file_size", "create_date"]);
    expect(kwargs.fields).not.toContain("datas");
  });

  it("get_partner reads only the identity fields, vat included", async () => {
    const { calls } = mockOdoo({ execute: () => [{ id: 42 }] });
    const odoo = getConnector("odoo")!;
    const out = await odoo.actions.get_partner!.run(CONFIG, { id: 42 });
    const call = calls.find((c) => c.method === "execute_kw")!;
    expect(call.args[3]).toBe("res.partner");
    expect(call.args[4]).toBe("read");
    expect(call.args[5]).toEqual([[42]]);
    expect((call.args[6] as { fields: string[] }).fields).toEqual([
      "id",
      "name",
      "vat",
      "is_company",
      "parent_id",
      "email",
      "country_id",
    ]);
    expect(out).toEqual({ partner: { id: 42 } });
  });

  it("list_stages filters by project and orders by sequence", async () => {
    const { calls } = mockOdoo({ execute: () => [] });
    const odoo = getConnector("odoo")!;
    await odoo.actions.list_stages!.run(CONFIG, { project_id: 4242 });
    const call = calls.find((c) => c.method === "execute_kw")!;
    expect(call.args[3]).toBe("project.task.type");
    expect((call.args[5] as unknown[])[0]).toEqual([["project_ids", "in", [4242]]]);
    const kwargs = call.args[6] as { fields: string[]; order: string };
    expect(kwargs.fields).toEqual(["id", "name", "sequence", "fold"]);
    expect(kwargs.order).toBe("sequence");
  });

  it("list_stages needs a project", async () => {
    mockOdoo({ execute: () => [] });
    const odoo = getConnector("odoo")!;
    await expect(odoo.actions.list_stages!.run(CONFIG, {})).rejects.toThrow(/project_id/);
  });

  it("search_tasks adds description, tag, assignee and multi-project filters", async () => {
    const { calls } = mockOdoo({ execute: () => [] });
    const odoo = getConnector("odoo")!;
    await odoo.actions.search_tasks!.run(CONFIG, {
      description_query: "timeout",
      tag_id: 5,
      user_id: 8,
      project_ids: [3, 4],
      project_id: 9,
    });
    const call = calls.find((c) => c.method === "execute_kw")!;
    const domain = (call.args[5] as unknown[])[0] as unknown[];
    expect(domain).toContainEqual(["description", "ilike", "timeout"]);
    expect(domain).toContainEqual(["tag_ids", "in", [5]]);
    expect(domain).toContainEqual(["user_ids", "in", [8]]);
    expect(domain).toContainEqual(["project_id", "in", [3, 4]]);
    expect(domain).toContainEqual(["project_id", "=", 9]);
  });

  it("test() succeeds when the credentials authenticate", async () => {
    mockOdoo({});
    const odoo = getConnector("odoo")!;
    const res = await odoo.test(CONFIG);
    expect(res.ok).toBe(true);
  });
});
