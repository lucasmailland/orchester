// packages/db/src/schema/brain.ts
//
// Brain Core (sub-spec 2): tenant-isolated, semantically-searchable
// fact store. See docs/specs/2026-05-24-brain-core-design.md.
import {
  pgTable,
  text,
  timestamp,
  boolean,
  integer,
  real,
  jsonb,
  customType,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { workspaces } from "./workspaces";
import { agents, conversations } from "./core";

// pgvector custom type — mirrors the one used in knowledge.ts.
const vector = customType<{ data: number[]; driverData: string }>({
  dataType: () => "vector(1536)",
  toDriver: (v) => `[${v.join(",")}]`,
  fromDriver: (raw) => (typeof raw === "string" ? JSON.parse(raw) : raw),
});

export const brainFacts = pgTable(
  "brain_fact",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    agentId: text("agent_id").references(() => agents.id, { onDelete: "set null" }),
    scope: text("scope").notNull(), // CHECK enforced in SQL
    scopeRef: text("scope_ref"),
    kind: text("kind").notNull(),
    subject: text("subject").notNull(),
    statement: text("statement").notNull(),
    confidence: real("confidence").notNull().default(0.7),
    pinned: boolean("pinned").notNull().default(false),
    relevance: real("relevance").notNull().default(1.0),
    hitCount: integer("hit_count").notNull().default(0),
    lastRecalledAt: timestamp("last_recalled_at", { withTimezone: true }),
    sourceMessageIds: text("source_message_ids")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    embedding: vector("embedding"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    status: text("status").notNull().default("active"),
    mergedIntoId: text("merged_into_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_brain_fact_workspace_status").on(t.workspaceId, t.status),
    index("idx_brain_fact_workspace_scope").on(t.workspaceId, t.scope, t.scopeRef),
    index("idx_brain_fact_workspace_subject").on(t.workspaceId, t.subject),
    // HNSW + partial-unique dedup index live in raw SQL (see migration 0016).
  ]
);

export const brainExtractionJobs = pgTable(
  "brain_extraction_job",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    state: text("state").notNull().default("pending"),
    messageCount: integer("message_count").notNull(),
    factsProduced: integer("facts_produced").notNull().default(0),
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_brain_extract_job_workspace_state").on(t.workspaceId, t.state, t.createdAt),
  ]
);

export type BrainFact = typeof brainFacts.$inferSelect;
export type NewBrainFact = typeof brainFacts.$inferInsert;
export type BrainExtractionJob = typeof brainExtractionJobs.$inferSelect;
export type NewBrainExtractionJob = typeof brainExtractionJobs.$inferInsert;
