// apps/web/app/api/mnemo/entities/route.ts
//
// Mnemosyne v1.6 G2 — entity browser surface.
//
//   GET  /api/mnemo/entities       — list entities (kind / q / limit).
//   POST /api/mnemo/entities       — manual create (editor+).
//
// Why a manual-create endpoint exists at all:
//   The extraction pipeline auto-creates entities via `findOrCreate`,
//   but the inspector also needs a way for a human to (a) bootstrap
//   the entity table before any conversation has happened ("set up
//   the canonical names ahead of the first onboarding chat") and
//   (b) backfill an entity discovered out-of-band ("CEO mentioned in
//   a doc we just imported").
//
// RBAC: viewer+ for GET, editor+ for POST. The list surface is read-
// only inspection; only editor+ can mutate state.
//
// RLS: every read/write goes through `withMnemoTx(workspace.id, ...)`
// so `app.workspace_id` is set and the role is downgraded to app_user
// — the FORCE policies on mnemo_entity (migration 0039) prevent
// cross-tenant leakage even if the connection role has BYPASSRLS.
import { NextResponse } from "next/server";
import { z } from "zod";
import { createEntity, listEntities, withMnemoTx, type EntityKind } from "@orchester/mnemosyne";
import { requireAuth, isAuthContext } from "@/lib/auth-guards";
import { parseBody } from "@/lib/validation";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

const ALLOWED_KINDS: ReadonlySet<EntityKind> = new Set([
  "person",
  "organization",
  "project",
  "concept",
  "place",
  "other",
]);

const createEntitySchema = z.object({
  // Canonical display name. Bound matches the SQL column (no length
  // constraint there, but we keep it reasonable for the UI). 1-200
  // gives plenty of room for "Acme Marketing, Inc. (Buenos Aires)".
  name: z.string().trim().min(1).max(200),
  kind: z.enum(["person", "organization", "project", "concept", "place", "other"]),
  // Aliases optional. Each one trimmed + capped at 200 chars; the
  // overall array capped at 50 to keep the GIN index sane.
  aliases: z.array(z.string().trim().min(1).max(200)).max(50).optional(),
  description: z.string().max(2000).nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export async function GET(req: Request) {
  const ctx = await requireAuth({ minRole: "viewer" });
  if (!isAuthContext(ctx)) return ctx;

  const url = new URL(req.url);
  const kindRaw = url.searchParams.get("kind");
  const q = url.searchParams.get("q") ?? undefined;
  const limitRaw = Number(url.searchParams.get("limit") ?? "50");
  const limit =
    Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(Math.floor(limitRaw), 200) : 50;

  if (kindRaw && !ALLOWED_KINDS.has(kindRaw as EntityKind)) {
    return NextResponse.json({ error: "Invalid kind" }, { status: 400 });
  }

  const items = await withMnemoTx(ctx.workspace.id, (tx) =>
    listEntities({
      workspaceId: ctx.workspace.id,
      // exactOptionalPropertyTypes: only spread keys whose values are
      // defined so undefined never lands on a property typed as
      // `EntityKind | undefined` / `string | undefined`.
      ...(kindRaw ? { kind: kindRaw as EntityKind } : {}),
      ...(q && q.trim().length > 0 ? { q } : {}),
      limit,
      tx,
    })
  );

  return NextResponse.json({ items });
}

export async function POST(req: Request) {
  const ctx = await requireAuth({ minRole: "editor" });
  if (!isAuthContext(ctx)) return ctx;

  const parsed = await parseBody(req, createEntitySchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  const created = await withMnemoTx(ctx.workspace.id, (tx) =>
    createEntity({
      workspaceId: ctx.workspace.id,
      name: body.name,
      kind: body.kind,
      aliases: body.aliases ?? [],
      // exactOptionalPropertyTypes guard: only forward `description`
      // when the caller supplied a value (including explicit null).
      ...(body.description !== undefined ? { description: body.description } : {}),
      ...(body.metadata !== undefined ? { metadata: body.metadata } : {}),
      tx,
    })
  );

  await logAudit({
    workspaceId: ctx.workspace.id,
    userId: ctx.user.id,
    action: "mnemo.entity.create",
    resource: "mnemo_entity",
    resourceId: created.id,
    after: {
      name: created.name,
      kind: created.kind,
      aliases: created.aliases,
    },
  });

  return NextResponse.json(created, { status: 201 });
}
