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
  smallint,
  index,
} from "drizzle-orm/pg-core";

const inet = customType<{ data: string }>({ dataType: () => "inet" });

export const auditLog = pgTable(
  "audit_log",
  {
    id: text("id").primaryKey(),
    // No FKs on workspace_id / actor_user_id (migration 0072): audit rows
    // outlive the workspace or user they mention and leave only through
    // retention (RETENTION_AUDIT_DAYS).
    workspaceId: text("workspace_id").notNull(),
    seq: bigint("seq", { mode: "bigint" }).notNull(),
    prevHash: char("prev_hash", { length: 64 }),
    payloadHash: char("payload_hash", { length: 64 }).notNull(),
    chainHash: char("chain_hash", { length: 64 }).notNull(),
    action: text("action").notNull(),
    actorUserId: text("actor_user_id"),
    actorKind: text("actor_kind").notNull(),
    actorIp: inet("actor_ip"),
    actorUserAgent: text("actor_user_agent"),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    // 1 = unkeyed sha256 chain (pre-0072), 2 = HMAC chain, see lib/audit/chain.ts.
    hashVersion: smallint("hash_version").notNull().default(1),
  },
  (t) => [
    uniqueIndex("uniq_audit_workspace_seq").on(t.workspaceId, t.seq),
    index("idx_audit_workspace_created").on(t.workspaceId, t.createdAt),
  ]
);

export type AuditLog = typeof auditLog.$inferSelect;
export type NewAuditLog = typeof auditLog.$inferInsert;
