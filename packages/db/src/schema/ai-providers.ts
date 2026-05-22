import {
  pgTable,
  text,
  timestamp,
  pgEnum,
  integer,
  boolean,
  jsonb,
  numeric,
  unique,
} from "drizzle-orm/pg-core";
import { workspaces } from "./workspaces";
import { agents } from "./core";

export const aiProviderTypeEnum = pgEnum("ai_provider_type", [
  "anthropic",
  "openai",
  "google",
  "azure_openai",
]);

export interface ModelInfo {
  id: string;
  name: string;
  contextWindow: number;
  tier: "fast" | "smart" | "powerful";
}

export const aiProviders = pgTable(
  "ai_provider",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    // Antes era un enum de 4 valores; ahora es texto abierto para soportar
    // cualquier proveedor del catálogo (openai, replicate, elevenlabs, …).
    provider: text("provider").notNull(),
    apiKey: text("api_key").notNull(), // AES-256-GCM encrypted
    endpoint: text("endpoint"), // azure / providers con endpoint propio
    enabled: boolean("enabled").notNull().default(true),
    modelsJson: jsonb("models_json").$type<ModelInfo[]>().default([]),
    // Extras por proveedor (región Bedrock, account Cloudflare, etc.).
    config: jsonb("config").$type<Record<string, unknown>>().default({}),
    lastTestedAt: timestamp("last_tested_at"),
    lastTestStatus: text("last_test_status"),
    lastTestError: text("last_test_error"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [unique().on(t.workspaceId, t.provider)]
);

export const agentVersions = pgTable("agent_version", {
  id: text("id").primaryKey(),
  agentId: text("agent_id")
    .notNull()
    .references(() => agents.id, { onDelete: "cascade" }),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  systemPrompt: text("system_prompt").notNull(),
  model: text("model").notNull(),
  temperature: numeric("temperature", { precision: 3, scale: 2 }),
  maxTokens: integer("max_tokens"),
  label: text("label"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type AiProvider = typeof aiProviders.$inferSelect;
export type NewAiProvider = typeof aiProviders.$inferInsert;
export type AgentVersion = typeof agentVersions.$inferSelect;
export type NewAgentVersion = typeof agentVersions.$inferInsert;
