# Orchester v2 — Master Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform Orchester from a basic agents-list app into a fully usable AI orchestration platform with deep agent editing, multi-provider AI support, a visual flow builder that connects agents into pipelines, and an interactive organigrama that visualizes the whole system.

**Architecture:** Five sequential phases over a single PostgreSQL + Drizzle data model. Server-side flow engine. React + xyflow for the visual builder and organigrama. Provider abstraction routes requests by model prefix. AES-256-GCM encrypts API keys at rest.

**Tech Stack:** Next.js 15 (App Router, Turbopack) · TypeScript strict · Drizzle ORM 0.45 · PostgreSQL · Better Auth · Vitest · framer-motion · @xyflow/react · @paralleldrive/cuid2 · next-intl (es/en/pt-BR).

---

## Phases Overview

| Phase | Name | Tasks | Outcome |
|-------|------|-------|---------|
| A | Foundation | 1–5 | Schema, encryption, provider abstraction, migrations, demo seed |
| B | Agent Studio | 6–13 | Multi-provider settings UI + full-page agent editor with versions, test chat, AI prompt generator, templates |
| C | Flow Builder | 14–20 | Visual node-based workflow editor + server-side execution engine + run history |
| D | Organigrama 2.0 | 21–23 | Interactive canvas connecting teams ↔ agents ↔ flows ↔ employees with live activity |
| E | Polish | 24–27 | i18n complete, empty states, demo data, smoke verification |

---

## Phase A — Foundation

### Task 1: AI Providers & Agent Versions Schema

**Files:**
- Create: `packages/db/src/schema/ai-providers.ts`
- Modify: `packages/db/src/schema/core.ts` (add `temperature`, `maxTokens` columns to `agents`)
- Modify: `packages/db/src/schema/index.ts` (re-export new tables)

- [ ] **Step 1: Create the ai-providers schema file**

Write `packages/db/src/schema/ai-providers.ts`:

```typescript
import {
  pgTable,
  text,
  timestamp,
  pgEnum,
  integer,
  boolean,
  jsonb,
  numeric,
  unique,
} from "drizzle-orm/pg-core";
import { workspaces } from "./workspaces";
import { agents } from "./core";

export const aiProviderTypeEnum = pgEnum("ai_provider_type", [
  "anthropic",
  "openai",
  "google",
  "azure_openai",
]);

export interface ModelInfo {
  id: string;
  name: string;
  contextWindow: number;
  tier: "fast" | "smart" | "powerful";
}

export const aiProviders = pgTable(
  "ai_provider",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    provider: aiProviderTypeEnum("provider").notNull(),
    apiKey: text("api_key").notNull(), // AES-256-GCM encrypted
    endpoint: text("endpoint"), // azure: https://{name}.openai.azure.com
    enabled: boolean("enabled").notNull().default(true),
    modelsJson: jsonb("models_json").$type<ModelInfo[]>().default([]),
    lastTestedAt: timestamp("last_tested_at"),
    lastTestStatus: text("last_test_status"),
    lastTestError: text("last_test_error"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [unique().on(t.workspaceId, t.provider)]
);

export const agentVersions = pgTable("agent_version", {
  id: text("id").primaryKey(),
  agentId: text("agent_id")
    .notNull()
    .references(() => agents.id, { onDelete: "cascade" }),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  systemPrompt: text("system_prompt").notNull(),
  model: text("model").notNull(),
  temperature: numeric("temperature", { precision: 3, scale: 2 }),
  maxTokens: integer("max_tokens"),
  label: text("label"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type AiProvider = typeof aiProviders.$inferSelect;
export type NewAiProvider = typeof aiProviders.$inferInsert;
export type AgentVersion = typeof agentVersions.$inferSelect;
export type NewAgentVersion = typeof agentVersions.$inferInsert;
```

- [ ] **Step 2: Add columns to agents table**

Edit `packages/db/src/schema/core.ts` — find the `agents` table definition and add `temperature` + `maxTokens` columns after `config`:

```typescript
import { pgTable, text, timestamp, pgEnum, integer, boolean, jsonb, numeric } from "drizzle-orm/pg-core";
// ...existing imports

export const agents = pgTable("agent", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  teamId: text("team_id").references(() => teams.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  role: text("role").notNull(),
  systemPrompt: text("system_prompt").notNull(),
  model: text("model").notNull().default("claude-sonnet-4-6"),
  status: agentStatusEnum("status").notNull().default("draft"),
  config: jsonb("config").$type<Record<string, unknown>>().default({}),
  temperature: numeric("temperature", { precision: 3, scale: 2 }).default("0.70"),
  maxTokens: integer("max_tokens"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
```

(Add `numeric` to the import from drizzle-orm/pg-core if it isn't there yet.)

- [ ] **Step 3: Re-export from schema index**

Edit `packages/db/src/schema/index.ts`:

```typescript
export * from "./auth";
export * from "./workspaces";
export * from "./core";
export * from "./ai-providers";
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @orchester/db typecheck` (or `pnpm tsc --noEmit -p packages/db`).
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/schema/ai-providers.ts packages/db/src/schema/core.ts packages/db/src/schema/index.ts
git commit -m "feat(db): add ai_provider and agent_version tables, agent temperature/maxTokens"
```

---

### Task 2: Flows Schema (nodes, edges, runs)

**Files:**
- Create: `packages/db/src/schema/flows.ts`
- Modify: `packages/db/src/schema/index.ts`

- [ ] **Step 1: Create the flows schema file**

Write `packages/db/src/schema/flows.ts`:

```typescript
import {
  pgTable,
  text,
  timestamp,
  pgEnum,
  integer,
  jsonb,
  boolean,
} from "drizzle-orm/pg-core";
import { workspaces } from "./workspaces";

export const flowStatusEnum = pgEnum("flow_status", ["draft", "active", "paused"]);
export const flowTriggerEnum = pgEnum("flow_trigger_type", [
  "manual",
  "webhook",
  "schedule",
  "conversation",
]);
export const flowRunStatusEnum = pgEnum("flow_run_status", [
  "pending",
  "running",
  "succeeded",
  "failed",
  "cancelled",
]);
export const flowNodeTypeEnum = pgEnum("flow_node_type", [
  "trigger",
  "agent",
  "condition",
  "http",
  "transform",
  "delay",
  "notify",
  "end",
]);

export interface FlowNodeData {
  type:
    | "trigger"
    | "agent"
    | "condition"
    | "http"
    | "transform"
    | "delay"
    | "notify"
    | "end";
  label: string;
  config: Record<string, unknown>;
  position: { x: number; y: number };
}

export interface FlowEdgeData {
  source: string;
  target: string;
  sourceHandle?: string;
  label?: string;
}

export const flows = pgTable("flow", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  status: flowStatusEnum("status").notNull().default("draft"),
  trigger: flowTriggerEnum("trigger").notNull().default("manual"),
  triggerConfig: jsonb("trigger_config").$type<Record<string, unknown>>().default({}),
  nodes: jsonb("nodes").$type<Array<{ id: string } & FlowNodeData>>().default([]),
  edges: jsonb("edges").$type<Array<{ id: string } & FlowEdgeData>>().default([]),
  variables: jsonb("variables").$type<Record<string, unknown>>().default({}),
  version: integer("version").notNull().default(1),
  lastRunAt: timestamp("last_run_at"),
  enabled: boolean("enabled").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const flowRuns = pgTable("flow_run", {
  id: text("id").primaryKey(),
  flowId: text("flow_id")
    .notNull()
    .references(() => flows.id, { onDelete: "cascade" }),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  status: flowRunStatusEnum("status").notNull().default("pending"),
  triggerSource: text("trigger_source"), // "manual:userId", "webhook", "schedule"
  input: jsonb("input").$type<Record<string, unknown>>().default({}),
  output: jsonb("output").$type<Record<string, unknown>>(),
  error: text("error"),
  startedAt: timestamp("started_at").notNull().defaultNow(),
  completedAt: timestamp("completed_at"),
});

export const flowRunSteps = pgTable("flow_run_step", {
  id: text("id").primaryKey(),
  runId: text("run_id")
    .notNull()
    .references(() => flowRuns.id, { onDelete: "cascade" }),
  nodeId: text("node_id").notNull(), // node.id within flow.nodes JSON
  nodeType: flowNodeTypeEnum("node_type").notNull(),
  status: flowRunStatusEnum("status").notNull().default("pending"),
  input: jsonb("input").$type<Record<string, unknown>>(),
  output: jsonb("output").$type<Record<string, unknown>>(),
  error: text("error"),
  startedAt: timestamp("started_at").notNull().defaultNow(),
  completedAt: timestamp("completed_at"),
});

export type Flow = typeof flows.$inferSelect;
export type NewFlow = typeof flows.$inferInsert;
export type FlowRun = typeof flowRuns.$inferSelect;
export type NewFlowRun = typeof flowRuns.$inferInsert;
export type FlowRunStep = typeof flowRunSteps.$inferSelect;
export type NewFlowRunStep = typeof flowRunSteps.$inferInsert;
```

- [ ] **Step 2: Re-export**

Edit `packages/db/src/schema/index.ts`:

```typescript
export * from "./auth";
export * from "./workspaces";
export * from "./core";
export * from "./ai-providers";
export * from "./flows";
```

- [ ] **Step 3: Typecheck and commit**

```bash
pnpm --filter @orchester/db typecheck
git add packages/db/src/schema/flows.ts packages/db/src/schema/index.ts
git commit -m "feat(db): add flow, flow_run, flow_run_step tables for visual flow builder"
```

---

### Task 3: Run Migration

**Files:**
- Generate: `packages/db/drizzle/*` (auto-generated migration)

- [ ] **Step 1: Generate migration**

```bash
cd packages/db
pnpm drizzle-kit generate --name=v2_studio_and_flows
```

Expected: a new SQL file appears under `packages/db/drizzle/`.

- [ ] **Step 2: Apply migration**

Verify Postgres is up:

```bash
docker compose -f /Users/lucasmailland/dev/orchester/docker-compose.yml ps
# If not running: docker compose up -d postgres
```

Push schema:

```bash
cd packages/db
pnpm drizzle-kit push
```

Expected: tables `ai_provider`, `agent_version`, `flow`, `flow_run`, `flow_run_step` are created. Existing `agent` gets `temperature` + `max_tokens` columns.

- [ ] **Step 3: Verify**

```bash
psql "postgresql://orchester:orchester@localhost:5432/orchester" -c "\dt"
psql "postgresql://orchester:orchester@localhost:5432/orchester" -c "\d agent"
```

Expected: see `temperature numeric(3,2)` and `max_tokens integer` on `agent`. New tables present.

- [ ] **Step 4: Commit**

```bash
git add packages/db/drizzle/
git commit -m "chore(db): generate migration for v2 studio + flows"
```

---

### Task 4: Encryption Utility

**Files:**
- Create: `apps/web/lib/encryption.ts`
- Create: `apps/web/__tests__/encryption.test.ts`
- Modify: `apps/web/.env.local` (add `ENCRYPTION_SECRET`)
- Modify: `.env.example`

- [ ] **Step 1: Write failing test**

Create `apps/web/__tests__/encryption.test.ts`:

```typescript
import { describe, it, expect, beforeAll } from "vitest";
import crypto from "node:crypto";

beforeAll(() => {
  process.env.ENCRYPTION_SECRET = crypto.randomBytes(32).toString("hex");
});

describe("encryption", () => {
  it("roundtrip plaintext through encrypt/decrypt", async () => {
    const { encrypt, decrypt } = await import("../lib/encryption");
    const plaintext = "sk-ant-api03-very-secret-key-12345";
    const encrypted = encrypt(plaintext);
    expect(encrypted).not.toContain(plaintext);
    expect(encrypted.split(":")).toHaveLength(3); // iv:tag:ct
    expect(decrypt(encrypted)).toBe(plaintext);
  });

  it("produces different ciphertext each call (random IV)", async () => {
    const { encrypt } = await import("../lib/encryption");
    const a = encrypt("hello");
    const b = encrypt("hello");
    expect(a).not.toBe(b);
  });

  it("throws on tampered ciphertext", async () => {
    const { encrypt, decrypt } = await import("../lib/encryption");
    const e = encrypt("hello");
    const parts = e.split(":");
    parts[2] = Buffer.from("tampered").toString("base64");
    expect(() => decrypt(parts.join(":"))).toThrow();
  });

  it("throws when ENCRYPTION_SECRET is missing", async () => {
    const original = process.env.ENCRYPTION_SECRET;
    delete process.env.ENCRYPTION_SECRET;
    // Re-import: vitest caches modules, so re-import via dynamic require pattern
    const mod = await import("../lib/encryption?t=" + Date.now());
    expect(() => mod.encrypt("x")).toThrow(/ENCRYPTION_SECRET/);
    process.env.ENCRYPTION_SECRET = original;
  });
});
```

- [ ] **Step 2: Run test (should fail — module doesn't exist)**

```bash
pnpm --filter web test encryption
```

Expected: FAIL — Cannot find module `../lib/encryption`.

- [ ] **Step 3: Implement encryption**

Create `apps/web/lib/encryption.ts`:

```typescript
import "server-only";
import crypto from "node:crypto";

const ALGO = "aes-256-gcm";
const IV_LEN = 12;

function getKey(): Buffer {
  const secret = process.env.ENCRYPTION_SECRET;
  if (!secret) {
    throw new Error(
      "ENCRYPTION_SECRET env var is required. Generate one with: openssl rand -hex 32"
    );
  }
  if (secret.length !== 64) {
    throw new Error(
      "ENCRYPTION_SECRET must be a 32-byte hex string (64 chars). Got: " + secret.length
    );
  }
  return Buffer.from(secret, "hex");
}

/** Encrypt plaintext to "iv:authTag:ciphertext" base64 triple. */
export function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64"), tag.toString("base64"), ct.toString("base64")].join(":");
}

/** Decrypt "iv:authTag:ciphertext" — throws on tamper. */
export function decrypt(encoded: string): string {
  const key = getKey();
  const [ivB64, tagB64, ctB64] = encoded.split(":");
  if (!ivB64 || !tagB64 || !ctB64) {
    throw new Error("Invalid ciphertext format");
  }
  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const ct = Buffer.from(ctB64, "base64");
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return pt.toString("utf8");
}

export function maskKey(key: string): string {
  if (key.length <= 8) return "••••••••";
  return key.slice(0, 4) + "••••" + key.slice(-4);
}
```

- [ ] **Step 4: Run tests, expect green**

```bash
pnpm --filter web test encryption
```

Expected: 4 passing.

- [ ] **Step 5: Update env files**

Append to `apps/web/.env.local`:

```
ENCRYPTION_SECRET="<generate with: openssl rand -hex 32>"
```

Run locally: `openssl rand -hex 32`, paste output.

Append to `.env.example` (project root):

```
ENCRYPTION_SECRET=    # 32-byte hex string. Generate with: openssl rand -hex 32
```

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/encryption.ts apps/web/__tests__/encryption.test.ts .env.example
git commit -m "feat(web): add AES-256-GCM encryption utility for AI provider keys"
```

---

### Task 5: Provider Abstraction Layer

**Files:**
- Create: `apps/web/lib/providers.ts`
- Create: `apps/web/__tests__/providers.test.ts`

- [ ] **Step 1: Write failing tests**

Create `apps/web/__tests__/providers.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { routeToProvider, defaultModelsFor } from "../lib/providers";

describe("routeToProvider", () => {
  it("routes claude-* to anthropic", () => {
    expect(routeToProvider("claude-sonnet-4-6")).toBe("anthropic");
    expect(routeToProvider("claude-opus-4-7")).toBe("anthropic");
    expect(routeToProvider("claude-haiku-4-5")).toBe("anthropic");
  });
  it("routes gpt-*/o1-*/o3-* to openai", () => {
    expect(routeToProvider("gpt-4o")).toBe("openai");
    expect(routeToProvider("gpt-4o-mini")).toBe("openai");
    expect(routeToProvider("o1-preview")).toBe("openai");
    expect(routeToProvider("o3-mini")).toBe("openai");
  });
  it("routes gemini-* to google", () => {
    expect(routeToProvider("gemini-1.5-pro")).toBe("google");
    expect(routeToProvider("gemini-2.0-flash")).toBe("google");
  });
  it("routes azure/* to azure_openai", () => {
    expect(routeToProvider("azure/gpt-4o")).toBe("azure_openai");
  });
  it("returns null for unknown", () => {
    expect(routeToProvider("mystery-model-99")).toBeNull();
  });
});

describe("defaultModelsFor", () => {
  it("returns curated list for anthropic", () => {
    const m = defaultModelsFor("anthropic");
    expect(m.length).toBeGreaterThan(0);
    expect(m[0]).toHaveProperty("id");
    expect(m[0]).toHaveProperty("tier");
  });
  it("returns curated list for openai", () => {
    expect(defaultModelsFor("openai").length).toBeGreaterThan(0);
  });
  it("returns curated list for google", () => {
    expect(defaultModelsFor("google").length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
pnpm --filter web test providers
```

- [ ] **Step 3: Implement**

Create `apps/web/lib/providers.ts`:

```typescript
import "server-only";
import type { ModelInfo } from "@orchester/db";

export type ProviderType = "anthropic" | "openai" | "google" | "azure_openai";

export function routeToProvider(model: string): ProviderType | null {
  if (model.startsWith("claude-")) return "anthropic";
  if (
    model.startsWith("gpt-") ||
    model.startsWith("o1-") ||
    model.startsWith("o3-") ||
    model.startsWith("o4-")
  )
    return "openai";
  if (model.startsWith("gemini-")) return "google";
  if (model.startsWith("azure/") || model.startsWith("azure-")) return "azure_openai";
  return null;
}

const ANTHROPIC: ModelInfo[] = [
  { id: "claude-opus-4-7", name: "Claude Opus 4.7", contextWindow: 200_000, tier: "powerful" },
  { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6", contextWindow: 200_000, tier: "smart" },
  { id: "claude-haiku-4-5", name: "Claude Haiku 4.5", contextWindow: 200_000, tier: "fast" },
];
const OPENAI: ModelInfo[] = [
  { id: "gpt-4o", name: "GPT-4o", contextWindow: 128_000, tier: "smart" },
  { id: "gpt-4o-mini", name: "GPT-4o mini", contextWindow: 128_000, tier: "fast" },
  { id: "o3-mini", name: "o3-mini", contextWindow: 200_000, tier: "powerful" },
];
const GOOGLE: ModelInfo[] = [
  { id: "gemini-1.5-pro", name: "Gemini 1.5 Pro", contextWindow: 2_000_000, tier: "powerful" },
  { id: "gemini-1.5-flash", name: "Gemini 1.5 Flash", contextWindow: 1_000_000, tier: "fast" },
  { id: "gemini-2.0-flash", name: "Gemini 2.0 Flash", contextWindow: 1_000_000, tier: "smart" },
];

export function defaultModelsFor(provider: ProviderType): ModelInfo[] {
  switch (provider) {
    case "anthropic":
      return ANTHROPIC;
    case "openai":
      return OPENAI;
    case "google":
      return GOOGLE;
    case "azure_openai":
      return [];
  }
}

/** Test connection by calling the provider's models endpoint. */
export async function testProviderConnection(
  provider: ProviderType,
  apiKey: string,
  endpoint?: string | null
): Promise<{ ok: boolean; models?: ModelInfo[]; error?: string }> {
  try {
    if (provider === "anthropic") {
      const r = await fetch("https://api.anthropic.com/v1/models", {
        headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      });
      if (!r.ok) return { ok: false, error: `Anthropic returned ${r.status}` };
      const j = await r.json();
      const models: ModelInfo[] = (j.data || []).map((m: { id: string; display_name?: string }) => ({
        id: m.id,
        name: m.display_name ?? m.id,
        contextWindow: 200_000,
        tier: m.id.includes("opus") ? "powerful" : m.id.includes("haiku") ? "fast" : "smart",
      }));
      return { ok: true, models: models.length ? models : ANTHROPIC };
    }
    if (provider === "openai") {
      const r = await fetch("https://api.openai.com/v1/models", {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!r.ok) return { ok: false, error: `OpenAI returned ${r.status}` };
      const j = await r.json();
      const ids = new Set<string>((j.data || []).map((m: { id: string }) => m.id));
      const models = OPENAI.filter((m) => ids.has(m.id));
      return { ok: true, models: models.length ? models : OPENAI };
    }
    if (provider === "google") {
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`
      );
      if (!r.ok) return { ok: false, error: `Google returned ${r.status}` };
      const j = await r.json();
      const ids = new Set<string>(
        (j.models || []).map((m: { name: string }) => m.name.replace(/^models\//, ""))
      );
      const models = GOOGLE.filter((m) => ids.has(m.id));
      return { ok: true, models: models.length ? models : GOOGLE };
    }
    if (provider === "azure_openai") {
      if (!endpoint) return { ok: false, error: "Azure requires an endpoint URL" };
      const url = `${endpoint.replace(/\/$/, "")}/openai/deployments?api-version=2024-02-01`;
      const r = await fetch(url, { headers: { "api-key": apiKey } });
      if (!r.ok) return { ok: false, error: `Azure returned ${r.status}` };
      const j = await r.json();
      const models: ModelInfo[] = (j.data || []).map(
        (d: { id: string; model: string }) => ({
          id: `azure/${d.id}`,
          name: `Azure: ${d.id}`,
          contextWindow: 128_000,
          tier: "smart",
        })
      );
      return { ok: true, models };
    }
    return { ok: false, error: "Unknown provider" };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
```

- [ ] **Step 4: Run tests, expect green**

```bash
pnpm --filter web test providers
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/providers.ts apps/web/__tests__/providers.test.ts
git commit -m "feat(web): add provider abstraction with model routing and connection test"
```

---

## Phase B — Agent Studio

### Task 6: AI Provider API Routes

**Files:**
- Create: `apps/web/app/api/providers/route.ts`
- Create: `apps/web/app/api/providers/[id]/route.ts`
- Create: `apps/web/app/api/providers/[id]/test/route.ts`

- [ ] **Step 1: GET list + POST upsert**

Create `apps/web/app/api/providers/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { createId } from "@paralleldrive/cuid2";
import { getDb, schema } from "@orchester/db";
import { eq, and } from "drizzle-orm";
import { getCurrentWorkspace } from "@/lib/workspace";
import { encrypt, maskKey, decrypt } from "@/lib/encryption";

export async function GET() {
  const ws = await getCurrentWorkspace();
  if (!ws) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.aiProviders)
    .where(eq(schema.aiProviders.workspaceId, ws.workspace.id));
  return NextResponse.json(
    rows.map((r) => ({
      id: r.id,
      provider: r.provider,
      apiKeyMasked: maskKey(safeDecrypt(r.apiKey)),
      endpoint: r.endpoint,
      enabled: r.enabled,
      models: r.modelsJson ?? [],
      lastTestedAt: r.lastTestedAt,
      lastTestStatus: r.lastTestStatus,
      lastTestError: r.lastTestError,
    }))
  );
}

