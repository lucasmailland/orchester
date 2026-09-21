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
  it("registers only read actions and standard credential fields", () => {
    const connector = getConnector("gitlab");
    expect(connector).toBeDefined();
    expect(connector!.authType).toBe("token");
    expect(connector!.fields).toEqual([
      expect.objectContaining({ key: "baseUrl", type: "url", required: false }),
      expect.objectContaining({ key: "token", type: "password", required: true }),
    ]);
    // La lista es explícita a propósito: el conector es de SÓLO LECTURA y esta
    // prueba es el guardián. Sumar una acción acá es una decisión, no un
    // descuido — y una que escriba en GitLab no debería pasar por este cambio
    // de una línea, debería discutirse.
    expect(Object.keys(connector!.actions).sort()).toEqual([
      "compare_refs",
      "get_merge_request",
      "list_commits",
      "read_file",
      "search_code",
    ]);
  });
  it("toda acción registrada es de lectura", () => {
    // Lo que de verdad protege el guardián no es el número, es que nada
    // escriba. Un nombre que suene a escritura falla acá aunque alguien haya
    // actualizado la lista de arriba sin pensar.
    const ESCRIBE = /^(create|update|delete|post|put|patch|merge|close|add|remove|set|write)/;
    for (const nombre of Object.keys(getConnector("gitlab")!.actions)) {
      expect(nombre).not.toMatch(ESCRIBE);
    }
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
    ).toMatchObject({ matches: [{ path: "src/a.ts", startline: 7, snippet: "match" }] });
    expect(calls[0]!.url).toBe(
      `https://gitlab.example.com/api/v4/${scope}s/group%2Fproject%20%23%3F/search?scope=blobs&search=a+%26+b%2B%23&per_page=20&ref=feat%2Fa%23b`
    );
    expectGet(calls);
  });
  it("returns each group match's project and chains numeric IDs into read actions", async () => {
    const calls = mockGitLab(
      {
        payload: [
          { path: "src/a.ts", startline: 7, data: "match", project_id: 12 },
          { path: "src/b.ts", startline: 8, data: "match", project_id: 34 },
        ],
      },
      { payload: { content: "eA==", encoding: "base64", size: 1 } },
      { payload: [] }
    );
    const out = (await run("search_code", { scope: "group", id: "acme", query: "match" })) as {
      matches: { projectId: string; path: string }[];
    };
    expect(out.matches).toEqual([
      { path: "src/a.ts", startline: 7, snippet: "match", projectId: "12" },
      { path: "src/b.ts", startline: 8, snippet: "match", projectId: "34" },
    ]);
    await run("read_file", { project: out.matches[0]!.projectId, path: out.matches[0]!.path });
    await run("list_commits", { project: out.matches[1]!.projectId });
    expect(calls[1]!.url).toContain("/projects/12/repository/files/");
    expect(calls[2]!.url).toContain("/projects/34/repository/commits?");
    expect(calls).toHaveLength(3);
  });
  it.each([12, "12"])(
    "preserves numeric project scope %s without response metadata",
    async (id) => {
      const calls = mockGitLab({ payload: [{ path: "a.ts", startline: 1, data: "x" }] });
      expect(await run("search_code", { scope: "project", id, query: "x" })).toEqual({
        matches: [{ path: "a.ts", startline: 1, snippet: "x", projectId: "12" }],
      });
      expect(calls).toHaveLength(1);
    }
  );
  it("returns the API project ID for a project selected by namespace", async () => {
    mockGitLab({ payload: [{ path: "a.ts", startline: 1, data: "x", project_id: 12 }] });
    expect(
      await run("search_code", { scope: "project", id: "acme/widgets", query: "x" })
    ).toMatchObject({ matches: [{ projectId: "12" }] });
  });
  it("builds links only with a project path, file path and known ref", async () => {
    // Optional project.path_with_namespace and ref are assumed response extensions.
    const project = { path_with_namespace: "acme/widgets" };
    const calls = mockGitLab({
      payload: [
        { path: "src/a #?.ts", startline: 7, data: "x", project_id: 12, project, ref: "feat/a#b" },
        { path: "b.ts", startline: 1, data: "x", project_id: 12, project },
        { path: "c.ts", startline: 1, data: "x", project_id: 34, ref: "main" },
      ],
    });
    const out = (await getConnector("gitlab")!.actions.search_code!.run(
      { ...CONFIG, baseUrl: `${CONFIG.baseUrl}/gitlab/` },
      { scope: "group", id: "acme", query: "x" }
    )) as { matches: Record<string, unknown>[] };
    expect(out.matches[0]).toEqual({
      path: "src/a #?.ts",
      startline: 7,
      snippet: "x",
      projectId: "12",
      projectPath: "acme/widgets",
      webUrl: `${CONFIG.baseUrl}/gitlab/acme/widgets/-/blob/feat%2Fa%23b/src/a%20%23%3F.ts`,
    });
    expect(out.matches[1]).toHaveProperty("projectPath", "acme/widgets");
    expect(out.matches[1]).not.toHaveProperty("webUrl");
    expect(out.matches[2]).not.toHaveProperty("projectPath");
    expect(out.matches[2]).not.toHaveProperty("webUrl");
    expect(calls).toHaveLength(1);
  });
  it("uses an explicit project search ref when the response has no ref", async () => {
    mockGitLab({
      payload: [
        {
          path: "a.ts",
          startline: 1,
          data: "x",
          project_id: 12,
          project: { path_with_namespace: "acme/widgets" },
        },
      ],
    });
    expect(
      await run("search_code", { scope: "project", id: 12, query: "x", ref: "release" })
    ).toMatchObject({
      matches: [{ webUrl: `${CONFIG.baseUrl}/acme/widgets/-/blob/release/a.ts` }],
    });
  });
  it.each([
    [undefined, 20, 80],
    [999, 50, 100],
    [0, 1, 20],
    [NaN, 20, 80],
    [2.9, 2, 20],
  ])("bounds search limit %s to %s while fetching %s to rank", async (limit, expected, fetched) => {
    const calls = mockGitLab({
      payload: Array.from({ length: 120 }, () => ({ path: "a", startline: 1, data: "x" })),
    });
    const out = (await run("search_code", { scope: "project", id: 12, query: "x", limit })) as {
      matches: unknown[];
    };
    expect(out.matches).toHaveLength(expected!);
    expect(new URL(calls[0]!.url).searchParams.get("per_page")).toBe(String(fetched));
    expectGet(calls);
  });
  describe("search ranking", () => {
    async function search(paths: string[], input: Record<string, unknown> = {}) {
      mockGitLab({
        payload: paths.map((path, index) => ({ path, startline: index + 1, data: path })),
      });
      return (await run("search_code", {
        scope: "project",
        id: "acme/widgets",
        query: "invalid password",
        ...input,
      })) as { matches: { path: string; startline: number; snippet: string }[] };
    }

    it("ranks source before locales and fixtures without changing match fields", async () => {
      const paths = ["locales/es-ES.json", "fixtures/rs_invalid_password.json", "src/auth.ts"];
      expect(await search(paths)).toEqual({
        matches: [2, 0, 1].map((index) => ({
          path: paths[index],
          startline: index + 1,
          snippet: paths[index],
        })),
      });
    });

    it("preserves GitLab order within every tier", async () => {
      const paths = [
        "tests/z.ts",
        "locales/z.ts",
        "README.md",
        "src/z.ts",
        "src/a.py",
        "LICENSE",
        "config.json",
        "src/a.test.ts",
      ];
      expect((await search(paths, { onlySource: false })).matches.map((row) => row.path)).toEqual([
        "src/z.ts",
        "src/a.py",
        "README.md",
        "LICENSE",
        "locales/z.ts",
        "config.json",
        "tests/z.ts",
        "src/a.test.ts",
      ]);
    });

    it("onlySource drops data and tests but retains unclassified files", async () => {
      const excluded = [
        ...["json", "yaml", "yml", "toml", "xml", "csv", "lock"].map((ext) => `config.${ext}`),
        ...[
          "locales",
          "i18n",
          "translations",
          "messages",
          "fixtures",
          "__fixtures__",
          "snapshots",
          "__snapshots__",
        ].map((dir) => `src/${dir}/example.ts`),
        ...["test", "tests", "spec", "__tests__"].map((dir) => `${dir}/example.ts`),
        "src/auth.test.ts",
        "src/auth.spec.js",
        "tests/fixtures/example.json",
      ];
      const kept = ["src/auth.ts", "README.md", "src/contests.ts", "src/test/helpers.ts"];
      expect(
        (await search([...excluded, ...kept], { onlySource: true })).matches.map((row) => row.path)
      ).toEqual(["src/auth.ts", "src/contests.ts", "README.md"]);
    });

    it.each([
      "ts",
      "tsx",
      "js",
      "jsx",
      "mjs",
      "cjs",
      "py",
      "go",
      "rb",
      "java",
      "kt",
      "php",
      "cs",
      "rs",
      "sql",
    ])("ranks .%s source files before unclassified files", async (ext) => {
      expect(
        (await search(["README.md", `src/auth.${ext}`])).matches.map((row) => row.path)
      ).toEqual([`src/auth.${ext}`, "README.md"]);
    });

    it("applies limit after ranking so the last source match survives", async () => {
      expect(
        (await search(["locales/es-ES.json", "fixtures/error.json", "src/auth.ts"], { limit: 1 }))
          .matches
      ).toEqual([{ path: "src/auth.ts", startline: 3, snippet: "src/auth.ts" }]);
    });

    it("fetches past the caller's limit so a late source match can still rank first", async () => {
      const paths = [...Array.from({ length: 19 }, (_, i) => `locales/m${i}.json`), "src/auth.ts"];
      const calls = mockGitLab({
        payload: paths.map((path, index) => ({ path, startline: index + 1, data: path })),
      });
      const out = (await run("search_code", {
        scope: "project",
        id: "acme/widgets",
        query: "invalid password",
        limit: 2,
      })) as { matches: { path: string }[] };
      expect(new URL(calls[0]!.url).searchParams.get("per_page")).toBe("20");
      expect(out.matches.map((row) => row.path)).toEqual(["src/auth.ts", "locales/m0.json"]);
    });

    it("gives test markers precedence over data markers and matches whole directories", async () => {
      const paths = [
        "tests/fixtures/auth.json",
        "locales/auth.ts",
        "src/latest/auth.ts",
        "src/auth.test/helpers.ts",
      ];
      expect((await search(paths)).matches.map((row) => row.path)).toEqual([
        "src/latest/auth.ts",
        "src/auth.test/helpers.ts",
        "locales/auth.ts",
        "tests/fixtures/auth.json",
      ]);
    });

    it("returns test-only results unless onlySource is requested", async () => {
      const paths = ["tests/auth.ts", "src/auth.spec.ts"];
      expect((await search(paths)).matches.map((row) => row.path)).toEqual(paths);
      expect((await search(paths, { onlySource: true })).matches).toEqual([]);
    });

    it("documents onlySource as an optional boolean defaulting to false", () => {
      const schema = getConnector("gitlab")!.actions.search_code!.inputSchema;
      expect(schema.properties.onlySource).toMatchObject({
        type: "boolean",
        default: false,
        description: expect.stringContaining("data"),
      });
      expect(schema.required).not.toContain("onlySource");
    });
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
  it.each([
    [100, undefined, 60, 140],
    [-10, 2, 1, 3],
    [9999, 2, 498, 500],
    [250, 3, 247, 253],
    [250, 999, 50, 450],
    [250, 0, 250, 250],
  ])("windows around %s with context %s", async (aroundLine, contextLines, fromLine, toLine) => {
    const lines = Array.from({ length: 500 }, (_, i) => `line ${i + 1}`);
    const content = lines.join("\n");
    mockGitLab({
      payload: {
        content: Buffer.from(content).toString("base64"),
        encoding: "base64",
        size: content.length,
      },
    });
    expect(
      await run("read_file", {
        project: "acme/widgets",
        path: "service.ts",
        aroundLine,
        contextLines,
      })
    ).toEqual({
      content: lines.slice(fromLine! - 1, toLine).join("\n"),
      size: content.length,
      fromLine,
      toLine,
      totalLines: 500,
      truncated: true,
    });
  });
  it.each(["first\r\nsecond\r\n", ""])("preserves line contents: %j", async (content) => {
    mockGitLab({
      payload: {
        content: Buffer.from(content).toString("base64"),
        encoding: "base64",
        size: content.length,
      },
    });
    expect(
      await run("read_file", {
        project: "acme/widgets",
        path: "service.ts",
        aroundLine: 1,
      })
    ).toEqual({
      content,
      size: content.length,
      fromLine: 1,
      toLine: content.split("\n").length,
      totalLines: content.split("\n").length,
      truncated: true,
    });
  });
  it("ignores contextLines without aroundLine and adds no window fields", async () => {
    const content = "first\r\nsecond\nlast\n";
    mockGitLab({
      payload: {
        content: Buffer.from(content).toString("base64"),
        encoding: "base64",
        size: 999,
      },
    });
    expect(
      await run("read_file", {
        project: "acme/widgets",
        path: "service.ts",
        contextLines: 0,
      })
    ).toEqual({ content, size: content.length });
  });
  it.each([true, false])(
    "allows oversized windowed files (accurate metadata: %s)",
    async (accurate) => {
      const content = "a".repeat(204801) + "\nmatch\nlast";
      mockGitLab({
        payload: {
          content: Buffer.from(content).toString("base64"),
          encoding: "base64",
          size: accurate ? content.length : 1,
        },
      });
      expect(
        await run("read_file", {
          project: "acme/widgets",
          path: "service.ts",
          aroundLine: 2,
          contextLines: 0,
        })
      ).toEqual({
        content: "match",
        size: content.length,
        fromLine: 2,
        toLine: 2,
        totalLines: 3,
        truncated: true,
      });
    }
  );
  it.each([undefined, "1", String(8 * 1024 * 1024 + 1)])(
    "bounds streamed bytes regardless of Content-Length %s",
    async (length) => {
      const cancel = vi.fn();
      let chunks = 0;
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          chunks++;
          controller.enqueue(new Uint8Array(1024 * 1024).fill(32));
          if (chunks === 12) controller.close();
        },
        cancel,
      });
      vi.stubGlobal(
        "fetch",
        vi.fn(
          async () =>
            new Response(body, {
              headers: length === undefined ? {} : { "content-length": length },
            })
        )
      );
      await expect(
        run("read_file", {
          project: "acme/widgets",
          path: "service.ts",
          aroundLine: 2,
        })
      ).rejects.toThrow(/8 MiB/);
      expect(cancel).toHaveBeenCalledOnce();
      expect(chunks).toBeLessThan(12);
    }
  );
  it("accepts a response exactly at the byte cap", async () => {
    const payload = JSON.stringify({ content: "eA==", encoding: "base64", size: 1 });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(payload.padEnd(8 * 1024 * 1024)))
    );
    expect(
      await run("read_file", { project: "acme/widgets", path: "service.ts", aroundLine: 1 })
    ).toEqual({ content: "x", size: 1, fromLine: 1, toLine: 1, totalLines: 1, truncated: true });
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

