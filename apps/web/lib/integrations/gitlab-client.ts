import "server-only";
import { assertPublicUrl } from "@/lib/net-guard";

const MAX_FILE_BYTES = 200 * 1024;

function requiredText(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`GitLab needs ${name}.`);
  return value;
}

function segment(value: unknown, name: string): string {
  const raw =
    typeof value === "number" && Number.isSafeInteger(value) && value > 0
      ? String(value)
      : requiredText(value, name);
  // URL parsers normalize dot segments even when percent-encoded.
  if (raw === "." || raw === "..") throw new Error(`Invalid GitLab ${name}.`);
  return encodeURIComponent(raw);
}

function limitOf(value: unknown): number {
  const n = Number(value ?? 20);
  return Number.isFinite(n) ? Math.min(50, Math.max(1, Math.trunc(n))) : 20;
}

function optionalParams(input: Record<string, unknown>, names: string[]): Record<string, string> {
  const params: Record<string, string> = {};
  for (const name of names) {
    if (input[name] !== undefined) params[name] = requiredText(input[name], name);
  }
  return params;
}

/** Private transport: callers cannot supply methods, bodies, headers or arbitrary URLs. */
async function get<T>(
  config: Record<string, string>,
  path: string,
  params: Record<string, string> = {}
) {
  const token = requiredText(config.token, "a personal access token with read_api").trim();
  const base = assertPublicUrl(config.baseUrl?.trim() || "https://gitlab.com");
  if (base.username || base.password || base.search || base.hash) {
    throw new Error("GitLab baseUrl must not contain credentials, a query or a fragment.");
  }
  const url = new URL(`${base.toString().replace(/\/+$/, "")}/api/v4/${path}`);
  url.search = new URLSearchParams(params).toString();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 20_000);
  try {
    const res = await fetch(url.toString(), {
      method: "GET",
      headers: { "PRIVATE-TOKEN": token, Accept: "application/json" },
      // Do not forward a private token to a redirect target.
      redirect: "error",
      signal: ac.signal,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`GitLab HTTP ${res.status}: ${text.trim().slice(0, 200)}`);
    let data: T;
    try {
      data = JSON.parse(text) as T;
    } catch {
      throw new Error(
        `GitLab returned a non-JSON response (HTTP ${res.status}): ${text.trim().slice(0, 200)}`
      );
    }
    return { data, nextPage: res.headers.get("x-next-page") };
  } finally {
    clearTimeout(timer);
  }
}

export async function gitlabTest(config: Record<string, string>): Promise<void> {
  await get(config, "user");
}

export async function gitlabSearchCode(
  config: Record<string, string>,
  input: Record<string, unknown>
) {
  if (input.scope !== "project" && input.scope !== "group") {
    throw new Error("GitLab search scope must be project or group.");
  }
  const limit = limitOf(input.limit);
  const { data } = await get<{ path: string; startline: number; data: string }[]>(
    config,
    `${input.scope}s/${segment(input.id, "id")}/search`,
    {
      scope: "blobs",
      search: requiredText(input.query, "query"),
      per_page: String(limit),
      ...optionalParams(input, ["ref"]),
    }
  );
  return {
    matches: data
      .slice(0, limit)
      .map((row) => ({ path: row.path, startline: row.startline, snippet: row.data })),
  };
}

export async function gitlabReadFile(
  config: Record<string, string>,
  input: Record<string, unknown>
) {
  const { data } = await get<{ size: number; encoding: string; content: string }>(
    config,
    `projects/${segment(input.project, "project")}/repository/files/${segment(input.path, "path")}`,
    { ref: input.ref === undefined ? "HEAD" : requiredText(input.ref, "ref") }
  );
  const tooLarge = () => new Error("GitLab file exceeds the 200 KiB (204800 bytes) limit.");
  if (data.size > MAX_FILE_BYTES) throw tooLarge();
  if (data.encoding !== "base64") throw new Error("GitLab file content must be base64-encoded.");
  const content = Buffer.from(data.content, "base64");
  if (content.length > MAX_FILE_BYTES) throw tooLarge();
  return { content: content.toString("utf8"), size: content.length };
}

interface Commit {
  id: string;
  short_id: string;
  title: string;
  author_name: string;
  committed_date: string;
}

export async function gitlabListCommits(
  config: Record<string, string>,
  input: Record<string, unknown>
) {
  const limit = limitOf(input.limit);
  const { data } = await get<Commit[]>(
    config,
    `projects/${segment(input.project, "project")}/repository/commits`,
    { per_page: String(limit), ...optionalParams(input, ["path", "since", "until"]) }
  );
  return {
    commits: data.slice(0, limit).map(({ id, short_id, title, author_name, committed_date }) => ({
      id,
      short_id,
      title,
      author_name,
      committed_date,
    })),
  };
}

interface MergeRequest {
  title: string;
  state: string;
  source_branch: string;
  target_branch: string;
  author: { id: number; username: string; name: string } | null;
  merged_at: string | null;
}

export async function gitlabGetMergeRequest(
  config: Record<string, string>,
  input: Record<string, unknown>
) {
  const iid = String(input.iid ?? "");
  if (!/^[1-9]\d*$/.test(iid)) throw new Error("GitLab iid must be a positive integer.");
  const path = `projects/${segment(input.project, "project")}/merge_requests/${encodeURIComponent(iid)}`;
  const { data: mr } = await get<MergeRequest>(config, path);
  const paths = new Set<string>();
  let page = 1;
  while (true) {
    const { data, nextPage } = await get<{ old_path: string; new_path: string }[]>(
      config,
      `${path}/diffs`,
      {
        per_page: "100",
        page: String(page),
      }
    );
    // Both sides of a rename matter; unchanged paths appear only once.
    for (const file of data) {
      paths.add(file.old_path);
      paths.add(file.new_path);
    }
    if (nextPage === "" || (nextPage === null && data.length < 100)) break;
    const next = nextPage === null ? page + 1 : Number(nextPage);
    if (!Number.isSafeInteger(next) || next <= page)
      throw new Error("GitLab returned invalid diff pagination.");
    page = next;
  }
  return {
    title: mr.title,
    state: mr.state,
    source_branch: mr.source_branch,
    target_branch: mr.target_branch,
    author: mr.author
      ? { id: mr.author.id, username: mr.author.username, name: mr.author.name }
      : null,
    merged_at: mr.merged_at ?? null,
    changed_paths: [...paths],
  };
}
