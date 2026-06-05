// apps/web/app/api/mnemo/entities/[id]/route.ts
//
// Mnemosyne v1.6 G2 — single-entity surface.
//
//   GET   /api/mnemo/entities/[id] — fetch one + linked-fact count.
//   PATCH /api/mnemo/entities/[id] — rename, alias edits, kind change,
//                                    canonical_id (merge into another).
//
// 404 when the entity doesn't exist OR lives in another workspace
// (RLS already filters cross-tenant rows; the explicit check just
// gives a tighter error message).
//
// RBAC: viewer+ for GET, editor+ for PATCH.
import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq, sql } from "drizzle-orm";
import { schema } from "@orchester/db";
import { getEntity, updateEntity, withMnemoTx } from "@orchester/mnemosyne";
import { requireAuth, isAuthContext } from "@/lib/auth-guards";
import { parseBody } from "@/lib/validation";
import { logAudit } from "@/lib/audit";

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

  const result = await withMnemoTx(ctx.workspace.id, async (tx) => {
    const entity = await getEntity(ctx.workspace.id, id, tx);
    if (!entity) return null;

    // Cheap linked-fact count for the inspector header. A full list
    // is served by the sibling /facts route — here we just need the
    // header chip ("12 linked facts"). The partial index
    // `idx_mnemo_fact_entity` covers the (workspace_id, entity_id)
    // predicate; the count is constant-time enough at v1.6 scale.
    const countRows = (await tx.execute(sql`
      SELECT COUNT(*)::int AS total
      FROM mnemo_fact
      WHERE workspace_id = ${ctx.workspace.id}
        AND entity_id = ${id}
        AND status = 'active'
    `)) as unknown as Array<{ total: number }>;
    const linkedFactCount = countRows[0]?.total ?? 0;

    return { entity, linkedFactCount };
  });

  if (!result) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(result);
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
  // entity exists in this workspace. We use a direct schema.select
  // rather than getEntity so we can pull only the id column. RLS
  // gives us the workspace scope free of charge.
  if (body.canonicalId !== undefined && body.canonicalId !== null) {
    const canonExists = await withMnemoTx(ctx.workspace.id, async (tx) => {
      const rows = await tx
        .select({ id: schema.mnemoEntity.id })
        .from(schema.mnemoEntity)
        .where(
          and(
            eq(schema.mnemoEntity.id, body.canonicalId!),
            eq(schema.mnemoEntity.workspaceId, ctx.workspace.id)
          )
        )
        .limit(1);
      return rows.length > 0;
    });
    if (!canonExists) {
      return NextResponse.json({ error: "canonicalId target does not exist" }, { status: 400 });
    }
    if (body.canonicalId === id) {
      // An entity cannot be its own canonical (that's just the
      // canonical state — pass null instead).
      return NextResponse.json(
        { error: "canonicalId cannot equal the entity id" },
        { status: 400 }
      );
    }
  }

  const updated = await withMnemoTx(ctx.workspace.id, (tx) =>
    updateEntity({
      workspaceId: ctx.workspace.id,
      id,
      // Only spread defined keys under exactOptionalPropertyTypes.
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.kind !== undefined ? { kind: body.kind } : {}),
      ...(body.aliases !== undefined ? { aliases: body.aliases } : {}),
      ...(body.canonicalId !== undefined ? { canonicalId: body.canonicalId } : {}),
      ...(body.description !== undefined ? { description: body.description } : {}),
      ...(body.metadata !== undefined ? { metadata: body.metadata } : {}),
      tx,
    })
  );

  if (!updated) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
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

  return NextResponse.json(updated);
}
