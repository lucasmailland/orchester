// packages/db/src/schema/idempotency.ts
import { pgTable, text, timestamp, integer, jsonb, char, primaryKey } from "drizzle-orm/pg-core";
import { workspaces } from "./workspaces";
import { users } from "./auth";

export const idempotencyKeys = pgTable(
  "idempotency_key",
  {
    key: text("key").notNull(),
    workspaceId: text("workspace_id").references(() => workspaces.id, {
      onDelete: "cascade",
    }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    endpoint: text("endpoint").notNull(),
    requestHash: char("request_hash", { length: 64 }).notNull(),
    responseStatus: integer("response_status"),
    responseBody: jsonb("response_body"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.endpoint, t.key] })]
);

export type IdempotencyKey = typeof idempotencyKeys.$inferSelect;