describe("compare_refs", () => {
  // Para qué sirve: en Fichap, `service.version` de New Relic viene como
  // `0.2.67+da206454` — semver MÁS el sha del commit. Si un error aparece
  // recién en una versión, comparar el sha de la anterior contra el de ésa
  // acota el sospechoso a unos pocos commits. Medido contra vacation-service
  // el 2026-09-21: 3 commits y 4 archivos, contra los ~30 repos que hay que
  // revisar buscando el texto del error.
  const respuesta = {
    commits: [
      {
        id: "96687710aaaa",
        short_id: "96687710",
        title: "Enhance vacation request DTOs",
        author_name: "Alguien",
        committed_date: "2026-09-16T10:00:00Z",
      },
    ],
    diffs: [
      { new_path: "src/vacations/services/vacationRequests.service.ts", old_path: "x" },
      { new_path: "package.json", old_path: "package.json" },
    ],
  };

  it("pide la comparación y devuelve commits y archivos", async () => {
    const calls = mockGitLab({ payload: respuesta });
    const out = (await run("compare_refs", {
      project: "fichap-team/microservices/vacation-service",
      from: "d9bc5f4d",
      to: "da206454",
    })) as { commits: unknown[]; files: string[] };

    expectGet(calls);
    expect(calls[0]!.url).toContain("/repository/compare");
    expect(calls[0]!.url).toContain("from=d9bc5f4d");
    expect(calls[0]!.url).toContain("to=da206454");
    expect(out.commits).toHaveLength(1);
    expect(out.files).toEqual([
      "src/vacations/services/vacationRequests.service.ts",
      "package.json",
    ]);
  });

  it("acota commits y archivos, y dice que los acotó", async () => {
    // Una comparación entre versiones lejanas puede traer cientos de archivos.
    // Volcarlos en un prompt gasta el contexto en ruido; peor, esconde los
    // pocos que importan.
    const grande = {
      commits: Array.from({ length: 40 }, (_, i) => ({
        id: `c${i}`,
        short_id: `c${i}`,
        title: `commit ${i}`,
        author_name: "a",
        committed_date: "2026-09-16T10:00:00Z",
      })),
      diffs: Array.from({ length: 80 }, (_, i) => ({ new_path: `src/f${i}.ts` })),
    };
    mockGitLab({ payload: grande });
    const out = (await run("compare_refs", {
      project: "g/p",
      from: "a",
      to: "b",
      limit: 5,
    })) as { commits: unknown[]; files: string[]; truncated: boolean; totalCommits: number };

    expect(out.commits).toHaveLength(5);
    expect(out.files.length).toBeLessThanOrEqual(40);
    expect(out.truncated).toBe(true);
    expect(out.totalCommits).toBe(40);
  });

  it("exige las dos puntas", async () => {
    await expect(run("compare_refs", { project: "g/p", from: "a" })).rejects.toThrow(/to/i);
    await expect(run("compare_refs", { project: "g/p", to: "b" })).rejects.toThrow(/from/i);
  });
});
