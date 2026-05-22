import { NextResponse } from "next/server";
import { createId } from "@paralleldrive/cuid2";
import { getDb, schema } from "@orchester/db";
import { eq, and } from "drizzle-orm";
import { getCurrentSession, getCurrentWorkspace } from "@/lib/workspace";
import { encrypt, maskKey, decrypt } from "@/lib/encryption";
import { logAudit } from "@/lib/audit";

function safeDecrypt(s: string): string {
  try {
    return decrypt(s);
  } catch {
    return "";
  }
}

/** En self-host con ANTHROPIC_API_KEY/OPENAI_API_KEY/GOOGLE_AI_API_KEY en .env,
 * tratamos esos providers como configurados aunque no haya filas en DB. */
function envFallbackProviders(): Array<{ provider: string; source: "env" }> {
  const out: Array<{ provider: string; source: "env" }> = [];
  if (process.env["ANTHROPIC_API_KEY"]) out.push({ provider: "anthropic", source: "env" });
  if (process.env["OPENAI_API_KEY"]) out.push({ provider: "openai", source: "env" });
  if (process.env["GOOGLE_AI_API_KEY"]) out.push({ provider: "google", source: "env" });
  return out;
}

export async function GET(req: Request) {
  const ws = await getCurrentWorkspace();
  if (!ws) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.aiProviders)
    .where(eq(schema.aiProviders.workspaceId, ws.workspace.id));
  const dbProviders = rows.map((r) => ({
    id: r.id,
    provider: r.provider,
    apiKeyMasked: maskKey(safeDecrypt(r.apiKey)),
    endpoint: r.endpoint,
    enabled: r.enabled,
    models: r.modelsJson ?? [],
    lastTestedAt: r.lastTestedAt,
    lastTestStatus: r.lastTestStatus,
    lastTestError: r.lastTestError,
    source: "db" as const,
  }));

  // ?summary=1 → forma compacta usada por NoProviderBanner.
  const url = new URL(req.url);
  if (url.searchParams.get("summary") === "1") {
    const envProvs = envFallbackProviders();
    // ¿Existe al menos un mensaje histórico? Si la cuenta tiene actividad y
    // ningún provider activo, el banner debe gritar más fuerte.
    const msg = await db
      .select({ id: schema.messages.id })
      .from(schema.messages)
      .innerJoin(
        schema.conversations,
        eq(schema.messages.conversationId, schema.conversations.id)
      )
      .where(eq(schema.conversations.workspaceId, ws.workspace.id))
      .limit(1);
    const configured = dbProviders.length > 0 || envProvs.length > 0;
    return NextResponse.json({
      configured,
      sources: [
        ...dbProviders.map((p) => ({ provider: p.provider, source: "db" })),
        ...envProvs,
      ],
      hasHistoricalActivity: msg.length > 0,
    });
  }

  return NextResponse.json(dbProviders);
}

export async function POST(req: Request) {
  const session = await getCurrentSession();
  const ws = await getCurrentWorkspace();
  if (!ws || !session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json();
  const { provider, apiKey, endpoint } = body as {
    provider: string;
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
    // No loguear la key, sólo el provider y el masked.
    await logAudit({
      workspaceId: ws.workspace.id,
      userId: session.user.id,
      action: "provider.update",
      resource: "ai_provider",
      resourceId: row.id,
      after: { provider: row.provider, apiKeyMasked: maskKey(apiKey.trim()) },
    });
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
  await logAudit({
    workspaceId: ws.workspace.id,
    userId: session.user.id,
    action: "provider.create",
    resource: "ai_provider",
    resourceId: row.id,
    after: { provider: row.provider, apiKeyMasked: maskKey(apiKey.trim()) },
  });
  return NextResponse.json({ id: row.id, provider: row.provider }, { status: 201 });
}
