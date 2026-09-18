import { describe, it, expect, afterEach, vi } from "vitest";
import { getConnector } from "@/lib/integrations/registry";

const CONFIG = { baseUrl: "https://gitlab.example.com", token: "test-token" };
interface Captured {
  url: string;
  init: RequestInit;
}
function mockGitLab(
  ...responses: { payload: unknown; status?: number; headers?: Record<string, string> }[]
) {
  const calls: Captured[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      const response = responses[calls.length - 1];
      if (!response) throw new Error("Unexpected request");
      return new Response(JSON.stringify(response.payload), {
        status: response.status ?? 200,
        headers: { "content-type": "application/json", ...response.headers },
      });
    })
  );
  return calls;
}
async function run(action: string, input: Record<string, unknown>) {
  expect(getConnector("gitlab")).toBeDefined();
  return getConnector("gitlab")!.actions[action]!.run(CONFIG, input);
}
function expectGet(calls: Captured[]) {
  expect(calls.length).toBeGreaterThan(0);
  for (const { url, init } of calls) {
    expect(init.method).toBe("GET");
    expect(init.body).toBeUndefined();
    expect(new Headers(init.headers).get("PRIVATE-TOKEN")).toBe("test-token");
    expect(init.redirect).toBe("error");
    expect(url).not.toContain("test-token");
  }
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("gitlab connector", () => {
  it("registers only four read actions and standard credential fields", () => {
    const connector = getConnector("gitlab");
    expect(connector).toBeDefined();
    expect(connector!.authType).toBe("token");
    expect(connector!.fields).toEqual([
      expect.objectContaining({ key: "baseUrl", type: "url", required: false }),
      expect.objectContaining({ key: "token", type: "password", required: true }),
    ]);
    expect(Object.keys(connector!.actions).sort()).toEqual([
      "get_merge_request",
      "list_commits",
      "read_file",
      "search_code",
    ]);
  });
  it.each(["project", "group"])("searches %s blobs with encoded inputs", async (scope) => {
    const calls = mockGitLab({
      payload: [{ path: "src/a.ts", startline: 7, data: "match", project_id: 12 }],
    });
    expect(
      await run("search_code", {
        scope,
        id: "group/project #?",
        query: "a & b+#",
        ref: "feat/a#b",
        limit: 2,
      })
    ).toEqual({ matches: [{ path: "src/a.ts", startline: 7, snippet: "match" }] });
    expect(calls[0]!.url).toBe(
      `https://gitlab.example.com/api/v4/${scope}s/group%2Fproject%20%23%3F/search?scope=blobs&search=a+%26+b%2B%23&per_page=2&ref=feat%2Fa%23b`
    );
    expectGet(calls);
  });
  it.each([
    [undefined, 20],
    [999, 50],
    [0, 1],
    [NaN, 20],
    [2.9, 2],
  ])("bounds search limit %s to %s", async (limit, expected) => {
    const calls = mockGitLab({
      payload: Array.from({ length: 60 }, () => ({ path: "a", startline: 1, data: "x" })),
    });
    const out = (await run("search_code", { scope: "project", id: 12, query: "x", limit })) as {
      matches: unknown[];
    };
    expect(out.matches).toHaveLength(expected!);
    expect(new URL(calls[0]!.url).searchParams.get("per_page")).toBe(String(expected));
    expectGet(calls);
  });
  it("decodes UTF-8 file text and encodes path and ref", async () => {
    const content = "Hello 🌍\n",
      size = Buffer.byteLength(content);
    const calls = mockGitLab({
      payload: { content: Buffer.from(content).toString("base64"), encoding: "base64", size },
    });
    expect(
      await run("read_file", { project: "group/project", path: "src/a #?.ts", ref: "feat/a&b" })
    ).toEqual({ content, size });
    expect(calls[0]!.url).toBe(
      "https://gitlab.example.com/api/v4/projects/group%2Fproject/repository/files/src%2Fa%20%23%3F.ts?ref=feat%2Fa%26b"
    );
    expectGet(calls);
  });
  it("defaults ref to HEAD and accepts the 200 KiB boundary", async () => {
    const content = "a".repeat(204800);
    const calls = mockGitLab({
      payload: {
        content: Buffer.from(content).toString("base64"),
        encoding: "base64",
        size: content.length,
      },
    });
    expect(await run("read_file", { project: 12, path: "README.md" })).toEqual({
      content,
      size: content.length,
    });
    expect(calls[0]!.url).toBe(
      "https://gitlab.example.com/api/v4/projects/12/repository/files/README.md?ref=HEAD"
    );
    expectGet(calls);
  });
  it.each([true, false])("refuses oversized files (accurate metadata: %s)", async (accurate) => {
    const calls = mockGitLab({
      payload: {
        size: accurate ? 204801 : 1,
        encoding: "base64",
        content: Buffer.alloc(204801).toString("base64"),
      },
    });
    await expect(run("read_file", { project: 12, path: "large.txt" })).rejects.toThrow(/200 KiB/);
    expectGet(calls);
  });
  it("lists only commit summary fields with encoded filters", async () => {
    const commit = {
      id: "abcdef",
      short_id: "abc",
      title: "Change",
      author_name: "Test Author",
      committed_date: "2026-01-01T00:00:00Z",
    };
    const calls = mockGitLab({ payload: [{ ...commit, message: "hidden" }] });
    expect(
      await run("list_commits", {
        project: "group/project",
        path: "src/a & b.ts",
        since: "2026-01-01T00:00:00+03:00",
        until: "2026-02-01T00:00:00Z",
        limit: 3,
      })
    ).toEqual({ commits: [commit] });
    expect(calls[0]!.url).toBe(
      "https://gitlab.example.com/api/v4/projects/group%2Fproject/repository/commits?per_page=3&path=src%2Fa+%26+b.ts&since=2026-01-01T00%3A00%3A00%2B03%3A00&until=2026-02-01T00%3A00%3A00Z"
    );
    expectGet(calls);
  });
  it.each([
    [undefined, 20],
    [999, 50],
  ])("bounds commit limit %s to %s", async (limit, expected) => {
    const calls = mockGitLab({ payload: Array.from({ length: 60 }, () => ({})) });
    const out = (await run("list_commits", { project: 12, limit })) as { commits: unknown[] };
    expect(out.commits).toHaveLength(expected!);
    expect(calls[0]!.url).toBe(
      `https://gitlab.example.com/api/v4/projects/12/repository/commits?per_page=${expected}`
    );
    expectGet(calls);
  });
  it("returns merge request metadata and paginated paths, without diffs", async () => {
    const metadata = {
      title: "Change",
      state: "merged",
      source_branch: "feat/a",
      target_branch: "main",
      author: { id: 12, username: "test-author", name: "Test Author" },
      merged_at: "2026-01-01T00:00:00Z",
    };
    const calls = mockGitLab(
      { payload: { ...metadata, description: "hidden" } },
      {
        payload: [{ old_path: "a.ts", new_path: "b.ts", diff: "hidden" }],
        headers: { "x-next-page": "2" },
      },
      {
        payload: [{ old_path: "c.ts", new_path: "c.ts", diff: "hidden" }],
        headers: { "x-next-page": "" },
      }
    );
    expect(await run("get_merge_request", { project: "group/project #?", iid: 7 })).toEqual({
      ...metadata,
      changed_paths: ["a.ts", "b.ts", "c.ts"],
    });
    const base =
      "https://gitlab.example.com/api/v4/projects/group%2Fproject%20%23%3F/merge_requests/7";
    expect(calls.map((c) => c.url)).toEqual([
      base,
      `${base}/diffs?per_page=100&page=1`,
      `${base}/diffs?per_page=100&page=2`,
    ]);
    expectGet(calls);
  });
  it("tests credentials with GET /user", async () => {
    const calls = mockGitLab({ payload: { id: 12 } });
    expect(getConnector("gitlab")).toBeDefined();
    expect(
      await getConnector("gitlab")!.test({ ...CONFIG, baseUrl: `${CONFIG.baseUrl}/` })
    ).toEqual({ ok: true });
    expect(calls[0]!.url).toBe(`${CONFIG.baseUrl}/api/v4/user`);
    expectGet(calls);
  });
  it("surfaces a bounded GitLab error body", async () => {
    mockGitLab({ payload: { message: "Denied " + "x".repeat(500) }, status: 403 });
    await expect(run("list_commits", { project: 12 })).rejects.toThrow(
      /^GitLab HTTP 403: .*Denied/
    );
    mockGitLab({ payload: { message: "Denied " + "x".repeat(500) }, status: 403 });
    const error = await run("list_commits", { project: 12 }).catch((e: Error) => e);
    expect((error as Error).message.length).toBeLessThan(240);
  });
  it("reports credential failures as test results", async () => {
    mockGitLab({ payload: { message: "Unauthorized" }, status: 401 });
    expect(getConnector("gitlab")).toBeDefined();
    expect(await getConnector("gitlab")!.test(CONFIG)).toEqual({
      ok: false,
      error: expect.stringContaining("Unauthorized"),
    });
  });
  it.each([
    ["search_code", { scope: "other", id: 12, query: "x" }],
    ["read_file", { project: "..", path: "a" }],
    ["read_file", { project: 12, path: ".." }],
    ["get_merge_request", { project: 12, iid: "7/merge" }],
    ["list_commits", {}],
  ])("rejects invalid input for %s before fetching", async (action, input) => {
    const calls = mockGitLab();
    await expect(run(action as string, input as Record<string, unknown>)).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });
  it("ignores attempts to override the request method or URL", async () => {
    const calls = mockGitLab({ payload: [] });
    await run("list_commits", {
      project: 12,
      method: "DELETE",
      url: "https://gitlab.example.com/other",
      body: {},
    });
    expect(calls[0]!.url).toBe(
      "https://gitlab.example.com/api/v4/projects/12/repository/commits?per_page=20"
    );
    expectGet(calls);
  });
  it("preserves instance subpaths", async () => {
    const calls = mockGitLab({ payload: {} });
    expect(
      await getConnector("gitlab")!.test({ ...CONFIG, baseUrl: `${CONFIG.baseUrl}/gitlab/` })
    ).toEqual({ ok: true });
    expect(calls[0]!.url).toBe(`${CONFIG.baseUrl}/gitlab/api/v4/user`);
    expectGet(calls);
  });
  it("rejects missing tokens and query-bearing base URLs before fetching", async () => {
    const calls = mockGitLab();
    expect((await getConnector("gitlab")!.test({ ...CONFIG, token: "" })).ok).toBe(false);
    expect(
      (
        await getConnector("gitlab")!.test({
          ...CONFIG,
          baseUrl: `${CONFIG.baseUrl}?token=test-token`,
        })
      ).ok
    ).toBe(false);
    expect(calls).toHaveLength(0);
  });
  it("trims non-JSON error bodies", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("  Access denied  ", { status: 403 }))
    );
    await expect(run("read_file", { project: 12, path: "a" })).rejects.toThrow(
      "GitLab HTTP 403: Access denied"
    );
  });
  it("rejects repeated pagination instead of looping", async () => {
    mockGitLab({ payload: {} }, { payload: [], headers: { "x-next-page": "1" } });
    await expect(run("get_merge_request", { project: 12, iid: 7 })).rejects.toThrow(/pagination/);
  });
});
