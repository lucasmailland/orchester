import "server-only";
import { createId } from "@paralleldrive/cuid2";
import { getDb, schema } from "@orchester/db";
import { and, eq } from "drizzle-orm";
import { encrypt, decrypt } from "@/lib/encryption";
import { getConnector } from "./registry";

/** Lee y desencripta la config de una integración. */
export async function loadIntegration(
  workspaceId: string,
  integrationId: string
): Promise<{ id: string; type: string; name: string; config: Record<string, string>; enabled: boolean } | null> {
  const db = getDb();
  const row = (
    await db
      .select()
      .from(schema.workspaceIntegrations)
      .where(
        and(
          eq(schema.workspaceIntegrations.id, integrationId),
          eq(schema.workspaceIntegrations.workspaceId, workspaceId)
        )
      )
      .limit(1)
  )[0];
  if (!row) return null;
  let config: Record<string, string> = {};
  try {
    config = JSON.parse(decrypt(row.configEncrypted));
  } catch {
    /* corrupto → vacío */
  }
  return { id: row.id, type: row.type, name: row.name, config, enabled: row.enabled };
}

/** Lista integraciones del workspace SIN credenciales (seguro para UI). */
export async function listIntegrations(workspaceId: string) {
  const db = getDb();
  const rows = await db
    .select({
      id: schema.workspaceIntegrations.id,
      type: schema.workspaceIntegrations.type,
      name: schema.workspaceIntegrations.name,
      meta: schema.workspaceIntegrations.meta,
      enabled: schema.workspaceIntegrations.enabled,
      status: schema.workspaceIntegrations.status,
      lastTestedAt: schema.workspaceIntegrations.lastTestedAt,
      lastError: schema.workspaceIntegrations.lastError,
      createdAt: schema.workspaceIntegrations.createdAt,
    })
    .from(schema.workspaceIntegrations)
    .where(eq(schema.workspaceIntegrations.workspaceId, workspaceId));
  return rows;
}

/** Crea o actualiza una integración, encriptando la config y testeando. */
export async function upsertIntegration(args: {
  workspaceId: string;
  id?: string;
  type: string;
  name: string;
  config: Record<string, string>;
}): Promise<{ id: string; status: string; error?: string; meta?: Record<string, unknown> }> {
  const connector = getConnector(args.type);
  if (!connector) throw new Error(`Connector desconocido: ${args.type}`);

  const test = await connector.test(args.config);
  const status = test.ok ? "connected" : "error";
  const configEncrypted = encrypt(JSON.stringify(args.config));
  const db = getDb();
  const now = new Date();

  if (args.id) {
    await db
      .update(schema.workspaceIntegrations)
      .set({
        name: args.name,
        configEncrypted,
        meta: test.meta ?? {},
        status,
        lastTestedAt: now,
        lastError: test.ok ? null : (test.error ?? "test falló"),
        updatedAt: now,
      })
      .where(
        and(
          eq(schema.workspaceIntegrations.id, args.id),
          eq(schema.workspaceIntegrations.workspaceId, args.workspaceId)
        )
      );
    return { id: args.id, status, ...(test.error ? { error: test.error } : {}), ...(test.meta ? { meta: test.meta } : {}) };
  }

  const id = createId();
  await db.insert(schema.workspaceIntegrations).values({
    id,
    workspaceId: args.workspaceId,
    type: args.type,
    name: args.name,
    configEncrypted,
    meta: test.meta ?? {},
    status,
    lastTestedAt: now,
    lastError: test.ok ? null : (test.error ?? "test falló"),
  });
  // Webhook out: avisar que se conectó una integración (best-effort).
  if (test.ok) {
    const { dispatchEvent } = await import("@/lib/webhooks-out");
    void dispatchEvent(args.workspaceId, "integration.connected", {
      integrationId: id,
      type: args.type,
      name: args.name,
    });
  }
  return { id, status, ...(test.error ? { error: test.error } : {}), ...(test.meta ? { meta: test.meta } : {}) };
}

/** Re-testea una integración existente y actualiza su estado. */
export async function testIntegration(
  workspaceId: string,
  integrationId: string
): Promise<{ ok: boolean; error?: string; meta?: Record<string, unknown> }> {
  const loaded = await loadIntegration(workspaceId, integrationId);
  if (!loaded) throw new Error("Integración no encontrada");
  const connector = getConnector(loaded.type);
  if (!connector) throw new Error("Connector desconocido");
  const result = await connector.test(loaded.config);
  const db = getDb();
  await db
    .update(schema.workspaceIntegrations)
    .set({
      status: result.ok ? "connected" : "error",
      lastTestedAt: new Date(),
      lastError: result.ok ? null : (result.error ?? "test falló"),
      meta: result.meta ?? {},
    })
    .where(eq(schema.workspaceIntegrations.id, integrationId));
  return result;
}

export async function deleteIntegration(workspaceId: string, integrationId: string): Promise<void> {
  const db = getDb();
  await db
    .delete(schema.workspaceIntegrations)
    .where(
      and(
        eq(schema.workspaceIntegrations.id, integrationId),
        eq(schema.workspaceIntegrations.workspaceId, workspaceId)
      )
    );
}

/** Ejecuta una acción de una integración configurada (usado por tools de agente). */
export async function runIntegrationAction(
  workspaceId: string,
  integrationId: string,
  actionKey: string,
  input: Record<string, unknown>
): Promise<unknown> {
  const loaded = await loadIntegration(workspaceId, integrationId);
  if (!loaded) throw new Error("Integración no encontrada");
  if (!loaded.enabled) throw new Error("Integración deshabilitada");
  const connector = getConnector(loaded.type);
  if (!connector) throw new Error("Connector desconocido");
  const action = connector.actions[actionKey];
  if (!action) throw new Error(`Acción desconocida: ${actionKey}`);
  return action.run(loaded.config, input);
}
