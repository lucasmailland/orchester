import { describe, it, expect, afterEach, vi } from "vitest";

import { buildBrowserErrorsQuery, buildSearchLogsQuery } from "@/lib/integrations/newrelic-client";
import { getConnector } from "@/lib/integrations/registry";
import { listAllTools, toolEffect } from "@/lib/tools";

const CONFIG: Record<string, string> = { accountId: "1234567", apiKey: "NRAK-testkey" };

function mockRows(results: unknown[]) {
  const queries: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string | URL, init?: RequestInit) => {
      queries.push(JSON.parse(String(init?.body)).variables.q);
      return new Response(JSON.stringify({ data: { actor: { account: { nrql: { results } } } } }), {
        status: 200,
      });
    })
  );
  return queries;
}

afterEach(() => vi.unstubAllGlobals());

describe("buildBrowserErrorsQuery", () => {
  it("builds the fixed template with defaults", () => {
    expect(buildBrowserErrorsQuery({ appName: "dash" })).toBe(
      "SELECT count(*) AS count, latest(requestUri) AS sample_uri, latest(timestamp) AS last_seen " +
        "FROM JavaScriptError WHERE appName = 'dash' " +
        "FACET errorClass, errorMessage SINCE 24 hours ago LIMIT 20"
    );
  });

  it("adds the optional filters in a fixed order", () => {
    expect(
      buildBrowserErrorsQuery({
        appName: "dash",
        sinceHours: 6,
        messageContains: "boom",
        pageContains: "/login",
      })
    ).toBe(
      "SELECT count(*) AS count, latest(requestUri) AS sample_uri, latest(timestamp) AS last_seen " +
        "FROM JavaScriptError WHERE appName = 'dash' " +
        "AND errorMessage LIKE '%boom%' AND requestUri LIKE '%/login%' " +
        "FACET errorClass, errorMessage SINCE 6 hours ago LIMIT 20"
    );
  });

  it("neutralises quotes and backslashes", () => {
    const q = buildBrowserErrorsQuery({
      appName: "a' OR appName != '",
      messageContains: "x\\' OR 1=1 --",
    });
    expect(q).toContain("appName = 'a\\' OR appName != \\''");
    expect(q).toContain("LIKE '%x\\\\\\' OR 1=1 --%'");
  });

  it("rejects wildcards, control characters, long text and bad bounds", () => {
    expect(() => buildBrowserErrorsQuery({ appName: "d", messageContains: "a%b" })).toThrow(/%/);
    expect(() => buildBrowserErrorsQuery({ appName: "d", pageContains: "a%b" })).toThrow(/%/);
    expect(() => buildBrowserErrorsQuery({ appName: "d", messageContains: "a\nb" })).toThrow();
    expect(() =>
      buildBrowserErrorsQuery({ appName: "d", messageContains: "x".repeat(121) })
    ).toThrow();
    expect(() => buildBrowserErrorsQuery({ appName: "" })).toThrow(/appName/);
    expect(() => buildBrowserErrorsQuery({ appName: "d", sinceHours: 0 })).toThrow();
    expect(() => buildBrowserErrorsQuery({ appName: "d", sinceHours: 169 })).toThrow();
    expect(() => buildBrowserErrorsQuery({ appName: "d", sinceHours: 1.5 })).toThrow();
  });
});

describe("buildSearchLogsQuery", () => {
  it("builds the fixed template with defaults", () => {
    expect(buildSearchLogsQuery({ service: "user-service" })).toBe(
      "SELECT timestamp, level, message, trace_id FROM Log " +
        "WHERE service.name = 'user-service' " +
        "AND (request.uri IS NULL OR request.uri NOT LIKE '%health%') " +
        "SINCE 60 minutes ago ORDER BY timestamp DESC LIMIT 30"
    );
  });

  it("adds level and message filters", () => {
    expect(
      buildSearchLogsQuery({
        service: "s",
        sinceMinutes: 5,
        level: "error",
        messageContains: "timeout",
        limit: 100,
      })
    ).toBe(
      "SELECT timestamp, level, message, trace_id FROM Log " +
        "WHERE service.name = 's' " +
        "AND (request.uri IS NULL OR request.uri NOT LIKE '%health%') " +
        "AND level IN ('error', 'ERROR') AND message LIKE '%timeout%' " +
        "SINCE 5 minutes ago ORDER BY timestamp DESC LIMIT 100"
    );
  });

  it("neutralises injection and rejects bad input", () => {
    const q = buildSearchLogsQuery({ service: "s' OR 1=1 --", messageContains: "\\" });
    expect(q).toContain("service.name = 's\\' OR 1=1 --'");
    expect(q).toContain("LIKE '%\\\\%'");
    expect(() => buildSearchLogsQuery({ service: "s", messageContains: "%" })).toThrow();
    expect(() => buildSearchLogsQuery({ service: "" })).toThrow(/service/);
    expect(() => buildSearchLogsQuery({ service: "s", level: "x' OR '" as never })).toThrow(
      /level/
    );
    expect(() => buildSearchLogsQuery({ service: "s", sinceMinutes: 4 })).toThrow();
    expect(() => buildSearchLogsQuery({ service: "s", sinceMinutes: 1441 })).toThrow();
    expect(() => buildSearchLogsQuery({ service: "s", limit: 0 })).toThrow();
    expect(() => buildSearchLogsQuery({ service: "s", limit: 101 })).toThrow();
  });
});

