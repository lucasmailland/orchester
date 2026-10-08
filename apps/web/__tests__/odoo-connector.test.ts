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
