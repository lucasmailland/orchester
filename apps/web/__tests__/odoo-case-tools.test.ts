import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

import { __resetOdooAuthCache } from "@/lib/integrations/odoo-client";
import { getConnector } from "@/lib/integrations/registry";
import { getToolDefinitions, listAllTools } from "@/lib/tools";

const CONFIG: Record<string, string> = {
  baseUrl: "https://example.odoo.com",
  db: "example",
  login: "bot@example.com",
  apiKey: "test-key",
};

interface Exec {
  model: string;
  method: string;
  args: unknown[];
  kwargs: Record<string, unknown>;
}

function mockOdoo(handler: (e: Exec) => unknown) {
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
      return respond(body.id, handler(e));
    })
  );
  return calls;
}

beforeEach(() => __resetOdooAuthCache());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const odoo = () => getConnector("odoo")!;

describe("search_tasks include_archived", () => {
  it("passes active_test:false only when asked", async () => {
    const calls = mockOdoo(() => []);
    await odoo().actions.search_tasks!.run(CONFIG, { query: "x", include_archived: true });
    expect(calls[0]!.kwargs.context).toEqual({ active_test: false });
  });

  it.each([{}, { include_archived: false }, { include_archived: "true" }])(
    "sends no context for %j",
    async (extra) => {
      const calls = mockOdoo(() => []);
      await odoo().actions.search_tasks!.run(CONFIG, { query: "x", ...extra });
      expect(calls[0]!.kwargs).not.toHaveProperty("context");
    }
  );

  it("get_task reads by id, which Odoo does not filter by active, so no context is needed", async () => {
    const calls = mockOdoo(() => [{ id: 7, active: false }]);
    await odoo().actions.get_task!.run(CONFIG, { id: 7 });
    expect(calls[0]!.method).toBe("read");
    expect(calls[0]!.kwargs).not.toHaveProperty("context");
  });

  it("the tool schema exposes the flag", () => {
    const [def] = getToolDefinitions(["odoo_search_tasks"]);
    const props = def!.inputSchema.properties as Record<string, { type?: string }>;
    expect(props.include_archived?.type).toBe("boolean");
  });
});