function safeDecrypt(s: string): string {
  try {
    return decrypt(s);
  } catch {
    return "";
  }
}

export async function POST(req: Request) {
  const ws = await getCurrentWorkspace();
  if (!ws) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json();
  const { provider, apiKey, endpoint } = body as {
    provider: "anthropic" | "openai" | "google" | "azure_openai";
    apiKey: string;
    endpoint?: string;
  };
  if (!provider || !apiKey?.trim())
    return NextResponse.json({ error: "provider and apiKey required" }, { status: 400 });

  const db = getDb();
  const existing = await db
    .select()
    .from(schema.aiProviders)
    .where(
      and(
        eq(schema.aiProviders.workspaceId, ws.workspace.id),
        eq(schema.aiProviders.provider, provider)
      )
    )
    .limit(1);

  const ciphertext = encrypt(apiKey.trim());
  if (existing[0]) {
    const [updated] = await db
      .update(schema.aiProviders)
      .set({ apiKey: ciphertext, endpoint: endpoint ?? null, updatedAt: new Date() })
      .where(eq(schema.aiProviders.id, existing[0].id))
      .returning();
    return NextResponse.json({ id: updated.id, provider: updated.provider });
  }
  const [inserted] = await db
    .insert(schema.aiProviders)
    .values({
      id: createId(),
      workspaceId: ws.workspace.id,
      provider,
      apiKey: ciphertext,
      endpoint: endpoint ?? null,
    })
    .returning();
  return NextResponse.json({ id: inserted.id, provider: inserted.provider }, { status: 201 });
}
```

- [ ] **Step 2: DELETE one provider**

Create `apps/web/app/api/providers/[id]/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { getDb, schema } from "@orchester/db";
import { eq, and } from "drizzle-orm";
import { getCurrentWorkspace } from "@/lib/workspace";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ws = await getCurrentWorkspace();
  if (!ws) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const db = getDb();
  const [d] = await db
    .delete(schema.aiProviders)
    .where(and(eq(schema.aiProviders.id, id), eq(schema.aiProviders.workspaceId, ws.workspace.id)))
    .returning({ id: schema.aiProviders.id });
  if (!d) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 3: POST test connection**

Create `apps/web/app/api/providers/[id]/test/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { getDb, schema } from "@orchester/db";
import { eq, and } from "drizzle-orm";
import { getCurrentWorkspace } from "@/lib/workspace";
import { decrypt } from "@/lib/encryption";
import { testProviderConnection } from "@/lib/providers";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ws = await getCurrentWorkspace();
  if (!ws) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.aiProviders)
    .where(and(eq(schema.aiProviders.id, id), eq(schema.aiProviders.workspaceId, ws.workspace.id)))
    .limit(1);
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const apiKey = decrypt(row.apiKey);
  const result = await testProviderConnection(row.provider, apiKey, row.endpoint);
  await db
    .update(schema.aiProviders)
    .set({
      lastTestedAt: new Date(),
      lastTestStatus: result.ok ? "ok" : "error",
      lastTestError: result.ok ? null : result.error ?? "Unknown error",
      modelsJson: result.ok ? result.models ?? [] : row.modelsJson,
    })
    .where(eq(schema.aiProviders.id, row.id));

  return NextResponse.json(result);
}
```

- [ ] **Step 4: Smoke test**

Start the dev server. From browser devtools or curl with a session cookie:

```bash
curl -s http://localhost:3333/api/providers | head
```

Expected: 401 if not logged in, otherwise `[]`.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/api/providers
git commit -m "feat(api): provider CRUD and connection test endpoints"
```

---

### Task 7: Agent GET + Versions API

**Files:**
- Modify: `apps/web/app/api/agents/[id]/route.ts` (add GET handler)
- Create: `apps/web/app/api/agents/[id]/versions/route.ts`
- Create: `apps/web/app/api/agents/[id]/versions/[vid]/restore/route.ts`

- [ ] **Step 1: Add GET to agent route**

Edit `apps/web/app/api/agents/[id]/route.ts` — prepend a GET handler:

```typescript
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const workspace = await getCurrentWorkspace();
  if (!workspace) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const db = getDb();
  const [agent] = await db
    .select()
    .from(schema.agents)
    .where(and(eq(schema.agents.id, id), eq(schema.agents.workspaceId, workspace.workspace.id)))
    .limit(1);
  if (!agent) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(agent);
}
```

Also extend the existing PATCH to accept `temperature` and `maxTokens`:

```typescript
const { name, role, systemPrompt, model, status, teamId, temperature, maxTokens } = body;
// ...
const [agent] = await db
  .update(schema.agents)
  .set({
    name: name.trim(),
    role: role.trim(),
    ...(systemPrompt !== undefined && { systemPrompt: systemPrompt.trim() }),
    ...(model !== undefined && { model }),
    ...(status !== undefined && { status }),
    ...(teamId !== undefined && { teamId: teamId || null }),
    ...(temperature !== undefined && { temperature: String(temperature) }),
    ...(maxTokens !== undefined && { maxTokens }),
    updatedAt: new Date(),
  })
```

- [ ] **Step 2: Versions list + create**

Create `apps/web/app/api/agents/[id]/versions/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { createId } from "@paralleldrive/cuid2";
import { getDb, schema } from "@orchester/db";
import { eq, and, desc } from "drizzle-orm";
import { getCurrentWorkspace } from "@/lib/workspace";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ws = await getCurrentWorkspace();
  if (!ws) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.agentVersions)
    .where(
      and(
        eq(schema.agentVersions.agentId, id),
        eq(schema.agentVersions.workspaceId, ws.workspace.id)
      )
    )
    .orderBy(desc(schema.agentVersions.createdAt));
  return NextResponse.json(rows);
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ws = await getCurrentWorkspace();
  if (!ws) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const body = await req.json();
  const { systemPrompt, model, temperature, maxTokens, label } = body;
  if (!systemPrompt || !model)
    return NextResponse.json({ error: "systemPrompt and model required" }, { status: 400 });
  const db = getDb();
  const [v] = await db
    .insert(schema.agentVersions)
    .values({
      id: createId(),
      agentId: id,
      workspaceId: ws.workspace.id,
      systemPrompt,
      model,
      temperature: temperature !== undefined ? String(temperature) : null,
      maxTokens: maxTokens ?? null,
      label: label ?? null,
    })
    .returning();
  return NextResponse.json(v, { status: 201 });
}
```

- [ ] **Step 3: Restore version**

Create `apps/web/app/api/agents/[id]/versions/[vid]/restore/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { getDb, schema } from "@orchester/db";
import { eq, and } from "drizzle-orm";
import { getCurrentWorkspace } from "@/lib/workspace";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string; vid: string }> }
) {
  const ws = await getCurrentWorkspace();
  if (!ws) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id, vid } = await params;
  const db = getDb();
  const [v] = await db
    .select()
    .from(schema.agentVersions)
    .where(
      and(
        eq(schema.agentVersions.id, vid),
        eq(schema.agentVersions.agentId, id),
        eq(schema.agentVersions.workspaceId, ws.workspace.id)
      )
    )
    .limit(1);
  if (!v) return NextResponse.json({ error: "Version not found" }, { status: 404 });

  const [updated] = await db
    .update(schema.agents)
    .set({
      systemPrompt: v.systemPrompt,
      model: v.model,
      temperature: v.temperature ?? null,
      maxTokens: v.maxTokens ?? null,
      updatedAt: new Date(),
    })
    .where(and(eq(schema.agents.id, id), eq(schema.agents.workspaceId, ws.workspace.id)))
    .returning();
  return NextResponse.json(updated);
}
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/api/agents
git commit -m "feat(api): agent GET, version list/create/restore endpoints"
```

---

### Task 8: Generate-Prompt + Test-Chat APIs

**Files:**
- Create: `apps/web/lib/llm-call.ts`
- Create: `apps/web/app/api/agents/[id]/generate-prompt/route.ts`
- Create: `apps/web/app/api/agents/[id]/test-chat/route.ts`

- [ ] **Step 1: Create unified LLM caller**

Create `apps/web/lib/llm-call.ts`:

```typescript
import "server-only";
import { getDb, schema } from "@orchester/db";
import { eq, and } from "drizzle-orm";
import { decrypt } from "./encryption";
import { routeToProvider, type ProviderType } from "./providers";

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface LlmCallParams {
  workspaceId: string;
  model: string;
  systemPrompt: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
}

export interface LlmCallResult {
  content: string;
  tokensUsed: number;
  model: string;
}

export class ProviderNotConfiguredError extends Error {
  constructor(public provider: ProviderType) {
    super(`Provider ${provider} is not configured`);
  }
}

async function getProviderKey(workspaceId: string, provider: ProviderType) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.aiProviders)
    .where(
      and(
        eq(schema.aiProviders.workspaceId, workspaceId),
        eq(schema.aiProviders.provider, provider)
      )
    )
    .limit(1);
  if (!row || !row.enabled) throw new ProviderNotConfiguredError(provider);
  return { apiKey: decrypt(row.apiKey), endpoint: row.endpoint };
}

export async function llmCall(p: LlmCallParams): Promise<LlmCallResult> {
  const provider = routeToProvider(p.model);
  if (!provider) throw new Error(`Unknown model: ${p.model}`);
  const { apiKey, endpoint } = await getProviderKey(p.workspaceId, provider);

  if (provider === "anthropic") return callAnthropic(p, apiKey);
  if (provider === "openai") return callOpenAI(p, apiKey);
  if (provider === "google") return callGoogle(p, apiKey);
  if (provider === "azure_openai") return callAzure(p, apiKey, endpoint);
  throw new Error(`Provider ${provider} not implemented`);
}

async function callAnthropic(p: LlmCallParams, apiKey: string): Promise<LlmCallResult> {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: p.model,
      max_tokens: p.maxTokens ?? 1024,
      temperature: p.temperature ?? 0.7,
      system: p.systemPrompt,
      messages: p.messages.filter((m) => m.role !== "system").map((m) => ({
        role: m.role,
        content: m.content,
      })),
    }),
  });
  if (!r.ok) throw new Error(`Anthropic ${r.status}: ${await r.text()}`);
  const j = await r.json();
  const content = j.content?.[0]?.text ?? "";
  return {
    content,
    tokensUsed: (j.usage?.input_tokens ?? 0) + (j.usage?.output_tokens ?? 0),
    model: p.model,
  };
}

async function callOpenAI(p: LlmCallParams, apiKey: string): Promise<LlmCallResult> {
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: p.model,
      messages: [{ role: "system", content: p.systemPrompt }, ...p.messages],
      temperature: p.temperature ?? 0.7,
      max_tokens: p.maxTokens ?? 1024,
    }),
  });
  if (!r.ok) throw new Error(`OpenAI ${r.status}: ${await r.text()}`);
  const j = await r.json();
  return {
    content: j.choices?.[0]?.message?.content ?? "",
    tokensUsed: j.usage?.total_tokens ?? 0,
    model: p.model,
  };
}

async function callGoogle(p: LlmCallParams, apiKey: string): Promise<LlmCallResult> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    p.model
  )}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: p.systemPrompt }] },
      contents: p.messages.map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      })),
      generationConfig: {
        temperature: p.temperature ?? 0.7,
        maxOutputTokens: p.maxTokens ?? 1024,
      },
    }),
  });
  if (!r.ok) throw new Error(`Google ${r.status}: ${await r.text()}`);
  const j = await r.json();
  const content = j.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  return {
    content,
    tokensUsed:
      (j.usageMetadata?.promptTokenCount ?? 0) +
      (j.usageMetadata?.candidatesTokenCount ?? 0),
    model: p.model,
  };
}

async function callAzure(
  p: LlmCallParams,
  apiKey: string,
  endpoint: string | null
): Promise<LlmCallResult> {
  if (!endpoint) throw new Error("Azure endpoint not configured");
  const deployment = p.model.replace(/^azure\//, "");
  const url = `${endpoint.replace(/\/$/, "")}/openai/deployments/${deployment}/chat/completions?api-version=2024-02-01`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "api-key": apiKey, "content-type": "application/json" },
    body: JSON.stringify({
      messages: [{ role: "system", content: p.systemPrompt }, ...p.messages],
      temperature: p.temperature ?? 0.7,
      max_tokens: p.maxTokens ?? 1024,
    }),
  });
  if (!r.ok) throw new Error(`Azure ${r.status}: ${await r.text()}`);
  const j = await r.json();
  return {
    content: j.choices?.[0]?.message?.content ?? "",
    tokensUsed: j.usage?.total_tokens ?? 0,
    model: p.model,
  };
}

/** Pick the best available provider for one-shot tasks (prompt generation). */
export async function pickAvailableModel(
  workspaceId: string
): Promise<{ provider: ProviderType; model: string } | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.aiProviders)
    .where(eq(schema.aiProviders.workspaceId, workspaceId));
  const order: ProviderType[] = ["anthropic", "openai", "google", "azure_openai"];
  for (const p of order) {
    const row = rows.find((r) => r.provider === p && r.enabled);
    if (!row) continue;
    if (p === "anthropic") return { provider: p, model: "claude-sonnet-4-6" };
    if (p === "openai") return { provider: p, model: "gpt-4o-mini" };
    if (p === "google") return { provider: p, model: "gemini-1.5-flash" };
    if (p === "azure_openai" && row.modelsJson?.[0])
      return { provider: p, model: row.modelsJson[0].id };
  }
  return null;
}
```

- [ ] **Step 2: Generate-prompt route**

Create `apps/web/app/api/agents/[id]/generate-prompt/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { getCurrentWorkspace } from "@/lib/workspace";
import { llmCall, pickAvailableModel } from "@/lib/llm-call";

