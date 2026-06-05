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
// RBAC: member+ (same as the rest of the read-side Inspector surface).
//
// RLS: the read goes through `withMnemoTx(workspace.id, ...)` so the
// `app.workspace_id` GUC is set and the tx runs as `app_user` — the
// FORCE policies on mnemo_episode (migration 0034) prevent any cross-
// tenant leakage even if the connection role has BYPASSRLS.
import { NextResponse } from "next/server";
import { listEpisodes, withMnemoTx } from "@mnemosyne/core";
import { requireAuth, isAuthContext } from "@/lib/auth-guards";

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

  const items = await withMnemoTx(ctx.workspace.id, (tx) =>
    listEpisodes({
      workspaceId: ctx.workspace.id,
      // The package is built with exactOptionalPropertyTypes; only spread
      // keys whose values are defined so undefined never lands on a
      // property typed as `Date | undefined`.
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
      ...(topic ? { topic } : {}),
      limit,
      tx,
    })
  );

  return NextResponse.json({ items });
}
