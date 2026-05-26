// apps/web/app/api/mnemo/settings/route.ts
//
// GET /api/mnemo/settings  — load the workspace's recall-quality + tier
//                            settings (defaults shown in the UI).
// PATCH /api/mnemo/settings — partial update of one or more keys.
//
// Body for PATCH (all optional):
//   {
//     disableHyde?:    boolean,   // default false → HyDE ON
//     disableRerank?:  boolean,   // default false → rerank ON
//     disableGraph?:   boolean,   // default false → graph expansion ON
//     premiumEmbeddingProvider?: 'openai' | 'voyage' | 'cohere' | null,
//     premiumEmbeddingModel?:    string | null
//   }
//
// We store each kill-switch as its own `feature_flag` row (matches the
// existing pattern from `lib/settings/mnemo.ts`). The PATCH is partial:
// only keys present in the body are touched; everything else stays at
// its persisted value (or DEFAULT if it's never been set).
//
// RBAC: admin+ (the kill switches affect recall cost AND quality across
// the workspace — only an admin should flip them).

import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import { getDb, schema } from "@orchester/db";
import { requireAuth, isAuthContext } from "@/lib/auth-guards";
import { parseBody } from "@/lib/validation";
import { logAudit } from "@/lib/audit";
import { getMnemoSettings, MNEMO_SETTING_KEYS } from "@/lib/settings/mnemo";

export const dynamic = "force-dynamic";

const patchSchema = z
  .object({
    disableHyde: z.boolean().optional(),
    disableRerank: z.boolean().optional(),
    disableGraph: z.boolean().optional(),
    premiumEmbeddingProvider: z
      .union([z.enum(["openai", "voyage", "cohere"]), z.null()])
      .optional(),
    premiumEmbeddingModel: z.union([z.string().min(1).max(120), z.null()]).optional(),
  })
  .strict();

export async function GET() {
  const ctx = await requireAuth({ minRole: "admin" });
  if (!isAuthContext(ctx)) return ctx;

  const settings = await getMnemoSettings(ctx.workspace.id);
  return NextResponse.json({
    disableHyde: settings.disableHyde,
    disableRerank: settings.disableRerank,
    disableGraph: settings.disableGraph,
    premiumEmbeddingProvider: settings.premiumEmbeddingProvider ?? null,
    premiumEmbeddingModel: settings.premiumEmbeddingModel ?? null,
  });
}

