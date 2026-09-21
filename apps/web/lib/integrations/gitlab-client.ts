import "server-only";
import { assertPublicUrl } from "@/lib/net-guard";

const MAX_FILE_BYTES = 200 * 1024;
// Includes base64 expansion and JSON metadata; bounds every GitLab response.
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

async function boundedText(res: Response, ac: AbortController): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) {
        ac.abort();
        await reader.cancel().catch(() => {});
        throw new Error("GitLab response exceeds the 8 MiB (8388608 bytes) limit.");
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks, bytes).toString("utf8");
  } finally {
    reader.releaseLock();
  }
}

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
    const text = await boundedText(res, ac);
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

function searchTier(path: string): number {
  const filename = path.slice(path.lastIndexOf("/") + 1);
  // A test or translation proves the string exists; the source proves where it comes from.
  if (/(^|\/)(test|tests|spec|__tests__)\//.test(path) || /\.(test|spec)\./.test(filename)) {
    return 4;
  }
  if (
    /(^|\/)(locales|i18n|translations|messages|fixtures|__fixtures__|snapshots|__snapshots__)\//.test(
      path
    ) ||
    /\.(json|yaml|yml|toml|xml|csv|lock)$/.test(filename)
  ) {
    return 3;
  }
  return /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rb|java|kt|php|cs|rs|sql)$/.test(filename) ? 1 : 2;
}

export async function gitlabSearchCode(
  config: Record<string, string>,
  input: Record<string, unknown>
) {
  if (input.scope !== "project" && input.scope !== "group") {
    throw new Error("GitLab search scope must be project or group.");
  }
  const limit = limitOf(input.limit);
  // Rank what GitLab returns, not what fits: the source file is often further down the
  // page than the caller's limit, so fetch a wider page and let the tiers pick from it.
  const fetchSize = Math.min(100, Math.max(limit * 4, 20));
  const { data } = await get<
    {
      path: string;
      startline: number;
      data: string;
      project_id?: number;
      // Optional response extensions; do not assume every search backend supplies them.
      project?: { path_with_namespace?: string };
      ref?: string;
    }[]
  >(config, `${input.scope}s/${segment(input.id, "id")}/search`, {
    scope: "blobs",
    search: requiredText(input.query, "query"),
    per_page: String(fetchSize),
    ...optionalParams(input, ["ref"]),
  });
  const ranked = data
    .map((row) => ({ row, tier: searchTier(row.path) }))
    .filter(({ tier }) => input.onlySource !== true || tier <= 2)
    .sort((a, b) => a.tier - b.tier);
  return {
    matches: ranked.slice(0, limit).map(({ row }) => {
      const projectId =
        row.project_id !== undefined
          ? String(row.project_id)
          : input.scope === "project" && /^[1-9]\d*$/.test(String(input.id))
            ? String(input.id)
            : undefined;
      const projectPath = row.project?.path_with_namespace;
      const ref =
        row.ref || (input.scope === "project" ? (input.ref as string | undefined) : undefined);
      const encodePath = (path: string) => path.split("/").map(encodeURIComponent).join("/");
      const baseUrl = (config.baseUrl?.trim() || "https://gitlab.com").replace(/\/+$/, "");
      const webUrl =
        projectPath && row.path && ref
          ? `${baseUrl}/${encodePath(projectPath)}/-/blob/${encodeURIComponent(ref)}/${encodePath(row.path)}`
          : undefined;
      return {
        path: row.path,
        startline: row.startline,
        snippet: row.data,
        ...(projectId !== undefined ? { projectId } : {}),
        ...(projectPath ? { projectPath } : {}),
        ...(webUrl ? { webUrl } : {}),
      };
    }),
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
  const windowed = input.aroundLine !== undefined;
  if (!windowed && data.size > MAX_FILE_BYTES) throw tooLarge();
  if (data.encoding !== "base64") throw new Error("GitLab file content must be base64-encoded.");
  const content = Buffer.from(data.content, "base64");
  if (!windowed && content.length > MAX_FILE_BYTES) throw tooLarge();
  const text = content.toString("utf8");
  if (!windowed) return { content: text, size: content.length };
  // Splitting only on LF preserves CR characters and trailing empty lines.
  const lines = text.split("\n");
  const requestedLine = Number(input.aroundLine);
  const aroundLine = Number.isFinite(requestedLine)
    ? Math.min(lines.length, Math.max(1, Math.trunc(requestedLine)))
    : 1;
  const requestedContext = Number(input.contextLines ?? 40);
  const contextLines = Number.isFinite(requestedContext)
    ? Math.min(200, Math.max(0, Math.trunc(requestedContext)))
    : 40;
  const fromLine = Math.max(1, aroundLine - contextLines);
  const toLine = Math.min(lines.length, aroundLine + contextLines);
  return {
    content: lines.slice(fromLine - 1, toLine).join("\n"),
    size: content.length,
    fromLine,
    toLine,
    totalLines: lines.length,
    truncated: true,
  };
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
  // Rank what GitLab returns, not what fits: the source file is often further down the
  // page than the caller's limit, so fetch a wider page and let the tiers pick from it.
  const fetchSize = Math.min(100, Math.max(limit * 4, 20));
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

interface Compare {
  commits: Commit[];
  diffs: { new_path?: string; old_path?: string }[];
}

/** Cuántos archivos como mucho: más que esto en un prompt es ruido, no evidencia. */
const MAX_COMPARE_FILES = 40;

/**
 * Qué cambió entre dos puntos del repo.
 *
 * Existe para acotar al sospechoso cuando se sabe en qué versión apareció un
 * error. En Fichap, `service.version` de New Relic viene como
 * `0.2.67+da206454` — semver más el sha del commit —, así que comparar el sha
 * de la versión anterior contra el de la primera que trae el error deja unos
 * pocos commits. Medido contra vacation-service el 2026-09-21: 3 commits y 4
 * archivos, en vez de buscar el texto del error en treinta repos.
 *
 * Acota a propósito, y lo dice: una comparación entre versiones lejanas puede
 * traer cientos de archivos, y volcarlos enteros esconde los pocos que
 * importan.
 */
export async function gitlabCompareRefs(
  config: Record<string, string>,
  input: Record<string, unknown>
) {
  const limit = limitOf(input.limit);
  const from = requiredText(input.from, "from");
  const to = requiredText(input.to, "to");
  const { data } = await get<Compare>(
    config,
    `projects/${segment(input.project, "project")}/repository/compare`,
    { from, to }
  );
  const commits = data.commits ?? [];
  const archivos = (data.diffs ?? [])
    .map((d) => d.new_path || d.old_path || "")
    .filter((p) => p !== "");
  return {
    from,
    to,
    commits: commits
      .slice(0, limit)
      .map(({ id, short_id, title, author_name, committed_date }) => ({
        id,
        short_id,
        title,
        author_name,
        committed_date,
      })),
    files: archivos.slice(0, MAX_COMPARE_FILES),
    totalCommits: commits.length,
    totalFiles: archivos.length,
    truncated: commits.length > limit || archivos.length > MAX_COMPARE_FILES,
  };
}
