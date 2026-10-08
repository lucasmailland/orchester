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
        ...(isSecretPath(row.path) ? { content_withheld: true } : { snippet: row.data }),
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
  if (isSecretPath(typeof input.path === "string" ? input.path : "")) {
    throw new Error("This file usually holds credentials; its content is not returned.");
  }
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

const MR_STATES = ["opened", "merged", "closed", "all"];

function boundedInt(value: unknown, name: string, min: number, max: number, dflt: number): number {
  if (value === undefined) return dflt;
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    throw new Error(`GitLab ${name} must be an integer between ${min} and ${max}.`);
  }
  return value;
}

interface MergeRequestRow {
  iid: number;
  title: string;
  state: string;
  author?: { username?: string } | null;
  source_branch: string;
  target_branch: string;
  merged_at: string | null;
  created_at: string;
  web_url: string;
  merge_commit_sha: string | null;
}

/**
 * Merge requests of one project, one page, metadata only. Descriptions are
 * deliberately not returned: they are long, user-written and not needed to
 * date a change.
 */
export async function gitlabListMergeRequests(
  config: Record<string, string>,
  input: Record<string, unknown>
) {
  const project = segment(input.project, "project");
  const state = input.state === undefined ? "merged" : input.state;
  if (typeof state !== "string" || !MR_STATES.includes(state)) {
    throw new Error("GitLab state must be one of opened, merged, closed or all.");
  }
  const limit = boundedInt(input.limit, "limit", 1, 30, 10);
  const params: Record<string, string> = {
    state,
    order_by: "updated_at",
    sort: "desc",
    per_page: String(limit),
  };
  let sinceMs: number | undefined;
  if (input.merged_since !== undefined) {
    sinceMs = typeof input.merged_since === "string" ? Date.parse(input.merged_since) : NaN;
    if (!Number.isFinite(sinceMs)) throw new Error("GitLab merged_since must be an ISO 8601 date.");
    // A merged MR was last updated at or after its merge, so this never drops a match;
    // the exact bound is applied below on merged_at.
    params.updated_after = new Date(sinceMs).toISOString();
    params.per_page = "100";
  }
  if (input.search !== undefined) {
    const search = requiredText(input.search, "search");
    if (search.length > 100) throw new Error("GitLab search must be at most 100 characters.");
    params.search = search;
  }
  if (input.target_branch !== undefined) {
    params.target_branch = requiredText(input.target_branch, "target_branch");
  }
  const { data } = await get<MergeRequestRow[]>(
    config,
    `projects/${project}/merge_requests`,
    params
  );
  const rows =
    sinceMs === undefined
      ? data
      : data.filter((r) => r.merged_at && Date.parse(r.merged_at) >= sinceMs!);
  return {
    merge_requests: rows.slice(0, limit).map((r) => ({
      iid: r.iid,
      title: String(r.title ?? "").slice(0, 200),
      state: r.state,
      author: r.author?.username ?? null,
      source_branch: r.source_branch,
      target_branch: r.target_branch,
      merged_at: r.merged_at ?? null,
      created_at: r.created_at,
      web_url: r.web_url,
      merge_commit_sha: r.merge_commit_sha ?? null,
    })),
  };
}

const DIFF_MAX_FILES = 20;
const DIFF_MAX_FILE_BYTES = 8 * 1024;
const DIFF_MAX_TOTAL_BYTES = 40 * 1024;

interface DiffRow {
  old_path: string;
  new_path: string;
  new_file?: boolean;
  deleted_file?: boolean;
  renamed_file?: boolean;
  diff?: string;
  too_large?: boolean;
}

// Files that usually hold credentials. Their content is withheld (path and flags still
// listed) because a committed secret would otherwise reach the model and whatever it
// writes, such as a ticket note. The match is on the file name only: `credentials.json`
// matches, `docs/credentials-guide.md` does not.
const SECRET_FILE =
  /(^|\/)(\.env(\.[^/]*)?|[^/]*\.env|\.npmrc|\.pypirc|\.netrc|\.git-credentials|id_(rsa|dsa|ecdsa|ed25519)|credentials(\.json)?|[^/]*\.(pem|key|p12|pfx|jks|keystore))$/i;

