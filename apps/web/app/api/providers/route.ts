import { NextResponse } from "next/server";
import { createId } from "@paralleldrive/cuid2";
import { getDb, schema } from "@orchester/db";
import { eq, and } from "drizzle-orm";
import { getCurrentWorkspace } from "@/lib/workspace";
import { encrypt, maskKey, decrypt } from "@/lib/encryption";

function safeDecrypt(s: string): string {
  try {
    return decrypt(s);
  } catch {
    return "";
  }
}

export async function GET() {
  const ws = await getCurrentWorkspace();
  if (!ws) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.aiProviders)
    .where(eq(schema.aiProviders.workspaceId, ws.workspace.id));
  return NextResponse.json(
    rows.map((r) => ({
      id: r.id,
      provider: r.provider,
      apiKeyMasked: maskKey(safeDecrypt(r.apiKey)),
      endpoint: r.endpoint,
      enabled: r.enabled,
      models: r.modelsJson ?? [],
      lastTestedAt: r.lastTestedAt,
      lastTestStatus: r.lastTestStatus,
      lastTestError: r.lastTestError,
    }))
  );
}

export async function POST(req: Request) {
  const ws = await getCurrentWorkspace();
  if (!ws) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json();
  const { provider, apiKey, endpoint } = body as {
    provider: "anthropic" | "openai" | "google" | "azure_openai";
    apiKey: string;
    endpoint?: string;
  };
  if (!provider || !apiKey?.trim())
    return NextResponse.json({ error: "provider and apiKey required" }, { status: 400 });

  const db = getDb();
  const existing = await db
    .select()
    .from(schema.aiProviders)
    .where(
      and(
        eq(schema.aiProviders.workspaceId, ws.workspace.id),
        eq(schema.aiProviders.provider, provider)
      )
    )
    .limit(1);

  const ciphertext = encrypt(apiKey.trim());
  if (existing[0]) {
    const updated = await db
      .update(schema.aiProviders)
      .set({ apiKey: ciphertext, endpoint: endpoint ?? null, updatedAt: new Date() })
      .where(eq(schema.aiProviders.id, existing[0].id))
      .returning();
    const row = updated[0];
    if (!row) return NextResponse.json({ error: "Update failed" }, { status: 500 });
    return NextResponse.json({ id: row.id, provider: row.provider });
  }
  const inserted = await db
    .insert(schema.aiProviders)
    .values({
      id: createId(),
      workspaceId: ws.workspace.id,
      provider,
      apiKey: ciphertext,
      endpoint: endpoint ?? null,
    })
    .returning();
  const row = inserted[0];
  if (!row) return NextResponse.json({ error: "Insert failed" }, { status: 500 });
  return NextResponse.json({ id: row.id, provider: row.provider }, { status: 201 });
}
