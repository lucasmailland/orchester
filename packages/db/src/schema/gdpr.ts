// packages/db/src/schema/gdpr.ts
import { pgTable, text, timestamp, integer, jsonb, bigint, pgEnum } from "drizzle-orm/pg-core";
import { workspaces } from "./workspaces";
import { users } from "./auth";

export const gdprExportStateEnum = pgEnum("gdpr_export_state", [
  "pending",
  "exporting",
  "uploading",
  "emailing",
  "completed",
  "failed",
]);

export const gdprExportJobs = pgTable("gdpr_export_job", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  requestedByUserId: text("requested_by_user_id")
    .notNull()
    .references(() => users.id),
  state: gdprExportStateEnum("state").notNull().default("pending"),
  progress: integer("progress").notNull().default(0),
  format: text("format").notNull().default("json+csv"),
  storageKey: text("storage_key"),
  signedUrl: text("signed_url"),
  signedUrlExpiresAt: timestamp("signed_url_expires_at", {
    withTimezone: true,
  }),
  bytesTotal: bigint("bytes_total", { mode: "bigint" }),
  error: text("error"),
  retryCount: integer("retry_count").notNull().default(0),
  checkpoint: jsonb("checkpoint").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

export type GdprExportJob = typeof gdprExportJobs.$inferSelect;
export type NewGdprExportJob = typeof gdprExportJobs.$inferInsert;
