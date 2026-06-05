// apps/web/app/api/mnemo/entities/route.ts
//
// Mnemosyne v1.6 G2 — entity browser surface.
//
//   GET  /api/mnemo/entities       — list entities (kind / q / limit).
//   POST /api/mnemo/entities       — manual create (editor+).
//
// As of the service-extraction Phase 2 (tramo 1), GET delegates to
// `listWorkspaceEntities()` which picks the data source at runtime:
//   - service mode (preferred): HTTPS round-trip to @mnemosyne/server
//     via `client.listEntities()`, when `MNEMO_URL` + `MNEMO_API_KEY`
//     are set;
//   - library mode (legacy fallback): in-process via `listEntities()`
//     under `withMnemoTx(workspace.id)`.
//
// POST stays on the in-process path — writes haven't shipped upstream
// yet (tramo 2 ships them). RBAC + RLS semantics are preserved
// verbatim either way.
//
// The `X-Mnemo-Mode` response header surfaces which path served GET
// — strictly operational, lets `curl -I` confirm a deploy is using
// the service path.
//
// RBAC: viewer+ for GET, editor+ for POST.
// RLS: writes go through `withMnemoTx(workspace.id, ...)` so
// `app.workspace_id` is set and the role is downgraded to app_user
// — the FORCE policies on mnemo_entity (migration 0039) prevent
// cross-tenant leakage even if the connection role has BYPASSRLS.
import { NextResponse } from "next/server";
import { z } from "zod";
import type { EntityKind } from "@mnemosyne/core";
import { requireAuth, isAuthContext } from "@/lib/auth-guards";
import { parseBody } from "@/lib/validation";
import { logAudit } from "@/lib/audit";
import { createWorkspaceEntity, listWorkspaceEntities } from "@/lib/mnemo/entities";

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

  try {
    const { mode, data } = await listWorkspaceEntities(ctx.workspace.id, {
      // exactOptionalPropertyTypes: only spread keys whose values are
      // defined so undefined never lands on a property typed as
      // `EntityKind | undefined` / `string | undefined`.
      ...(kindRaw ? { kind: kindRaw as EntityKind } : {}),
      ...(q && q.trim().length > 0 ? { q } : {}),
      limit,
    });
    return NextResponse.json(data, { headers: { "X-Mnemo-Mode": mode } });
  } catch (e) {
    console.error("[mnemo/entities] list failed", e);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const ctx = await requireAuth({ minRole: "editor" });
  if (!isAuthContext(ctx)) return ctx;

  const parsed = await parseBody(req, createEntitySchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  try {
    const { mode, data: created } = await createWorkspaceEntity(ctx.workspace.id, {
      name: body.name,
      kind: body.kind,
      // Pre-tramo-2 the route silently materialized [] for aliases;
      // we preserve that semantic so the audit log entry below keeps
      // its old shape.
      aliases: body.aliases ?? [],
      ...(body.description !== undefined ? { description: body.description } : {}),
      ...(body.metadata !== undefined ? { metadata: body.metadata } : {}),
    });

    // Audit-log entry is the same regardless of mode — the wire
    // payload mirrors the legacy lib-mode body so existing audit
    // tooling keeps parsing it.
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

    return NextResponse.json(created, {
      status: 201,
      headers: { "X-Mnemo-Mode": mode },
    });
  } catch (e) {
    console.error("[mnemo/entities] create failed", e);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
