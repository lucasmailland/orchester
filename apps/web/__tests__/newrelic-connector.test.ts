import { describe, it, expect, afterEach, vi } from "vitest";

import { nerdgraph, nrqlEscape, buildErrorsQuery } from "@/lib/integrations/newrelic-client";
import { getConnector } from "@/lib/integrations/registry";

const CONFIG: Record<string, string> = {
  accountId: "1234567",
  apiKey: "NRAK-testkey",
};

interface Captured {
  url: string;
  headers: Record<string, string>;
  body: { query: string; variables: Record<string, unknown> };
}

function mockNerdgraph(payload: unknown, status = 200) {
  const calls: Captured[] = [];
  const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
    calls.push({
      url: String(url),
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: JSON.parse(String(init?.body ?? "{}")),
    });
    return new Response(JSON.stringify(payload), {
      status,
      headers: { "content-type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls };
}

/** NerdGraph wraps NRQL results this deep. */
function nrqlPayload(results: unknown[]) {
  return { data: { actor: { account: { nrql: { results } } } } };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("nerdgraph transport", () => {
  it("posts to the NerdGraph endpoint with the Api-Key header", async () => {
    const { calls } = mockNerdgraph({ data: { actor: {} } });
    await nerdgraph(CONFIG, "{ actor { user { id } } }");
    expect(calls[0]!.url).toBe("https://api.newrelic.com/graphql");
    expect(calls[0]!.headers["Api-Key"]).toBe("NRAK-testkey");
  });

  it("throws when NerdGraph reports errors inside a 200 response", async () => {
    mockNerdgraph({ errors: [{ message: "Not Authorized" }] });
    await expect(nerdgraph(CONFIG, "{ actor { user { id } } }")).rejects.toThrow(/Not Authorized/);
  });

  it("supports the EU endpoint when configured", async () => {
    const { calls } = mockNerdgraph({ data: {} });
    await nerdgraph(
      { ...CONFIG, endpoint: "https://api.eu.newrelic.com/graphql" },
      "{ actor { user { id } } }"
    );
    expect(calls[0]!.url).toBe("https://api.eu.newrelic.com/graphql");
  });
});

describe("NRQL is built, not concatenated blindly", () => {
  it("escapes single quotes so an app name cannot break out of the string", () => {
    expect(nrqlEscape("user-service' OR 1=1 --")).toBe("user-service\\' OR 1=1 --");
  });

  it("embeds the escaped app name in the errors query", () => {
    const q = buildErrorsQuery("it's-a-service", 30, 10);
    expect(q).toContain("appName = 'it\\'s-a-service'");
    expect(q).toContain("SINCE 30 minutes ago");
    expect(q).toContain("LIMIT 10");
  });

  it("clamps the window and the limit to sane bounds", () => {
    const q = buildErrorsQuery("svc", 99999, 9999);
    expect(q).toContain("SINCE 1440 minutes ago");
    expect(q).toContain("LIMIT 100");
  });
});

describe("newrelic connector", () => {
  it("is registered in the catalog", () => {
    expect(getConnector("newrelic")).toBeDefined();
  });

  it("get_errors returns the NRQL rows", async () => {
    mockNerdgraph(nrqlPayload([{ count: 12, "error.class": "TypeError" }]));
    const nr = getConnector("newrelic")!;
    const out = (await nr.actions.get_errors!.run(CONFIG, { app_name: "user-service" })) as {
      errors: unknown[];
    };
    expect(out.errors).toHaveLength(1);
  });

  it("get_logs_for_trace queries trace_id, not New Relic's own trace.id", async () => {
    const { calls } = mockNerdgraph(nrqlPayload([]));
    const nr = getConnector("newrelic")!;
    await nr.actions.get_logs_for_trace!.run(CONFIG, { trace_id: "abc123" });
    const q = String(calls[0]!.body.variables.q);
    // Arsenal's tool queries `FROM Span WHERE trace.id`, which is New Relic's
    // own id — not the `trace_id` that @fichap-team/utils writes on logs. That
    // mismatch is the whole reason this action exists.
    expect(q).toContain("FROM Log");
    expect(q).toContain("trace_id = 'abc123'");
    expect(q).not.toContain("trace.id");
  });

  it("nrql passes an arbitrary query through", async () => {
    const { calls } = mockNerdgraph(nrqlPayload([{ count: 1 }]));
    const nr = getConnector("newrelic")!;
    await nr.actions.nrql!.run(CONFIG, { query: "SELECT count(*) FROM Transaction" });
    expect(calls[0]!.body.variables.q).toBe("SELECT count(*) FROM Transaction");
  });

  it("test() names the license-key mistake when the key is rejected", async () => {
    mockNerdgraph({ errors: [{ message: "Invalid API key" }] });
    const nr = getConnector("newrelic")!;
    const res = await nr.test({ accountId: "1234567", apiKey: "abc123456789NRAL" });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/User key/i);
  });
});
