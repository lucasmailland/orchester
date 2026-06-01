// packages/db/src/schema/mnemosyne.ts
//
// Drizzle schema for Mnemosyne tables (mnemo_*).
// Mirrors migrations 0017 onward.

import {
  pgTable,
  primaryKey,
  index,
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
import { orgs } from "./orgs";
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
  // Mnemosyne v1.4 — "The Cognitive Leap" (migration 0033).
  // Separates facts the way human cognition does:
  //   • semantic    — durable factual knowledge (default; preserves
  //                   pre-v1.4 behaviour because every existing row
  //                   migrates to 'semantic').
  //   • episodic    — events tied to a specific moment, linked to
  //                   `mnemo_episode` via metadata.episode_id.
  //   • procedural  — how-to ("when X happens, do Y").
  //   • working     — current conversation only; ephemeral.
  // Stored as text + CHECK constraint at the DB layer; the enum array
  // here keeps the type info in sync without paying ENUM-evolution
  // cost in Postgres.
  memoryType: text("memory_type", {
    enum: ["semantic", "episodic", "procedural", "working"],
  })
    .notNull()
    .default("semantic"),
  // Mnemosyne v1.4 — per-conversation actor isolation (migration 0037).
  // Tracks WHICH end-user the fact was learned from. NULL = workspace-
  // shared (preserves the current behaviour: all facts visible to the
  // workspace). Set to a User.id when the extraction pipeline has a
  // concrete actor for the conversation. No FK — actors come+go
  // independently of facts; this is a semantic reference.
  actorId: text("actor_id"),
  // Mnemosyne v1.4 — theory-of-mind attribution (migration 0035).
  // Cognitive provenance of the fact, distinct from `attributedTo`
  // (which records the message-author role) and `sourceMessageIds`
  // (literal evidence). The 4-value vocabulary is enforced by the
  // SQL CHECK constraint; the enum array here keeps the TS layer in
  // sync. Default 'inferred' preserves v1.3 row shape — every legacy
  // row migrates to 'inferred' without a backfill pass.
  attribution: text("attribution", {
    enum: ["user_stated", "user_belief", "objective_fact", "inferred"],
  })
    .notNull()
    .default("inferred"),
  // Mnemosyne v1.6 — link to a `mnemo_entity` row (migration 0039).
  // NULL when the extraction pipeline could not resolve a canonical
  // entity (legacy behaviour preserved). Populated when the fact is
  // primarily about a known entity ("Lucas prefers TS" → entity for
  // user "Lucas"). The reverse direction is the entity's
  // `mention_count` denormalised on `mnemo_entity`.
  entityId: text("entity_id"),
  // Mnemosyne v1.6 — Memory Protocol version this fact was extracted
  // under (migration 0041). SQL DEFAULT is 'v1.1' so every legacy row
  // tags itself with the protocol active at the time. New extractions
  // explicitly set 'v1.2' at the application layer.
  protocolVersion: text("protocol_version").notNull().default("v1.1"),
  // Mnemosyne v1.1 #10 — Hebbian potentiation + Ebbinghaus decay
  // (migration 0045).
  //
  //   memoryStrength      — trace strength in [0.05, 5.0]. Default 1.0.
  //                         Potentiated by +0.05 on each qualifying recall
  //                         (Cepeda ≥ 1 h spacing); decays exponentially
  //                         between recalls (Ebbinghaus forgetting curve).
  //   memoryStability     — forgetting-curve time constant (days). Default
  //                         1.0. Incremented by +0.1 on each potentiating
  //                         recall so frequently-recalled facts decay slower.
  //   lastStrengthUpdate  — timestamp of last decay + potentiation pass.
  //                         NULL = fact never recalled via markRecalled.
  memoryStrength: real("memory_strength").notNull().default(1.0),
  memoryStability: real("memory_stability").notNull().default(1.0),
  lastStrengthUpdate: timestamp("last_strength_update", {
    withTimezone: true,
    mode: "date",
  }),
  // Mnemosyne v2 — "Episodes first-class" (migrations 0048 + 0051).
  //
  // FK to the episode that this fact belongs to. NOT NULL since
  // migration 0051 ran a SQL-level backfill of every legacy row with
  // a placeholder synthetic episode and flipped the constraint.
  // New writes set this explicitly via `deriveSyntheticEpisodeId` in
  // the extraction pipeline.
  episodeId: text("episode_id")
    .notNull()
    .references(() => mnemoEpisode.id, { onDelete: "set null" }),
});

