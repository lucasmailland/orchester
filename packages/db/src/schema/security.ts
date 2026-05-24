// packages/db/src/schema/security.ts
import { pgTable, text, timestamp, jsonb, customType } from "drizzle-orm/pg-core";
import { workspaces } from "./workspaces";

const inet = customType<{ data: string }>({ dataType: () => "inet" });

export const securityEvents = pgTable("security_event", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").references(() => workspaces.id, {
    onDelete: "set null",
  }),
  eventType: text("event_type").notNull(),
  severity: text("severity").notNull(),
  actorUserId: text("actor_user_id"),
  actorIp: inet("actor_ip"),
  detail: jsonb("detail").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type SecurityEvent = typeof securityEvents.$inferSelect;
export type NewSecurityEvent = typeof securityEvents.$inferInsert;
