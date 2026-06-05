// apps/web/app/api/mnemo/entities/[id]/route.ts
//
// Mnemosyne v1.6 G2 — single-entity surface.
//
//   GET   /api/mnemo/entities/[id] — fetch one + linked-fact count.
//   PATCH /api/mnemo/entities/[id] — rename, alias edits, kind change,
//                                    canonical_id (merge into another).
//
// As of the service-extraction Phase 2 (tramo 1), GET delegates to
// `getWorkspaceEntity()` which picks the data source at runtime
// (service vs library). PATCH stays on the in-process path — writes
// haven't shipped upstream yet (tramo 2). `X-Mnemo-Mode` is set on
// the GET response.
//
// 404 when the entity doesn't exist OR lives in another workspace
// (RLS already filters cross-tenant rows; the explicit check just
// gives a tighter error message).
//
// RBAC: viewer+ for GET, editor+ for PATCH.
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, isAuthContext } from "@/lib/auth-guards";
import { parseBody } from "@/lib/validation";
import { logAudit } from "@/lib/audit";
import {
  getWorkspaceEntity,
  updateWorkspaceEntity,
  workspaceEntityExists,
} from "@/lib/mnemo/entities";

export const dynamic = "force-dynamic";

const patchEntitySchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  kind: z.enum(["person", "organization", "project", "concept", "place", "other"]).optional(),
  aliases: z.array(z.string().trim().min(1).max(200)).max(50).optional(),
  // canonical_id is the merge knob: set to another entity's id to mark
  // this one as a redirect, set to null to mark it canonical again.
  canonicalId: z.string().trim().min(1).max(100).nullable().optional(),
  description: z.string().max(2000).nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuth({ minRole: "viewer" });
  if (!isAuthContext(ctx)) return ctx;

  const { id } = await params;
  // Cheap guard — the cuid2 prefix is `ment_`. We don't hard-validate
  // (a clean 404 is plenty) but we reject obviously empty ids.
  if (!id || id.length < 4) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  try {
    const { mode, data } = await getWorkspaceEntity(ctx.workspace.id, id);
    if (!data) {
      return NextResponse.json(
        { error: "Not found" },
        { status: 404, headers: { "X-Mnemo-Mode": mode } }
      );
    }
    return NextResponse.json(data, { headers: { "X-Mnemo-Mode": mode } });
  } catch (e) {
    console.error("[mnemo/entities/:id] fetch failed", e);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuth({ minRole: "editor" });
  if (!isAuthContext(ctx)) return ctx;
  const { id } = await params;

  const parsed = await parseBody(req, patchEntitySchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  // Empty patch → 400. Cheaper to error early than to issue a no-op
  // UPDATE that bumps updatedAt.
  if (
    body.name === undefined &&
    body.kind === undefined &&
    body.aliases === undefined &&
    body.canonicalId === undefined &&
    body.description === undefined &&
    body.metadata === undefined
  ) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  // Sanity check: if the patch sets `canonicalId`, verify the target
  // entity exists in this workspace and isn't the row being patched.
  // The check happens on the orchester side regardless of mode — in
  // service mode it's a getEntity round-trip; in library mode it's a
  // 1-row select. Both produce the same 400 contract so any caller
  // that depended on the message text keeps working.
  if (body.canonicalId !== undefined && body.canonicalId !== null) {
    if (body.canonicalId === id) {
      // An entity cannot be its own canonical (that's just the
      // canonical state — pass null instead).
      return NextResponse.json(
        { error: "canonicalId cannot equal the entity id" },
        { status: 400 }
      );
    }
    const canonExists = await workspaceEntityExists(ctx.workspace.id, body.canonicalId);
    if (!canonExists) {
      return NextResponse.json({ error: "canonicalId target does not exist" }, { status: 400 });
    }
  }

  try {
    const { mode, data: updated } = await updateWorkspaceEntity(ctx.workspace.id, id, {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.kind !== undefined ? { kind: body.kind } : {}),
      ...(body.aliases !== undefined ? { aliases: body.aliases } : {}),
      ...(body.canonicalId !== undefined ? { canonicalId: body.canonicalId } : {}),
      ...(body.description !== undefined ? { description: body.description } : {}),
      ...(body.metadata !== undefined ? { metadata: body.metadata } : {}),
    });

    if (!updated) {
      return NextResponse.json(
        { error: "Not found" },
        { status: 404, headers: { "X-Mnemo-Mode": mode } }
      );
    }

    await logAudit({
      workspaceId: ctx.workspace.id,
      userId: ctx.user.id,
      action: "mnemo.entity.update",
      resource: "mnemo_entity",
      resourceId: updated.id,
      after: {
        fieldsTouched: Object.keys(body),
      },
    });

    return NextResponse.json(updated, { headers: { "X-Mnemo-Mode": mode } });
  } catch (e) {
    console.error("[mnemo/entities/:id] update failed", e);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