const META_PROMPT = `You are an expert prompt engineer. Generate THREE distinct system prompt variations for an AI agent.

Each prompt must:
- Be a complete system prompt (not a description of one)
- Define the agent's role, tone, and core behaviors
- Include 1-2 concrete examples or guardrails
- Be 200-600 words

Return ONLY a JSON array of three strings, no markdown, no commentary:
["prompt1...", "prompt2...", "prompt3..."]`;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ws = await getCurrentWorkspace();
  if (!ws) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await params; // agent id reserved for future scoping
  const body = await req.json();
  const { description, tone, context } = body as {
    description: string;
    tone?: "professional" | "friendly" | "formal" | "direct";
    context?: { companyName?: string; industry?: string; extraDetails?: string };
  };
  if (!description?.trim())
    return NextResponse.json({ error: "description required" }, { status: 400 });

  const pick = await pickAvailableModel(ws.workspace.id);
  if (!pick)
    return NextResponse.json(
      { error: "PROVIDER_NOT_CONFIGURED" },
      { status: 401 }
    );

  const userMsg = [
    `Description: ${description.trim()}`,
    tone ? `Desired tone: ${tone}` : "",
    context?.companyName ? `Company: ${context.companyName}` : "",
    context?.industry ? `Industry: ${context.industry}` : "",
    context?.extraDetails ? `Additional context: ${context.extraDetails}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const r = await llmCall({
      workspaceId: ws.workspace.id,
      model: pick.model,
      systemPrompt: META_PROMPT,
      messages: [{ role: "user", content: userMsg }],
      temperature: 0.8,
      maxTokens: 3000,
    });
    const cleaned = r.content.trim().replace(/^```json\s*/i, "").replace(/```$/, "");
    let variations: string[] = [];
    try {
      const parsed = JSON.parse(cleaned);
      if (Array.isArray(parsed)) variations = parsed.filter((s) => typeof s === "string");
    } catch {
      // fallback: split on triple newlines
      variations = r.content.split(/\n\n\n+/).slice(0, 3);
    }
    if (!variations.length) variations = [r.content];
    return NextResponse.json({ variations, model: pick.model });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 3: Test-chat route**

Create `apps/web/app/api/agents/[id]/test-chat/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { getCurrentWorkspace } from "@/lib/workspace";
import { llmCall, ProviderNotConfiguredError } from "@/lib/llm-call";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ws = await getCurrentWorkspace();
  if (!ws) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await params;
  const body = await req.json();
  const { messages, systemPrompt, model, temperature, maxTokens } = body as {
    messages: Array<{ role: "user" | "assistant"; content: string }>;
    systemPrompt: string;
    model: string;
    temperature?: number;
    maxTokens?: number;
  };
  if (!messages?.length || !systemPrompt || !model)
    return NextResponse.json({ error: "messages, systemPrompt, model required" }, { status: 400 });

  try {
    const r = await llmCall({
      workspaceId: ws.workspace.id,
      model,
      systemPrompt,
      messages,
      temperature,
      maxTokens,
    });
    return NextResponse.json(r);
  } catch (e) {
    if (e instanceof ProviderNotConfiguredError)
      return NextResponse.json(
        { error: "PROVIDER_NOT_CONFIGURED", provider: e.provider },
        { status: 401 }
      );
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/lib/llm-call.ts apps/web/app/api/agents
git commit -m "feat(api): generate-prompt and test-chat endpoints with multi-provider routing"
```

---

### Task 9: AI Providers Settings UI

**Files:**
- Create: `apps/web/components/settings/AIProvidersSection.tsx`
- Modify: `apps/web/components/settings/SettingsClient.tsx` (mount the section)

- [ ] **Step 1: Provider section component**

Create `apps/web/components/settings/AIProvidersSection.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Sparkles, KeyRound, Eye, EyeOff, Check, AlertCircle, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

type ProviderId = "anthropic" | "openai" | "google" | "azure_openai";

interface ProviderRow {
  id: string;
  provider: ProviderId;
  apiKeyMasked: string;
  endpoint: string | null;
  enabled: boolean;
  models: Array<{ id: string; name: string; tier: string }>;
  lastTestStatus: string | null;
  lastTestError: string | null;
}

const META: Record<ProviderId, { name: string; placeholder: string; needsEndpoint?: boolean }> = {
  anthropic: { name: "Anthropic", placeholder: "sk-ant-api03-..." },
  openai: { name: "OpenAI", placeholder: "sk-..." },
  google: { name: "Google AI", placeholder: "AIza..." },
  azure_openai: {
    name: "Azure OpenAI",
    placeholder: "<api key>",
    needsEndpoint: true,
  },
};

export function AIProvidersSection() {
  const [rows, setRows] = useState<ProviderRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/providers")
      .then((r) => r.json())
      .then((d) => setRows(Array.isArray(d) ? d : []))
      .finally(() => setLoading(false));
  }, []);

  if (loading)
    return (
      <div className="flex h-32 items-center justify-center text-zinc-500">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {(Object.keys(META) as ProviderId[]).map((p) => (
        <ProviderCard
          key={p}
          provider={p}
          row={rows.find((r) => r.provider === p) ?? null}
          onChange={(updated) => {
            setRows((prev) => {
              const others = prev.filter((r) => r.provider !== p);
              return updated ? [...others, updated] : others;
            });
          }}
        />
      ))}
    </div>
  );
}

