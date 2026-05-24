// packages/db/src/schema/feature-flags.ts
import { pgTable, text, timestamp, boolean, jsonb, uniqueIndex } from "drizzle-orm/pg-core";
import { workspaces } from "./workspaces";
import { users } from "./auth";

export const featureFlags = pgTable(
  "feature_flag",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    flagKey: text("flag_key").notNull(),
    enabled: boolean("enabled").notNull().default(false),
    rolledOutAt: timestamp("rolled_out_at", { withTimezone: true }),
    setByUserId: text("set_by_user_id").references(() => users.id),
    meta: jsonb("meta").$type<Record<string, unknown>>().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("uniq_feature_flag_workspace_key").on(t.workspaceId, t.flagKey)]
);

export type FeatureFlag = typeof featureFlags.$inferSelect;
export type NewFeatureFlag = typeof featureFlags.$inferInsert;
