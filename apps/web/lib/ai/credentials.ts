import "server-only";
import { getDb, schema } from "@orchester/db";
import { eq, and } from "drizzle-orm";
import { decrypt } from "../encryption";
import { getProvider } from "./catalog";
import type { Cred } from "./capabilities";

export class ProviderNotConnectedError extends Error {
  constructor(public providerId: string) {
    super(`El proveedor "${providerId}" no está conectado. Agregá su API key en Ajustes.`);
    this.name = "ProviderNotConnectedError";
  }
}

/** Carga y desencripta la conexión de un proveedor para un workspace. */
export async function loadCredential(workspaceId: string, providerId: string): Promise<Cred> {
  // Proveedores locales (Ollama/LM Studio) apuntan a localhost del SERVIDOR.
  // En entornos compartidos sería un SSRF a la red interna: deshabilitados salvo
  // que el operador lo habilite explícitamente (self-host).
  const def = getProvider(providerId);
  if (def?.kind === "local" && process.env["ALLOW_LOCAL_AI_PROVIDERS"] !== "1") {
    throw new Error(
      `Los proveedores locales (${providerId}) están deshabilitados en este entorno. Habilitalos con ALLOW_LOCAL_AI_PROVIDERS=1.`
    );
  }
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.aiProviders)
    .where(
      and(
        eq(schema.aiProviders.workspaceId, workspaceId),
        eq(schema.aiProviders.provider, providerId)
      )
    )
    .limit(1);
  const row = rows[0];
  if (!row || !row.enabled) throw new ProviderNotConnectedError(providerId);
  return {
    apiKey: decrypt(row.apiKey),
    endpoint: row.endpoint ?? undefined,
    config: (row.config as Record<string, unknown>) ?? undefined,
  };
}

/** Lista los ids de proveedores conectados (habilitados) de un workspace. */
export async function listConnectedProviderIds(workspaceId: string): Promise<string[]> {
  const db = getDb();
  const rows = await db
    .select({ provider: schema.aiProviders.provider, enabled: schema.aiProviders.enabled })
    .from(schema.aiProviders)
    .where(eq(schema.aiProviders.workspaceId, workspaceId));
  return rows.filter((r) => r.enabled).map((r) => r.provider);
}