function ProviderCard({
  provider,
  row,
  onChange,
}: {
  provider: ProviderId;
  row: ProviderRow | null;
  onChange: (r: ProviderRow | null) => void;
}) {
  const meta = META[provider];
  const [apiKey, setApiKey] = useState("");
  const [endpoint, setEndpoint] = useState(row?.endpoint ?? "");
  const [show, setShow] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  async function save() {
    if (!apiKey.trim()) return;
    setSaving(true);
    setFeedback(null);
    const r = await fetch("/api/providers", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider, apiKey, endpoint: endpoint || undefined }),
    });
    setSaving(false);
    if (!r.ok) {
      setFeedback("Error al guardar");
      return;
    }
    setApiKey("");
    setFeedback("Guardado");
    const all = await fetch("/api/providers").then((x) => x.json());
    onChange(all.find((x: ProviderRow) => x.provider === provider) ?? null);
  }

  async function test() {
    if (!row) return;
    setTesting(true);
    setFeedback(null);
    const r = await fetch(`/api/providers/${row.id}/test`, { method: "POST" });
    const j = await r.json();
    setTesting(false);
    if (j.ok) {
      setFeedback(`OK · ${j.models?.length ?? 0} modelos`);
      const all = await fetch("/api/providers").then((x) => x.json());
      onChange(all.find((x: ProviderRow) => x.provider === provider) ?? null);
    } else {
      setFeedback(`Error: ${j.error}`);
    }
  }

  async function remove() {
    if (!row) return;
    await fetch(`/api/providers/${row.id}`, { method: "DELETE" });
    onChange(null);
    setApiKey("");
    setFeedback(null);
  }

  const status = row?.lastTestStatus;
  const dot =
    status === "ok"
      ? "bg-emerald-400"
      : status === "error"
      ? "bg-red-400"
      : row
      ? "bg-amber-400"
      : "bg-zinc-700";
  const statusLabel = !row
    ? "No configurado"
    : status === "ok"
    ? "Conectado"
    : status === "error"
    ? "Error"
    : "Sin probar";

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl border border-white/[0.08] bg-zinc-900/40 p-5"
    >
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-500/10 text-violet-400">
            <Sparkles className="h-4 w-4" />
          </div>
          <div>
            <div className="text-sm font-semibold text-zinc-100">{meta.name}</div>
            <div className="flex items-center gap-1.5 text-xs text-zinc-500">
              <span className={cn("h-1.5 w-1.5 rounded-full", dot)} />
              {statusLabel}
            </div>
          </div>
        </div>
        {row && (
          <button
            onClick={remove}
            className="text-xs text-zinc-500 hover:text-red-400"
            type="button"
          >
            Quitar
          </button>
        )}
      </div>

      {row && (
        <div className="mb-3 flex items-center justify-between rounded-lg border border-white/5 bg-zinc-800/40 px-3 py-2 text-xs">
          <span className="font-mono text-zinc-400">{row.apiKeyMasked}</span>
          <span className="text-zinc-500">{row.models.length} modelos</span>
        </div>
      )}

      <div className="space-y-2">
        <div className="relative">
          <KeyRound className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-zinc-500" />
          <input
            type={show ? "text" : "password"}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={row ? "Reemplazar key…" : meta.placeholder}
            className="w-full rounded-lg border border-white/[0.08] bg-zinc-800/60 py-2 pl-9 pr-9 text-sm text-zinc-100 placeholder-zinc-600 outline-none focus:border-violet-500/60"
          />
          <button
            onClick={() => setShow((s) => !s)}
            type="button"
            className="absolute right-2.5 top-2.5 text-zinc-500 hover:text-zinc-300"
          >
            {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>

        {meta.needsEndpoint && (
          <input
            value={endpoint}
            onChange={(e) => setEndpoint(e.target.value)}
            placeholder="https://my-resource.openai.azure.com"
            className="w-full rounded-lg border border-white/[0.08] bg-zinc-800/60 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 outline-none focus:border-violet-500/60"
          />
        )}
      </div>

      <div className="mt-3 flex items-center gap-2">
        <button
          onClick={save}
          disabled={!apiKey.trim() || saving}
          className="flex-1 rounded-lg bg-violet-500/90 py-2 text-xs font-medium text-white transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {saving ? "Guardando…" : "Guardar"}
        </button>
        {row && (
          <button
            onClick={test}
            disabled={testing}
            className="rounded-lg border border-white/10 px-3 py-2 text-xs text-zinc-300 hover:bg-white/5 disabled:opacity-40"
          >
            {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Probar"}
          </button>
        )}
      </div>

      {feedback && (
        <div
          className={cn(
            "mt-2 flex items-center gap-1.5 text-xs",
            feedback.startsWith("Error") ? "text-red-400" : "text-emerald-400"
          )}
        >
          {feedback.startsWith("Error") ? (
            <AlertCircle className="h-3.5 w-3.5" />
          ) : (
            <Check className="h-3.5 w-3.5" />
          )}
          {feedback}
        </div>
      )}

      {row?.models && row.models.length > 0 && (
        <details className="mt-3 text-xs">
          <summary className="cursor-pointer text-zinc-500 hover:text-zinc-300">
            Ver modelos disponibles
          </summary>
          <ul className="mt-2 space-y-1 text-zinc-400">
            {row.models.map((m) => (
              <li key={m.id} className="flex items-center justify-between">
                <span className="font-mono">{m.id}</span>
                <span className="text-zinc-600">{m.tier}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </motion.div>
  );
}
```

- [ ] **Step 2: Mount in SettingsClient**

Edit `apps/web/components/settings/SettingsClient.tsx` — import the section and add a SectionCard:

```tsx
import { AIProvidersSection } from "./AIProvidersSection";
import { Sparkles } from "lucide-react";
// ...inside the JSX, after the API keys / before notifications section:
<SectionCard
  icon={<Sparkles className="h-4 w-4" />}
  title="Proveedores de IA"
  description="Conectá tus claves de Anthropic, OpenAI, Google AI o Azure. Los modelos disponibles aparecen en el editor de agentes."
>
  <AIProvidersSection />
</SectionCard>
```

(Match the exact import path style and SectionCard signature already in that file.)

- [ ] **Step 3: Smoke test**

Open `http://localhost:3333/<locale>/settings`, see the new card. Paste an Anthropic key, save, click "Probar". Status should turn green with the model count.

- [ ] **Step 4: Commit**

```bash
git add apps/web/components/settings/AIProvidersSection.tsx apps/web/components/settings/SettingsClient.tsx
git commit -m "feat(settings): AI providers section with key management and connection test"
```

---

### Task 10: Agent Studio — Editor Components

**Files:**
- Create: `apps/web/components/agents/studio/PromptEditor.tsx`
- Create: `apps/web/components/agents/studio/ModelPicker.tsx`
- Create: `apps/web/components/agents/studio/promptQuality.ts`
- Create: `apps/web/__tests__/promptQuality.test.ts`

- [ ] **Step 1: Quality heuristic test**

Create `apps/web/__tests__/promptQuality.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { promptQuality } from "../components/agents/studio/promptQuality";

describe("promptQuality", () => {
  it("scores empty prompt low", () => {
    expect(promptQuality("").score).toBeLessThan(20);
  });
  it("rewards length and action verbs", () => {
    const long = "You are a helpful assistant. ".repeat(20);
    const r = promptQuality(long + " Your job is to help. You must always be polite.");
    expect(r.score).toBeGreaterThan(40);
  });
  it("rewards examples and variables", () => {
    const p = "You are an agent. " + "x".repeat(220) + " For example: hi. {{name}}";
    expect(promptQuality(p).score).toBeGreaterThan(70);
  });
  it("returns label Excellent for high score", () => {
    const p = "You are an agent. Your job is to qualify leads. You must respond politely. " +
      "x".repeat(500) + " For example: hi. {{name}}";
    expect(promptQuality(p).label).toBe("Excellent");
  });
});
```

- [ ] **Step 2: Implement quality**

Create `apps/web/components/agents/studio/promptQuality.ts`:

```typescript
export type QualityLabel = "Poor" | "Good" | "Excellent";

export interface QualityResult {
  score: number;
  label: QualityLabel;
  tokens: number;
  chars: number;
}

const ACTION_VERB_RE = /(you are|your job|you must|you should|always|never)/i;
const EXAMPLE_RE = /(for example|e\.g\.|example:|p\.\s?ej\.|por ejemplo)/i;

export function promptQuality(text: string): QualityResult {
  const trimmed = (text || "").trim();
  let score = 0;
  if (trimmed.length > 200) score += 30;
  if (ACTION_VERB_RE.test(trimmed)) score += 20;
  if (trimmed.includes("{{")) score += 20;
  if (trimmed.length > 500) score += 15;
  if (EXAMPLE_RE.test(trimmed)) score += 15;
  score = Math.min(100, score);
  const label: QualityLabel = score < 40 ? "Poor" : score <= 70 ? "Good" : "Excellent";
  return {
    score,
    label,
    chars: trimmed.length,
    tokens: Math.ceil(trimmed.length / 4),
  };
}
```

- [ ] **Step 3: Run, expect green**

```bash
pnpm --filter web test promptQuality
```

- [ ] **Step 4: PromptEditor component**

Create `apps/web/components/agents/studio/PromptEditor.tsx`:

```tsx
"use client";

import { useMemo } from "react";
import { Sparkles, BookOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import { promptQuality } from "./promptQuality";

interface Props {
  value: string;
  onChange: (v: string) => void;
  onGenerate?: () => void;
  onTemplates?: () => void;
}

export function PromptEditor({ value, onChange, onGenerate, onTemplates }: Props) {
  const q = useMemo(() => promptQuality(value), [value]);
  const tone =
    q.label === "Excellent"
      ? "text-emerald-400 border-emerald-500/30 bg-emerald-500/10"
      : q.label === "Good"
      ? "text-amber-400 border-amber-500/30 bg-amber-500/10"
      : "text-red-400 border-red-500/30 bg-red-500/10";

  return (
    <div className="flex h-full flex-col rounded-2xl border border-white/[0.08] bg-zinc-900/40">
      <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-2.5">
        <div className="flex items-center gap-2">
          <button
            onClick={onGenerate}
            type="button"
            className="flex items-center gap-1.5 rounded-lg bg-violet-500/15 px-2.5 py-1.5 text-xs text-violet-300 hover:bg-violet-500/25"
          >
            <Sparkles className="h-3.5 w-3.5" /> Generar con IA
          </button>
          <button
            onClick={onTemplates}
            type="button"
            className="flex items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-1.5 text-xs text-zinc-300 hover:bg-white/5"
          >
            <BookOpen className="h-3.5 w-3.5" /> Plantillas
          </button>
        </div>
        <div className={cn("rounded-md border px-2 py-0.5 text-[11px] font-medium", tone)}>
          {q.label} · {q.score}
        </div>
      </div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        className="min-h-[260px] flex-1 resize-none bg-transparent px-4 py-3 font-mono text-[13px] leading-relaxed text-zinc-100 placeholder-zinc-600 outline-none"
        placeholder="Escribí el system prompt del agente o usá el generador con IA…"
      />
      <div className="flex items-center justify-between border-t border-white/[0.06] px-4 py-2 text-[11px] text-zinc-500">
        <span>{q.chars} chars</span>
        <span>~{q.tokens} tokens</span>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: ModelPicker component**

Create `apps/web/components/agents/studio/ModelPicker.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { ChevronDown, Zap, Brain, Rocket } from "lucide-react";
import { cn } from "@/lib/utils";

interface Model {
  id: string;
  name: string;
  tier: "fast" | "smart" | "powerful";
  contextWindow: number;
}

interface ProviderGroup {
  provider: string;
  enabled: boolean;
  models: Model[];
}

interface Props {
  value: string;
  onChange: (v: string) => void;
}

const TIER_ICON = {
  fast: <Zap className="h-3.5 w-3.5" />,
  smart: <Brain className="h-3.5 w-3.5" />,
  powerful: <Rocket className="h-3.5 w-3.5" />,
};

const PROVIDER_NAME: Record<string, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  google: "Google AI",
  azure_openai: "Azure OpenAI",
};

export function ModelPicker({ value, onChange }: Props) {
  const [groups, setGroups] = useState<ProviderGroup[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    fetch("/api/providers")
      .then((r) => r.json())
      .then((rows: Array<{ provider: string; enabled: boolean; models: Model[] }>) => {
        setGroups(
          rows.map((r) => ({ provider: r.provider, enabled: r.enabled, models: r.models }))
        );
      })
      .catch(() => setGroups([]));
  }, []);

  const selected =
    groups.flatMap((g) => g.models).find((m) => m.id === value) ?? null;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between rounded-xl border border-white/[0.08] bg-zinc-800/40 px-3.5 py-2.5 text-sm text-zinc-100 hover:bg-zinc-800/60"
      >
        <span className="flex items-center gap-2">
          {selected ? TIER_ICON[selected.tier] : null}
          {selected ? selected.name : value || "Elegir modelo…"}
        </span>
        <ChevronDown className="h-4 w-4 text-zinc-500" />
      </button>
      {open && (
        <div className="absolute z-50 mt-1.5 max-h-72 w-full overflow-y-auto rounded-xl border border-white/[0.08] bg-zinc-900 shadow-xl">
          {groups.length === 0 && (
            <div className="px-3 py-3 text-xs text-zinc-500">
              Configura un proveedor en Ajustes para ver modelos.
            </div>
          )}
          {groups.map((g) => (
            <div key={g.provider}>
              <div className="border-b border-white/5 bg-zinc-900/80 px-3 py-1.5 text-[10px] uppercase tracking-wider text-zinc-500">
                {PROVIDER_NAME[g.provider] ?? g.provider}
              </div>
              {g.models.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => {
                    onChange(m.id);
                    setOpen(false);
                  }}
                  className={cn(
                    "flex w-full items-center justify-between px-3 py-2 text-left text-xs hover:bg-white/5",
                    m.id === value && "bg-violet-500/10 text-violet-200"
                  )}
                >
                  <span className="flex items-center gap-2 text-zinc-200">
                    {TIER_ICON[m.tier]} {m.name}
                  </span>
                  <span className="text-[10px] text-zinc-500">
                    {Math.round(m.contextWindow / 1000)}k
                  </span>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Commit**

```bash
git add apps/web/components/agents/studio apps/web/__tests__/promptQuality.test.ts
git commit -m "feat(agents): PromptEditor with quality scoring and ModelPicker"
```

---

### Task 11: Agent Studio — TestChat & Versions

**Files:**
- Create: `apps/web/components/agents/studio/TestChat.tsx`
- Create: `apps/web/components/agents/studio/VersionHistory.tsx`

- [ ] **Step 1: TestChat component**

Create `apps/web/components/agents/studio/TestChat.tsx`:

```tsx
"use client";

import { useRef, useState } from "react";
import { Send, Trash2, Loader2 } from "lucide-react";

interface Msg {
  role: "user" | "assistant";
  content: string;
}

interface Props {
  agentId: string;
  systemPrompt: string;
  model: string;
  temperature: number;
  maxTokens?: number;
}

export function TestChat({ agentId, systemPrompt, model, temperature, maxTokens }: Props) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [tokens, setTokens] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  async function send() {
    if (!input.trim() || loading) return;
    const next: Msg[] = [...messages, { role: "user", content: input.trim() }];
    setMessages(next);
    setInput("");
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/agents/${agentId}/test-chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          messages: next,
          systemPrompt,
          model,
          temperature,
          maxTokens,
        }),
      });
      const j = await r.json();
      if (!r.ok) {
        if (j.error === "PROVIDER_NOT_CONFIGURED")
          setError("Configura el proveedor en Ajustes para usar este modelo.");
        else setError(j.error || "Error");
        return;
      }
      setMessages((prev) => [...prev, { role: "assistant", content: j.content }]);
      setTokens((t) => t + (j.tokensUsed ?? 0));
      setTimeout(() => scrollRef.current?.scrollTo({ top: 99999, behavior: "smooth" }), 50);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex h-full flex-col rounded-2xl border border-white/[0.08] bg-zinc-900/40">
      <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-2.5">
        <span className="text-xs font-medium text-zinc-300">Test chat</span>
        <button
          onClick={() => {
            setMessages([]);
            setTokens(0);
            setError(null);
          }}
          className="text-zinc-500 hover:text-red-400"
          type="button"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {messages.length === 0 && (
          <div className="mt-8 text-center text-xs text-zinc-500">
            Escribí un mensaje para probar al agente con la configuración actual.
          </div>
        )}
        {messages.map((m, i) => (
          <div
            key={i}
            className={
              m.role === "user"
                ? "ml-auto max-w-[85%] rounded-2xl rounded-br-sm bg-violet-500/20 px-3.5 py-2 text-sm text-zinc-100"
                : "mr-auto max-w-[85%] rounded-2xl rounded-bl-sm border border-white/5 bg-zinc-800/60 px-3.5 py-2 text-sm text-zinc-100"
            }
          >
            {m.content}
          </div>
        ))}
        {loading && (
          <div className="mr-auto flex items-center gap-2 text-xs text-zinc-500">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Pensando…
          </div>
        )}
        {error && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
            {error}
          </div>
        )}
      </div>
      <div className="border-t border-white/[0.06] p-3">
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            rows={2}
            placeholder="Escribí un mensaje…"
            className="flex-1 resize-none rounded-xl border border-white/[0.08] bg-zinc-800/40 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 outline-none focus:border-violet-500/60"
          />
          <button
            onClick={send}
            disabled={!input.trim() || loading}
            className="rounded-xl bg-violet-500 p-2.5 text-white hover:bg-violet-400 disabled:opacity-40"
            type="button"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-1.5 text-[10px] text-zinc-600">Tokens usados: {tokens}</div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: VersionHistory component**

Create `apps/web/components/agents/studio/VersionHistory.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { History, RotateCcw, Plus } from "lucide-react";

interface Version {
  id: string;
  systemPrompt: string;
  model: string;
  label: string | null;
  createdAt: string;
}

interface Props {
  agentId: string;
  current: { systemPrompt: string; model: string; temperature?: number; maxTokens?: number };
  onRestored: () => void;
}

export function VersionHistory({ agentId, current, onRestored }: Props) {
  const [versions, setVersions] = useState<Version[]>([]);
  const [loading, setLoading] = useState(true);
  const [label, setLabel] = useState("");
  const [saving, setSaving] = useState(false);

  async function refresh() {
    setLoading(true);
    const r = await fetch(`/api/agents/${agentId}/versions`);
    const j = await r.json();
    setVersions(Array.isArray(j) ? j : []);
    setLoading(false);
  }
  useEffect(() => {
    refresh();
  }, [agentId]);

  async function saveVersion() {
    setSaving(true);
    await fetch(`/api/agents/${agentId}/versions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        systemPrompt: current.systemPrompt,
        model: current.model,
        temperature: current.temperature,
        maxTokens: current.maxTokens,
        label: label.trim() || null,
      }),
    });
    setLabel("");
    setSaving(false);
    refresh();
  }

  async function restore(vid: string) {
    await fetch(`/api/agents/${agentId}/versions/${vid}/restore`, { method: "POST" });
    onRestored();
    refresh();
  }

  return (
    <div className="rounded-2xl border border-white/[0.08] bg-zinc-900/40 p-4">
      <div className="mb-3 flex items-center gap-2 text-sm font-medium text-zinc-200">
        <History className="h-4 w-4 text-zinc-500" /> Historial de versiones
      </div>
      <div className="mb-3 flex items-center gap-2">
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Etiqueta (opcional)"
          className="flex-1 rounded-lg border border-white/[0.08] bg-zinc-800/40 px-2.5 py-1.5 text-xs text-zinc-100 placeholder-zinc-600 outline-none focus:border-violet-500/60"
        />
        <button
          onClick={saveVersion}
          disabled={saving}
          className="flex items-center gap-1 rounded-lg bg-violet-500/90 px-2.5 py-1.5 text-xs text-white hover:bg-violet-500 disabled:opacity-40"
          type="button"
        >
          <Plus className="h-3.5 w-3.5" /> Guardar versión
        </button>
      </div>
      {loading ? (
        <div className="text-xs text-zinc-500">Cargando…</div>
      ) : versions.length === 0 ? (
        <div className="text-xs text-zinc-500">Aún no hay versiones guardadas.</div>
      ) : (
        <ul className="space-y-1.5">
          {versions.map((v) => (
            <li
              key={v.id}
              className="flex items-center justify-between rounded-lg border border-white/5 bg-zinc-800/30 px-3 py-2 text-xs"
            >
              <div>
                <div className="text-zinc-200">{v.label ?? "Sin etiqueta"}</div>
                <div className="text-[10px] text-zinc-500">
                  {new Date(v.createdAt).toLocaleString()} · {v.model}
                </div>
              </div>
              <button
                onClick={() => restore(v.id)}
                className="flex items-center gap-1 text-zinc-400 hover:text-violet-300"
                type="button"
              >
                <RotateCcw className="h-3.5 w-3.5" /> Restaurar
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/agents/studio
git commit -m "feat(agents): TestChat and VersionHistory studio components"
```

---

### Task 12: Prompt Generator + Templates Modals

**Files:**
- Create: `apps/web/components/agents/studio/PromptGeneratorModal.tsx`
- Create: `apps/web/components/agents/studio/templates.ts`
- Create: `apps/web/components/agents/studio/TemplatePickerModal.tsx`

- [ ] **Step 1: Templates library**

Create `apps/web/components/agents/studio/templates.ts`:

```typescript
export interface AgentTemplate {
  id: string;
  category: "Sales" | "Support" | "HR" | "IT" | "Legal" | "Finance" | "Operations";
  name: string;
  description: string;
  systemPrompt: string;
  suggestedModel: string;
  suggestedTemperature: number;
}

export const TEMPLATES: AgentTemplate[] = [
  {
    id: "sales-lead-qualifier",
    category: "Sales",
    name: "Calificador de leads",
    description: "Califica leads según BANT (Budget, Authority, Need, Timeline).",
    systemPrompt: `You are a sales lead qualification assistant. Your job is to qualify inbound leads using the BANT framework: Budget, Authority, Need, Timeline.

You must:
- Ask one question at a time, conversationally
- Track which BANT dimensions are covered
- Output a structured summary at the end with a 0-100 score

For example, start with: "Hola, gracias por tu interés. ¿Qué problema estás tratando de resolver?"

When all four dimensions are covered, return a JSON summary:
{ "score": 0-100, "budget": "...", "authority": "...", "need": "...", "timeline": "...", "next_step": "..." }`,
    suggestedModel: "claude-sonnet-4-6",
    suggestedTemperature: 0.4,
  },
  {
    id: "sales-followup",
    category: "Sales",
    name: "Follow-up automático",
    description: "Hace seguimiento de oportunidades sin actividad reciente.",
    systemPrompt: `You are a sales follow-up specialist. You re-engage leads who haven't responded in 3+ days.

You must:
- Reference the last conversation specifically
- Add new value (a tip, case study, or question)
- Keep messages under 80 words
- Never sound desperate or pushy

Tone: professional, warm, brief.`,
    suggestedModel: "claude-haiku-4-5",
    suggestedTemperature: 0.7,
  },
  {
    id: "support-tier1",
    category: "Support",
    name: "Soporte nivel 1",
    description: "Resuelve consultas frecuentes y escala lo complejo.",
    systemPrompt: `You are a Tier 1 customer support agent. You handle common questions about our product and escalate complex issues to humans.

You must:
- Greet warmly and acknowledge the user's question
- Search known issues before answering
- Escalate to a human if: refund requested, billing dispute, security concern, or after 2 failed attempts
- Always end with "¿Te ayudó esto?" so we can measure satisfaction

Never make up policy. If unsure, escalate.`,
    suggestedModel: "claude-sonnet-4-6",
    suggestedTemperature: 0.3,
  },
  {
    id: "support-onboarding",
    category: "Support",
    name: "Onboarding guiado",
    description: "Guía a nuevos usuarios paso a paso por el setup.",
    systemPrompt: `You are an onboarding assistant. Guide brand-new users through the initial setup of our platform in 3-5 steps.

You must:
- Welcome them by name
- Ask one setup question at a time
- Confirm each step before moving on
- Detect frustration (e.g. "esto es complicado") and offer a live human

Tone: encouraging, patient.`,
    suggestedModel: "claude-haiku-4-5",
    suggestedTemperature: 0.6,
  },
  {
    id: "hr-recruiter",
    category: "HR",
    name: "Pre-screen de candidatos",
    description: "Pre-entrevista candidatos para roles específicos.",
    systemPrompt: `You are an HR pre-screening assistant. You conduct initial 5-minute interviews for {{role_name}} candidates.

You must:
- Ask 5 questions: motivation, relevant experience, strongest skill, deal-breakers (compensation/location), availability
- Never make hiring decisions — only summarize
- Output a 200-word summary at the end

Tone: friendly, neutral, never leading.`,
    suggestedModel: "claude-sonnet-4-6",
    suggestedTemperature: 0.5,
  },
  {
    id: "hr-handbook",
    category: "HR",
    name: "Asistente del manual del empleado",
    description: "Responde preguntas sobre políticas internas.",
    systemPrompt: `You are an HR policy assistant. You answer employee questions about vacation, benefits, expenses, and company policies based on the official handbook.

You must:
- Quote the policy section when relevant
- Never invent policy — say "Voy a verificarlo con HR" when unsure
- Be neutral on sensitive topics (harassment, terminations) and route to a human

Tone: professional, clear, brief.`,
    suggestedModel: "claude-sonnet-4-6",
    suggestedTemperature: 0.2,
  },
  {
    id: "it-helpdesk",
    category: "IT",
    name: "IT helpdesk",
    description: "Resuelve problemas técnicos comunes (VPN, contraseñas, accesos).",
    systemPrompt: `You are an internal IT helpdesk agent. You handle requests for password resets, VPN issues, software installation, and access provisioning.

You must:
- Verify the user's identity before doing anything (full name + employee ID)
- Walk them through the fix step by step
- Open a ticket if it can't be resolved in chat
- Escalate security incidents immediately

Never share credentials in chat.`,
    suggestedModel: "claude-haiku-4-5",
    suggestedTemperature: 0.3,
  },
  {
    id: "legal-nda",
    category: "Legal",
    name: "Triage de NDAs",
    description: "Revisa NDAs simples y marca cláusulas riesgosas.",
    systemPrompt: `You are a legal triage assistant. You review simple, standard NDAs and flag clauses that need attorney review.

You must:
- Identify: party names, term, jurisdiction, IP ownership, non-solicit clauses
- Flag any unusual or one-sided language
- Never give legal advice — only triage and summarize
- Always recommend attorney review for changes

Output: a checklist of what's standard vs. what needs review.`,
    suggestedModel: "claude-opus-4-7",
    suggestedTemperature: 0.2,
  },
  {
    id: "finance-expense",
    category: "Finance",
    name: "Aprobador de gastos",
    description: "Revisa solicitudes de gastos contra la política.",
    systemPrompt: `You are an expense report reviewer. You check submitted expenses against company policy.

You must:
- Verify amount, category, and receipt are present
- Flag if: > $500 without approval, missing receipt, personal items, alcohol/entertainment > $50
- Approve only when fully compliant
- Otherwise, request the missing info politely

Tone: brief and clear.`,
    suggestedModel: "claude-haiku-4-5",
    suggestedTemperature: 0.1,
  },
  {
    id: "ops-status",
    category: "Operations",
    name: "Reporte de status diario",
    description: "Genera resúmenes de status de equipos para standups.",
    systemPrompt: `You are an operations standup assistant. You collect status updates from team members and produce a daily summary.

You must:
- Ask: "¿Qué hiciste ayer? ¿Qué vas a hacer hoy? ¿Tenés bloqueos?"
- Wait for all responses before summarizing
- Highlight blockers in red flag format
- Keep the final summary under 200 words

Format: Markdown with sections per team member.`,
    suggestedModel: "claude-sonnet-4-6",
    suggestedTemperature: 0.4,
  },
];
```

- [ ] **Step 2: Templates modal**

Create `apps/web/components/agents/studio/TemplatePickerModal.tsx`:

```tsx
"use client";

import { useState } from "react";
import { X, BookOpen } from "lucide-react";
import { TEMPLATES, type AgentTemplate } from "./templates";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onClose: () => void;
  onPick: (t: AgentTemplate) => void;
}

const CATEGORIES = ["All", "Sales", "Support", "HR", "IT", "Legal", "Finance", "Operations"] as const;

export function TemplatePickerModal({ open, onClose, onPick }: Props) {
  const [cat, setCat] = useState<(typeof CATEGORIES)[number]>("All");
  if (!open) return null;
  const filtered = cat === "All" ? TEMPLATES : TEMPLATES.filter((t) => t.category === cat);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-zinc-950 shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/[0.08] px-5 py-4">
          <div className="flex items-center gap-2.5 text-sm font-medium text-zinc-100">
            <BookOpen className="h-4 w-4 text-violet-400" /> Plantillas profesionales
          </div>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-200" type="button">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex gap-1.5 overflow-x-auto border-b border-white/[0.06] px-5 py-2.5">
          {CATEGORIES.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCat(c)}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs",
                cat === c
                  ? "bg-violet-500/20 text-violet-300"
                  : "text-zinc-500 hover:text-zinc-300"
              )}
            >
              {c}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-1 gap-2 overflow-y-auto p-4 sm:grid-cols-2">
          {filtered.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => {
                onPick(t);
                onClose();
              }}
              className="rounded-xl border border-white/[0.08] bg-zinc-900/40 p-3.5 text-left hover:border-violet-500/40 hover:bg-zinc-900/60"
            >
              <div className="mb-1 flex items-center gap-2">
                <span className="rounded-md bg-violet-500/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-violet-300">
                  {t.category}
                </span>
                <span className="text-sm font-medium text-zinc-100">{t.name}</span>
              </div>
              <p className="text-xs text-zinc-500">{t.description}</p>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Generator modal**

Create `apps/web/components/agents/studio/PromptGeneratorModal.tsx`:

```tsx
"use client";

import { useState } from "react";
import { X, Sparkles, ArrowRight, RotateCcw, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  agentId: string;
  onClose: () => void;
  onPick: (prompt: string) => void;
}

const TONES = ["professional", "friendly", "formal", "direct"] as const;

export function PromptGeneratorModal({ open, agentId, onClose, onPick }: Props) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [description, setDescription] = useState("");
  const [tone, setTone] = useState<(typeof TONES)[number]>("professional");
  const [companyName, setCompanyName] = useState("");
  const [industry, setIndustry] = useState("");
  const [variations, setVariations] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  async function generate() {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/agents/${agentId}/generate-prompt`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          description: description.trim(),
          tone,
          context: { companyName, industry },
        }),
      });
      const j = await r.json();
      if (!r.ok) {
        if (j.error === "PROVIDER_NOT_CONFIGURED")
          setError("Configura un proveedor en Ajustes para usar el generador.");
        else setError(j.error || "Error");
        return;
      }
      setVariations(j.variations);
      setStep(3);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-zinc-950 shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/[0.08] px-5 py-4">
          <div className="flex items-center gap-2.5 text-sm font-medium text-zinc-100">
            <Sparkles className="h-4 w-4 text-violet-400" /> Generador de prompts con IA · Paso {step}/3
          </div>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-200" type="button">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {step === 1 && (
            <div>
              <label className="mb-2 block text-xs font-medium text-zinc-300">
                ¿Qué hace este agente?
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={6}
                placeholder="Necesito un agente que califique leads B2B según BANT y los enrute al vendedor correcto…"
                className="w-full rounded-xl border border-white/[0.08] bg-zinc-900 px-3 py-2.5 text-sm text-zinc-100 placeholder-zinc-600 outline-none focus:border-violet-500/60"
              />
              <p className="mt-1.5 text-[11px] text-zinc-500">
                {description.length} / 50–500 caracteres
              </p>
            </div>
          )}
          {step === 2 && (
            <div className="space-y-4">
              <div>
                <label className="mb-2 block text-xs font-medium text-zinc-300">Tono</label>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {TONES.map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setTone(t)}
                      className={cn(
                        "rounded-lg border px-2 py-2 text-xs",
                        tone === t
                          ? "border-violet-500/50 bg-violet-500/15 text-violet-200"
                          : "border-white/[0.08] text-zinc-400 hover:border-white/20"
                      )}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="mb-2 block text-xs font-medium text-zinc-300">
                  Empresa (opcional)
                </label>
                <input
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  className="w-full rounded-xl border border-white/[0.08] bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-violet-500/60"
                />
              </div>
              <div>
                <label className="mb-2 block text-xs font-medium text-zinc-300">
                  Industria (opcional)
                </label>
                <input
                  value={industry}
                  onChange={(e) => setIndustry(e.target.value)}
                  className="w-full rounded-xl border border-white/[0.08] bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-violet-500/60"
                />
              </div>
            </div>
          )}
          {step === 3 && (
            <div className="space-y-3">
              {error && (
                <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                  {error}
                </div>
              )}
              {variations.map((v, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => {
                    onPick(v);
                    onClose();
                  }}
                  className="block w-full rounded-xl border border-white/[0.08] bg-zinc-900/60 p-4 text-left hover:border-violet-500/40 hover:bg-zinc-900"
                >
                  <div className="mb-1 text-xs font-medium text-violet-300">Variación {i + 1}</div>
                  <pre className="whitespace-pre-wrap font-mono text-[12px] text-zinc-200">
                    {v.length > 400 ? v.slice(0, 400) + "…" : v}
                  </pre>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-white/[0.06] bg-zinc-950 px-5 py-3">
          <button
            type="button"
            onClick={() => {
              if (step === 3) {
                setStep(2);
                setVariations([]);
              } else if (step === 2) setStep(1);
              else onClose();
            }}
            className="text-xs text-zinc-500 hover:text-zinc-300"
          >
            {step === 1 ? "Cancelar" : "Atrás"}
          </button>
          <div className="flex items-center gap-2">
            {step === 3 && (
              <button
                type="button"
                onClick={generate}
                className="flex items-center gap-1 rounded-lg border border-white/10 px-3 py-1.5 text-xs text-zinc-200 hover:bg-white/5"
              >
                <RotateCcw className="h-3.5 w-3.5" /> Regenerar
              </button>
            )}
            {step !== 3 && (
              <button
                type="button"
                disabled={loading || (step === 1 && description.trim().length < 20)}
                onClick={() => {
                  if (step === 1) setStep(2);
                  else generate();
                }}
                className="flex items-center gap-1 rounded-lg bg-violet-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-400 disabled:opacity-40"
              >
                {loading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <>
                    {step === 2 ? "Generar" : "Siguiente"} <ArrowRight className="h-3.5 w-3.5" />
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/components/agents/studio
git commit -m "feat(agents): prompt generator wizard and template picker modals"
```

---

### Task 13: Agent Studio Page + Navigation Update

**Files:**
- Create: `apps/web/components/agents/studio/AgentStudio.tsx`
- Create: `apps/web/app/[locale]/(shell)/agents/[id]/page.tsx`
- Modify: `apps/web/components/agents/AgentsPageClient.tsx` (route on click)
- Modify: `apps/web/lib/db-queries.ts` (add `getAgent(id, workspaceId)`)

- [ ] **Step 1: Add getAgent query**

Edit `apps/web/lib/db-queries.ts` — add at the end:

```typescript
export async function getAgent(id: string, workspaceId: string) {
  const db = getDb();
  const [a] = await db
    .select()
    .from(schema.agents)
    .where(and(eq(schema.agents.id, id), eq(schema.agents.workspaceId, workspaceId)))
    .limit(1);
  return a ?? null;
}
```

- [ ] **Step 2: AgentStudio main component**

Create `apps/web/components/agents/studio/AgentStudio.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Save, Loader2 } from "lucide-react";
import { PromptEditor } from "./PromptEditor";
import { ModelPicker } from "./ModelPicker";
import { TestChat } from "./TestChat";
import { VersionHistory } from "./VersionHistory";
import { PromptGeneratorModal } from "./PromptGeneratorModal";
import { TemplatePickerModal } from "./TemplatePickerModal";

interface AgentDTO {
  id: string;
  name: string;
  role: string;
  systemPrompt: string;
  model: string;
  status: string;
  temperature: string | number | null;
  maxTokens: number | null;
  teamId: string | null;
}

export function AgentStudio({ agent }: { agent: AgentDTO }) {
  const router = useRouter();
  const [name, setName] = useState(agent.name);
  const [role, setRole] = useState(agent.role);
  const [systemPrompt, setSystemPrompt] = useState(agent.systemPrompt);
  const [model, setModel] = useState(agent.model);
  const [temperature, setTemperature] = useState(
    agent.temperature ? Number(agent.temperature) : 0.7
  );
  const [maxTokens, setMaxTokens] = useState<number | undefined>(agent.maxTokens ?? undefined);
  const [tab, setTab] = useState<"config" | "versions">("config");
  const [genOpen, setGenOpen] = useState(false);
  const [tplOpen, setTplOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  async function save() {
    setSaving(true);
    const r = await fetch(`/api/agents/${agent.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name,
        role,
        systemPrompt,
        model,
        temperature,
        maxTokens,
      }),
    });
    setSaving(false);
    if (r.ok) {
      setSavedAt(new Date());
      router.refresh();
    }
  }

  return (
    <>
      <div className="flex h-screen flex-col bg-black">
        {/* header */}
        <div className="flex items-center justify-between border-b border-white/[0.06] px-6 py-3">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => router.back()}
              className="text-zinc-400 hover:text-zinc-100"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="bg-transparent text-sm font-medium text-zinc-100 outline-none focus:underline"
            />
            <span className="text-zinc-600">·</span>
            <input
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="bg-transparent text-xs text-zinc-400 outline-none focus:underline"
            />
          </div>
          <div className="flex items-center gap-3">
            {savedAt && (
              <span className="text-[11px] text-zinc-500">
                Guardado {savedAt.toLocaleTimeString()}
              </span>
            )}
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="flex items-center gap-1.5 rounded-lg bg-violet-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-400 disabled:opacity-40"
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              Guardar
            </button>
          </div>
        </div>

        {/* split */}
        <div className="flex flex-1 overflow-hidden">
          {/* left 60% */}
          <div className="flex w-[60%] flex-col gap-3 overflow-y-auto border-r border-white/[0.06] p-4">
            <div className="flex gap-1.5">
              {(["config", "versions"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTab(t)}
                  className={
                    tab === t
                      ? "rounded-lg bg-zinc-800 px-3 py-1.5 text-xs text-zinc-100"
                      : "rounded-lg px-3 py-1.5 text-xs text-zinc-500 hover:text-zinc-300"
                  }
                >
                  {t === "config" ? "Configuración" : "Versiones"}
                </button>
              ))}
            </div>

            {tab === "config" ? (
              <>
                <div className="flex-1 min-h-[300px]">
                  <PromptEditor
                    value={systemPrompt}
                    onChange={setSystemPrompt}
                    onGenerate={() => setGenOpen(true)}
                    onTemplates={() => setTplOpen(true)}
                  />
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div>
                    <label className="mb-1.5 block text-[11px] uppercase tracking-wider text-zinc-500">
                      Modelo
                    </label>
                    <ModelPicker value={model} onChange={setModel} />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-[11px] uppercase tracking-wider text-zinc-500">
                      Temperature: {temperature.toFixed(2)}
                    </label>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={temperature}
                      onChange={(e) => setTemperature(Number(e.target.value))}
                      className="w-full accent-violet-500"
                    />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-[11px] uppercase tracking-wider text-zinc-500">
                      Max tokens
                    </label>
                    <input
                      type="number"
                      value={maxTokens ?? ""}
                      onChange={(e) =>
                        setMaxTokens(e.target.value ? Number(e.target.value) : undefined)
                      }
                      placeholder="default"
                      className="w-full rounded-lg border border-white/[0.08] bg-zinc-800/40 px-2.5 py-2 text-sm text-zinc-100 outline-none focus:border-violet-500/60"
                    />
                  </div>
                </div>
              </>
            ) : (
              <VersionHistory
                agentId={agent.id}
                current={{ systemPrompt, model, temperature, maxTokens }}
                onRestored={() => router.refresh()}
              />
            )}
          </div>

          {/* right 40% */}
          <div className="w-[40%] overflow-hidden p-4">
            <TestChat
              agentId={agent.id}
              systemPrompt={systemPrompt}
              model={model}
              temperature={temperature}
              maxTokens={maxTokens}
            />
          </div>
        </div>
      </div>

      <PromptGeneratorModal
        open={genOpen}
        agentId={agent.id}
        onClose={() => setGenOpen(false)}
        onPick={(p) => setSystemPrompt(p)}
      />
      <TemplatePickerModal
        open={tplOpen}
        onClose={() => setTplOpen(false)}
        onPick={(t) => {
          setSystemPrompt(t.systemPrompt);
          setModel(t.suggestedModel);
          setTemperature(t.suggestedTemperature);
        }}
      />
    </>
  );
}
```

- [ ] **Step 3: Studio page route**

Create `apps/web/app/[locale]/(shell)/agents/[id]/page.tsx`:

```tsx
import { notFound, redirect } from "next/navigation";
import { getAgent } from "@/lib/db-queries";
import { getCurrentWorkspace } from "@/lib/workspace";
import { AgentStudio } from "@/components/agents/studio/AgentStudio";

export default async function AgentStudioPage({
  params,
}: {
  params: Promise<{ id: string; locale: string }>;
}) {
  const { id, locale } = await params;
  const ws = await getCurrentWorkspace();
  if (!ws) redirect(`/${locale}/login`);
  const agent = await getAgent(id, ws.workspace.id);
  if (!agent) notFound();
  return (
    <AgentStudio
      agent={{
        id: agent.id,
        name: agent.name,
        role: agent.role,
        systemPrompt: agent.systemPrompt,
        model: agent.model,
        status: agent.status,
        temperature: agent.temperature,
        maxTokens: agent.maxTokens,
        teamId: agent.teamId,
      }}
    />
  );
}
```

Note: this page replaces the shell layout because `(shell)` routes layout takes effect. If the shell wraps with sidebar, we want full-screen. Move this file to `apps/web/app/[locale]/agents/[id]/page.tsx` (outside `(shell)`) so it gets a full-page layout. Adjust accordingly.

- [ ] **Step 4: Update agents list to navigate**

Edit `apps/web/components/agents/AgentsPageClient.tsx` — replace the card click handler. Find the agent card click and change:

```tsx
// before:
onClick={() => setEditingAgent(agent)}

// after — use locale from props or pathname:
const locale = typeof window !== "undefined" ? window.location.pathname.split("/")[1] : "es";
onClick={() => router.push(`/${locale}/agents/${agent.id}`)}
```

(For correctness, accept `locale` as a prop from the page-level component, or use `useParams` from `next/navigation`.)

Keep the "+ Nuevo Agente" modal as-is for quick creation; after create, push to studio with the new id.

- [ ] **Step 5: Smoke test**

Visit `http://localhost:3333/<locale>/agents`, click an agent. Should land on the Studio. Edit the prompt, click Save. Use Test chat (requires AI provider configured).

- [ ] **Step 6: Commit**

```bash
git add apps/web/components/agents apps/web/app/[locale]/agents apps/web/lib/db-queries.ts
git commit -m "feat(agents): full-page Agent Studio with split-pane editor and live test chat"
```

---

## Phase C — Flow Builder

### Task 14: Flow CRUD API

**Files:**
- Create: `apps/web/app/api/flows/route.ts`
- Create: `apps/web/app/api/flows/[id]/route.ts`

- [ ] **Step 1: Install xyflow**

```bash
pnpm --filter web add @xyflow/react
```

- [ ] **Step 2: List + create**

Create `apps/web/app/api/flows/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { createId } from "@paralleldrive/cuid2";
import { getDb, schema } from "@orchester/db";
import { eq, desc } from "drizzle-orm";
import { getCurrentWorkspace } from "@/lib/workspace";

export async function GET() {
  const ws = await getCurrentWorkspace();
  if (!ws) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.flows)
    .where(eq(schema.flows.workspaceId, ws.workspace.id))
    .orderBy(desc(schema.flows.updatedAt));
  return NextResponse.json(rows);
}

export async function POST(req: Request) {
  const ws = await getCurrentWorkspace();
  if (!ws) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json();
  const { name, description } = body;
  if (!name?.trim())
    return NextResponse.json({ error: "name required" }, { status: 400 });
  const db = getDb();
  const triggerNodeId = createId();
  const [row] = await db
    .insert(schema.flows)
    .values({
      id: createId(),
      workspaceId: ws.workspace.id,
      name: name.trim(),
      description: description ?? null,
      nodes: [
        {
          id: triggerNodeId,
          type: "trigger",
          label: "Inicio",
          config: { trigger: "manual" },
          position: { x: 100, y: 100 },
        },
      ],
      edges: [],
    })
    .returning();
  return NextResponse.json(row, { status: 201 });
}
```

- [ ] **Step 3: Get/update/delete**

Create `apps/web/app/api/flows/[id]/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { getDb, schema } from "@orchester/db";
import { eq, and } from "drizzle-orm";
import { getCurrentWorkspace } from "@/lib/workspace";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ws = await getCurrentWorkspace();
  if (!ws) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.flows)
    .where(and(eq(schema.flows.id, id), eq(schema.flows.workspaceId, ws.workspace.id)))
    .limit(1);
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(row);
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ws = await getCurrentWorkspace();
  if (!ws) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const body = await req.json();
  const { name, description, status, trigger, triggerConfig, nodes, edges, variables, enabled } =
    body;
  const db = getDb();
  const [row] = await db
    .update(schema.flows)
    .set({
      ...(name !== undefined && { name: name.trim() }),
      ...(description !== undefined && { description }),
      ...(status !== undefined && { status }),
      ...(trigger !== undefined && { trigger }),
      ...(triggerConfig !== undefined && { triggerConfig }),
      ...(nodes !== undefined && { nodes }),
      ...(edges !== undefined && { edges }),
      ...(variables !== undefined && { variables }),
      ...(enabled !== undefined && { enabled }),
      updatedAt: new Date(),
    })
    .where(and(eq(schema.flows.id, id), eq(schema.flows.workspaceId, ws.workspace.id)))
    .returning();
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(row);
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ws = await getCurrentWorkspace();
  if (!ws) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const db = getDb();
  const [d] = await db
    .delete(schema.flows)
    .where(and(eq(schema.flows.id, id), eq(schema.flows.workspaceId, ws.workspace.id)))
    .returning({ id: schema.flows.id });
  if (!d) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/api/flows
git commit -m "feat(api): flow CRUD endpoints"
```

---

### Task 15: Flow Engine (Server Executor)

**Files:**
- Create: `apps/web/lib/flow-engine.ts`
- Create: `apps/web/__tests__/flow-engine.test.ts`

- [ ] **Step 1: Engine test**

Create `apps/web/__tests__/flow-engine.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";

vi.mock("@orchester/db", () => ({
  getDb: vi.fn(),
  schema: {},
}));
vi.mock("../lib/llm-call", () => ({
  llmCall: vi.fn(async () => ({ content: "ok", tokensUsed: 5, model: "claude-haiku-4-5" })),
}));

import { evaluateCondition, interpolate } from "../lib/flow-engine";

describe("interpolate", () => {
  it("replaces {{var}} from context", () => {
    expect(interpolate("Hello {{name}}", { name: "Lucas" })).toBe("Hello Lucas");
  });
  it("supports nested paths", () => {
    expect(interpolate("{{user.email}}", { user: { email: "x@y" } })).toBe("x@y");
  });
  it("leaves unknown vars as empty string", () => {
    expect(interpolate("Hello {{missing}}", {})).toBe("Hello ");
  });
});

describe("evaluateCondition", () => {
  it("equals", () => {
    expect(evaluateCondition({ left: "{{a}}", op: "==", right: "1" }, { a: "1" })).toBe(true);
    expect(evaluateCondition({ left: "{{a}}", op: "==", right: "2" }, { a: "1" })).toBe(false);
  });
  it("contains", () => {
    expect(
      evaluateCondition({ left: "{{a}}", op: "contains", right: "lo" }, { a: "hello" })
    ).toBe(true);
  });
  it("gt for numbers", () => {
    expect(evaluateCondition({ left: "{{a}}", op: ">", right: "5" }, { a: "10" })).toBe(true);
  });
});
```

- [ ] **Step 2: Implement engine**

Create `apps/web/lib/flow-engine.ts`:

```typescript
import "server-only";
import { createId } from "@paralleldrive/cuid2";
import { getDb, schema } from "@orchester/db";
import { eq } from "drizzle-orm";
import { llmCall } from "./llm-call";

export interface FlowNode {
  id: string;
  type: "trigger" | "agent" | "condition" | "http" | "transform" | "delay" | "notify" | "end";
  label: string;
  config: Record<string, unknown>;
  position: { x: number; y: number };
}
export interface FlowEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  label?: string;
}

export interface RunContext {
  variables: Record<string, unknown>;
  output: Record<string, unknown>;
}

export function interpolate(template: string, ctx: Record<string, unknown>): string {
  return template.replace(/\{\{([^}]+)\}\}/g, (_, path: string) => {
    const parts = path.trim().split(".");
    let v: unknown = ctx;
    for (const p of parts) {
      if (v && typeof v === "object" && p in (v as Record<string, unknown>)) {
        v = (v as Record<string, unknown>)[p];
      } else {
        return "";
      }
    }
    return v == null ? "" : String(v);
  });
}

export interface Condition {
  left: string;
  op: "==" | "!=" | ">" | "<" | ">=" | "<=" | "contains";
  right: string;
}

export function evaluateCondition(c: Condition, ctx: Record<string, unknown>): boolean {
  const l = interpolate(c.left, ctx);
  const r = interpolate(c.right, ctx);
  switch (c.op) {
    case "==":
      return l === r;
    case "!=":
      return l !== r;
    case "contains":
      return l.includes(r);
    case ">":
      return Number(l) > Number(r);
    case "<":
      return Number(l) < Number(r);
    case ">=":
      return Number(l) >= Number(r);
    case "<=":
      return Number(l) <= Number(r);
  }
}

export async function executeFlow({
  flowId,
  workspaceId,
  triggerSource,
  input,
}: {
  flowId: string;
  workspaceId: string;
  triggerSource: string;
  input: Record<string, unknown>;
}): Promise<{ runId: string; status: "succeeded" | "failed"; error?: string }> {
  const db = getDb();
  const [flow] = await db
    .select()
    .from(schema.flows)
    .where(eq(schema.flows.id, flowId))
    .limit(1);
  if (!flow) throw new Error("Flow not found");

  const runId = createId();
  await db.insert(schema.flowRuns).values({
    id: runId,
    flowId,
    workspaceId,
    status: "running",
    triggerSource,
    input,
  });

  const ctx: RunContext = {
    variables: { ...(flow.variables ?? {}), ...input },
    output: {},
  };

  const nodes = (flow.nodes ?? []) as FlowNode[];
  const edges = (flow.edges ?? []) as FlowEdge[];
  const start = nodes.find((n) => n.type === "trigger");
  if (!start) {
    await db
      .update(schema.flowRuns)
      .set({ status: "failed", error: "No trigger node", completedAt: new Date() })
      .where(eq(schema.flowRuns.id, runId));
    return { runId, status: "failed", error: "No trigger node" };
  }

  try {
    await runFromNode(start.id, nodes, edges, ctx, runId, workspaceId, db);
    await db
      .update(schema.flowRuns)
      .set({ status: "succeeded", output: ctx.output, completedAt: new Date() })
      .where(eq(schema.flowRuns.id, runId));
    await db
      .update(schema.flows)
      .set({ lastRunAt: new Date() })
      .where(eq(schema.flows.id, flowId));
    return { runId, status: "succeeded" };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await db
      .update(schema.flowRuns)
      .set({ status: "failed", error: msg, completedAt: new Date() })
      .where(eq(schema.flowRuns.id, runId));
    return { runId, status: "failed", error: msg };
  }
}

async function runFromNode(
  nodeId: string,
  nodes: FlowNode[],
  edges: FlowEdge[],
  ctx: RunContext,
  runId: string,
  workspaceId: string,
  db: ReturnType<typeof getDb>,
  depth = 0
): Promise<void> {
  if (depth > 50) throw new Error("Flow exceeded max depth (50)");
  const node = nodes.find((n) => n.id === nodeId);
  if (!node || node.type === "end") return;

  const stepId = createId();
  await db.insert(schema.flowRunSteps).values({
    id: stepId,
    runId,
    nodeId: node.id,
    nodeType: node.type,
    status: "running",
    input: { ...ctx.variables },
  });

  let nextHandle: string | undefined;
  let stepOutput: Record<string, unknown> = {};

  try {
    if (node.type === "trigger") {
      // pass-through
    } else if (node.type === "agent") {
      const agentId = node.config.agentId as string | undefined;
      const userMessage = interpolate(
        (node.config.message as string) ?? "{{input}}",
        ctx.variables
      );
      if (!agentId) throw new Error("agent node missing agentId");
      const [agent] = await db
        .select()
        .from(schema.agents)
        .where(eq(schema.agents.id, agentId))
        .limit(1);
      if (!agent) throw new Error(`agent not found: ${agentId}`);
      const result = await llmCall({
        workspaceId,
        model: agent.model,
        systemPrompt: agent.systemPrompt,
        messages: [{ role: "user", content: userMessage }],
        temperature: agent.temperature ? Number(agent.temperature) : 0.7,
        maxTokens: agent.maxTokens ?? undefined,
      });
      const outputVar = (node.config.outputVar as string) ?? "agentResult";
      ctx.variables[outputVar] = result.content;
      stepOutput = { content: result.content, tokensUsed: result.tokensUsed };
    } else if (node.type === "condition") {
      const cond = node.config.condition as Condition;
      const passed = evaluateCondition(cond, ctx.variables);
      nextHandle = passed ? "true" : "false";
      stepOutput = { passed };
    } else if (node.type === "http") {
      const method = (node.config.method as string) ?? "GET";
      const url = interpolate(node.config.url as string, ctx.variables);
      const r = await fetch(url, {
        method,
        headers: (node.config.headers as Record<string, string>) ?? {},
        body: method === "GET" ? undefined : interpolate(
          (node.config.body as string) ?? "",
          ctx.variables
        ),
      });
      const text = await r.text();
      let body: unknown = text;
      try {
        body = JSON.parse(text);
      } catch {}
      const outputVar = (node.config.outputVar as string) ?? "httpResult";
      ctx.variables[outputVar] = body;
      stepOutput = { status: r.status, body };
    } else if (node.type === "transform") {
      const target = node.config.target as string;
      const value = interpolate((node.config.value as string) ?? "", ctx.variables);
      ctx.variables[target] = value;
      stepOutput = { [target]: value };
    } else if (node.type === "delay") {
      const ms = Math.min(30000, Number(node.config.ms ?? 1000));
      await new Promise((res) => setTimeout(res, ms));
      stepOutput = { ms };
    } else if (node.type === "notify") {
      // record-only for now; channel integration plugged in later
      stepOutput = {
        channel: node.config.channel,
        message: interpolate((node.config.message as string) ?? "", ctx.variables),
      };
    }

    await db
      .update(schema.flowRunSteps)
      .set({ status: "succeeded", output: stepOutput, completedAt: new Date() })
      .where(eq(schema.flowRunSteps.id, stepId));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await db
      .update(schema.flowRunSteps)
      .set({ status: "failed", error: msg, completedAt: new Date() })
      .where(eq(schema.flowRunSteps.id, stepId));
    throw e;
  }

  // follow edges
  const outgoing = edges.filter(
    (e) => e.source === node.id && (nextHandle == null || e.sourceHandle === nextHandle)
  );
  for (const ed of outgoing) {
    await runFromNode(ed.target, nodes, edges, ctx, runId, workspaceId, db, depth + 1);
  }
}
```

- [ ] **Step 3: Run engine tests**

```bash
pnpm --filter web test flow-engine
```

Expected: 6 passing.

- [ ] **Step 4: Commit**

```bash
git add apps/web/lib/flow-engine.ts apps/web/__tests__/flow-engine.test.ts
git commit -m "feat(web): flow engine with agent/condition/http/transform/delay nodes"
```

---

### Task 16: Flow Run API + Trigger

**Files:**
- Create: `apps/web/app/api/flows/[id]/run/route.ts`
- Create: `apps/web/app/api/flows/[id]/runs/route.ts`
- Create: `apps/web/app/api/flow-runs/[id]/route.ts`

- [ ] **Step 1: Trigger run**

Create `apps/web/app/api/flows/[id]/run/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { getCurrentWorkspace } from "@/lib/workspace";
import { executeFlow } from "@/lib/flow-engine";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ws = await getCurrentWorkspace();
  if (!ws) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const result = await executeFlow({
    flowId: id,
    workspaceId: ws.workspace.id,
    triggerSource: "manual",
    input: body?.input ?? {},
  });
  return NextResponse.json(result);
}
```

- [ ] **Step 2: List runs**

Create `apps/web/app/api/flows/[id]/runs/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { getDb, schema } from "@orchester/db";
import { eq, and, desc } from "drizzle-orm";
import { getCurrentWorkspace } from "@/lib/workspace";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ws = await getCurrentWorkspace();
  if (!ws) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.flowRuns)
    .where(
      and(eq(schema.flowRuns.flowId, id), eq(schema.flowRuns.workspaceId, ws.workspace.id))
    )
    .orderBy(desc(schema.flowRuns.startedAt))
    .limit(50);
  return NextResponse.json(rows);
}
```

- [ ] **Step 3: Run detail with steps**

Create `apps/web/app/api/flow-runs/[id]/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { getDb, schema } from "@orchester/db";
import { eq, and } from "drizzle-orm";
import { getCurrentWorkspace } from "@/lib/workspace";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ws = await getCurrentWorkspace();
  if (!ws) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const db = getDb();
  const [run] = await db
    .select()
    .from(schema.flowRuns)
    .where(and(eq(schema.flowRuns.id, id), eq(schema.flowRuns.workspaceId, ws.workspace.id)))
    .limit(1);
  if (!run) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const steps = await db
    .select()
    .from(schema.flowRunSteps)
    .where(eq(schema.flowRunSteps.runId, id))
    .orderBy(schema.flowRunSteps.startedAt);
  return NextResponse.json({ run, steps });
}
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/api/flows apps/web/app/api/flow-runs
git commit -m "feat(api): manual flow run trigger and runs/steps inspection endpoints"
```

---

### Task 17: Flow Builder UI — Canvas

**Files:**
- Create: `apps/web/components/flows/FlowBuilder.tsx`
- Create: `apps/web/components/flows/nodes/AgentNode.tsx`
- Create: `apps/web/components/flows/nodes/ConditionNode.tsx`
- Create: `apps/web/components/flows/nodes/HttpNode.tsx`
- Create: `apps/web/components/flows/nodes/TriggerNode.tsx`
- Create: `apps/web/components/flows/nodes/SimpleNode.tsx`

- [ ] **Step 1: Node visual components**

Create `apps/web/components/flows/nodes/SimpleNode.tsx`:

```tsx
"use client";
import { Handle, Position } from "@xyflow/react";
import type { NodeProps } from "@xyflow/react";
import { LucideIcon } from "lucide-react";

export function SimpleNode({
  data,
  Icon,
  accent,
  showSourceHandle = true,
  showTargetHandle = true,
}: NodeProps & { Icon: LucideIcon; accent: string; showSourceHandle?: boolean; showTargetHandle?: boolean }) {
  const d = data as { label: string; subtitle?: string };
  return (
    <div
      className="flex min-w-[180px] items-center gap-2.5 rounded-xl border border-white/[0.08] bg-zinc-900/95 px-3 py-2.5 shadow-md"
      style={{ borderLeftWidth: 3, borderLeftColor: accent }}
    >
      {showTargetHandle && <Handle type="target" position={Position.Left} />}
      <div
        className="flex h-8 w-8 items-center justify-center rounded-lg"
        style={{ background: `${accent}1A`, color: accent }}
      >
        <Icon className="h-4 w-4" />
      </div>
      <div>
        <div className="text-xs font-medium text-zinc-100">{d.label}</div>
        {d.subtitle && <div className="text-[10px] text-zinc-500">{d.subtitle}</div>}
      </div>
      {showSourceHandle && <Handle type="source" position={Position.Right} />}
    </div>
  );
}
```

Create the wrapped node files:

`apps/web/components/flows/nodes/TriggerNode.tsx`:

```tsx
"use client";
import { Play } from "lucide-react";
import { SimpleNode } from "./SimpleNode";
import type { NodeProps } from "@xyflow/react";
export const TriggerNode = (p: NodeProps) => (
  <SimpleNode {...p} Icon={Play} accent="#10b981" showTargetHandle={false} />
);
```

`apps/web/components/flows/nodes/AgentNode.tsx`:

```tsx
"use client";
import { Bot } from "lucide-react";
import { SimpleNode } from "./SimpleNode";
import type { NodeProps } from "@xyflow/react";
export const AgentNode = (p: NodeProps) => <SimpleNode {...p} Icon={Bot} accent="#8b5cf6" />;
```

`apps/web/components/flows/nodes/HttpNode.tsx`:

```tsx
"use client";
import { Globe } from "lucide-react";
import { SimpleNode } from "./SimpleNode";
import type { NodeProps } from "@xyflow/react";
export const HttpNode = (p: NodeProps) => <SimpleNode {...p} Icon={Globe} accent="#3b82f6" />;
```

`apps/web/components/flows/nodes/ConditionNode.tsx`:

```tsx
"use client";
import { Handle, Position } from "@xyflow/react";
import type { NodeProps } from "@xyflow/react";
import { GitBranch } from "lucide-react";

export function ConditionNode({ data }: NodeProps) {
  const d = data as { label: string; subtitle?: string };
  return (
    <div className="relative min-w-[200px] rounded-xl border border-white/[0.08] bg-zinc-900/95 px-3 py-3 shadow-md" style={{ borderLeftWidth: 3, borderLeftColor: "#f59e0b" }}>
      <Handle type="target" position={Position.Left} />
      <div className="flex items-center gap-2.5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/15 text-amber-400">
          <GitBranch className="h-4 w-4" />
        </div>
        <div>
          <div className="text-xs font-medium text-zinc-100">{d.label}</div>
          {d.subtitle && <div className="text-[10px] text-zinc-500">{d.subtitle}</div>}
        </div>
      </div>
      <Handle type="source" position={Position.Right} id="true" style={{ top: "30%", background: "#10b981" }} />
      <Handle type="source" position={Position.Right} id="false" style={{ top: "70%", background: "#ef4444" }} />
    </div>
  );
}
```

- [ ] **Step 2: FlowBuilder canvas**

Create `apps/web/components/flows/FlowBuilder.tsx`:

```tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Controls,
  Background,
  MiniMap,
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type Node,
  type Edge,
  type Connection,
  type NodeChange,
  type EdgeChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { createId } from "@paralleldrive/cuid2";
import { AgentNode } from "./nodes/AgentNode";
import { ConditionNode } from "./nodes/ConditionNode";
import { HttpNode } from "./nodes/HttpNode";
import { TriggerNode } from "./nodes/TriggerNode";
import { Save, Play, Loader2 } from "lucide-react";

const nodeTypes = {
  trigger: TriggerNode,
  agent: AgentNode,
  condition: ConditionNode,
  http: HttpNode,
  transform: AgentNode,
  delay: AgentNode,
  notify: AgentNode,
};

interface FlowDTO {
  id: string;
  name: string;
  nodes: Array<{ id: string; type: string; label: string; config: Record<string, unknown>; position: { x: number; y: number } }>;
  edges: Array<{ id: string; source: string; target: string; sourceHandle?: string; label?: string }>;
}

export function FlowBuilder({ flow }: { flow: FlowDTO }) {
  const [nodes, setNodes] = useState<Node[]>(
    flow.nodes.map((n) => ({
      id: n.id,
      type: n.type,
      position: n.position,
      data: { label: n.label, subtitle: subtitleFor(n) },
    }))
  );
  const [edges, setEdges] = useState<Edge[]>(
    flow.edges.map((e) => ({ id: e.id, source: e.source, target: e.target, sourceHandle: e.sourceHandle, label: e.label }))
  );
  const [selected, setSelected] = useState<Node | null>(null);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => setNodes((nds) => applyNodeChanges(changes, nds)),
    []
  );
  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => setEdges((eds) => applyEdgeChanges(changes, eds)),
    []
  );
  const onConnect = useCallback(
    (c: Connection) => setEdges((eds) => addEdge({ ...c, id: createId() }, eds)),
    []
  );

  function addNode(type: string) {
    const id = createId();
    setNodes((nds) => [
      ...nds,
      {
        id,
        type,
        position: { x: 350 + Math.random() * 100, y: 200 + Math.random() * 100 },
        data: { label: defaultLabel(type) },
      },
    ]);
  }

  async function save() {
    setSaving(true);
    const payload = {
      nodes: nodes.map((n) => ({
        id: n.id,
        type: n.type,
        label: (n.data as { label: string }).label,
        config: (n.data as { config?: Record<string, unknown> }).config ?? {},
        position: n.position,
      })),
      edges: edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle ?? undefined,
        label: typeof e.label === "string" ? e.label : undefined,
      })),
    };
    await fetch(`/api/flows/${flow.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    setSaving(false);
  }

  async function run() {
    setRunning(true);
    const r = await fetch(`/api/flows/${flow.id}/run`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input: {} }),
    });
    setRunning(false);
    const j = await r.json();
    alert(`Run ${j.status}${j.error ? `: ${j.error}` : ""}`);
  }

  return (
    <ReactFlowProvider>
      <div className="flex h-screen flex-col bg-black text-zinc-100">
        <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-3">
          <div className="text-sm font-medium">{flow.name}</div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-xs hover:bg-white/5 disabled:opacity-40"
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Guardar
            </button>
            <button
              type="button"
              onClick={run}
              disabled={running}
              className="flex items-center gap-1.5 rounded-lg bg-violet-500 px-3 py-1.5 text-xs font-medium hover:bg-violet-400 disabled:opacity-40"
            >
              {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />} Ejecutar
            </button>
          </div>
        </div>
        <div className="flex flex-1 overflow-hidden">
          <Sidebar onAdd={addNode} />
          <div className="flex-1">
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onNodeClick={(_, n) => setSelected(n)}
              nodeTypes={nodeTypes}
              fitView
              proOptions={{ hideAttribution: true }}
            >
              <Background color="#27272a" gap={20} />
              <Controls className="!border-white/10 !bg-zinc-900" />
              <MiniMap pannable zoomable className="!border-white/10 !bg-zinc-900" />
            </ReactFlow>
          </div>
          <Inspector
            node={selected}
            onChange={(updated) => {
              setNodes((nds) => nds.map((n) => (n.id === updated.id ? updated : n)));
              setSelected(updated);
            }}
            onDelete={(id) => {
              setNodes((nds) => nds.filter((n) => n.id !== id));
              setEdges((eds) => eds.filter((e) => e.source !== id && e.target !== id));
              setSelected(null);
            }}
          />
        </div>
      </div>
    </ReactFlowProvider>
  );
}

function defaultLabel(type: string): string {
  const map: Record<string, string> = {
    trigger: "Inicio",
    agent: "Agente",
    condition: "Condición",
    http: "HTTP",
    transform: "Transformar",
    delay: "Esperar",
    notify: "Notificar",
  };
  return map[type] ?? type;
}

function subtitleFor(n: { type: string; config: Record<string, unknown> }): string {
  if (n.type === "agent" && n.config.agentId) return `agentId: ${(n.config.agentId as string).slice(0, 8)}`;
  if (n.type === "http" && n.config.url) return String(n.config.url).slice(0, 32);
  return "";
}

function Sidebar({ onAdd }: { onAdd: (type: string) => void }) {
  const types = [
    { id: "agent", label: "Agente", emoji: "🤖" },
    { id: "condition", label: "Condición", emoji: "🔀" },
    { id: "http", label: "HTTP", emoji: "🌐" },
    { id: "transform", label: "Transformar", emoji: "🔧" },
    { id: "delay", label: "Esperar", emoji: "⏱" },
    { id: "notify", label: "Notificar", emoji: "📨" },
  ];
  return (
    <div className="w-44 border-r border-white/[0.06] bg-zinc-950 p-3">
      <div className="mb-2 text-[10px] font-medium uppercase tracking-wider text-zinc-500">
        Nodos
      </div>
      {types.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => onAdd(t.id)}
          className="mb-1 flex w-full items-center gap-2 rounded-lg border border-white/[0.06] bg-zinc-900/40 px-2.5 py-1.5 text-xs text-zinc-200 hover:bg-zinc-800/60"
        >
          <span>{t.emoji}</span> {t.label}
        </button>
      ))}
    </div>
  );
}

function Inspector({
  node,
  onChange,
  onDelete,
}: {
  node: Node | null;
  onChange: (n: Node) => void;
  onDelete: (id: string) => void;
}) {
  const [agents, setAgents] = useState<Array<{ id: string; name: string }>>([]);
  useEffect(() => {
    fetch("/api/agents")
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setAgents(Array.isArray(d) ? d : []))
      .catch(() => setAgents([]));
  }, []);

  if (!node) {
    return (
      <div className="w-72 border-l border-white/[0.06] bg-zinc-950 p-4 text-xs text-zinc-500">
        Seleccioná un nodo para configurarlo.
      </div>
    );
  }

  const data = node.data as { label: string; config?: Record<string, unknown> };
  const config = data.config ?? {};

  function update(patch: Partial<{ label: string; config: Record<string, unknown> }>) {
    onChange({
      ...node!,
      data: { ...data, ...patch, config: { ...config, ...(patch.config ?? {}) } },
    });
  }

  return (
    <div className="w-72 space-y-3 overflow-y-auto border-l border-white/[0.06] bg-zinc-950 p-4 text-xs">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">
          {node.type}
        </span>
        <button
          type="button"
          onClick={() => onDelete(node.id)}
          className="text-red-400 hover:text-red-300"
        >
          Eliminar
        </button>
      </div>
      <input
        value={data.label}
        onChange={(e) => update({ label: e.target.value })}
        className="w-full rounded-lg border border-white/[0.08] bg-zinc-800/40 px-2.5 py-1.5 text-zinc-100 outline-none focus:border-violet-500/60"
      />

      {node.type === "agent" && (
        <>
          <label className="block text-zinc-500">Agente</label>
          <select
            value={(config.agentId as string) ?? ""}
            onChange={(e) => update({ config: { agentId: e.target.value } })}
            className="w-full rounded-lg border border-white/[0.08] bg-zinc-800/40 px-2 py-1.5 text-zinc-100 outline-none"
          >
            <option value="">— elegir —</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <label className="block text-zinc-500">Mensaje (template)</label>
          <textarea
            value={(config.message as string) ?? ""}
            onChange={(e) => update({ config: { message: e.target.value } })}
            placeholder="Hola {{nombre}}, …"
            rows={3}
            className="w-full rounded-lg border border-white/[0.08] bg-zinc-800/40 px-2 py-1.5 font-mono text-zinc-100 outline-none focus:border-violet-500/60"
          />
          <label className="block text-zinc-500">Output var</label>
          <input
            value={(config.outputVar as string) ?? ""}
            onChange={(e) => update({ config: { outputVar: e.target.value } })}
            placeholder="agentResult"
            className="w-full rounded-lg border border-white/[0.08] bg-zinc-800/40 px-2 py-1.5 text-zinc-100 outline-none"
          />
        </>
      )}

      {node.type === "condition" && (
        <>
          <label className="block text-zinc-500">left</label>
          <input
            value={((config.condition as { left?: string })?.left) ?? ""}
            onChange={(e) =>
              update({
                config: {
                  condition: { ...(config.condition as object ?? {}), left: e.target.value },
                },
              })
            }
            placeholder="{{score}}"
            className="w-full rounded-lg border border-white/[0.08] bg-zinc-800/40 px-2 py-1.5 font-mono text-zinc-100 outline-none"
          />
          <label className="block text-zinc-500">op</label>
          <select
            value={((config.condition as { op?: string })?.op) ?? "=="}
            onChange={(e) =>
              update({
                config: {
                  condition: { ...(config.condition as object ?? {}), op: e.target.value },
                },
              })
            }
            className="w-full rounded-lg border border-white/[0.08] bg-zinc-800/40 px-2 py-1.5 text-zinc-100 outline-none"
          >
            {["==", "!=", ">", "<", ">=", "<=", "contains"].map((o) => (
              <option key={o}>{o}</option>
            ))}
          </select>
          <label className="block text-zinc-500">right</label>
          <input
            value={((config.condition as { right?: string })?.right) ?? ""}
            onChange={(e) =>
              update({
                config: {
                  condition: { ...(config.condition as object ?? {}), right: e.target.value },
                },
              })
            }
            placeholder="50"
            className="w-full rounded-lg border border-white/[0.08] bg-zinc-800/40 px-2 py-1.5 font-mono text-zinc-100 outline-none"
          />
        </>
      )}

      {node.type === "http" && (
        <>
          <label className="block text-zinc-500">Method</label>
          <select
            value={(config.method as string) ?? "GET"}
            onChange={(e) => update({ config: { method: e.target.value } })}
            className="w-full rounded-lg border border-white/[0.08] bg-zinc-800/40 px-2 py-1.5 text-zinc-100 outline-none"
          >
            {["GET", "POST", "PUT", "DELETE"].map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
          <label className="block text-zinc-500">URL</label>
          <input
            value={(config.url as string) ?? ""}
            onChange={(e) => update({ config: { url: e.target.value } })}
            placeholder="https://api.example.com/{{id}}"
            className="w-full rounded-lg border border-white/[0.08] bg-zinc-800/40 px-2 py-1.5 font-mono text-zinc-100 outline-none"
          />
          <label className="block text-zinc-500">Output var</label>
          <input
            value={(config.outputVar as string) ?? ""}
            onChange={(e) => update({ config: { outputVar: e.target.value } })}
            placeholder="httpResult"
            className="w-full rounded-lg border border-white/[0.08] bg-zinc-800/40 px-2 py-1.5 text-zinc-100 outline-none"
          />
        </>
      )}

      {node.type === "delay" && (
        <>
          <label className="block text-zinc-500">ms</label>
          <input
            type="number"
            value={(config.ms as number) ?? 1000}
            onChange={(e) => update({ config: { ms: Number(e.target.value) } })}
            className="w-full rounded-lg border border-white/[0.08] bg-zinc-800/40 px-2 py-1.5 text-zinc-100 outline-none"
          />
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/flows
git commit -m "feat(flows): visual flow builder with node types, sidebar, and inspector"
```

---

### Task 18: Flow List + Detail Pages

**Files:**
- Create: `apps/web/app/[locale]/(shell)/flows/page.tsx`
- Create: `apps/web/app/[locale]/(shell)/flows/FlowsListClient.tsx`
- Create: `apps/web/app/[locale]/flows/[id]/page.tsx` (full-screen, no shell)
- Modify: sidebar nav (add Flows link)

- [ ] **Step 1: Flows list server page**

Create `apps/web/app/[locale]/(shell)/flows/page.tsx`:

```tsx
import { getDb, schema } from "@orchester/db";
import { eq, desc } from "drizzle-orm";
import { getCurrentWorkspace } from "@/lib/workspace";
import { FlowsListClient } from "./FlowsListClient";

export default async function FlowsPage() {
  const ws = await getCurrentWorkspace();
  if (!ws) return null;
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.flows)
    .where(eq(schema.flows.workspaceId, ws.workspace.id))
    .orderBy(desc(schema.flows.updatedAt));
  return (
    <FlowsListClient
      flows={rows.map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description ?? null,
        status: r.status,
        nodeCount: (r.nodes as unknown[] | null)?.length ?? 0,
        lastRunAt: r.lastRunAt?.toISOString() ?? null,
      }))}
    />
  );
}
```

- [ ] **Step 2: Client list**

Create `apps/web/app/[locale]/(shell)/flows/FlowsListClient.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { motion } from "framer-motion";
import { Workflow, Plus } from "lucide-react";

interface Item {
  id: string;
  name: string;
  description: string | null;
  status: string;
  nodeCount: number;
  lastRunAt: string | null;
}

export function FlowsListClient({ flows }: { flows: Item[] }) {
  const router = useRouter();
  const params = useParams<{ locale: string }>();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");

  async function create() {
    if (!name.trim()) return;
    const r = await fetch("/api/flows", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (r.ok) {
      const j = await r.json();
      router.push(`/${params.locale}/flows/${j.id}`);
    }
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-zinc-100">Flujos</h1>
          <p className="text-sm text-zinc-500">
            Conectá tus agentes en pipelines visuales que se ejecutan automáticamente.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="flex items-center gap-1.5 rounded-lg bg-violet-500 px-3.5 py-2 text-sm font-medium text-white hover:bg-violet-400"
        >
          <Plus className="h-4 w-4" /> Nuevo flujo
        </button>
      </div>

      {creating && (
        <div className="rounded-2xl border border-violet-500/30 bg-zinc-900/40 p-4">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nombre del flujo"
            className="w-full rounded-lg border border-white/[0.08] bg-zinc-800/40 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-violet-500/60"
          />
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={create}
              className="rounded-lg bg-violet-500 px-3 py-1.5 text-xs text-white hover:bg-violet-400"
            >
              Crear
            </button>
            <button
              type="button"
              onClick={() => setCreating(false)}
              className="text-xs text-zinc-400 hover:text-zinc-200"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {flows.length === 0 && !creating && (
        <div className="rounded-2xl border border-dashed border-white/10 p-10 text-center">
          <Workflow className="mx-auto mb-3 h-8 w-8 text-zinc-600" />
          <h3 className="text-sm font-medium text-zinc-200">Aún no hay flujos</h3>
          <p className="mt-1 text-xs text-zinc-500">
            Creá tu primer flujo para empezar a orquestar agentes.
          </p>
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {flows.map((f) => (
          <motion.button
            key={f.id}
            type="button"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            onClick={() => router.push(`/${params.locale}/flows/${f.id}`)}
            className="rounded-2xl border border-white/[0.08] bg-zinc-900/40 p-4 text-left hover:border-violet-500/40"
          >
            <div className="mb-2 flex items-center gap-2">
              <Workflow className="h-4 w-4 text-violet-400" />
              <span className="font-medium text-zinc-100">{f.name}</span>
            </div>
            <p className="line-clamp-2 text-xs text-zinc-500">{f.description ?? "—"}</p>
            <div className="mt-3 flex items-center justify-between text-[10px] text-zinc-600">
              <span>{f.nodeCount} nodos</span>
              <span>{f.status}</span>
            </div>
          </motion.button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Flow detail full-screen page**

Create `apps/web/app/[locale]/flows/[id]/page.tsx`:

```tsx
import { notFound, redirect } from "next/navigation";
import { getDb, schema } from "@orchester/db";
import { eq, and } from "drizzle-orm";
import { getCurrentWorkspace } from "@/lib/workspace";
import { FlowBuilder } from "@/components/flows/FlowBuilder";

export default async function FlowDetailPage({
  params,
}: {
  params: Promise<{ id: string; locale: string }>;
}) {
  const { id, locale } = await params;
  const ws = await getCurrentWorkspace();
  if (!ws) redirect(`/${locale}/login`);
  const db = getDb();
  const [f] = await db
    .select()
    .from(schema.flows)
    .where(and(eq(schema.flows.id, id), eq(schema.flows.workspaceId, ws.workspace.id)))
    .limit(1);
  if (!f) notFound();
  return (
    <FlowBuilder
      flow={{
        id: f.id,
        name: f.name,
        nodes: (f.nodes ?? []) as never,
        edges: (f.edges ?? []) as never,
      }}
    />
  );
}
```

- [ ] **Step 4: Add Flows to sidebar nav**

Open `apps/web/components/shell/Sidebar.tsx` (or wherever nav lives) and add a Flows entry between Agents and Conversations:

```tsx
{ href: `/${locale}/flows`, label: t("nav.flows"), icon: Workflow },
```

Add the i18n key in Task 25.

- [ ] **Step 5: Smoke test**

`http://localhost:3333/<locale>/flows` → "Nuevo flujo" → name → land on builder. Drag from sidebar, connect, save, run.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/[locale]/flows apps/web/app/[locale]/\(shell\)/flows apps/web/components/shell
git commit -m "feat(flows): list page and full-screen builder route"
```

---

### Task 19: Flow Runs Viewer

**Files:**
- Create: `apps/web/components/flows/FlowRunsPanel.tsx`
- Modify: `FlowBuilder.tsx` (slide-in runs panel)

- [ ] **Step 1: Runs panel**

Create `apps/web/components/flows/FlowRunsPanel.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { History, X, ChevronRight } from "lucide-react";

interface Run {
  id: string;
  status: string;
  startedAt: string;
  completedAt: string | null;
  triggerSource: string | null;
  error: string | null;
}
interface Step {
  id: string;
  nodeId: string;
  nodeType: string;
  status: string;
  output: unknown;
  error: string | null;
  startedAt: string;
}

export function FlowRunsPanel({ flowId, open, onClose }: { flowId: string; open: boolean; onClose: () => void }) {
  const [runs, setRuns] = useState<Run[]>([]);
  const [selected, setSelected] = useState<{ run: Run; steps: Step[] } | null>(null);

  useEffect(() => {
    if (!open) return;
    fetch(`/api/flows/${flowId}/runs`)
      .then((r) => r.json())
      .then((d) => setRuns(Array.isArray(d) ? d : []));
  }, [flowId, open]);

  async function pickRun(r: Run) {
    const detail = await fetch(`/api/flow-runs/${r.id}`).then((x) => x.json());
    setSelected(detail);
  }

  if (!open) return null;
  return (
    <div className="absolute right-0 top-0 z-30 flex h-full w-[420px] flex-col border-l border-white/[0.06] bg-zinc-950">
      <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3">
        <span className="flex items-center gap-2 text-sm text-zinc-200">
          <History className="h-4 w-4" /> Ejecuciones
        </span>
        <button onClick={onClose} type="button" className="text-zinc-500 hover:text-zinc-200">
          <X className="h-4 w-4" />
        </button>
      </div>
      {!selected ? (
        <div className="flex-1 overflow-y-auto p-3">
          {runs.length === 0 && (
            <div className="text-xs text-zinc-500">Aún no hubo ejecuciones.</div>
          )}
          {runs.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => pickRun(r)}
              className="mb-1.5 flex w-full items-center justify-between rounded-lg border border-white/[0.06] bg-zinc-900/40 px-3 py-2 text-left text-xs hover:bg-zinc-900"
            >
              <div>
                <div className="text-zinc-200">{r.triggerSource ?? "trigger"}</div>
                <div className="text-[10px] text-zinc-500">
                  {new Date(r.startedAt).toLocaleString()}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className={
                    r.status === "succeeded"
                      ? "text-emerald-400"
                      : r.status === "failed"
                      ? "text-red-400"
                      : r.status === "running"
                      ? "text-amber-400"
                      : "text-zinc-500"
                  }
                >
                  {r.status}
                </span>
                <ChevronRight className="h-3 w-3 text-zinc-600" />
              </div>
            </button>
          ))}
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-3">
          <button
            type="button"
            onClick={() => setSelected(null)}
            className="mb-2 text-[11px] text-zinc-500 hover:text-zinc-200"
          >
            ← Volver
          </button>
          <div className="mb-3 rounded-lg border border-white/[0.06] bg-zinc-900/40 p-3 text-xs">
            <div className="text-zinc-200">{selected.run.status}</div>
            <div className="text-[10px] text-zinc-500">
              {new Date(selected.run.startedAt).toLocaleString()}
            </div>
            {selected.run.error && (
              <div className="mt-2 rounded border border-red-500/30 bg-red-500/10 p-2 text-red-300">
                {selected.run.error}
              </div>
            )}
          </div>
          <div className="text-[10px] uppercase tracking-wider text-zinc-500">Pasos</div>
          {selected.steps.map((s) => (
            <div
              key={s.id}
              className="mt-1.5 rounded-lg border border-white/[0.06] bg-zinc-900/40 px-3 py-2 text-[11px]"
            >
              <div className="flex items-center justify-between">
                <span className="text-zinc-200">{s.nodeType}</span>
                <span
                  className={
                    s.status === "succeeded"
                      ? "text-emerald-400"
                      : s.status === "failed"
                      ? "text-red-400"
                      : "text-zinc-500"
                  }
                >
                  {s.status}
                </span>
              </div>
              {s.error && <div className="mt-1 text-red-300">{s.error}</div>}
              {s.output != null && (
                <pre className="mt-1 max-h-32 overflow-y-auto rounded bg-black/40 p-2 font-mono text-[10px] text-zinc-300">
                  {JSON.stringify(s.output, null, 2)}
                </pre>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Wire panel into FlowBuilder**

In `FlowBuilder.tsx`, add a state `runsOpen` and a button next to Save/Ejecutar:

```tsx
import { History } from "lucide-react";
import { FlowRunsPanel } from "./FlowRunsPanel";
// inside header:
<button
  type="button"
  onClick={() => setRunsOpen(true)}
  className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-zinc-300 hover:bg-white/5"
>
  <History className="h-3.5 w-3.5" />
</button>
// inside the canvas wrapper:
<FlowRunsPanel flowId={flow.id} open={runsOpen} onClose={() => setRunsOpen(false)} />
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/flows
git commit -m "feat(flows): runs panel with step-level inspection"
```

---

## Phase D — Organigrama 2.0

### Task 20: Org Graph Data API

**Files:**
- Create: `apps/web/app/api/org-graph/route.ts`
- Modify: `packages/db/src/schema/core.ts` (add `employees.assignedAgentIds` jsonb for agent ↔ employee linking)

- [ ] **Step 1: Add employee → agents column**

Edit `packages/db/src/schema/core.ts` — extend `employees`:

```typescript
export const employees = pgTable("employee", {
  // ...existing
  assignedAgentIds: jsonb("assigned_agent_ids").$type<string[]>().default([]),
  // ...
});
```

Then push:

```bash
cd packages/db
pnpm drizzle-kit push
```

- [ ] **Step 2: Org-graph endpoint**

Create `apps/web/app/api/org-graph/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { getDb, schema } from "@orchester/db";
import { eq, desc } from "drizzle-orm";
import { getCurrentWorkspace } from "@/lib/workspace";

interface OrgNode {
  id: string;
  type: "team" | "agent" | "employee" | "flow";
  label: string;
  meta?: Record<string, unknown>;
}
interface OrgEdge {
  id: string;
  source: string;
  target: string;
  kind: "team-agent" | "employee-agent" | "flow-agent" | "team-employee";
}

export async function GET() {
  const ws = await getCurrentWorkspace();
  if (!ws) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const db = getDb();
  const wsId = ws.workspace.id;

  const [teams, agents, employees, flows, runs] = await Promise.all([
    db.select().from(schema.teams).where(eq(schema.teams.workspaceId, wsId)),
    db.select().from(schema.agents).where(eq(schema.agents.workspaceId, wsId)),
    db.select().from(schema.employees).where(eq(schema.employees.workspaceId, wsId)),
    db.select().from(schema.flows).where(eq(schema.flows.workspaceId, wsId)),
    db
      .select()
      .from(schema.flowRuns)
      .where(eq(schema.flowRuns.workspaceId, wsId))
      .orderBy(desc(schema.flowRuns.startedAt))
      .limit(50),
  ]);

  const recentRunningFlowIds = new Set(
    runs.filter((r) => r.status === "running" || r.status === "succeeded").map((r) => r.flowId)
  );

  const nodes: OrgNode[] = [];
  const edges: OrgEdge[] = [];

  for (const t of teams) {
    nodes.push({
      id: `team:${t.id}`,
      type: "team",
      label: t.name,
      meta: { color: t.avatarColor },
    });
  }
  for (const a of agents) {
    nodes.push({
      id: `agent:${a.id}`,
      type: "agent",
      label: a.name,
      meta: { role: a.role, model: a.model, status: a.status },
    });
    if (a.teamId) {
      edges.push({
        id: `e:t-a:${a.id}`,
        source: `team:${a.teamId}`,
        target: `agent:${a.id}`,
        kind: "team-agent",
      });
    }
  }
  for (const e of employees) {
    nodes.push({
      id: `employee:${e.id}`,
      type: "employee",
      label: e.name,
      meta: { area: e.area, email: e.email },
    });
    for (const aid of e.assignedAgentIds ?? []) {
      edges.push({
        id: `e:em-a:${e.id}-${aid}`,
        source: `employee:${e.id}`,
        target: `agent:${aid}`,
        kind: "employee-agent",
      });
    }
  }
  for (const f of flows) {
    nodes.push({
      id: `flow:${f.id}`,
      type: "flow",
      label: f.name,
      meta: { active: recentRunningFlowIds.has(f.id), status: f.status },
    });
    // edges from flow → each agent it references
    const agentIdsInFlow = new Set<string>();
    for (const n of (f.nodes ?? []) as Array<{ type: string; config?: Record<string, unknown> }>) {
      if (n.type === "agent" && typeof n.config?.agentId === "string") {
        agentIdsInFlow.add(n.config.agentId);
      }
    }
    for (const aid of agentIdsInFlow) {
      edges.push({
        id: `e:f-a:${f.id}-${aid}`,
        source: `flow:${f.id}`,
        target: `agent:${aid}`,
        kind: "flow-agent",
      });
    }
  }

  return NextResponse.json({ nodes, edges });
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/db apps/web/app/api/org-graph
git commit -m "feat(org): graph data endpoint joining teams, agents, employees, flows"
```

---

### Task 21: Organigrama 2.0 Canvas

**Files:**
- Create: `apps/web/components/org/OrgCanvas.tsx`
- Modify: `apps/web/app/[locale]/(shell)/org/page.tsx` (replace existing content)

- [ ] **Step 1: OrgCanvas component**

Create `apps/web/components/org/OrgCanvas.tsx`:

```tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  type Node,
  type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Bot, Users, Workflow, User, Search } from "lucide-react";

interface OrgNode {
  id: string;
  type: "team" | "agent" | "employee" | "flow";
  label: string;
  meta?: Record<string, unknown>;
}
interface OrgEdge {
  id: string;
  source: string;
  target: string;
  kind: string;
}

const TYPE_STYLE: Record<string, { color: string; icon: typeof Bot }> = {
  team: { color: "#3b82f6", icon: Users },
  agent: { color: "#8b5cf6", icon: Bot },
  employee: { color: "#10b981", icon: User },
  flow: { color: "#f59e0b", icon: Workflow },
};

function layoutNodes(nodes: OrgNode[], edges: OrgEdge[]): Node[] {
  // Simple layered layout: teams on left, then agents, then flows top, employees bottom.
  const cols: Record<string, number> = { team: 0, employee: 1, agent: 2, flow: 3 };
  const counts: Record<string, number> = { team: 0, employee: 0, agent: 0, flow: 0 };
  return nodes.map((n) => {
    const col = cols[n.type] ?? 4;
    const row = counts[n.type]++;
    return {
      id: n.id,
      position: { x: col * 260 + 60, y: row * 90 + 60 },
      data: { label: n.label, kind: n.type, meta: n.meta },
      type: "card",
    };
  });
}

function CardNode({ data }: { data: { label: string; kind: string; meta?: Record<string, unknown> } }) {
  const style = TYPE_STYLE[data.kind] ?? TYPE_STYLE.agent;
  const Icon = style.icon;
  const active = (data.meta?.active as boolean) ?? false;
  return (
    <div
      className="flex min-w-[200px] items-center gap-2 rounded-xl border border-white/[0.08] bg-zinc-900/95 px-3 py-2.5 shadow"
      style={{ borderLeftWidth: 3, borderLeftColor: style.color }}
    >
      <div
        className="flex h-7 w-7 items-center justify-center rounded-lg"
        style={{ background: style.color + "1A", color: style.color }}
      >
        <Icon className="h-3.5 w-3.5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs font-medium text-zinc-100">{data.label}</div>
        <div className="text-[10px] uppercase tracking-wider text-zinc-500">
          {data.kind}
          {active && <span className="ml-1.5 text-emerald-400">● live</span>}
        </div>
      </div>
    </div>
  );
}

export function OrgCanvas() {
  const [data, setData] = useState<{ nodes: OrgNode[]; edges: OrgEdge[] }>({ nodes: [], edges: [] });
  const [filter, setFilter] = useState("");
  const [kindFilter, setKindFilter] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/org-graph")
      .then((r) => r.json())
      .then((d) => setData(d.nodes ? d : { nodes: [], edges: [] }));
    const interval = setInterval(() => {
      fetch("/api/org-graph")
        .then((r) => r.json())
        .then((d) => setData(d.nodes ? d : { nodes: [], edges: [] }))
        .catch(() => {});
    }, 10000);
    return () => clearInterval(interval);
  }, []);

  const visibleNodes = useMemo(() => {
    return data.nodes.filter((n) => {
      if (kindFilter && n.type !== kindFilter) return false;
      if (filter && !n.label.toLowerCase().includes(filter.toLowerCase())) return false;
      return true;
    });
  }, [data.nodes, filter, kindFilter]);

  const visibleIds = useMemo(() => new Set(visibleNodes.map((n) => n.id)), [visibleNodes]);

  const flowNodes: Node[] = useMemo(() => layoutNodes(visibleNodes, data.edges), [visibleNodes, data.edges]);
  const flowEdges: Edge[] = useMemo(
    () =>
      data.edges
        .filter((e) => visibleIds.has(e.source) && visibleIds.has(e.target))
        .map((e) => ({
          id: e.id,
          source: e.source,
          target: e.target,
          animated: e.kind === "flow-agent",
          style: { stroke: edgeColor(e.kind) },
        })),
    [data.edges, visibleIds]
  );

  return (
    <div className="flex h-[calc(100vh-80px)] flex-col">
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="flex items-center gap-2">
          <Search className="h-3.5 w-3.5 text-zinc-500" />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Buscar nodos…"
            className="rounded-lg border border-white/[0.08] bg-zinc-900 px-2.5 py-1 text-xs text-zinc-100 placeholder-zinc-600 outline-none focus:border-violet-500/60"
          />
        </div>
        <div className="flex gap-1.5 text-xs">
          {["team", "agent", "employee", "flow"].map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setKindFilter((curr) => (curr === k ? null : k))}
              className={
                kindFilter === k
                  ? "rounded-md bg-violet-500/20 px-2 py-1 text-violet-300"
                  : "rounded-md text-zinc-500 hover:text-zinc-300"
              }
            >
              {k}
            </button>
          ))}
        </div>
        <div className="ml-auto text-[11px] text-zinc-500">
          {visibleNodes.length} / {data.nodes.length} nodos · {flowEdges.length} conexiones
        </div>
      </div>
      <div className="flex-1">
        <ReactFlow
          nodes={flowNodes}
          edges={flowEdges}
          nodeTypes={{ card: CardNode }}
          fitView
          proOptions={{ hideAttribution: true }}
        >
          <Background color="#27272a" gap={20} />
          <Controls className="!border-white/10 !bg-zinc-900" />
          <MiniMap pannable zoomable className="!border-white/10 !bg-zinc-900" />
        </ReactFlow>
      </div>
    </div>
  );
}

function edgeColor(kind: string): string {
  switch (kind) {
    case "team-agent":
      return "#3b82f6";
    case "employee-agent":
      return "#10b981";
    case "flow-agent":
      return "#f59e0b";
    default:
      return "#52525b";
  }
}
```

- [ ] **Step 2: Org page**

Edit `apps/web/app/[locale]/(shell)/org/page.tsx` (replace existing content):

```tsx
import { OrgCanvas } from "@/components/org/OrgCanvas";

export default function OrgPage() {
  return (
    <div className="space-y-3 p-4">
      <div>
        <h1 className="text-xl font-semibold text-zinc-100">Organigrama</h1>
        <p className="text-sm text-zinc-500">
          Vista en vivo de cómo equipos, agentes, flujos y personas se conectan.
        </p>
      </div>
      <OrgCanvas />
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/org apps/web/app/[locale]/\(shell\)/org/page.tsx
git commit -m "feat(org): interactive organigrama 2.0 with live activity layer"
```

---

### Task 22: Employee → Agent Assignment UI

**Files:**
- Modify: `apps/web/app/[locale]/(shell)/employees/...` (add assign-agent dropdown to employee row)
- Create: `apps/web/app/api/employees/[id]/agents/route.ts`

- [ ] **Step 1: Assignment endpoint**

Create `apps/web/app/api/employees/[id]/agents/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { getDb, schema } from "@orchester/db";
import { eq, and } from "drizzle-orm";
import { getCurrentWorkspace } from "@/lib/workspace";

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ws = await getCurrentWorkspace();
  if (!ws) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const body = await req.json();
  const { agentIds } = body as { agentIds: string[] };
  if (!Array.isArray(agentIds))
    return NextResponse.json({ error: "agentIds[] required" }, { status: 400 });
  const db = getDb();
  const [row] = await db
    .update(schema.employees)
    .set({ assignedAgentIds: agentIds, updatedAt: new Date() })
    .where(
      and(eq(schema.employees.id, id), eq(schema.employees.workspaceId, ws.workspace.id))
    )
    .returning();
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(row);
}
```

- [ ] **Step 2: UI hookup**

Where the employees list/card is rendered, add an "Asignar agentes" button that opens a popover with checkboxes for each agent. On change, call `PUT /api/employees/{id}/agents`. (Keep this minimal — the existing employees screen already has card UI; just inject the popover.)

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/api/employees apps/web/app/[locale]/\(shell\)/employees apps/web/components/employees 2>/dev/null
git commit -m "feat(employees): assign agents to employees, surfaced in organigrama"
```

---

## Phase E — Polish & Integration

### Task 23: i18n Keys

**Files:**
- Modify: `apps/web/messages/es.json`
- Modify: `apps/web/messages/en.json`
- Modify: `apps/web/messages/pt-BR.json`

- [ ] **Step 1: Add namespaces to all three locales**

Add the following keys (translate as you copy). For `es.json`:

```json
{
  "nav": {
    "flows": "Flujos"
  },
  "agentStudio": {
    "title": "Estudio del agente",
    "save": "Guardar",
    "savedAt": "Guardado a las {time}",
    "tabs": { "config": "Configuración", "versions": "Versiones" },
    "promptEditor": {
      "generate": "Generar con IA",
      "templates": "Plantillas",
      "quality": { "Poor": "Pobre", "Good": "Bueno", "Excellent": "Excelente" },
      "tokens": "tokens",
      "chars": "caracteres"
    },
    "modelPicker": {
      "placeholder": "Elegir modelo…",
      "noProviders": "Configurá un proveedor en Ajustes para ver modelos."
    },
    "generator": {
      "title": "Generador de prompts con IA",
      "step1": "¿Qué hace este agente?",
      "step2": "Tono y contexto",
      "step3": "Elegí una variación",
      "regenerate": "Regenerar",
      "next": "Siguiente",
      "back": "Atrás",
      "cancel": "Cancelar"
    },
    "templates": { "title": "Plantillas profesionales", "categories": "Categorías" },
    "testChat": {
      "title": "Test chat",
      "placeholder": "Escribí un mensaje…",
      "thinking": "Pensando…",
      "tokensUsed": "Tokens usados: {count}",
      "providerNotConfigured": "Configura el proveedor en Ajustes para usar este modelo."
    },
    "versions": {
      "title": "Historial de versiones",
      "save": "Guardar versión",
      "restore": "Restaurar",
      "labelPlaceholder": "Etiqueta (opcional)",
      "empty": "Aún no hay versiones guardadas."
    }
  },
  "settings": {
    "aiProviders": {
      "title": "Proveedores de IA",
      "description": "Conectá tus claves de Anthropic, OpenAI, Google AI o Azure.",
      "save": "Guardar",
      "test": "Probar",
      "remove": "Quitar",
      "status": {
        "ok": "Conectado",
        "error": "Error",
        "untested": "Sin probar",
        "notConfigured": "No configurado"
      }
    }
  },
  "flows": {
    "title": "Flujos",
    "subtitle": "Conectá tus agentes en pipelines visuales que se ejecutan automáticamente.",
    "newFlow": "Nuevo flujo",
    "namePlaceholder": "Nombre del flujo",
    "create": "Crear",
    "empty": {
      "title": "Aún no hay flujos",
      "description": "Creá tu primer flujo para empezar a orquestar agentes."
    },
    "builder": {
      "save": "Guardar",
      "run": "Ejecutar",
      "runs": "Ejecuciones",
      "nodes": "Nodos",
      "inspector": "Seleccioná un nodo para configurarlo.",
      "delete": "Eliminar"
    }
  },
  "org": {
    "title": "Organigrama",
    "subtitle": "Vista en vivo de cómo equipos, agentes, flujos y personas se conectan.",
    "search": "Buscar nodos…"
  }
}
```

For `en.json` (mirror structure, English copy):

```json
{
  "nav": { "flows": "Flows" },
  "agentStudio": { /* ...same shape, English copy... */ }
}
```

For `pt-BR.json`, mirror in Portuguese.

- [ ] **Step 2: Replace hardcoded strings**

Sweep these files and swap hardcoded ES strings for `t("agentStudio…")` calls:
- `components/agents/studio/*.tsx`
- `components/settings/AIProvidersSection.tsx`
- `components/flows/*.tsx`
- `components/org/OrgCanvas.tsx`

(Use `useTranslations` from `next-intl`.)

- [ ] **Step 3: Commit**

```bash
git add apps/web/messages apps/web/components
git commit -m "feat(i18n): translate agent studio, AI providers, flows, organigrama"
```

---

### Task 24: Demo Seeder

**Files:**
- Create: `packages/db/src/seed-v2.ts`
- Modify: `packages/db/package.json` (add script `seed:v2`)

- [ ] **Step 1: Seed script**

Create `packages/db/src/seed-v2.ts`:

```typescript
import { createId } from "@paralleldrive/cuid2";
import { createDbClient } from "./client";
import * as schema from "./schema";
import { eq } from "drizzle-orm";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL required");
  const db = createDbClient(url);

  // pick first workspace
  const [ws] = await db.select().from(schema.workspaces).limit(1);
  if (!ws) {
    console.log("No workspace yet. Sign in once to create one, then re-run.");
    process.exit(0);
  }
  const wsId = ws.id;
  console.log("Seeding into workspace:", ws.name);

  // teams
  const ventasId = createId();
  const soporteId = createId();
  await db.insert(schema.teams).values([
    { id: ventasId, workspaceId: wsId, name: "Ventas", description: "Equipo comercial" },
    { id: soporteId, workspaceId: wsId, name: "Soporte", description: "Atención al cliente" },
  ]);

  // agents
  const leadAgentId = createId();
  const closerAgentId = createId();
  const supportAgentId = createId();
  await db.insert(schema.agents).values([
    {
      id: leadAgentId,
      workspaceId: wsId,
      teamId: ventasId,
      name: "Lead Qualifier",
      role: "Califica leads B2B",
      systemPrompt:
        "You are a B2B sales lead qualifier. Use BANT to evaluate leads and return a JSON score.",
      model: "claude-sonnet-4-6",
      status: "active",
      temperature: "0.30",
    },
    {
      id: closerAgentId,
      workspaceId: wsId,
      teamId: ventasId,
      name: "Closer Bot",
      role: "Cierra oportunidades",
      systemPrompt: "You are a closing assistant. Help reps move leads to closed-won.",
      model: "claude-sonnet-4-6",
      status: "active",
      temperature: "0.50",
    },
    {
      id: supportAgentId,
      workspaceId: wsId,
      teamId: soporteId,
      name: "Support Tier 1",
      role: "Atención de primer nivel",
      systemPrompt: "You are a Tier 1 support agent. Answer common questions, escalate complex.",
      model: "claude-haiku-4-5",
      status: "active",
      temperature: "0.30",
    },
  ]);

  // sample flow: Lead → qualify → if score>50 → Closer; else end
  const triggerNodeId = createId();
  const qualifyNodeId = createId();
  const condNodeId = createId();
  const closerNodeId = createId();
  await db.insert(schema.flows).values({
    id: createId(),
    workspaceId: wsId,
    name: "Pipeline de leads",
    description: "Califica un lead y lo envía al Closer si supera 50 puntos",
    status: "active",
    enabled: true,
    nodes: [
      {
        id: triggerNodeId,
        type: "trigger",
        label: "Inicio",
        config: { trigger: "manual" },
        position: { x: 60, y: 200 },
      },
      {
        id: qualifyNodeId,
        type: "agent",
        label: "Calificar lead",
        config: {
          agentId: leadAgentId,
          message: "Evaluá este lead: {{lead}}",
          outputVar: "score",
        },
        position: { x: 320, y: 200 },
      },
      {
        id: condNodeId,
        type: "condition",
        label: "¿Score > 50?",
        config: { condition: { left: "{{score}}", op: ">", right: "50" } },
        position: { x: 600, y: 200 },
      },
      {
        id: closerNodeId,
        type: "agent",
        label: "Closer Bot",
        config: {
          agentId: closerAgentId,
          message: "Cerrá este lead calificado: {{lead}}",
          outputVar: "closingResponse",
        },
        position: { x: 880, y: 140 },
      },
    ],
    edges: [
      { id: createId(), source: triggerNodeId, target: qualifyNodeId },
      { id: createId(), source: qualifyNodeId, target: condNodeId },
      { id: createId(), source: condNodeId, target: closerNodeId, sourceHandle: "true" },
    ],
  });

  // ensure at least one employee exists; if so, assign agents
  const emps = await db.select().from(schema.employees).where(eq(schema.employees.workspaceId, wsId));
  if (emps[0]) {
    await db
      .update(schema.employees)
      .set({ assignedAgentIds: [leadAgentId, closerAgentId] })
      .where(eq(schema.employees.id, emps[0].id));
  }

  console.log("Seed v2 done.");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 2: Add script**

Edit `packages/db/package.json`:

```json
{
  "scripts": {
    "seed:v2": "tsx src/seed-v2.ts"
  }
}
```

(Install `tsx` if not present: `pnpm add -D tsx -w` or in the db package.)

- [ ] **Step 3: Run seeder**

```bash
DATABASE_URL="postgresql://orchester:orchester@localhost:5432/orchester" pnpm --filter @orchester/db seed:v2
```

- [ ] **Step 4: Commit**

```bash
git add packages/db/src/seed-v2.ts packages/db/package.json
git commit -m "chore(db): add v2 demo seeder with sample teams, agents, and pipeline flow"
```

---

### Task 25: Empty States & Onboarding Hints

**Files:**
- Modify: `apps/web/app/[locale]/(shell)/agents/page.tsx` (link to studio's first agent)
- Modify: `apps/web/components/settings/SettingsClient.tsx` (warning banner if no provider configured)
- Modify: `apps/web/components/agents/AgentsPageClient.tsx` (banner if no provider)

- [ ] **Step 1: Provider warning banner component**

Create `apps/web/components/common/NoProviderBanner.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { AlertCircle } from "lucide-react";

export function NoProviderBanner() {
  const [show, setShow] = useState(false);
  const { locale } = useParams<{ locale: string }>();
  useEffect(() => {
    fetch("/api/providers")
      .then((r) => r.json())
      .then((d) => setShow(!Array.isArray(d) || d.length === 0))
      .catch(() => setShow(false));
  }, []);
  if (!show) return null;
  return (
    <Link
      href={`/${locale}/settings`}
      className="mb-3 flex items-center gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/5 px-3.5 py-2.5 text-xs text-amber-200 hover:bg-amber-500/10"
    >
      <AlertCircle className="h-4 w-4" />
      <span>
        Aún no configuraste un proveedor de IA. Andá a <strong>Ajustes</strong> y conectá Anthropic,
        OpenAI o Google para habilitar agentes y flujos.
      </span>
    </Link>
  );
}
```

- [ ] **Step 2: Mount in agents and flows pages**

In `AgentsPageClient.tsx` (top of return), add:

```tsx
import { NoProviderBanner } from "@/components/common/NoProviderBanner";
// ...
<NoProviderBanner />
```

Same in the FlowsListClient.tsx.

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/common apps/web/components/agents apps/web/app/[locale]/\(shell\)/flows
git commit -m "feat(ux): no-provider banner directing to settings"
```

---

### Task 26: Smoke Test Checklist (Manual)

**Goal:** Verify every part of v2 works end-to-end before declaring done.

- [ ] **Step 1: Provider setup**
  - Login → `/<locale>/settings` → AIProviders section → paste Anthropic key → Guardar → Probar → green check + N modelos.

- [ ] **Step 2: Agent Studio**
  - `/<locale>/agents` → click an agent card → lands in Studio (no shell sidebar).
  - Edit prompt → Save → toast / "Guardado HH:MM" appears.
  - Click "Generar con IA" → describe → tone → 3 variations → pick one → prompt populates.
  - Click "Plantillas" → pick "Calificador de leads" → fields prefill.
  - Test chat: send "Hola" → see assistant reply, tokens count > 0.
  - Versiones tab → Guardar versión → list shows entry → Restaurar → values reset.

- [ ] **Step 3: Flow Builder**
  - `/<locale>/flows` → "Nuevo flujo" → "Pipeline de prueba" → builder opens.
  - Drag Agente node → connect from Inicio → pick agent in inspector → set message `Hola {{name}}`.
  - Save. Click Ejecutar → alert "Run succeeded".
  - Click history icon → see run → click → step list shows agent output.

- [ ] **Step 4: Organigrama**
  - `/<locale>/org` → see team, agent, flow, employee nodes connected.
  - Active flow shows `● live` indicator.
  - Filter by `agent` only → only agent nodes visible.
  - Search "Lead" → only matching nodes shown.

- [ ] **Step 5: i18n**
  - Switch locale to en → all new copy shows English.
  - Switch to pt-BR → Portuguese copy.

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "chore: orchester v2 smoke test verified"
```

---

## Self-Review Checklist (post-completion)

Before declaring v2 done, scan:

1. **No hardcoded keys/secrets.** All AI provider keys go through `encrypt()` before insert; `getCurrentWorkspace()` gates every endpoint.
2. **No N+1 in org-graph.** The endpoint runs five parallel queries — verify the page stays under 300ms with 100 nodes.
3. **No flow infinite loops.** `runFromNode` has a `depth > 50` cap. Cycles in edges → throws "max depth".
4. **No SSR leaks.** `encryption.ts`, `llm-call.ts`, `flow-engine.ts`, `providers.ts` all `import "server-only"`.
5. **i18n keys exist in all 3 locales.** Run a script: any `t(...)` not found falls back to key string visibly.
6. **Tests green.** `pnpm --filter web test` passes.
7. **Build clean.** `pnpm --filter web build` produces no type errors.

## Out of Scope (future work)

- Real-time streaming of LLM responses (currently buffered).
- Webhook + scheduled flow triggers (engine supports them; routes left for v2.1).
- Per-edge variable mapping (currently flat shared `ctx.variables`).
- Agent-to-agent A2A protocol over flows.
- Audit log viewer.
- Per-workspace usage / cost dashboards.
- Multi-step conversation memory inside flow runs.
- Granular RBAC on flows and agents (currently workspace-wide).

---

**End of plan.**