// Mnemosyne v1.6 — the entity primitive (migration 0039). The 4th
// cognitive primitive alongside fact / decision / episode. A
// canonical "thing" (person / organization / project / concept /
// place / other) that facts can reference via
// `mnemo_fact.entity_id`. RLS+FORCE Pattern A; reads/writes through
// `withMnemoTx(workspaceId, …)`.
export const mnemoEntity = pgTable("mnemo_entity", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  // Canonical display name — "Lucas Mailland", "Acme Inc.", "Q2
  // launch". Unique per (workspace_id, name, kind).
  name: text("name").notNull(),
  // 6-value cognitive vocabulary. SQL CHECK constraint enforces it;
  // the enum array here keeps the TS layer in sync.
  kind: text("kind", {
    enum: ["person", "organization", "project", "concept", "place", "other"],
  }).notNull(),
  // Alternate spellings / handles. The extraction pipeline uses these
  // for dedup ("@lucas" ↔ "Lucas Mailland"). GIN-indexed in SQL.
  aliases: text("aliases").array().notNull().default([]),
  // Self-reference for merge. NULL = this row is canonical.
  canonicalId: text("canonical_id"),
  // LLM-generated one-sentence description. Nullable — heuristic-only
  // extractions leave this empty until the LLM-assisted pass fills it.
  description: text("description"),
  metadata: jsonb("metadata").notNull().default({}),
  firstSeenAt: timestamp("first_seen_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  mentionCount: integer("mention_count").notNull().default(1),
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
  // Mnemosyne v1.1 #11 — edge provenance (migration 0043).
  // NULL ⇒ LLM-derived (status-quo, the vast majority); 'heuristic' ⇒
  // synthesized by the system (alias merge, coreference, deterministic
  // dedup). Free text (no enum constraint) so future provenances
  // ('import', 'rule', …) don't require an ALTER TYPE migration —
  // the application layer in `packages/mnemosyne/src/graph/relation.ts`
  // is the chokepoint that gates what values land on disk.
  provenance: text("provenance"),
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

// Mnemosyne v1.3 — active learning review queue (migration 0032).
// One row per fact that needs human attention. Created either by:
//   • `saveFactWithCandidates` when judgmentRequired=true and no LLM
//     judge is available (Mode A/B) — reason='contradiction'.
//   • The daily `review-sweep-job` cron — reason='low_confidence'.
//   • A UI user explicitly adding a fact for review — reason='manual'.
// Decoupled from `mnemo_fact` (no FK) so the janitor crons can archive
// or merge a fact without blocking on open review rows. RLS+FORCE
// Pattern A; reads/writes flow through `withMnemoTx`.
export const mnemoReviewQueue = pgTable("mnemo_review_queue", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  // v1.1 #24 — fact_id is now nullable (migration 0044). Exactly one of
  // (fact_id, decision_id) must be non-NULL per row; enforced by the DB
  // CHECK constraint `mnemo_review_queue_source_check` and at the
  // application layer in `enqueueReview`. The "no FK" pattern is
  // intentional (same as the original 0032 schema) — a fact or decision
  // may move to an archive table between enqueue and resolve; the
  // reviewer UI handles the "source gone" case gracefully.
  factId: text("fact_id"),
  /** v1.1 #24 — optional decision_id for contradiction rows produced by
   *  `saveDecisionWithCandidates`. Null on fact-sourced rows. */
  decisionId: text("decision_id"),
  reason: text("reason", {
    enum: ["low_confidence", "contradiction", "manual"],
  }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true, mode: "date" }),
  resolvedBy: text("resolved_by"),
  resolution: text("resolution", {
    enum: ["kept", "edited", "forgotten", "dismissed"],
  }),
});

// Mnemosyne v1.4 — episodic timeline (migration 0034).
// Rich events (meetings, decisions, milestones) that aggregate multiple
// facts under a narrative arc. Distinct from `mnemo_fact` because an
// episode carries duration + a topic vocabulary + a linked-fact list.
// Many facts can reference one episode via `mnemo_fact.metadata.episode_id`,
// set by the extraction pipeline; the `linkedFactIds` column on the
// episode is the denormalised reverse direction for cheap timeline
// rendering. RLS+FORCE Pattern A — every read/write through
// `withMnemoTx(workspaceId, ...)`.
export const mnemoEpisode = pgTable("mnemo_episode", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  narrative: text("narrative").notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "date" }).notNull(),
  durationMinutes: integer("duration_minutes"),
  // Free-form participant ids (user_ids OR agent_ids); no FK so the
  // episode survives a deleted participant for audit purposes.
  participants: text("participants").array().notNull().default([]),
  // Topical tags ("deployment", "Q2-roadmap"); GIN-indexed in SQL.
  topics: text("topics").array().notNull().default([]),
  // Denormalised reverse pointer to mnemo_fact ids. We could derive
  // this from a join, but the timeline UI page reads it on every
  // tick so we keep it on the row.
  linkedFactIds: text("linked_fact_ids").array().notNull().default([]),
  sourceConversationId: text("source_conversation_id"),
  metadata: jsonb("metadata").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  // Mnemosyne v2 — "Episodes first-class" (migration 0048). True for
  // episodes auto-created by the extraction pipeline (one per
  // message turn / document / day). The Inspector UI's default
  // "real episodes" listing filters them out via the partial index
  // `idx_mnemo_episode_real`.
  isSynthetic: boolean("is_synthetic").notNull().default(false),
});