describe("get_browser_errors action", () => {
  it("returns only the allowlisted fields, truncated and masked", async () => {
    mockRows([
      {
        errorClass: "TypeError",
        errorMessage: "bad user a.b@c.com id 123456789 " + "x".repeat(400),
        count: 7,
        last_seen: 1760000000000,
        sample_uri: "/home",
        secret: "leak",
        facet: ["TypeError", "m"],
      },
    ]);
    const out = (await getConnector("newrelic")!.actions.get_browser_errors!.run(CONFIG, {
      appName: "dash",
    })) as { errors: Record<string, unknown>[]; since_hours: number; truncated: boolean };
    expect(out.since_hours).toBe(24);
    expect(out.truncated).toBe(false);
    const row = out.errors[0]!;
    expect(Object.keys(row).sort()).toEqual(
      ["count", "error_class", "last_seen", "message", "sample_uri"].sort()
    );
    expect(String(row.message)).toContain("[email]");
    expect(String(row.message)).toContain("[num]");
    expect(String(row.message).length).toBeLessThanOrEqual(300);
  });

  it.each([
    [
      "https://app.example.com/users/ana.perez@example.com/profile",
      "https://app.example.com/users/[email]/profile",
    ],
    ["/reset?token=abc123secret&u=1", "/reset"],
    ["/page?x=1#access_token=zzz", "/page"],
    ["https://bob:hunter2@app.example.com/home", "https://app.example.com/home"],
    ["/orders/3f2b8c1e-9a4d-4e7b-8c3a-1b2c3d4e5f60/items", "/orders/[id]/items"],
    ["/s/9f86d081884c7d659a2feaa0c55ad015a3bf4f1b/view", "/s/[id]/view"],
    ["/dni/12345678/x", "/dni/[num]/x"],
    ["/settings/customer-dashboard-preferences", "/settings/customer-dashboard-preferences"],
    ["/home", "/home"],
  ])("masks sample_uri %s", async (uri, expected) => {
    mockRows([{ errorClass: "E", errorMessage: "m", count: 1, sample_uri: uri }]);
    const out = (await getConnector("newrelic")!.actions.get_browser_errors!.run(CONFIG, {
      appName: "dash",
    })) as { errors: { sample_uri: string }[] };
    expect(out.errors[0]!.sample_uri).toBe(expected);
  });

  it("flags truncation when the row cap is reached", async () => {
    mockRows(
      Array.from({ length: 20 }, (_, i) => ({ errorClass: "E", errorMessage: `m${i}`, count: 1 }))
    );
    const out = (await getConnector("newrelic")!.actions.get_browser_errors!.run(CONFIG, {
      appName: "dash",
    })) as { truncated: boolean };
    expect(out.truncated).toBe(true);
  });

  it("sends the built query", async () => {
    const queries = mockRows([]);
    await getConnector("newrelic")!.actions.get_browser_errors!.run(CONFIG, {
      appName: "dash",
      since_hours: 2,
    });
    expect(queries[0]).toBe(buildBrowserErrorsQuery({ appName: "dash", sinceHours: 2 }));
  });
});

describe("search_logs action", () => {
  it("returns only the allowlisted fields and masks messages", async () => {
    mockRows([
      {
        timestamp: 1760000000000,
        level: "error",
        message: "user a.b@c.com phone 1155551234 failed " + "y".repeat(600),
        trace_id: "uuid-1",
        "trace.id": "agent-id",
        "span.id": "s",
        entityGuid: "g",
      },
    ]);
    const out = (await getConnector("newrelic")!.actions.search_logs!.run(CONFIG, {
      service: "svc",
    })) as { logs: Record<string, unknown>[] };
    const row = out.logs[0]!;
    expect(Object.keys(row).sort()).toEqual(["level", "message", "timestamp", "trace_id"]);
    expect(row.trace_id).toBe("uuid-1");
    expect(String(row.message)).toContain("[email]");
    expect(String(row.message)).toContain("[num]");
    expect(String(row.message).length).toBeLessThanOrEqual(500);
  });

  it("rejects out-of-bounds input before any request", async () => {
    const queries = mockRows([]);
    await expect(
      getConnector("newrelic")!.actions.search_logs!.run(CONFIG, { service: "s", limit: 500 })
    ).rejects.toThrow();
    expect(queries).toHaveLength(0);
  });
});

describe("agent surface", () => {
  it("offers both tools as reads and still hides nrql", async () => {
    const names = listAllTools().map((t) => t.name);
    expect(names).toContain("newrelic_get_browser_errors");
    expect(names).toContain("newrelic_search_logs");
    expect(names).not.toContain("newrelic_nrql");
    const ctx = { workspaceId: "w" };
    expect(await toolEffect("newrelic_get_browser_errors", {}, ctx)).toBe("read");
    expect(await toolEffect("newrelic_search_logs", {}, ctx)).toBe("read");
  });
});
