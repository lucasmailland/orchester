import { pgTable, text, timestamp, boolean, jsonb } from "drizzle-orm/pg-core";
import { workspaces } from "./workspaces";

/**
 * Integraciones de terceros configuradas por workspace.
 *
 * `configEncrypted` guarda las credenciales (tokens, connection strings, etc.)
 * encriptadas con AES-256-GCM (lib/encryption). Nunca se exponen al cliente:
 * la UI sólo ve `status`, `name` y metadata no sensible.
 *
 * `type` matchea un id del registry (lib/integrations/registry) — stripe,
 * notion, postgres, http, resend, google, slack, etc.
 */
export const workspaceIntegrations = pgTable("workspace_integration", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  /** id del connector en el registry (stripe, notion, postgres, http, resend…). */
  type: text("type").notNull(),
  /** Nombre amigable que le pone el usuario (ej. "Stripe producción"). */
  name: text("name").notNull(),
  /** Credenciales encriptadas (JSON serializado → AES-256-GCM). */
  configEncrypted: text("config_encrypted").notNull(),
  /** Metadata no sensible para mostrar en UI (ej. { last4, mode, dbName }). */
  meta: jsonb("meta").$type<Record<string, unknown>>().default({}),
  enabled: boolean("enabled").notNull().default(true),
  /** "connected" | "error" | "untested" */
  status: text("status").notNull().default("untested"),
  lastTestedAt: timestamp("last_tested_at"),
  lastError: text("last_error"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type WorkspaceIntegration = typeof workspaceIntegrations.$inferSelect;
export type NewWorkspaceIntegration = typeof workspaceIntegrations.$inferInsert;
