// apps/web/app/api/mnemo/facts/route.ts
//
// GET /api/mnemo/facts — paginated, filterable fact list for the v1.3
// Memory Inspector UI.
//
// Filters: kind, scope, scopeRef, pinned, status (active|forgotten|
// merged|all, default 'active'), q (FTS), sortBy (created_at|updated_
// at|relevance|hit_count, default 'updated_at'), order (asc|desc,
// default 'desc'), limit (default 50, max 200), cursor (opaque
// base64-of-{id, sortValue} for keyset pagination).
//
// Keyset pagination: faster than OFFSET at scale (the inspector will
// page through tens of thousands of facts on big workspaces). The
// cursor encodes the LAST item's `(sortValue, id)` tuple; the next
// page is `WHERE (sortValue, id) [< or >] cursor` based on `order`.
//
// RLS: every read goes through `withMnemoTx(workspaceId, ...)` so
// `app.workspace_id` is set and the role is downgraded to app_user.
import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { withMnemoTx } from "@mnemosyne/core";
import { requireAuth, isAuthContext } from "@/lib/auth-guards";

export const dynamic = "force-dynamic";

// Whitelist of allowed sort columns — we splice these into the SQL
// directly so they MUST be checked against this set (no user input
// reaches a raw SQL identifier).
const SORT_COLUMNS = {
  created_at: "f.created_at",
  updated_at: "f.updated_at",
  relevance: "f.relevance",
  hit_count: "f.hit_count",
} as const;
type SortBy = keyof typeof SORT_COLUMNS;

const ALLOWED_KINDS = new Set([
  "preference",
  "trait",
  "event",
  "relationship",
  "skill",
  "concern",
  "other",
]);
const ALLOWED_SCOPES = new Set(["global", "conversation", "employee", "team"]);
const ALLOWED_STATUS = new Set(["active", "forgotten", "merged", "all"]);

interface CursorPayload {
  /** The sort column value at the cursor row. ISO string for
   *  timestamps, number for relevance/hit_count. */
  v: string | number;
  /** Tiebreaker — the row id at the cursor. */
  id: string;
}

function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decodeCursor(raw: string | null): CursorPayload | null {
  if (!raw) return null;
  try {
    const json = Buffer.from(raw, "base64url").toString("utf8");
    const obj = JSON.parse(json) as Partial<CursorPayload>;
    if ((typeof obj.v === "string" || typeof obj.v === "number") && typeof obj.id === "string") {
      return { v: obj.v, id: obj.id };
    }
  } catch {
    // Malformed cursors map to "ignore, start from the top".
  }
  return null;
}

