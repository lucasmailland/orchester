// packages/db/src/schema/audit.ts
import {
  pgTable,
  text,
  timestamp,
  bigint,
  jsonb,
  uniqueIndex,
  char,
  customType,
} from "drizzle-orm/pg-core";
import { workspaces } from "./workspaces";
import { users } from "./auth";

const inet = customType<{ data: string }>({ dataType: () => "inet" });

export const auditLog = pgTable(
  "audit_log",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    seq: bigint("seq", { mode: "bigint" }).notNull(),
    prevHash: char("prev_hash", { length: 64 }),
    payloadHash: char("payload_hash", { length: 64 }).notNull(),
    chainHash: char("chain_hash", { length: 64 }).notNull(),
    action: text("action").notNull(),
    actorUserId: text("actor_user_id").references(() => users.id),
    actorKind: text("actor_kind").notNull(),
    actorIp: inet("actor_ip"),
    actorUserAgent: text("actor_user_agent"),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("uniq_audit_workspace_seq").on(t.workspaceId, t.seq)]
);

export type AuditLog = typeof auditLog.$inferSelect;
export type NewAuditLog = typeof auditLog.$inferInsert;
