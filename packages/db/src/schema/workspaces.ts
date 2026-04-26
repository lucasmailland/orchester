import { pgTable, text, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { users } from "./auth";

export const workspaceMemberRoleEnum = pgEnum("workspace_member_role", [
  "owner",
  "admin",
  "editor",
  "viewer",
]);

export const workspaces = pgTable("workspace", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const workspaceMembers = pgTable("workspace_member", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  role: workspaceMemberRoleEnum("role").notNull().default("viewer"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type Workspace = typeof workspaces.$inferSelect;
export type NewWorkspace = typeof workspaces.$inferInsert;
export type WorkspaceMember = typeof workspaceMembers.$inferSelect;
export type WorkspaceMemberRole = (typeof workspaceMemberRoleEnum.enumValues)[number];