// Mnemosyne v1.1 #1+2 — Pointer index (migration 0046).
//
// Lightweight routing table that maps content terms to the entity
// (drawer) that most frequently uses them. The recall pipeline uses
// this to route a query to the 1-5 most relevant entities before
// running the full first-stage FTS/vector search, achieving
// dramatically higher precision for entity-specific queries.
//
// Primary key (workspace_id, term, entity_id) — one row per (term,
// entity) pair. `mention_count` tracks how many distinct facts within
// that entity's drawer reference the term; the pointer lookup ranks
// entities by SUM(mention_count) for the query's token set.
export const mnemoPointer = pgTable(
  "mnemo_pointer",
  {
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    term: text("term").notNull(),
    entityId: text("entity_id").notNull(),
    mentionCount: integer("mention_count").notNull().default(1),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.workspaceId, t.term, t.entityId] }),
    index("idx_mnemo_pointer_lookup").on(t.workspaceId, t.term, t.mentionCount),
    index("idx_mnemo_pointer_entity").on(t.workspaceId, t.entityId),
  ]
);

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

// ─── v1.1 #22 — Unresolved-mention queue (migration 0047) ────────────────────
//
// CRM-style precision layer: mentions the extractor could not confidently
// resolve to a known `mnemo_entity` row are parked here for human (or
// background-cron) resolution. See migration 0047 for the full schema
// rationale and RLS policy.

export const mnemoUnresolvedMention = pgTable(
  "mnemo_unresolved_mention",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    /** The raw entity mention string seen by the extractor. */
    rawName: text("raw_name").notNull(),
    /** Surrounding text for human / cron disambiguation. */
    context: text("context"),
    /** Fact the mention was extracted from (soft ref — no FK). */
    sourceFactId: text("source_fact_id"),
    /** Extractor certainty [0,1] that rawName is a genuine named entity. */
    confidence: real("confidence").notNull().default(0.0),
    /** Best-guess entity from the extractor (soft ref — no FK). */
    suggestedEntityId: text("suggested_entity_id"),
    /** Times this rawName has been encountered since last pending. */
    mentionCount: integer("mention_count").notNull().default(1),
    /** Lifecycle state: pending → resolved | dismissed. */
    status: text("status", {
      enum: ["pending", "resolved", "dismissed"],
    })
      .notNull()
      .default("pending"),
    /** Set on resolve — the entity this mention was linked to. */
    resolvedEntityId: text("resolved_entity_id"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true, mode: "date" }),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    // Pending mentions by workspace (primary query pattern).
    index("idx_mnemo_unresolved_mention_pending").on(t.workspaceId, t.status, t.createdAt),
    // Raw-name lookup — dedup enforced at application layer via
    // INSERT … ON CONFLICT(workspace_id, raw_name) WHERE status='pending'.
    index("idx_mnemo_unresolved_mention_raw_name").on(t.workspaceId, t.rawName, t.status),
    // Resolution lookup.
    index("idx_mnemo_unresolved_mention_resolved_entity").on(t.workspaceId, t.resolvedEntityId),
  ]
);

// Mnemosyne v2 — Cross-workspace consolidation surface (migration 0050).
// Populated by `apps/web/worker/org-consolidation-job.ts` running as
// service-role; read by the (future) org-admin UI under the
// `app_org_user` role with the `app.org_id` GUC set.
//
// Per-workspace `app_user` reads are NEVER granted on this table —
// the role lattice keeps cross-workspace data out of the agent-runtime
// hot path. See docs/specs/2026-05-30-cross-workspace-consolidation-design.md.
export const mnemoOrgFactView = pgTable(
  "mnemo_org_fact_view",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    sourceFactIds: text("source_fact_ids").array().notNull(),
    sourceWorkspaceIds: text("source_workspace_ids").array().notNull(),
    statementSummary: text("statement_summary").notNull(),
    clusterSimilarity: real("cluster_similarity").notNull(),
    subject: text("subject").notNull(),
    kind: text("kind").notNull(),
    source: text("source").notNull().default("org_consolidation"),
    /** True when a source workspace is deleted; the cron re-clusters and
     *  drops rows whose cluster falls below the size threshold. */
    stale: boolean("stale").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_mnemo_org_fact_view_org").on(t.orgId, t.createdAt),
    index("idx_mnemo_org_fact_view_subject_kind").on(t.orgId, t.subject, t.kind),
  ]
);
