import {
  pgTable,
  text,
  timestamp,
  integer,
  jsonb,
  pgEnum,
  customType,
} from "drizzle-orm/pg-core";
import { workspaces } from "./workspaces";

// pgvector custom type — drizzle doesn't ship one, so we declare it
const vectorType = customType<{ data: number[]; driverData: string }>({
  dataType() {
    return "vector(1536)";
  },
  toDriver(value) {
    return `[${value.join(",")}]`;
  },
  fromDriver(value) {
    if (typeof value === "string") {
      return JSON.parse(value);
    }
    return value as number[];
  },
});

export const kbStatusEnum = pgEnum("kb_doc_status", [
  "pending",
  "parsing",
  "embedding",
  "ready",
  "failed",
]);

export const knowledgeBases = pgTable("knowledge_base", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  embeddingModel: text("embedding_model").notNull().default("text-embedding-3-small"),
  embeddingProvider: text("embedding_provider").notNull().default("openai"), // openai | google | voyage
  chunkSize: integer("chunk_size").notNull().default(800),
  chunkOverlap: integer("chunk_overlap").notNull().default(100),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const knowledgeDocs = pgTable("knowledge_doc", {
  id: text("id").primaryKey(),
  kbId: text("kb_id")
    .notNull()
    .references(() => knowledgeBases.id, { onDelete: "cascade" }),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  source: text("source"), // upload | url | text
  url: text("url"),
  contentType: text("content_type"),
  byteSize: integer("byte_size"),
  status: kbStatusEnum("status").notNull().default("pending"),
  error: text("error"),
  chunkCount: integer("chunk_count").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const knowledgeChunks = pgTable("knowledge_chunk", {
  id: text("id").primaryKey(),
  docId: text("doc_id")
    .notNull()
    .references(() => knowledgeDocs.id, { onDelete: "cascade" }),
  kbId: text("kb_id")
    .notNull()
    .references(() => knowledgeBases.id, { onDelete: "cascade" }),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  ordinal: integer("ordinal").notNull(),
  text: text("text").notNull(),
  embedding: vectorType("embedding"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const agentMemories = pgTable("agent_memory", {
  id: text("id").primaryKey(),
  agentId: text("agent_id").notNull(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  conversationId: text("conversation_id"),
  employeeId: text("employee_id"),
  scope: text("scope").notNull().default("global"), // global | conversation | employee
  data: jsonb("data").$type<Record<string, unknown>>().default({}),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type KnowledgeBase = typeof knowledgeBases.$inferSelect;
export type NewKnowledgeBase = typeof knowledgeBases.$inferInsert;
export type KnowledgeDoc = typeof knowledgeDocs.$inferSelect;
export type NewKnowledgeDoc = typeof knowledgeDocs.$inferInsert;
export type KnowledgeChunk = typeof knowledgeChunks.$inferSelect;
export type AgentMemory = typeof agentMemories.$inferSelect;