export async function PATCH(req: Request) {
  const ctx = await requireAuth({ minRole: "admin" });
  if (!isAuthContext(ctx)) return ctx;

  const parsed = await parseBody(req, patchSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  const db = getDb();
  const wsId = ctx.workspace.id;
  const userId = ctx.user.id;
  const now = new Date();

  // Helper to upsert a boolean kill-switch row. Uses the existing
  // unique (workspace_id, flag_key) index so the ON CONFLICT path
  // only ever flips the `enabled` column.
  async function upsertBool(flagKey: string, enabled: boolean): Promise<void> {
    await db
      .insert(schema.featureFlags)
      .values({
        id: createId(),
        workspaceId: wsId,
        flagKey,
        enabled,
        setByUserId: userId,
        rolledOutAt: now,
      })
      .onConflictDoUpdate({
        target: [schema.featureFlags.workspaceId, schema.featureFlags.flagKey],
        set: {
          enabled,
          setByUserId: userId,
          rolledOutAt: now,
          updatedAt: now,
        },
      });
  }

  // Helper for the premium-embedding row which carries meta.
  async function upsertPremium(
    provider: "openai" | "voyage" | "cohere" | null,
    model: string | null
  ): Promise<void> {
    if (provider === null) {
      // Clear the override — set enabled=false so the read path falls
      // back to default-tier (workspace opted out of premium tiering).
      await db
        .insert(schema.featureFlags)
        .values({
          id: createId(),
          workspaceId: wsId,
          flagKey: MNEMO_SETTING_KEYS.PREMIUM_EMBEDDING,
          enabled: false,
          meta: {},
          setByUserId: userId,
          rolledOutAt: now,
        })
        .onConflictDoUpdate({
          target: [schema.featureFlags.workspaceId, schema.featureFlags.flagKey],
          set: {
            enabled: false,
            meta: {},
            setByUserId: userId,
            rolledOutAt: now,
            updatedAt: now,
          },
        });
      return;
    }
    // Provider + model both required to take effect — match the read
    // path's contract (only honored when BOTH are set).
    const meta: Record<string, unknown> = { provider };
    if (model) meta.model = model;
    await db
      .insert(schema.featureFlags)
      .values({
        id: createId(),
        workspaceId: wsId,
        flagKey: MNEMO_SETTING_KEYS.PREMIUM_EMBEDDING,
        enabled: true,
        meta,
        setByUserId: userId,
        rolledOutAt: now,
      })
      .onConflictDoUpdate({
        target: [schema.featureFlags.workspaceId, schema.featureFlags.flagKey],
        set: {
          enabled: true,
          meta,
          setByUserId: userId,
          rolledOutAt: now,
          updatedAt: now,
        },
      });
  }

  if (typeof body.disableHyde === "boolean") {
    await upsertBool(MNEMO_SETTING_KEYS.DISABLE_HYDE, body.disableHyde);
  }
  if (typeof body.disableRerank === "boolean") {
    await upsertBool(MNEMO_SETTING_KEYS.DISABLE_RERANK, body.disableRerank);
  }
  if (typeof body.disableGraph === "boolean") {
    await upsertBool(MNEMO_SETTING_KEYS.DISABLE_GRAPH, body.disableGraph);
  }
  if ("premiumEmbeddingProvider" in body || "premiumEmbeddingModel" in body) {
    // Pull current state and overlay only the fields touched, so a
    // PATCH that only sends `premiumEmbeddingModel` doesn't clear the
    // provider.
    const existing = await db
      .select({
        enabled: schema.featureFlags.enabled,
        meta: schema.featureFlags.meta,
      })
      .from(schema.featureFlags)
      .where(
        and(
          eq(schema.featureFlags.workspaceId, wsId),
          eq(schema.featureFlags.flagKey, MNEMO_SETTING_KEYS.PREMIUM_EMBEDDING)
        )
      )
      .limit(1);
    const existingMeta = (existing[0]?.meta as Record<string, unknown> | null) ?? {};
    const existingProvider =
      typeof existingMeta.provider === "string" &&
      ["openai", "voyage", "cohere"].includes(existingMeta.provider)
        ? (existingMeta.provider as "openai" | "voyage" | "cohere")
        : null;
    const existingModel =
      typeof existingMeta.model === "string" && existingMeta.model.length > 0
        ? existingMeta.model
        : null;
    const nextProvider =
      body.premiumEmbeddingProvider !== undefined
        ? body.premiumEmbeddingProvider
        : existingProvider;
    const nextModel =
      body.premiumEmbeddingModel !== undefined ? body.premiumEmbeddingModel : existingModel;
    await upsertPremium(nextProvider, nextModel);
  }

  await logAudit({
    workspaceId: wsId,
    userId,
    action: "mnemo.settings.update",
    resource: "mnemo_settings",
    resourceId: wsId,
    after: body as unknown as Record<string, unknown>,
  });

  // Return the resolved post-update view so the client can update its
  // local state without an extra GET round-trip.
  const updated = await getMnemoSettings(wsId);
  return NextResponse.json({
    disableHyde: updated.disableHyde,
    disableRerank: updated.disableRerank,
    disableGraph: updated.disableGraph,
    premiumEmbeddingProvider: updated.premiumEmbeddingProvider ?? null,
    premiumEmbeddingModel: updated.premiumEmbeddingModel ?? null,
  });
}
