import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

import { __resetOdooAuthCache } from "@/lib/integrations/odoo-client";
import { getConnector } from "@/lib/integrations/registry";

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

const post = (input: Record<string, unknown>) =>
  getConnector("odoo")!.actions.post_note!.run(CONFIG, { id: 5, body_text: "report", ...input });

// What Odoo returns for the loose candidate query.
const note = (body: string, extra: Record<string, unknown> = {}) => ({
  id: 1,
  body,
  message_type: "comment",
  subtype_id: [2, "Note"],
  ...extra,
});

function run(candidates: unknown[], marker: string) {
  const calls = mockOdoo((e) => {
    if (e.model === "mail.message") return candidates;
    return 99;
  });
  return post({ marker }).then((result) => ({ result, calls }));
}

const posted = (calls: Exec[]) => calls.some((c) => c.method === "message_post");

describe("post_note marker idempotency", () => {
  it("suppresses when its own internal note carries the exact marker line", async () => {
    const { result, calls } = await run(
      [note("<p>[[orchester:triage_1]]</p><p>report</p>")],
      "triage_1"
    );
    expect(result).toEqual({ posted: false, reason: "duplicate" });
    expect(posted(calls)).toBe(false);
  });

  it("is not suppressed by a customer email that quotes the marker", async () => {
    const email = note("<p>[[orchester:triage_1]]</p>", { message_type: "email" });
    const { result, calls } = await run([email], "triage_1");
    expect(result).toMatchObject({ ok: true });
    expect(posted(calls)).toBe(true);
  });

  it("only asks Odoo for internal notes", async () => {
    const { calls } = await run([], "triage_1");
    const domain = JSON.stringify(calls.find((c) => c.model === "mail.message")!.args[0]);
    expect(domain).toContain('"message_type","=","comment"');
    expect(domain).toContain('"subtype_id.internal","=",true');
  });

  it("does not let triage_1 match triage-1 (wildcard characters are literal)", async () => {
    const { result } = await run([note("<p>[[orchester:triage-1]]</p>")], "triage_1");
    expect(result).toMatchObject({ ok: true });
  });

  it("escapes LIKE metacharacters in the candidate query", async () => {
    const { calls } = await run([], "a_b");
    const domain = calls.find((c) => c.model === "mail.message")!.args[0] as unknown[][];
    const leaf = domain.find((d) => d[0] === "body")!;
    expect(leaf[1]).toBe("=ilike");
    expect(leaf[2]).toBe("%[[orchester:a\\_b]]%");
  });

  it("is case sensitive", async () => {
    const { result } = await run([note("<p>[[orchester:Triage_1]]</p>")], "triage_1");
    expect(result).toMatchObject({ ok: true });
  });

  it("requires the marker on its own line, not quoted inside other text", async () => {
    const quoted = note("<p>Please ignore [[orchester:triage_1]] thanks</p>");
    const { result } = await run([quoted], "triage_1");
    expect(result).toMatchObject({ ok: true });
  });
});

describe("odoo post_note body", () => {
  // Odoo 17+ treats a message_post body that arrives over RPC as plain text and
  // escapes it unless body_is_html is set: the note then shows literal <br/>.
  it("posts the body as HTML", async () => {
    const calls = mockOdoo(() => 99);
    await post({ body_text: "line one\nline two" });
    const msg = calls.find((c) => c.method === "message_post")!;
    expect(msg.kwargs.body).toBe("line one<br/>line two");
    expect(msg.kwargs.body_is_html).toBe(true);
  });

  it("escapes plain text before it is posted as HTML", async () => {
    const calls = mockOdoo(() => 99);
    await post({ body_text: "a <script>x</script> & b" });
    const msg = calls.find((c) => c.method === "message_post")!;
    expect(msg.kwargs.body).toBe("a &lt;script&gt;x&lt;/script&gt; &amp; b");
    expect(msg.kwargs.body_is_html).toBe(true);
  });
});

describe("odoo post_note body_markdown", () => {
  it("renders body_markdown as HTML", async () => {
    const calls = mockOdoo(() => 99);
    await post({ body_text: undefined, body_markdown: "**bold**\n\n- a\n- b" });
    const msg = calls.find((c) => c.method === "message_post")!;
    expect(msg.kwargs.body).toBe("<p><b>bold</b></p><ul><li>a</li><li>b</li></ul>");
    expect(msg.kwargs.body_is_html).toBe(true);
  });

  it("escapes raw HTML inside body_markdown", async () => {
    const calls = mockOdoo(() => 99);
    await post({ body_text: undefined, body_markdown: "<img src=x onerror=1>" });
    const msg = calls.find((c) => c.method === "message_post")!;
    expect(msg.kwargs.body).toBe("<p>&lt;img src=x onerror=1&gt;</p>");
  });

  it("prefers body over body_markdown over body_text", async () => {
    const both = { body_markdown: "**md**", body_text: "plain" };
    let calls = mockOdoo(() => 99);
    await post({ ...both, body: "<p>raw</p>" });
    expect(calls.find((c) => c.method === "message_post")!.kwargs.body).toBe("<p>raw</p>");
    calls = mockOdoo(() => 99);
    await post(both);
    expect(calls.find((c) => c.method === "message_post")!.kwargs.body).toBe("<p><b>md</b></p>");
  });

  it("still prefixes the marker line", async () => {
    const calls = mockOdoo((e) => (e.model === "mail.message" ? [] : 99));
    await post({ body_text: undefined, body_markdown: "x", marker: "m1" });
    const msg = calls.find((c) => c.method === "message_post")!;
    expect(msg.kwargs.body).toBe("<p>[[orchester:m1]]</p><p>x</p>");
  });

  it("rejects a markdown body that renders to nothing", async () => {
    mockOdoo(() => 99);
    await expect(post({ body_text: undefined, body_markdown: "  " })).rejects.toThrow(
      /needs a body/
    );
  });
});
