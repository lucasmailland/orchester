// apps/web/app/api/mnemo/facts/route.ts
//
// GET /api/mnemo/facts — paginated, filterable fact list for the
// Memory Inspector UI. Routing/parsing/RBAC live here; the SDK
// round-trip to @mnemosyne/server lives in
// `lib/mnemo/facts.listWorkspaceFacts`. Supports FTS, keyset cursor,
// sortBy/order and bitemporal `asOf`. Response shape: `{items,
// nextCursor, total}`.
import { NextResponse } from "next/server";
import { requireAuth, isAuthContext } from "@/lib/auth-guards";
import { listWorkspaceFacts } from "@/lib/mnemo/facts";

export const dynamic = "force-dynamic";

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
const ALLOWED_SORT_BY = new Set(["created_at", "updated_at", "relevance", "hit_count"] as const);

export async function GET(req: Request) {
  const ctx = await requireAuth({ minRole: "viewer" });
  if (!isAuthContext(ctx)) return ctx;

  const url = new URL(req.url);
  const p = url.searchParams;

  // ── Filters ─────────────────────────────────────────────────────
  const kindParam = p.get("kind");
  const scopeParam = p.get("scope");
  const scopeRefParam = p.get("scopeRef");
  const pinnedParam = p.get("pinned");
  const statusParam = (p.get("status") ?? "active").toLowerCase();
  const qParam = p.get("q");

  // v1.6 G1-3: bitemporal asOf. Future dates are rejected — they would
  // always return zero rows and we don't want operators thinking memory
  // was empty just because they pasted tomorrow's date.
  const asOfParam = p.get("asOf");
  let asOfIso: string | null = null;
  if (asOfParam) {
    const parsed = new Date(asOfParam);
    if (Number.isNaN(parsed.getTime())) {
      return NextResponse.json({ error: "Invalid asOf timestamp" }, { status: 400 });
    }
    if (parsed.getTime() > Date.now()) {
      return NextResponse.json({ error: "asOf cannot be in the future" }, { status: 400 });
    }
    asOfIso = parsed.toISOString();
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
  const sortByParam = p.get("sortBy") ?? "updated_at";
  if (!ALLOWED_SORT_BY.has(sortByParam as never)) {
    return NextResponse.json({ error: "Invalid sortBy" }, { status: 400 });
  }
  const orderParam = (p.get("order") ?? "desc").toLowerCase();
  if (orderParam !== "asc" && orderParam !== "desc") {
    return NextResponse.json({ error: "Invalid order" }, { status: 400 });
  }
  const limitRaw = Number(p.get("limit") ?? "50");
  const limit =
    Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(Math.floor(limitRaw), 200) : 50;
  const cursorParam = p.get("cursor");

  const result = await listWorkspaceFacts(ctx.workspace.id, {
    ...(kindParam ? { kind: kindParam } : {}),
    ...(scopeParam ? { scope: scopeParam } : {}),
    ...(scopeRefParam ? { scopeRef: scopeRefParam } : {}),
    status: statusParam as "active" | "forgotten" | "merged" | "all",
    ...(pinnedParam === "true" ? { pinned: true } : {}),
    ...(pinnedParam === "false" ? { pinned: false } : {}),
    ...(qParam ? { q: qParam } : {}),
    sortBy: sortByParam as "created_at" | "updated_at" | "relevance" | "hit_count",
    order: orderParam,
    ...(cursorParam ? { cursor: cursorParam } : {}),
    ...(asOfIso ? { asOf: asOfIso } : {}),
    limit,
  });

  const res = NextResponse.json({
    items: result.items,
    nextCursor: result.nextCursor,
    total: result.total,
  });
  // Operator signal — lets us confirm at runtime which path served a
  // given request without enabling debug logs.
  res.headers.set("X-Mnemo-Mode", result.mode);
  return res;
}
