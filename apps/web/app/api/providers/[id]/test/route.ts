import { NextResponse } from "next/server";
import { getDb, schema } from "@orchester/db";
import { eq, and } from "drizzle-orm";
import { requireAuth, isAuthContext } from "@/lib/auth-guards";
import { decrypt } from "@/lib/encryption";
import { testProviderConnection } from "@/lib/providers";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuth({ minRole: "admin" });
  if (!isAuthContext(ctx)) return ctx;
  const { id } = await params;
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.aiProviders)
    .where(and(eq(schema.aiProviders.id, id), eq(schema.aiProviders.workspaceId, ctx.workspace.id)))
    .limit(1);
  const row = rows[0];
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const apiKey = decrypt(row.apiKey);
  const result = await testProviderConnection(row.provider, apiKey, row.endpoint);
  await db
    .update(schema.aiProviders)
    .set({
      lastTestedAt: new Date(),
      lastTestStatus: result.ok ? "ok" : "error",
      lastTestError: result.ok ? null : result.error ?? "Unknown error",
      modelsJson: result.ok ? result.models ?? [] : row.modelsJson,
    })
    .where(eq(schema.aiProviders.id, row.id));

  return NextResponse.json(result);
}
