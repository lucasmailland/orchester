// apps/web/app/api/mnemo/episodes/route.ts
//
// GET /api/mnemo/episodes — list `mnemo_episode` rows (Mnemosyne v1.4)
// in a date window, optionally filtered by topic. Powers the timeline
// UI in the Inspector.
//
// Query params:
//   ?from=ISO        (default: now - 30d)
//   ?to=ISO          (default: now)
//   ?topic=string    (single-topic filter via GIN-indexed `topics`)
//   ?limit=50        (default 50, max 200)
//
// The handler delegates to `listWorkspaceEpisodes()`, which calls
// the @mnemosyne/server SDK. The mnemosyne service scopes every
// episode lookup to the API-key workspace, so cross-tenant reads
// are impossible at the service boundary.
//
// RBAC: member+ (same as the rest of the read-side Inspector surface).
import { NextResponse } from "next/server";
import { requireAuth, isAuthContext } from "@/lib/auth-guards";
import { listWorkspaceEpisodes } from "@/lib/mnemo/episodes";

export const dynamic = "force-dynamic";

/**
 * Parse an ISO date string. Returns null on invalid input so the caller
 * can fall back to the default window. We deliberately accept anything
 * that `new Date()` accepts — too strict a parser would block valid
 * timezone-suffixed strings.
 */
function parseIsoDate(raw: string | null): Date | null {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isFinite(d.getTime()) ? d : null;
}

export async function GET(req: Request) {
  // `member` doesn't exist in the role enum (viewer/editor/admin/owner);
  // the brief asks for `minRole: 'member'` which maps to `viewer` (the
  // baseline "can read this workspace" role). We match the rest of the
  // mnemo read-side surface (facts list = viewer).
  const ctx = await requireAuth({ minRole: "viewer" });
  if (!isAuthContext(ctx)) return ctx;

  const url = new URL(req.url);
  const from = parseIsoDate(url.searchParams.get("from")) ?? undefined;
  const to = parseIsoDate(url.searchParams.get("to")) ?? undefined;
  const topicRaw = url.searchParams.get("topic");
  const topic = topicRaw && topicRaw.trim().length > 0 ? topicRaw.trim() : undefined;

  const limitRaw = Number(url.searchParams.get("limit") ?? "50");
  const limit =
    Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(Math.floor(limitRaw), 200) : 50;

  try {
    const { mode, data } = await listWorkspaceEpisodes(ctx.workspace.id, {
      // exactOptionalPropertyTypes — only spread defined keys.
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
      ...(topic ? { topic } : {}),
      limit,
    });
    return NextResponse.json(data, { headers: { "X-Mnemo-Mode": mode } });
  } catch (e) {
    console.error("[mnemo/episodes] list failed", e);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
