import { pgTable, text, timestamp, boolean, pgEnum } from "drizzle-orm/pg-core";
import { workspaces } from "./workspaces";

export const mcpTransportEnum = pgEnum("mcp_transport", ["http"]);

export const mcpServers = pgTable("mcp_server", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  transport: mcpTransportEnum("transport").notNull().default("http"),
  url: text("url").notNull(),
  /** Encrypted `Authorization` header value (e.g. "Bearer …"). Null = no auth. */
  authHeaderEncrypted: text("auth_header_encrypted"),
  enabled: boolean("enabled").notNull().default(true),
  lastTestedAt: timestamp("last_tested_at"),
  lastError: text("last_error"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type McpServer = typeof mcpServers.$inferSelect;
export type NewMcpServer = typeof mcpServers.$inferInsert;
