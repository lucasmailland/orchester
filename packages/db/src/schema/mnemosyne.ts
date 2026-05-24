// packages/db/src/schema/mnemosyne.ts
//
// Drizzle schema for Mnemosyne tables (mnemo_*).
// Mirrors migrations 0017 onward.

import {
  pgTable,
  text,
  real,
  boolean,
  integer,
  timestamp,
  jsonb,
  vector,
  customType,
} from "drizzle-orm/pg-core";
import { workspaces } from "./workspaces";
import { agents, conversations } from "./core";
import { users } from "./auth";

// tsvector — readonly at the TS layer because the column is
// GENERATED ALWAYS in Postgres (see migration 0017). Marking via
// `customType` keeps the type info but we MUST NOT include it in
// `.insert().values({...})` payloads.
const tsvector = customType<{ data: string }>({
  dataType() {
    return "tsvector";
  },
});

export const mnemoFacts = pgTable("mnemo_fact", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  agentId: text("agent_id").references(() => agents.id, {
    onDelete: "set null",
  }),
  scope: text("scope", {
    enum: ["global", "conversation", "employee", "team"],
  }).notNull(),
  scopeRef: text("scope_ref"),
  kind: text("kind", {
    enum: ["preference", "trait", "event", "relationship", "skill", "concern", "other"],
  }).notNull(),
  subject: text("subject").notNull(),
  statement: text("statement").notNull(),
  confidence: real("confidence").notNull().default(0.7),
  pinned: boolean("pinned").notNull().default(false),
  relevance: real("relevance").notNull().default(1.0),
  hitCount: integer("hit_count").notNull().default(0),
  lastRecalledAt: timestamp("last_recalled_at", {
    withTimezone: true,
    mode: "date",
  }),
  sourceMessageIds: text("source_message_ids").array().notNull().default([]),
  attributedTo: text("attributed_to", {
    enum: ["user", "assistant", "system"],
  }),
  linkedMemoryIds: text("linked_memory_ids").array().notNull().default([]),
  embedding: vector("embedding", { dimensions: 1536 }),
  embeddingModel: text("embedding_model"),
  embeddingVersion: text("embedding_version"),
  textLemmatized: tsvector("text_lemmatized"),
  metadata: jsonb("metadata").notNull().default({}),
  status: text("status", { enum: ["active", "merged", "forgotten"] })
    .notNull()
    .default("active"),
  mergedIntoId: text("merged_into_id"),
  validFrom: timestamp("valid_from", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  validTo: timestamp("valid_to", { withTimezone: true, mode: "date" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});

export const mnemoExtractionJobs = pgTable("mnemo_extraction_job", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  conversationId: text("conversation_id")
    .notNull()
    .references(() => conversations.id, { onDelete: "cascade" }),
  state: text("state", {
    enum: ["pending", "running", "done", "failed", "skipped"],
  })
    .notNull()
    .default("pending"),
  messageCount: integer("message_count").notNull(),
  factsProduced: integer("facts_produced").notNull().default(0),
  skipReason: text("skip_reason"),
  error: text("error"),
  startedAt: timestamp("started_at", { withTimezone: true, mode: "date" }),
  completedAt: timestamp("completed_at", { withTimezone: true, mode: "date" }),
  metadata: jsonb("metadata").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});

export const mnemoDecisions = pgTable("mnemo_decision", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  agentId: text("agent_id").references(() => agents.id, {
    onDelete: "set null",
  }),
  conversationId: text("conversation_id").references(() => conversations.id, {
    onDelete: "set null",
  }),
  kind: text("kind", {
    enum: [
      "decision",
      "architecture",
      "policy",
      "process",
      "bugfix",
      "learning",
      "discovery",
      "config",
    ],
  }).notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  topicKey: text("topic_key"),
  revisionCount: integer("revision_count").notNull().default(1),
  normalizedHash: text("normalized_hash").notNull(),
  decidedByUserId: text("decided_by_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  embedding: vector("embedding", { dimensions: 1536 }),
  embeddingModel: text("embedding_model"),
  embeddingVersion: text("embedding_version"),
  textLemmatized: tsvector("text_lemmatized"),
  status: text("status", { enum: ["active", "superseded", "withdrawn"] })
    .notNull()
    .default("active"),
  supersededById: text("superseded_by_id"),
  metadata: jsonb("metadata").notNull().default({}),
  validFrom: timestamp("valid_from", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  validTo: timestamp("valid_to", { withTimezone: true, mode: "date" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});

export const mnemoRelations = pgTable("mnemo_relation", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  sourceKind: text("source_kind", {
    enum: ["fact", "decision", "entity", "episode"],
  }).notNull(),
  sourceId: text("source_id").notNull(),
  targetKind: text("target_kind", {
    enum: ["fact", "decision", "entity", "episode"],
  }).notNull(),
  targetId: text("target_id").notNull(),
  relation: text("relation", {
    enum: [
      "related",
      "compatible",
      "scoped",
      "conflicts_with",
      "supersedes",
      "not_conflict",
      "derived_from",
      "part_of",
      "member_of",
    ],
  }).notNull(),
  judgmentStatus: text("judgment_status", {
    enum: ["pending", "judged", "dismissed"],
  })
    .notNull()
    .default("pending"),
  reason: text("reason"),
  evidence: jsonb("evidence"),
  confidence: real("confidence"),
  markedByUserId: text("marked_by_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  markedByKind: text("marked_by_kind", {
    enum: ["user", "agent", "system", "llm_judge"],
  }).notNull(),
  markedByModel: text("marked_by_model"),
  markedByPromptVersion: text("marked_by_prompt_version"),
  conversationId: text("conversation_id").references(() => conversations.id, {
    onDelete: "set null",
  }),
  supersededByRelationId: text("superseded_by_relation_id"),
  validFrom: timestamp("valid_from", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  validTo: timestamp("valid_to", { withTimezone: true, mode: "date" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});
