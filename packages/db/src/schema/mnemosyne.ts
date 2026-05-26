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
  numeric,
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
  // 'deferred_provider_outage' added in migration 0027 (v1.1 circuit breaker):
  // distinguishes a job whose extraction was deferred because the LLM
  // provider was unavailable (retry later) from one that was intentionally
  // skipped because the workspace has no provider configured (steady-state
  // Mode A).
  state: text("state", {
    enum: ["pending", "running", "done", "failed", "skipped", "deferred_provider_outage"],
  })
    .notNull()
    .default("pending"),
  messageCount: integer("message_count").notNull(),
  factsProduced: integer("facts_produced").notNull().default(0),
  skipReason: text("skip_reason"),
  error: text("error"),
  startedAt: timestamp("started_at", { withTimezone: true, mode: "date" }),
  completedAt: timestamp("completed_at", { withTimezone: true, mode: "date" }),
  // v1.1 circuit breaker: when state='deferred_provider_outage', this
  // timestamp tells the worker when to re-attempt the job.
  deferUntil: timestamp("defer_until", { withTimezone: true, mode: "date" }),
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

// Mnemosyne v1.1 — distilled user profile cache (migration 0028).
// One row per (workspace, agent, user) triplet. Pre-computed daily by
// `apps/web/worker/summary-job.ts` so the agent runtime can inject a
// compact 80-150 token profile on EVERY turn (Layer 1) without paying
// the cost of a fresh recall. RLS+FORCE on the table; `withMnemoTx`
// gates every SELECT/INSERT/UPDATE/DELETE.
export const mnemoSummary = pgTable("mnemo_summary", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  agentId: text("agent_id")
    .notNull()
    .references(() => agents.id, { onDelete: "cascade" }),
  // Nullable: workspace-level summary used when the conversation has no
  // single user attached (e.g. shared inbox, agent-to-agent flow).
  userId: text("user_id"),
  summaryText: text("summary_text").notNull(),
  summaryStruct: jsonb("summary_struct").notNull().default({}),
  sourceFactIds: text("source_fact_ids").array().notNull().default([]),
  modelUsed: text("model_used"),
  tokenCount: integer("token_count"),
  generatedAt: timestamp("generated_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});

// Mnemosyne v1.2 — memory drift detection (migration 0031).
// One snapshot row per workspace per cron tick (daily). Tracks fact
// counts, recall hit-rate, contradiction count, extraction backlog
// and embedding coverage so the dashboard can spot drift over time.
// Pure cache — every metric is recomputable from the existing
// mnemo_* tables. RLS+FORCE Pattern A; reads/writes go through
// `withMnemoTx`.
export const mnemoHealth = pgTable("mnemo_health", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  snapshotAt: timestamp("snapshot_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  // counts
  factCountActive: integer("fact_count_active").notNull(),
  factCountArchived: integer("fact_count_archived").notNull(),
  factCountEmbedded: integer("fact_count_embedded").notNull(),
  factCountUnembedded: integer("fact_count_unembedded").notNull(),
  decisionCountActive: integer("decision_count_active").notNull(),
  relationCountConflicts: integer("relation_count_conflicts").notNull(),
  // hit-rate quality
  factsWithZeroHits: integer("facts_with_zero_hits").notNull(),
  // numeric(4,3) — nullable: NULL when there's no telemetry to compute
  // a rate (cold start) so the dashboard can distinguish "no data" from
  // "rate is zero".
  recallHitRate30d: numeric("recall_hit_rate_30d", { precision: 4, scale: 3 }),
  // extraction quality
  extractionJobsFailed7d: integer("extraction_jobs_failed_7d").notNull(),
  extractionJobsDeferred: integer("extraction_jobs_deferred").notNull(),
  // meta
  computedInMs: integer("computed_in_ms").notNull(),
  generatedAt: timestamp("generated_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
});

// Mnemosyne v1.2 — "The Janitor" cold-storage archive (migration 0029).
// Mirrors `mnemo_fact` minus the heavy/transient columns (`embedding`,
// `text_lemmatized`) plus three audit fields (`original_status`,
// `archived_at`, `archive_reason`). Populated by the dedup + prune crons
// in `apps/web/worker/` (dedup-job.ts, prune-job.ts) so the active
// `mnemo_fact` table stays small and recall stays fast. RLS+FORCE
// Pattern A — same `app.workspace_id` GUC gate as every other mnemo_*
// table. Reads/writes only go through `withMnemoTx`.
//
// No FK back to `workspaces`: an archive row by definition outlives the
// live mnemo_fact row, and we want the archive to survive even if the
// host workspace is later soft-deleted. RLS still scopes access.
export const mnemoFactArchive = pgTable("mnemo_fact_archive", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  agentId: text("agent_id"),
  scope: text("scope", {
    enum: ["global", "conversation", "employee", "team"],
  }).notNull(),
  scopeRef: text("scope_ref"),
  kind: text("kind", {
    enum: ["preference", "trait", "event", "relationship", "skill", "concern", "other"],
  }).notNull(),
  subject: text("subject").notNull(),
  statement: text("statement").notNull(),
  // numeric(3,2) on the SQL side; drizzle maps numeric to string by
  // default but we read these as numbers via SQL `::float` casts in the
  // janitor — at the schema-typing layer `numeric` is the closest match.
  confidence: numeric("confidence", { precision: 3, scale: 2 }).notNull(),
  pinned: boolean("pinned").notNull().default(false),
  relevance: numeric("relevance", { precision: 4, scale: 3 }).notNull(),
  hitCount: integer("hit_count").notNull().default(0),
  lastRecalledAt: timestamp("last_recalled_at", {
    withTimezone: true,
    mode: "date",
  }),
  sourceMessageIds: text("source_message_ids").array().notNull().default([]),
  metadata: jsonb("metadata").notNull().default({}),
  // Pre-archive status — was 'active' / 'forgotten' / 'merged'.
  originalStatus: text("original_status").notNull(),
  mergedIntoId: text("merged_into_id"),
  archivedAt: timestamp("archived_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  // Why the janitor archived this row. 'merged' = consumed by a dedup
  // primary; 'pruned_inactive' = old + zero hits + low relevance;
  // 'pruned_low_relevance' = same but tripped only the relevance gate.
  archiveReason: text("archive_reason").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull(),
});

export const mnemoCitations = pgTable("mnemo_citation", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  memoryKind: text("memory_kind", {
    enum: ["fact", "decision", "entity", "episode"],
  }).notNull(),
  memoryId: text("memory_id").notNull(),
  sourceKind: text("source_kind", {
    enum: [
      "message",
      "document",
      "tool_call",
      "llm_extraction",
      "user_edit",
      "agent_save",
      "imported",
    ],
  }).notNull(),
  sourceId: text("source_id"),
  extractorModel: text("extractor_model"),
  extractorPromptVersion: text("extractor_prompt_version"),
  judgeModel: text("judge_model"),
  judgeRelationId: text("judge_relation_id"),
  evidenceExcerpt: text("evidence_excerpt"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});