export function isSecretPath(path: string | null | undefined): boolean {
  return SECRET_FILE.test(path ?? "");
}

function isSecretFile(d: DiffRow): boolean {
  return isSecretPath(d.new_path) || isSecretPath(d.old_path);
}

function clipBytes(text: string, max: number): { text: string; clipped: boolean } {
  const buf = Buffer.from(text, "utf8");
  if (buf.length <= max) return { text, clipped: false };
  return {
    text: buf
      .subarray(0, max)
      .toString("utf8")
      .replace(/\uFFFD+$/, ""),
    clipped: true,
  };
}

/**
 * Diff of one commit or one merge request, hard-capped: 20 files, 8 KB per
 * file, 40 KB overall. One page only; whatever does not fit is counted in
 * `files_omitted` rather than fetched.
 */
export async function gitlabGetDiff(
  config: Record<string, string>,
  input: Record<string, unknown>
) {
  const project = segment(input.project, "project");
  const hasSha = input.commit_sha !== undefined;
  const hasIid = input.mr_iid !== undefined;
  if (hasSha === hasIid) throw new Error("GitLab needs exactly one of commit_sha or mr_iid.");
  let path: string;
  if (hasSha) {
    const sha = input.commit_sha;
    if (typeof sha !== "string" || !/^[0-9a-fA-F]{7,40}$/.test(sha)) {
      throw new Error("GitLab commit_sha must be 7 to 40 hex characters.");
    }
    path = `projects/${project}/repository/commits/${sha}/diff`;
  } else {
    const iid = input.mr_iid;
    if (typeof iid !== "number" || !Number.isSafeInteger(iid) || iid < 1) {
      throw new Error("GitLab mr_iid must be a positive integer.");
    }
    path = `projects/${project}/merge_requests/${iid}/diffs`;
  }
  const filter = input.path === undefined ? undefined : requiredText(input.path, "path");
  const { data, nextPage } = await get<DiffRow[]>(config, path, { per_page: "100" });
  const morePages = nextPage !== null && nextPage !== "";
  const rows = filter
    ? data.filter((d) => d.new_path?.includes(filter) || d.old_path?.includes(filter))
    : data;
  const files: Record<string, unknown>[] = [];
  let budget = DIFF_MAX_TOTAL_BYTES;
  let truncated = false;
  let omitted = 0;
  for (const d of rows) {
    if (files.length >= DIFF_MAX_FILES || budget <= 0) {
      omitted++;
      continue;
    }
    const withheld = isSecretFile(d);
    const raw = !withheld && typeof d.diff === "string" ? d.diff : "";
    const { text, clipped } = clipBytes(raw, Math.min(DIFF_MAX_FILE_BYTES, budget));
    budget -= Buffer.byteLength(text, "utf8");
    if (clipped) truncated = true;
    const unavailable =
      !withheld && (d.too_large === true || (raw === "" && d.renamed_file !== true));
    files.push({
      old_path: d.old_path,
      new_path: d.new_path,
      new_file: d.new_file === true,
      deleted_file: d.deleted_file === true,
      renamed_file: d.renamed_file === true,
      diff: text,
      ...(clipped ? { diff_truncated: true } : {}),
      ...(unavailable ? { diff_unavailable: true } : {}),
      ...(withheld ? { diff_withheld: true } : {}),
    });
  }
  if (omitted > 0 || morePages) truncated = true;
  return {
    files,
    truncated,
    ...(omitted > 0 ? { files_omitted: omitted } : {}),
    // Only the first page of 100 files is read: files_omitted does not cover the rest.
    ...(morePages ? { more_pages: true } : {}),
  };
}