describe("get_case", () => {
  const task = {
    id: 100,
    name: "T",
    parent_id: [50, "P"],
    child_ids: [101, 102],
    description: "<p>Hello&nbsp;<b>world</b></p>",
  };

  function caseHandler(opts: { children?: number; noParent?: boolean; notes?: unknown[] } = {}) {
    const childIds = Array.from({ length: opts.children ?? 2 }, (_, i) => 101 + i);
    return (e: Exec) => {
      if (e.model === "project.task" && e.method === "read")
        return [
          {
            ...task,
            child_ids: childIds,
            parent_id: opts.noParent ? false : [50, "P"],
          },
        ];
      if (e.model === "project.task" && e.method === "search_read") {
        const domain = e.args[0] as unknown[];
        const text = JSON.stringify(domain);
        if (text.includes('"parent_id","=",50'))
          return [{ id: 100 }, { id: 103, name: "sib" }].filter((r) => r.id !== 100);
        const ids = (
          domain.find((d) => Array.isArray(d) && d[0] === "id" && d[1] === "in") as [
            string,
            string,
            number[],
          ]
        )?.[2];
        const rows = (ids ?? []).map((id) => ({ id, name: `n${id}`, description: "<p>d</p>" }));
        if (!opts.noParent) rows.push({ id: 50, name: "P", description: "" });
        return rows;
      }
      if (e.model === "mail.message")
        return (
          opts.notes ?? [
            { id: 1, res_id: 100, body: "<p>first <script>x</script>note</p>", date: "2026-01-01" },
            { id: 2, res_id: 100, body: "<p>second</p>", date: "2026-01-02" },
            { id: 3, res_id: 100, body: "<p>third</p>", date: "2026-01-03" },
            { id: 4, res_id: 101, body: "<p>child</p>", date: "2026-01-04" },
          ]
        );
      if (e.model === "ir.attachment")
        return [
          { id: 9, res_id: 100, mimetype: "image/png", file_size: 10 },
          { id: 10, res_id: 100, mimetype: "text/csv", file_size: 10 },
          { id: 11, res_id: 101, mimetype: "image/png", file_size: 10 },
        ];
      return [];
    };
  }

  it("declares itself read-only and is a typed tool", () => {
    expect(odoo().actions.get_case!.effect).toBe("read");
    expect(listAllTools().map((t) => t.name)).toContain("odoo_get_case");
    const [def] = getToolDefinitions(["odoo_get_case"]);
    expect(def!.inputSchema.required).toContain("id");
    expect(def!.description).toMatch(/odoo_get_task\b/);
  });

  it("assembles the whole case with batched reads", async () => {
    const calls = mockOdoo(caseHandler());
    const out = (await odoo().actions.get_case!.run(CONFIG, { id: 100 })) as any;

    // task, parent+children, siblings, notes, attachments: one call each, not one per record.
    expect(calls.map((c) => `${c.model}.${c.method}`)).toEqual([
      "project.task.read",
      "project.task.search_read",
      "project.task.search_read",
      "mail.message.search_read",
      "ir.attachment.search_read",
    ]);
    expect(out.task.id).toBe(100);
    expect(out.parent.id).toBe(50);
    expect(out.children.map((c: any) => c.id)).toEqual([101, 102]);
    expect(out.siblings.map((c: any) => c.id)).toEqual([103]);
    expect(out.task.description).toBe("Hello world");
    expect(out.attachments).toEqual({
      "100": { count: 2, images: 1 },
      "101": { count: 1, images: 1 },
    });
  });

  it("batches notes and attachments over all case ids in one call each", async () => {
    const calls = mockOdoo(caseHandler());
    await odoo().actions.get_case!.run(CONFIG, { id: 100 });
    const msg = calls.find((c) => c.model === "mail.message")!;
    expect(JSON.stringify(msg.args[0])).toContain('["res_id","in",[100,101,102]]');
    expect(msg.kwargs.order).toBe("date desc");
    const att = calls.find((c) => c.model === "ir.attachment")!;
    expect(JSON.stringify(att.args[0])).toContain('["res_id","in",[100,101,102]]');
  });

  it("never reads attachment contents", async () => {
    const calls = mockOdoo(caseHandler());
    await odoo().actions.get_case!.run(CONFIG, { id: 100 });
    for (const c of calls) {
      expect((c.kwargs.fields as string[] | undefined) ?? []).not.toContain("datas");
    }
  });

  it("reads archived children and siblings (Done cards are archived)", async () => {
    const calls = mockOdoo(caseHandler());
    await odoo().actions.get_case!.run(CONFIG, { id: 100 });
    const searches = calls.filter((c) => c.model === "project.task" && c.method === "search_read");
    for (const s of searches) expect(s.kwargs.context).toEqual({ active_test: false });
  });

  it("caps children and requests at most 20 child ids", async () => {
    const calls = mockOdoo(caseHandler({ children: 35 }));
    const out = (await odoo().actions.get_case!.run(CONFIG, { id: 100 })) as any;
    expect(out.children.length).toBeLessThanOrEqual(20);
    expect(out.childrenTotal).toBe(35);
    const batch = calls[1]!;
    const ids = JSON.stringify(batch.args[0]);
    expect(ids).not.toContain("121"); // 101 + 20 is the first one cut
  });

  it("caps notes per task, strips HTML and truncates long bodies", async () => {
    const long = "<p>" + "a".repeat(5000) + "</p>";
    mockOdoo(
      caseHandler({
        notes: [
          { id: 1, res_id: 100, body: "<p>one</p>", date: "d" },
          { id: 2, res_id: 100, body: "<p>two</p>", date: "d" },
          { id: 3, res_id: 100, body: long, date: "d" },
        ],
      })
    );
    const out = (await odoo().actions.get_case!.run(CONFIG, { id: 100, notes_per_task: 2 })) as any;
    expect(out.notes["100"]).toHaveLength(2);
    expect(out.notes["100"][0].body).toBe("one");
    const out2 = (await odoo().actions.get_case!.run(CONFIG, {
      id: 100,
      notes_per_task: 3,
    })) as any;
    expect(out2.notes["100"][2].body.length).toBeLessThan(1700);
    expect(JSON.stringify(out2.notes)).not.toMatch(/<p>|<script>/);
  });

  it("skips parent and sibling reads for a top-level task", async () => {
    const calls = mockOdoo(caseHandler({ noParent: true }));
    const out = (await odoo().actions.get_case!.run(CONFIG, { id: 100 })) as any;
    expect(out.parent).toBeNull();
    expect(out.siblings).toEqual([]);
    expect(
      calls.filter((c) => c.model === "project.task" && c.method === "search_read")
    ).toHaveLength(1);
  });

  it("returns task null for a missing id without more calls", async () => {
    const calls = mockOdoo(() => []);
    const out = (await odoo().actions.get_case!.run(CONFIG, { id: 5 })) as any;
    expect(out.task).toBeNull();
    expect(calls).toHaveLength(1);
  });
});