export async function GET(req: Request) {
  const ctx = await requireAuth({ minRole: "viewer" });
  if (!isAuthContext(ctx)) return ctx;

  const url = new URL(req.url);
  const params = url.searchParams;

  // ── Filters ─────────────────────────────────────────────────────
  const kindParam = params.get("kind");
  const scopeParam = params.get("scope");
  const scopeRefParam = params.get("scopeRef");
  const pinnedParam = params.get("pinned"); // "true" | "false" | null
  const statusParam = (params.get("status") ?? "active").toLowerCase();
  const qParam = params.get("q");

  // v1.6 G1-3: bitemporal `asOf` query parameter. When provided we
  // filter to facts whose `[valid_from, valid_to)` bitemporal interval
  // contains `asOf` — i.e. the snapshot of memory at that instant.
  // Same semantics as `searchMnemo({ asOf })`. Future dates are
  // rejected — they would always return zero rows and we don't want
  // operators thinking memory was empty just because they pasted
  // tomorrow's date.
  const asOfParam = params.get("asOf");
  let asOfDate: Date | null = null;
  if (asOfParam) {
    const parsed = new Date(asOfParam);
    if (Number.isNaN(parsed.getTime())) {
      return NextResponse.json({ error: "Invalid asOf timestamp" }, { status: 400 });
    }
    if (parsed.getTime() > Date.now()) {
      return NextResponse.json({ error: "asOf cannot be in the future" }, { status: 400 });
    }
    asOfDate = parsed;
  }

  if (kindParam && !ALLOWED_KINDS.has(kindParam)) {
    return NextResponse.json({ error: "Invalid kind" }, { status: 400 });
  }
  if (scopeParam && !ALLOWED_SCOPES.has(scopeParam)) {
    return NextResponse.json({ error: "Invalid scope" }, { status: 400 });
  }
  if (!ALLOWED_STATUS.has(statusParam)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }

  // ── Sort + pagination ───────────────────────────────────────────
  const sortByParam = (params.get("sortBy") ?? "updated_at") as SortBy;
  if (!(sortByParam in SORT_COLUMNS)) {
    return NextResponse.json({ error: "Invalid sortBy" }, { status: 400 });
  }
  const orderParam = (params.get("order") ?? "desc").toLowerCase();
  if (orderParam !== "asc" && orderParam !== "desc") {
    return NextResponse.json({ error: "Invalid order" }, { status: 400 });
  }
  const isDesc = orderParam === "desc";

  const limitRaw = Number(params.get("limit") ?? "50");
  const limit =
    Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(Math.floor(limitRaw), 200) : 50;
  const cursor = decodeCursor(params.get("cursor"));

  // ── WHERE assembly ──────────────────────────────────────────────
  // We build with drizzle's sql tagged-template helper so the user
  // strings stay parameterised — no raw concatenation.
  const conds = [sql`f.workspace_id = ${ctx.workspace.id}`];
  if (statusParam !== "all") {
    conds.push(sql`f.status = ${statusParam}`);
  }
  // v1.6 G1-3: bitemporal snapshot filter. Matches the SQL used in
  // `searchMnemo` so the Inspector and the runtime recall agree on
  // what existed at that instant.
  if (asOfDate) {
    conds.push(
      sql`f.valid_from <= ${asOfDate} AND (f.valid_to IS NULL OR f.valid_to > ${asOfDate})`
    );
  }
  if (kindParam) conds.push(sql`f.kind = ${kindParam}`);
  if (scopeParam) conds.push(sql`f.scope = ${scopeParam}`);
  if (scopeRefParam) conds.push(sql`f.scope_ref = ${scopeRefParam}`);
  if (pinnedParam === "true") conds.push(sql`f.pinned = true`);
  if (pinnedParam === "false") conds.push(sql`f.pinned = false`);
  if (qParam && qParam.trim().length > 0) {
    // FTS hit on the lemmatized column when present; falls back to
    // ILIKE on statement when the column is null (Mode A).
    conds.push(sql`
      (
        (f.text_lemmatized IS NOT NULL
         AND f.text_lemmatized @@ plainto_tsquery('simple', ${qParam}))
        OR f.statement ILIKE ${"%" + qParam + "%"}
      )
    `);
  }

  // Cursor predicate: keyset pagination requires the (sort_col, id)
  // tuple comparison. Bind the cursor value as a *parameter* (passed
  // via drizzle's sql tagged-template — no string concat) and cast
  // it server-side to the sort column's type. Postgres tuple
  // comparison handles the comparator atomically.
  if (cursor) {
    const sortColumn = sql.raw(SORT_COLUMNS[sortByParam]);
    const isTimestamp = sortByParam === "created_at" || sortByParam === "updated_at";
    // `cursor.v` arrives as string-or-number (decoded from JSON inside
    // the user-controlled cursor). We bind it as a parameter so even
    // a malicious cursor cannot escape into raw SQL.
    const cursorValue = isTimestamp ? String(cursor.v) : Number(cursor.v);
    if (isDesc) {
      conds.push(
        isTimestamp
          ? sql`(${sortColumn}, f.id) < (${cursorValue}::timestamptz, ${cursor.id})`
          : sql`(${sortColumn}, f.id) < (${cursorValue}::double precision, ${cursor.id})`
      );
    } else {
      conds.push(
        isTimestamp
          ? sql`(${sortColumn}, f.id) > (${cursorValue}::timestamptz, ${cursor.id})`
          : sql`(${sortColumn}, f.id) > (${cursorValue}::double precision, ${cursor.id})`
      );
    }
  }

  const whereSql = sql.join(conds, sql` AND `);
  // For the count query we want the filter set WITHOUT the cursor —
  // the inspector header should show the total matching the filters,
  // not just the rows on this page.
  const filterCondsLen = cursor ? conds.length - 1 : conds.length;
  const filterOnlyConds = conds.slice(0, filterCondsLen);
  const countWhereSql = sql.join(filterOnlyConds, sql` AND `);
  const orderSql = sql.raw(
    `${SORT_COLUMNS[sortByParam]} ${isDesc ? "DESC" : "ASC"}, f.id ${isDesc ? "DESC" : "ASC"}`
  );

  // ── Query ───────────────────────────────────────────────────────
  // v1.6: surface the cognitive columns (memory_type, attribution,
  // actor_id, entity_id, protocol_version) so the Inspector's
  // `FactRow` can render the chips and the detail panel can show
  // the cognitive provenance without a follow-up call.
  type Row = {
    id: string;
    workspace_id: string;
    agent_id: string | null;
    scope: string;
    scope_ref: string | null;
    kind: string;
    subject: string;
    statement: string;
    confidence: number;
    pinned: boolean;
    relevance: number;
    hit_count: number;
    last_recalled_at: Date | null;
    source_message_ids: string[];
    attributed_to: string | null;
    metadata: Record<string, unknown>;
    status: string;
    created_at: Date;
    updated_at: Date;
    memory_type: string;
    attribution: string;
    actor_id: string | null;
    entity_id: string | null;
    protocol_version: string;
  };

  const { items, total } = await withMnemoTx(ctx.workspace.id, async (tx) => {
    const rows = (await tx.execute(sql`
      SELECT
        f.id, f.workspace_id, f.agent_id, f.scope, f.scope_ref, f.kind,
        f.subject, f.statement, f.confidence, f.pinned, f.relevance,
        f.hit_count, f.last_recalled_at, f.source_message_ids,
        f.attributed_to, f.metadata, f.status, f.created_at, f.updated_at,
        f.memory_type, f.attribution, f.actor_id, f.entity_id,
        f.protocol_version
      FROM mnemo_fact f
      WHERE ${whereSql}
      ORDER BY ${orderSql}
      LIMIT ${limit + 1}
    `)) as unknown as Row[];

    // Cheap total — useful for the UI's "X facts" header. Same
    // filter set, MINUS the cursor predicate (we want the full
    // result-set count, not just rows past the cursor).
    const totalRows = (await tx.execute(sql`
      SELECT COUNT(*)::int AS total
      FROM mnemo_fact f
      WHERE ${countWhereSql}
    `)) as unknown as Array<{ total: number }>;

    return { items: rows, total: totalRows[0]?.total ?? 0 };
  });

  // Slice off the lookahead row to decide the cursor.
  const hasMore = items.length > limit;
  const page = hasMore ? items.slice(0, limit) : items;
  let nextCursor: string | null = null;
  if (hasMore) {
    const last = page[page.length - 1]!;
    // `tx.execute(sql\`…\`)` returns column values as raw strings for
    // timestamp columns (drizzle's typed query builder coerces to Date,
    // but `execute(sql\`...\`)` does not). Wrapping with `new Date(...)`
    // is safe for both string and Date inputs — without it, the
    // `.toISOString()` call below throws TypeError on every hasMore=true
    // response and the route 500s with an empty body. That was the
    // mysterious 500 the v1.6 UI audit caught on fact-detail pages
    // (`?id=…&limit=1` → LIMIT 2 → hasMore=true → throw).
    const colValue =
      sortByParam === "created_at"
        ? new Date(last.created_at).toISOString()
        : sortByParam === "updated_at"
          ? new Date(last.updated_at).toISOString()
          : sortByParam === "relevance"
            ? Number(last.relevance)
            : Number(last.hit_count);
    nextCursor = encodeCursor({ v: colValue, id: last.id });
  }

  return NextResponse.json({
    items: page.map((r) => ({
      id: r.id,
      workspaceId: r.workspace_id,
      agentId: r.agent_id,
      scope: r.scope,
      scopeRef: r.scope_ref,
      kind: r.kind,
      subject: r.subject,
      statement: r.statement,
      confidence: Number(r.confidence),
      pinned: r.pinned,
      relevance: Number(r.relevance),
      hitCount: Number(r.hit_count),
      lastRecalledAt: r.last_recalled_at,
      sourceMessageIds: r.source_message_ids,
      attributedTo: r.attributed_to,
      metadata: r.metadata ?? {},
      status: r.status,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      // v1.6 cognitive surface — let the Inspector render chips
      // without a follow-up call.
      memoryType: r.memory_type,
      attribution: r.attribution,
      actorId: r.actor_id,
      entityId: r.entity_id,
      protocolVersion: r.protocol_version,
    })),
    nextCursor,
    total,
  });
}
