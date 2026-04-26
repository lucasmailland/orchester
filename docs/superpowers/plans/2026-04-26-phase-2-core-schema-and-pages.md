# Orchester Phase 2 — Core Schema, Dashboard & Shell Pages

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the core product schema (teams, agents, channels, employees, conversations), a rich seed dataset, a live dashboard with KPI cards + recharts chart, and all 8 shell pages.

**Architecture:** All data fetching happens in async server components via `lib/db-queries.ts`. Client components are used only for interactive UI (search inputs, chart rendering). Each page follows the pattern: server page → fetches data → passes to client display component. Recharts is wrapped in a `"use client"` component and lazy-imported to avoid SSR issues.

**Tech Stack:** Drizzle ORM v0.45 (existing), recharts 2.x (new), @heroui/react v2, Framer Motion 11, next-intl v3, existing `lib/motion.ts` variants.

---

## File Map

```
packages/db/
  src/schema/
    core.ts                           # NEW  — teams, agents, channels, employees, conversations, messages
    index.ts                          # MODIFY — re-export core schema
  src/seed.ts                         # MODIFY — add 3 teams, 6 agents, 3 channels, 20 employees, conversations

apps/web/
  app/[locale]/(shell)/
    page.tsx                          # MODIFY — live KPI cards + 30-day chart
    teams/
      page.tsx                        # NEW — server page, renders TeamGrid
    agents/
      page.tsx                        # NEW — server page, renders AgentList
    employees/
      page.tsx                        # NEW — client page with search
    conversations/
      page.tsx                        # NEW — server page, renders ConversationList
    channels/page.tsx                 # NEW — stub EmptyState
    integrations/page.tsx             # NEW — stub EmptyState
    usage/page.tsx                    # NEW — stub EmptyState
    settings/page.tsx                 # NEW — stub EmptyState
  components/
    dashboard/
      KpiCard.tsx                     # NEW — animated metric card
      ConversationChart.tsx           # NEW — recharts AreaChart wrapper
    teams/
      TeamGrid.tsx                    # NEW — grid of TeamCard
      TeamCard.tsx                    # NEW — card with name, agent count, status
    agents/
      AgentList.tsx                   # NEW — list of AgentRow
      AgentRow.tsx                    # NEW — row with model badge, status, team
    employees/
      EmployeeTable.tsx               # NEW — "use client" searchable table
    conversations/
      ConversationList.tsx            # NEW — list of ConversationRow
      ConversationRow.tsx             # NEW — row with avatar, employee, agent, status
  lib/
    db-queries.ts                     # NEW — all server DB query fns (requires DB running)
  messages/
    en.json                           # MODIFY — add pages.teams, pages.agents, etc.
    pt-BR.json                        # MODIFY
    es.json                           # MODIFY
```

---

## Task 1: Install recharts + update next.config.ts

**Files:**
- Modify: `apps/web/package.json`
- Modify: `apps/web/next.config.ts`

- [ ] **Step 1: Install recharts**

```bash
cd /Users/lucasmailland/Desktop/dev/orchester/apps/web
pnpm add recharts
```

Expected: `+ recharts X.X.X`

- [ ] **Step 2: Update next.config.ts to optimize recharts imports**

Replace `apps/web/next.config.ts`:

```ts
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

const nextConfig: NextConfig = {
  reactStrictMode: true,
  images: {
    formats: ["image/avif", "image/webp"],
  },
  experimental: {
    optimizePackageImports: ["@heroui/react", "lucide-react", "recharts"],
  },
};

export default withNextIntl(nextConfig);
```

- [ ] **Step 3: Commit**

```bash
cd /Users/lucasmailland/Desktop/dev/orchester
git add apps/web/package.json apps/web/next.config.ts
git commit -m "chore: install recharts for dashboard analytics charts"
```

---

## Task 2: Core DB Schema

**Files:**
- Create: `packages/db/src/schema/core.ts`
- Modify: `packages/db/src/schema/index.ts`
- Test: `packages/db/src/__tests__/core-schema.test.ts`

- [ ] **Step 1: Write failing test**

Create `packages/db/src/__tests__/core-schema.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  teams, agents, agentStatusEnum,
  channels, channelTypeEnum,
  employees,
  conversations, conversationStatusEnum,
  messages,
} from "../schema/core";

describe("Core schema", () => {
  it("teams table is defined", () => {
    expect(teams).toBeDefined();
    expect(teams.name).toBeDefined();
  });

  it("agents table has status enum", () => {
    expect(agents).toBeDefined();
    expect(agentStatusEnum.enumValues).toEqual(
      expect.arrayContaining(["active", "inactive", "draft"])
    );
  });

  it("channels has type enum", () => {
    expect(channelTypeEnum.enumValues).toEqual(
      expect.arrayContaining(["web", "whatsapp", "telegram"])
    );
  });

  it("employees table is defined", () => {
    expect(employees).toBeDefined();
    expect(employees.email).toBeDefined();
  });

  it("conversations has status enum", () => {
    expect(conversationStatusEnum.enumValues).toEqual(
      expect.arrayContaining(["open", "closed", "escalated"])
    );
  });

  it("messages references conversations", () => {
    expect(messages).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

```bash
cd /Users/lucasmailland/Desktop/dev/orchester/packages/db
pnpm test -- --reporter=verbose core-schema
```

Expected: FAIL — `Cannot find module '../schema/core'`

- [ ] **Step 3: Create packages/db/src/schema/core.ts**

```ts
import { pgTable, text, timestamp, pgEnum, integer, boolean, jsonb } from "drizzle-orm/pg-core";
import { workspaces } from "./workspaces";
import { users } from "./auth";

// ─── ENUMS ───────────────────────────────────────────────────────────────────

export const agentStatusEnum = pgEnum("agent_status", ["active", "inactive", "draft"]);
export const channelTypeEnum = pgEnum("channel_type", ["web", "whatsapp", "telegram"]);
export const channelStatusEnum = pgEnum("channel_status", ["active", "inactive"]);
export const conversationStatusEnum = pgEnum("conversation_status", ["open", "closed", "escalated"]);
export const messageRoleEnum = pgEnum("message_role", ["user", "assistant", "system"]);

// ─── TEAMS ───────────────────────────────────────────────────────────────────

export const teams = pgTable("team", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  avatarColor: text("avatar_color").default("#3B3BFF"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ─── AGENTS ──────────────────────────────────────────────────────────────────

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
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ─── CHANNELS ────────────────────────────────────────────────────────────────

export const channels = pgTable("channel", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  teamId: text("team_id").references(() => teams.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  type: channelTypeEnum("type").notNull(),
  status: channelStatusEnum("status").notNull().default("inactive"),
  config: jsonb("config").$type<Record<string, unknown>>().default({}),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ─── EMPLOYEES ───────────────────────────────────────────────────────────────

export const employees = pgTable("employee", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  email: text("email").notNull(),
  phone: text("phone"),
  area: text("area"),
  managerId: text("manager_id"),
  avatarUrl: text("avatar_url"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ─── CONVERSATIONS ────────────────────────────────────────────────────────────

export const conversations = pgTable("conversation", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  channelId: text("channel_id").references(() => channels.id, { onDelete: "set null" }),
  employeeId: text("employee_id").references(() => employees.id, { onDelete: "set null" }),
  agentId: text("agent_id").references(() => agents.id, { onDelete: "set null" }),
  status: conversationStatusEnum("status").notNull().default("open"),
  summary: text("summary"),
  messageCount: integer("message_count").notNull().default(0),
  durationSeconds: integer("duration_seconds"),
  startedAt: timestamp("started_at").notNull().defaultNow(),
  endedAt: timestamp("ended_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ─── MESSAGES ────────────────────────────────────────────────────────────────

export const messages = pgTable("message", {
  id: text("id").primaryKey(),
  conversationId: text("conversation_id")
    .notNull()
    .references(() => conversations.id, { onDelete: "cascade" }),
  role: messageRoleEnum("role").notNull(),
  content: text("content").notNull(),
  tokensUsed: integer("tokens_used"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ─── TYPES ───────────────────────────────────────────────────────────────────

export type Team = typeof teams.$inferSelect;
export type NewTeam = typeof teams.$inferInsert;
export type Agent = typeof agents.$inferSelect;
export type NewAgent = typeof agents.$inferInsert;
export type Channel = typeof channels.$inferSelect;
export type Employee = typeof employees.$inferSelect;
export type NewEmployee = typeof employees.$inferInsert;
export type Conversation = typeof conversations.$inferSelect;
export type Message = typeof messages.$inferSelect;
```

- [ ] **Step 4: Update packages/db/src/schema/index.ts**

```ts
export * from "./auth";
export * from "./workspaces";
export * from "./core";
```

- [ ] **Step 5: Run test — verify it passes**

```bash
cd /Users/lucasmailland/Desktop/dev/orchester/packages/db
pnpm test -- --reporter=verbose core-schema
```

Expected: PASS — 6 tests

- [ ] **Step 6: Commit**

```bash
cd /Users/lucasmailland/Desktop/dev/orchester
git add packages/db/src/schema/
git commit -m "feat: add core schema — teams, agents, channels, employees, conversations, messages"
```

---

## Task 3: DB Migration (requires Docker/Postgres running)

**Files:**
- Create: `packages/db/drizzle/` (auto-generated)

- [ ] **Step 1: Confirm Postgres is running**

```bash
docker ps | grep orchester-postgres
```

If not running:
```bash
cd /Users/lucasmailland/Desktop/dev/orchester
docker compose up -d postgres
```

- [ ] **Step 2: Generate migration**

```bash
cd /Users/lucasmailland/Desktop/dev/orchester/packages/db
DATABASE_URL="postgresql://orchester:orchester@localhost:5432/orchester" pnpm exec drizzle-kit generate
```

Expected: `✓ Your SQL migration file ➜ drizzle/XXXX_init.sql`

- [ ] **Step 3: Apply migration**

```bash
DATABASE_URL="postgresql://orchester:orchester@localhost:5432/orchester" pnpm exec drizzle-kit migrate
```

Expected: `✓ Migrations applied successfully`

- [ ] **Step 4: Commit migrations**

```bash
cd /Users/lucasmailland/Desktop/dev/orchester
git add packages/db/drizzle/
git commit -m "chore: add migration with all core tables"
```

---

## Task 4: Rich Seed Data

**Files:**
- Modify: `packages/db/src/seed.ts`

- [ ] **Step 1: Replace packages/db/src/seed.ts with rich seed**

```ts
import { createDbClient } from "./client";
import {
  users, accounts, workspaces, workspaceMembers,
  teams, agents, channels, employees, conversations, messages,
} from "./schema";
import { createId } from "@paralleldrive/cuid2";

const DATABASE_URL =
  process.env["DATABASE_URL"] ??
  "postgresql://orchester:orchester@localhost:5432/orchester";

const db = createDbClient(DATABASE_URL);

async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

const AREAS = ["HR", "IT", "Finance", "Sales", "Marketing", "Operations", "Legal", "Engineering"];
const EMPLOYEE_NAMES = [
  "Ana García", "Carlos López", "María Rodríguez", "José Martínez", "Laura Fernández",
  "Miguel Sánchez", "Carmen Díaz", "Antonio González", "Isabel Ruiz", "Pedro Jiménez",
  "Sofía Torres", "David Moreno", "Elena Álvarez", "Juan Romero", "Claudia Navarro",
  "Roberto Molina", "Patricia Domínguez", "Fernando Castro", "Valentina Ortega", "Diego Vargas",
];

async function seed() {
  console.log("🌱 Seeding Orchester rich demo data...");

  // ─── Workspace ───────────────────────────────────────────────────────────
  const workspaceId = createId();
  await db.insert(workspaces).values({
    id: workspaceId, name: "Acme Inc.", slug: "acme-inc",
  }).onConflictDoNothing();
  console.log("✓ Workspace: Acme Inc.");

  // ─── Admin user ───────────────────────────────────────────────────────────
  const userId = createId();
  await db.insert(users).values({
    id: userId, name: "Demo Admin", email: "demo@fichap.com",
    emailVerified: true, onboardingCompleted: true,
    preferredLocale: "en", createdAt: new Date(), updatedAt: new Date(),
  }).onConflictDoNothing();

  await db.insert(accounts).values({
    id: createId(), accountId: userId, providerId: "credential",
    userId, password: await hashPassword("demo1234"),
    createdAt: new Date(), updatedAt: new Date(),
  }).onConflictDoNothing();

  await db.insert(workspaceMembers).values({
    id: createId(), workspaceId, userId, role: "owner", createdAt: new Date(),
  }).onConflictDoNothing();
  console.log("✓ User: demo@fichap.com / demo1234");

  // ─── Teams ────────────────────────────────────────────────────────────────
  const teamHrId = createId();
  const teamItId = createId();
  const teamOnboardingId = createId();

  await db.insert(teams).values([
    { id: teamHrId, workspaceId, name: "HR Benefits", description: "Handles vacations, leaves, payroll questions and HR policies.", avatarColor: "#3B3BFF" },
    { id: teamItId, workspaceId, name: "IT Support", description: "Internal helpdesk, password resets, hardware requests.", avatarColor: "#7C3AED" },
    { id: teamOnboardingId, workspaceId, name: "Employee Onboarding", description: "Guides new hires through their first weeks at Acme.", avatarColor: "#22C55E" },
  ]).onConflictDoNothing();
  console.log("✓ 3 teams created");

  // ─── Agents ──────────────────────────────────────────────────────────────
  const agentIds = {
    hrMain: createId(),
    hrEscalation: createId(),
    itMain: createId(),
    itAssets: createId(),
    onboardingWelcome: createId(),
    onboardingDocs: createId(),
  };

  await db.insert(agents).values([
    {
      id: agentIds.hrMain, workspaceId, teamId: teamHrId,
      name: "Sofia HR", role: "HR Generalist",
      systemPrompt: "You are Sofia, a friendly HR assistant for Acme Inc. Help employees with vacation requests, leave policies, payroll questions, and HR procedures. Always be empathetic and refer to the official HR policy document when uncertain.",
      model: "claude-sonnet-4-6", status: "active",
    },
    {
      id: agentIds.hrEscalation, workspaceId, teamId: teamHrId,
      name: "Elena HR Pro", role: "Senior HR Specialist",
      systemPrompt: "You are Elena, a senior HR specialist. Handle complex HR cases that Sofia escalated: disciplinary procedures, legal compliance questions, and sensitive employee relations matters.",
      model: "claude-opus-4-7", status: "active",
    },
    {
      id: agentIds.itMain, workspaceId, teamId: teamItId,
      name: "Max IT", role: "IT Support Analyst",
      systemPrompt: "You are Max, an IT support agent for Acme Inc. Help employees with password resets, software installation, VPN access, and common technical issues. Create tickets for hardware requests.",
      model: "claude-sonnet-4-6", status: "active",
    },
    {
      id: agentIds.itAssets, workspaceId, teamId: teamItId,
      name: "Asset Bot", role: "Asset Manager",
      systemPrompt: "You handle hardware asset requests at Acme Inc. Process laptop requests, peripherals, monitor requests. Verify employee eligibility and route to IT procurement.",
      model: "claude-haiku-4-5", status: "active",
    },
    {
      id: agentIds.onboardingWelcome, workspaceId, teamId: teamOnboardingId,
      name: "Alex Welcome", role: "Onboarding Coordinator",
      systemPrompt: "You are Alex, the first point of contact for new Acme employees. Walk them through day 1 logistics, introduce company culture, answer first-week FAQs, and help them find the right person to talk to.",
      model: "claude-sonnet-4-6", status: "active",
    },
    {
      id: agentIds.onboardingDocs, workspaceId, teamId: teamOnboardingId,
      name: "Doc Helper", role: "Documentation Bot",
      systemPrompt: "You help new Acme employees complete their onboarding paperwork: tax forms, direct deposit setup, benefits enrollment, and equipment requisition forms.",
      model: "claude-haiku-4-5", status: "draft",
    },
  ]).onConflictDoNothing();
  console.log("✓ 6 agents created");

  // ─── Channels ────────────────────────────────────────────────────────────
  const channelWebId = createId();
  const channelWaId = createId();
  const channelTgId = createId();

  await db.insert(channels).values([
    { id: channelWebId, workspaceId, teamId: teamHrId, name: "HR Web Widget", type: "web", status: "active" },
    { id: channelWaId, workspaceId, teamId: teamItId, name: "IT WhatsApp", type: "whatsapp", status: "active" },
    { id: channelTgId, workspaceId, teamId: teamOnboardingId, name: "Onboarding Telegram", type: "telegram", status: "inactive" },
  ]).onConflictDoNothing();
  console.log("✓ 3 channels created");

  // ─── Employees ───────────────────────────────────────────────────────────
  const employeeIds: string[] = [];
  const empValues = EMPLOYEE_NAMES.map((name, i) => {
    const id = createId();
    employeeIds.push(id);
    return {
      id, workspaceId,
      name,
      email: name.toLowerCase().replace(/ /g, ".").replace(/[áéíóú]/g, (c) =>
        ({ á: "a", é: "e", í: "i", ó: "o", ú: "u" }[c] ?? c)
      ) + "@acme.com",
      area: AREAS[i % AREAS.length],
      phone: `+54 9 11 ${Math.floor(1000 + Math.random() * 9000)}-${Math.floor(1000 + Math.random() * 9000)}`,
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  });
  await db.insert(employees).values(empValues).onConflictDoNothing();
  console.log(`✓ ${empValues.length} employees created`);

  // ─── Conversations (30 days of history) ──────────────────────────────────
  const allAgentIds = Object.values(agentIds);
  const allChannelIds = [channelWebId, channelWaId, channelTgId];
  const statuses: Array<"open" | "closed" | "escalated"> = ["closed", "closed", "closed", "open", "escalated"];
  let totalConvs = 0;

  for (let daysAgo = 30; daysAgo >= 0; daysAgo--) {
    const date = new Date();
    date.setDate(date.getDate() - daysAgo);

    // 3-8 conversations per day
    const dailyCount = 3 + Math.floor(Math.random() * 6);
    for (let j = 0; j < dailyCount; j++) {
      const convId = createId();
      const empId = employeeIds[Math.floor(Math.random() * employeeIds.length)];
      const agentId = allAgentIds[Math.floor(Math.random() * allAgentIds.length)];
      const channelId = allChannelIds[Math.floor(Math.random() * allChannelIds.length)];
      const status = statuses[Math.floor(Math.random() * statuses.length)] ?? "closed";
      const durationSec = 60 + Math.floor(Math.random() * 480);
      const msgCount = 4 + Math.floor(Math.random() * 12);

      const startedAt = new Date(date);
      startedAt.setHours(8 + Math.floor(Math.random() * 10));
      startedAt.setMinutes(Math.floor(Math.random() * 60));

      await db.insert(conversations).values({
        id: convId, workspaceId, channelId, employeeId: empId, agentId,
        status,
        messageCount: msgCount,
        durationSeconds: durationSec,
        startedAt,
        endedAt: status !== "open" ? new Date(startedAt.getTime() + durationSec * 1000) : null,
        createdAt: startedAt,
      }).onConflictDoNothing();

      totalConvs++;
    }
  }
  console.log(`✓ ${totalConvs} conversations over 30 days`);

  console.log("\n🎉 Rich demo data seeded successfully!");
  console.log("  Login: demo@fichap.com / demo1234");
  console.log("  Workspace: Acme Inc.");
  process.exit(0);
}

seed().catch((e) => { console.error("Seed failed:", e); process.exit(1); });
```

- [ ] **Step 2: Run seed (requires Postgres running)**

```bash
cd /Users/lucasmailland/Desktop/dev/orchester
DATABASE_URL="postgresql://orchester:orchester@localhost:5432/orchester" pnpm --filter @orchester/db seed
```

Expected:
```
🌱 Seeding Orchester rich demo data...
✓ Workspace: Acme Inc.
✓ User: demo@fichap.com / demo1234
✓ 3 teams created
✓ 6 agents created
✓ 3 channels created
✓ 20 employees created
✓ ~150 conversations over 30 days
🎉 Rich demo data seeded successfully!
```

- [ ] **Step 3: Commit**

```bash
cd /Users/lucasmailland/Desktop/dev/orchester
git add packages/db/src/seed.ts
git commit -m "feat: rich seed — 3 teams, 6 agents, 20 employees, 30-day conversation history"
```

---

## Task 5: Server DB Query Functions

**Files:**
- Create: `apps/web/lib/db-queries.ts`
- Test: `apps/web/__tests__/db-queries.test.ts`

- [ ] **Step 1: Write failing test**

Create `apps/web/__tests__/db-queries.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";

// db-queries uses server-only — vitest.setup.ts already mocks server-only
// We test the shape of mock returns and that the functions exist

vi.mock("@orchester/db", () => ({
  getDb: vi.fn(() => ({
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
    orderBy: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    leftJoin: vi.fn().mockReturnThis(),
    groupBy: vi.fn().mockReturnThis(),
  })),
  schema: {
    teams: { workspaceId: "workspaceId", id: "id" },
    agents: { workspaceId: "workspaceId", status: "status" },
    employees: { workspaceId: "workspaceId", active: "active" },
    conversations: { workspaceId: "workspaceId", startedAt: "startedAt", status: "status" },
    channels: { workspaceId: "workspaceId" },
    messages: {},
  },
  createDbClient: vi.fn(),
}));

import {
  getDashboardStats,
  getTeams,
  getAgents,
  getEmployees,
  getConversations,
} from "../lib/db-queries";

describe("db-queries exports", () => {
  it("getDashboardStats is a function", () => {
    expect(typeof getDashboardStats).toBe("function");
  });

  it("getTeams is a function", () => {
    expect(typeof getTeams).toBe("function");
  });

  it("getAgents is a function", () => {
    expect(typeof getAgents).toBe("function");
  });

  it("getEmployees is a function", () => {
    expect(typeof getEmployees).toBe("function");
  });

  it("getConversations is a function", () => {
    expect(typeof getConversations).toBe("function");
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

```bash
cd /Users/lucasmailland/Desktop/dev/orchester/apps/web
pnpm test -- --reporter=verbose db-queries
```

Expected: FAIL — `Cannot find module '../lib/db-queries'`

- [ ] **Step 3: Create apps/web/lib/db-queries.ts**

```ts
import "server-only";
import { getDb, schema } from "@orchester/db";
import { eq, count, and, gte, sql, desc } from "drizzle-orm";

export interface DashboardStats {
  activeAgents: number;
  conversationsToday: number;
  totalEmployees: number;
  avgDurationSeconds: number;
  conversationsByDay: { date: string; count: number }[];
}

export async function getDashboardStats(workspaceId: string): Promise<DashboardStats> {
  const db = getDb();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const [activeAgentsResult, conversationsTodayResult, totalEmployeesResult, avgDurationResult, byDayResult] =
    await Promise.all([
      db
        .select({ value: count() })
        .from(schema.agents)
        .where(and(eq(schema.agents.workspaceId, workspaceId), eq(schema.agents.status, "active"))),

      db
        .select({ value: count() })
        .from(schema.conversations)
        .where(and(
          eq(schema.conversations.workspaceId, workspaceId),
          gte(schema.conversations.startedAt, today)
        )),

      db
        .select({ value: count() })
        .from(schema.employees)
        .where(and(
          eq(schema.employees.workspaceId, workspaceId),
          eq(schema.employees.active, true)
        )),

      db
        .select({ value: sql<number>`coalesce(avg(${schema.conversations.durationSeconds}), 0)` })
        .from(schema.conversations)
        .where(and(
          eq(schema.conversations.workspaceId, workspaceId),
          gte(schema.conversations.startedAt, thirtyDaysAgo)
        )),

      db
        .select({
          date: sql<string>`date(${schema.conversations.startedAt})`,
          count: count(),
        })
        .from(schema.conversations)
        .where(and(
          eq(schema.conversations.workspaceId, workspaceId),
          gte(schema.conversations.startedAt, thirtyDaysAgo)
        ))
        .groupBy(sql`date(${schema.conversations.startedAt})`),
    ]);

  return {
    activeAgents: activeAgentsResult[0]?.value ?? 0,
    conversationsToday: conversationsTodayResult[0]?.value ?? 0,
    totalEmployees: totalEmployeesResult[0]?.value ?? 0,
    avgDurationSeconds: Math.round(Number(avgDurationResult[0]?.value ?? 0)),
    conversationsByDay: byDayResult.map((r) => ({ date: r.date, count: r.count })),
  };
}

export async function getTeams(workspaceId: string) {
  const db = getDb();
  const rows = await db
    .select({
      id: schema.teams.id,
      name: schema.teams.name,
      description: schema.teams.description,
      avatarColor: schema.teams.avatarColor,
      createdAt: schema.teams.createdAt,
    })
    .from(schema.teams)
    .where(eq(schema.teams.workspaceId, workspaceId));

  // Attach agent count
  const agentCounts = await db
    .select({ teamId: schema.agents.teamId, count: count() })
    .from(schema.agents)
    .where(eq(schema.agents.workspaceId, workspaceId))
    .groupBy(schema.agents.teamId);

  const countMap = Object.fromEntries(
    agentCounts.map((r) => [r.teamId ?? "", r.count])
  );

  return rows.map((t) => ({ ...t, agentCount: countMap[t.id] ?? 0 }));
}

export async function getAgents(workspaceId: string) {
  const db = getDb();
  return db
    .select({
      id: schema.agents.id,
      name: schema.agents.name,
      role: schema.agents.role,
      model: schema.agents.model,
      status: schema.agents.status,
      teamId: schema.agents.teamId,
      teamName: schema.teams.name,
      createdAt: schema.agents.createdAt,
    })
    .from(schema.agents)
    .leftJoin(schema.teams, eq(schema.agents.teamId, schema.teams.id))
    .where(eq(schema.agents.workspaceId, workspaceId))
    .orderBy(desc(schema.agents.createdAt));
}

export async function getEmployees(workspaceId: string) {
  const db = getDb();
  return db
    .select({
      id: schema.employees.id,
      name: schema.employees.name,
      email: schema.employees.email,
      phone: schema.employees.phone,
      area: schema.employees.area,
      active: schema.employees.active,
      createdAt: schema.employees.createdAt,
    })
    .from(schema.employees)
    .where(eq(schema.employees.workspaceId, workspaceId))
    .orderBy(schema.employees.name);
}

export async function getConversations(workspaceId: string, limit = 50) {
  const db = getDb();
  return db
    .select({
      id: schema.conversations.id,
      status: schema.conversations.status,
      messageCount: schema.conversations.messageCount,
      durationSeconds: schema.conversations.durationSeconds,
      startedAt: schema.conversations.startedAt,
      endedAt: schema.conversations.endedAt,
      employeeName: schema.employees.name,
      employeeEmail: schema.employees.email,
      agentName: schema.agents.name,
      channelType: schema.channels.type,
    })
    .from(schema.conversations)
    .leftJoin(schema.employees, eq(schema.conversations.employeeId, schema.employees.id))
    .leftJoin(schema.agents, eq(schema.conversations.agentId, schema.agents.id))
    .leftJoin(schema.channels, eq(schema.conversations.channelId, schema.channels.id))
    .where(eq(schema.conversations.workspaceId, workspaceId))
    .orderBy(desc(schema.conversations.startedAt))
    .limit(limit);
}
```

- [ ] **Step 4: Run test — verify it passes**

```bash
cd /Users/lucasmailland/Desktop/dev/orchester/apps/web
pnpm test -- --reporter=verbose db-queries
```

Expected: PASS — 5 tests

- [ ] **Step 5: Commit**

```bash
cd /Users/lucasmailland/Desktop/dev/orchester
git add apps/web/lib/db-queries.ts apps/web/__tests__/db-queries.test.ts
git commit -m "feat: add server DB query functions for dashboard, teams, agents, employees, conversations"
```

---

## Task 6: Dashboard Page — KPI Cards + Chart

**Files:**
- Modify: `apps/web/app/[locale]/(shell)/page.tsx`
- Create: `apps/web/components/dashboard/KpiCard.tsx`
- Create: `apps/web/components/dashboard/ConversationChart.tsx`
- Modify: `apps/web/messages/en.json` (+ pt-BR + es) — add `pages.dashboard.*`

- [ ] **Step 1: Add dashboard i18n keys to en.json**

In `apps/web/messages/en.json`, add a `"pages"` section after `"auth"`:

```json
"pages": {
  "dashboard": {
    "title": "Dashboard",
    "subtitle": "Your workspace at a glance",
    "activeAgents": "Active Agents",
    "conversationsToday": "Conversations Today",
    "totalEmployees": "Total Employees",
    "avgResponseTime": "Avg. Response Time",
    "seconds": "sec",
    "conversationsChart": "Conversations — Last 30 Days",
    "noData": "No data yet — seed your database to see analytics."
  },
  "teams": {
    "title": "Teams",
    "subtitle": "Your AI agent teams",
    "agents": "agents",
    "empty": "No teams yet. Create your first team to get started.",
    "emptyCta": "Create team"
  },
  "agents": {
    "title": "Agents",
    "subtitle": "All agents across your workspace",
    "model": "Model",
    "team": "Team",
    "status": {
      "active": "Active",
      "inactive": "Inactive",
      "draft": "Draft"
    },
    "empty": "No agents yet.",
    "emptyCta": "Add agent"
  },
  "employees": {
    "title": "Employees",
    "subtitle": "Your team directory",
    "search": "Search by name or email…",
    "area": "Area",
    "email": "Email",
    "phone": "Phone",
    "active": "Active",
    "inactive": "Inactive",
    "empty": "No employees yet. Import your team to get started.",
    "emptyCta": "Import CSV"
  },
  "conversations": {
    "title": "Conversations",
    "subtitle": "Recent agent interactions",
    "status": {
      "open": "Open",
      "closed": "Closed",
      "escalated": "Escalated"
    },
    "channel": {
      "web": "Web",
      "whatsapp": "WhatsApp",
      "telegram": "Telegram"
    },
    "messages": "msgs",
    "duration": "sec",
    "empty": "No conversations yet.",
    "emptyCta": "Set up a channel"
  },
  "channels": {
    "title": "Channels",
    "subtitle": "Where your agents talk to employees",
    "empty": "No channels configured.",
    "emptyCta": "Connect a channel"
  },
  "integrations": {
    "title": "Integrations",
    "subtitle": "Connect your tools and data sources",
    "empty": "No integrations yet.",
    "emptyCta": "Browse integrations"
  },
  "usage": {
    "title": "Usage",
    "subtitle": "Token usage and billing",
    "empty": "Usage data will appear once agents start processing conversations."
  },
  "settings": {
    "title": "Settings",
    "subtitle": "Workspace configuration",
    "empty": "Settings coming soon."
  }
}
```

Add to `pt-BR.json`:
```json
"pages": {
  "dashboard": { "title": "Dashboard", "subtitle": "Seu workspace em um relance", "activeAgents": "Agentes Ativos", "conversationsToday": "Conversas Hoje", "totalEmployees": "Total de Colaboradores", "avgResponseTime": "Tempo Médio de Resposta", "seconds": "seg", "conversationsChart": "Conversas — Últimos 30 Dias", "noData": "Sem dados ainda — semeie o banco de dados para ver análises." },
  "teams": { "title": "Equipes", "subtitle": "Suas equipes de agentes de IA", "agents": "agentes", "empty": "Nenhuma equipe ainda.", "emptyCta": "Criar equipe" },
  "agents": { "title": "Agentes", "subtitle": "Todos os agentes do workspace", "model": "Modelo", "team": "Equipe", "status": { "active": "Ativo", "inactive": "Inativo", "draft": "Rascunho" }, "empty": "Nenhum agente ainda.", "emptyCta": "Adicionar agente" },
  "employees": { "title": "Colaboradores", "subtitle": "Diretório da sua equipe", "search": "Buscar por nome ou e-mail…", "area": "Área", "email": "E-mail", "phone": "Telefone", "active": "Ativo", "inactive": "Inativo", "empty": "Nenhum colaborador ainda.", "emptyCta": "Importar CSV" },
  "conversations": { "title": "Conversas", "subtitle": "Interações recentes dos agentes", "status": { "open": "Aberta", "closed": "Encerrada", "escalated": "Escalada" }, "channel": { "web": "Web", "whatsapp": "WhatsApp", "telegram": "Telegram" }, "messages": "msgs", "duration": "seg", "empty": "Nenhuma conversa ainda.", "emptyCta": "Configurar canal" },
  "channels": { "title": "Canais", "subtitle": "Onde seus agentes falam com colaboradores", "empty": "Nenhum canal configurado.", "emptyCta": "Conectar canal" },
  "integrations": { "title": "Integrações", "subtitle": "Conecte suas ferramentas", "empty": "Nenhuma integração ainda.", "emptyCta": "Explorar integrações" },
  "usage": { "title": "Uso", "subtitle": "Uso de tokens e faturamento", "empty": "Os dados de uso aparecerão quando os agentes processarem conversas." },
  "settings": { "title": "Configurações", "subtitle": "Configuração do workspace", "empty": "Configurações em breve." }
}
```

Add to `es.json`:
```json
"pages": {
  "dashboard": { "title": "Dashboard", "subtitle": "Tu workspace de un vistazo", "activeAgents": "Agentes Activos", "conversationsToday": "Conversaciones Hoy", "totalEmployees": "Total Empleados", "avgResponseTime": "Tiempo Medio de Respuesta", "seconds": "seg", "conversationsChart": "Conversaciones — Últimos 30 Días", "noData": "Sin datos aún — ejecuta el seed para ver analytics." },
  "teams": { "title": "Equipos", "subtitle": "Tus equipos de agentes IA", "agents": "agentes", "empty": "Aún no hay equipos.", "emptyCta": "Crear equipo" },
  "agents": { "title": "Agentes", "subtitle": "Todos los agentes del workspace", "model": "Modelo", "team": "Equipo", "status": { "active": "Activo", "inactive": "Inactivo", "draft": "Borrador" }, "empty": "Aún no hay agentes.", "emptyCta": "Agregar agente" },
  "employees": { "title": "Empleados", "subtitle": "Directorio de tu equipo", "search": "Buscar por nombre o email…", "area": "Área", "email": "Email", "phone": "Teléfono", "active": "Activo", "inactive": "Inactivo", "empty": "Aún no hay empleados.", "emptyCta": "Importar CSV" },
  "conversations": { "title": "Conversaciones", "subtitle": "Interacciones recientes de agentes", "status": { "open": "Abierta", "closed": "Cerrada", "escalated": "Escalada" }, "channel": { "web": "Web", "whatsapp": "WhatsApp", "telegram": "Telegram" }, "messages": "msgs", "duration": "seg", "empty": "Aún no hay conversaciones.", "emptyCta": "Configurar canal" },
  "channels": { "title": "Canales", "subtitle": "Donde tus agentes hablan con empleados", "empty": "No hay canales configurados.", "emptyCta": "Conectar canal" },
  "integrations": { "title": "Integraciones", "subtitle": "Conecta tus herramientas", "empty": "Aún no hay integraciones.", "emptyCta": "Explorar integraciones" },
  "usage": { "title": "Uso", "subtitle": "Uso de tokens y facturación", "empty": "Los datos de uso aparecerán cuando los agentes procesen conversaciones." },
  "settings": { "title": "Ajustes", "subtitle": "Configuración del workspace", "empty": "Ajustes próximamente." }
}
```

- [ ] **Step 2: Create KpiCard.tsx**

Create `apps/web/components/dashboard/KpiCard.tsx`:

```tsx
"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { staggerItem } from "@/lib/motion";

interface KpiCardProps {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  trend?: { value: number; label: string };
  color?: "primary" | "accent" | "success" | "warning";
  className?: string;
}

const COLOR_MAP = {
  primary: {
    bg: "bg-fichap-primary/10 dark:bg-fichap-primary/20",
    icon: "text-fichap-primary",
  },
  accent: {
    bg: "bg-fichap-accent/10 dark:bg-fichap-accent/20",
    icon: "text-fichap-accent",
  },
  success: {
    bg: "bg-fichap-success/10 dark:bg-fichap-success/20",
    icon: "text-fichap-success",
  },
  warning: {
    bg: "bg-fichap-warning/10 dark:bg-fichap-warning/20",
    icon: "text-fichap-warning",
  },
};

export function KpiCard({ label, value, icon, trend, color = "primary", className }: KpiCardProps) {
  const colors = COLOR_MAP[color];

  return (
    <motion.div
      variants={staggerItem}
      whileHover={{ y: -2, transition: { duration: 0.2 } }}
      className={cn(
        "rounded-2xl border border-default-100 bg-background p-5",
        "shadow-sm transition-shadow hover:shadow-md",
        "dark:border-white/5 dark:bg-white/[0.02]",
        className
      )}
    >
      <div className="flex items-start justify-between">
        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wider text-default-400">
            {label}
          </p>
          <p className="text-3xl font-bold tracking-tight text-default-900 dark:text-default-100">
            {value}
          </p>
          {trend && (
            <p className="text-xs text-default-500">
              <span className={trend.value >= 0 ? "text-fichap-success" : "text-fichap-danger"}>
                {trend.value >= 0 ? "+" : ""}{trend.value}%
              </span>{" "}
              {trend.label}
            </p>
          )}
        </div>
        <div className={cn("rounded-xl p-2.5", colors.bg)}>
          <div className={cn("h-5 w-5", colors.icon)}>{icon}</div>
        </div>
      </div>
    </motion.div>
  );
}
```

- [ ] **Step 3: Create ConversationChart.tsx**

Create `apps/web/components/dashboard/ConversationChart.tsx`:

```tsx
"use client";

import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { useTheme } from "next-themes";

interface DataPoint { date: string; count: number }

interface ConversationChartProps {
  data: DataPoint[];
  noDataLabel: string;
}

export function ConversationChart({ data, noDataLabel }: ConversationChartProps) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  if (!data.length) {
    return (
      <div className="flex h-48 items-center justify-center">
        <p className="text-sm text-default-400">{noDataLabel}</p>
      </div>
    );
  }

  const gridColor = isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)";
  const textColor = isDark ? "#a1a1aa" : "#71717a";

  return (
    <ResponsiveContainer width="100%" height={200}>
      <AreaChart data={data} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
        <defs>
          <linearGradient id="cvGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#3B3BFF" stopOpacity={0.25} />
            <stop offset="95%" stopColor="#3B3BFF" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
        <XAxis
          dataKey="date"
          tick={{ fill: textColor, fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v: string) => {
            const d = new Date(v);
            return `${d.getMonth() + 1}/${d.getDate()}`;
          }}
          interval="preserveStartEnd"
        />
        <YAxis
          tick={{ fill: textColor, fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          allowDecimals={false}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: isDark ? "#18181b" : "#fff",
            border: `1px solid ${isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.08)"}`,
            borderRadius: "12px",
            fontSize: "12px",
            color: isDark ? "#fafafa" : "#09090b",
          }}
          labelFormatter={(v) => {
            const d = new Date(String(v));
            return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
          }}
        />
        <Area
          type="monotone"
          dataKey="count"
          stroke="#3B3BFF"
          strokeWidth={2}
          fill="url(#cvGradient)"
          dot={false}
          activeDot={{ r: 4, fill: "#3B3BFF" }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
```

- [ ] **Step 4: Update dashboard page**

Replace `apps/web/app/[locale]/(shell)/page.tsx`:

```tsx
import { Bot, MessageSquare, Users, Clock } from "lucide-react";
import { motion } from "framer-motion";
import { getTranslations } from "next-intl/server";
import { KpiCard } from "@/components/dashboard/KpiCard";
import { ConversationChart } from "@/components/dashboard/ConversationChart";
import { getDashboardStats } from "@/lib/db-queries";
import { getCurrentWorkspace } from "@/lib/workspace";
import { staggerContainer } from "@/lib/motion";

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "pages.dashboard" });

  const workspace = await getCurrentWorkspace();
  const stats = workspace
    ? await getDashboardStats(workspace.workspace.id).catch(() => null)
    : null;

  const kpis = [
    {
      label: t("activeAgents"),
      value: stats?.activeAgents ?? "—",
      icon: <Bot size={20} />,
      color: "primary" as const,
    },
    {
      label: t("conversationsToday"),
      value: stats?.conversationsToday ?? "—",
      icon: <MessageSquare size={20} />,
      color: "accent" as const,
    },
    {
      label: t("totalEmployees"),
      value: stats?.totalEmployees ?? "—",
      icon: <Users size={20} />,
      color: "success" as const,
    },
    {
      label: t("avgResponseTime"),
      value: stats ? `${stats.avgDurationSeconds}${t("seconds")}` : "—",
      icon: <Clock size={20} />,
      color: "warning" as const,
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-default-900 dark:text-default-100">
          {t("title")}
        </h1>
        <p className="mt-1 text-sm text-default-500">{t("subtitle")}</p>
      </div>

      {/* KPI grid */}
      <motion.div
        variants={staggerContainer}
        initial="hidden"
        animate="visible"
        className="grid grid-cols-2 gap-4 lg:grid-cols-4"
      >
        {kpis.map((kpi) => (
          <KpiCard key={kpi.label} {...kpi} />
        ))}
      </motion.div>

      {/* Chart */}
      <div className="rounded-2xl border border-default-100 bg-background p-6 dark:border-white/5 dark:bg-white/[0.02]">
        <h2 className="mb-4 text-sm font-semibold text-default-700 dark:text-default-200">
          {t("conversationsChart")}
        </h2>
        <ConversationChart
          data={stats?.conversationsByDay ?? []}
          noDataLabel={t("noData")}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Commit**

```bash
cd /Users/lucasmailland/Desktop/dev/orchester
git add apps/web/components/dashboard/ apps/web/app/\[locale\]/\(shell\)/page.tsx apps/web/messages/
git commit -m "feat: dashboard page with KPI cards and recharts 30-day conversation chart"
```

---

## Task 7: Teams Page

**Files:**
- Create: `apps/web/app/[locale]/(shell)/teams/page.tsx`
- Create: `apps/web/components/teams/TeamCard.tsx`

- [ ] **Step 1: Create TeamCard.tsx**

Create `apps/web/components/teams/TeamCard.tsx`:

```tsx
"use client";

import { motion } from "framer-motion";
import { Bot } from "lucide-react";
import { Chip } from "@heroui/react";
import { cn } from "@/lib/utils";
import { cardHover } from "@/lib/motion";

interface TeamCardProps {
  name: string;
  description: string | null;
  avatarColor: string | null;
  agentCount: number;
  agentsLabel: string;
}

export function TeamCard({ name, description, avatarColor, agentCount, agentsLabel }: TeamCardProps) {
  const color = avatarColor ?? "#3B3BFF";

  return (
    <motion.div
      variants={cardHover}
      initial="rest"
      whileHover="hover"
      className={cn(
        "cursor-pointer rounded-2xl border border-default-100 bg-background p-5",
        "transition-colors dark:border-white/5 dark:bg-white/[0.02]"
      )}
    >
      <div className="flex items-start gap-4">
        <div
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-white text-lg font-bold"
          style={{ backgroundColor: color }}
        >
          {name[0]?.toUpperCase()}
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <h3 className="truncate font-semibold text-default-900 dark:text-default-100">
            {name}
          </h3>
          {description && (
            <p className="line-clamp-2 text-xs text-default-500">{description}</p>
          )}
          <Chip
            size="sm"
            variant="flat"
            color="primary"
            startContent={<Bot size={11} />}
            classNames={{ base: "gap-1 mt-1" }}
          >
            {agentCount} {agentsLabel}
          </Chip>
        </div>
      </div>
    </motion.div>
  );
}
```

- [ ] **Step 2: Create teams page**

Create `apps/web/app/[locale]/(shell)/teams/page.tsx`:

```tsx
import { getTranslations } from "next-intl/server";
import { Users } from "lucide-react";
import { motion } from "framer-motion";
import { TeamCard } from "@/components/teams/TeamCard";
import { EmptyState } from "@/components/ui/EmptyState";
import { getTeams } from "@/lib/db-queries";
import { getCurrentWorkspace } from "@/lib/workspace";
import { staggerContainer, staggerItem } from "@/lib/motion";

export default async function TeamsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "pages.teams" });

  const workspace = await getCurrentWorkspace();
  const teams = workspace
    ? await getTeams(workspace.workspace.id).catch(() => [])
    : [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-default-900 dark:text-default-100">
          {t("title")}
        </h1>
        <p className="mt-1 text-sm text-default-500">{t("subtitle")}</p>
      </div>

      {teams.length === 0 ? (
        <EmptyState
          icon={<Users size={28} />}
          title={t("empty")}
          description=""
          ctaLabel={t("emptyCta")}
          onCta={() => {}}
        />
      ) : (
        <motion.div
          variants={staggerContainer}
          initial="hidden"
          animate="visible"
          className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
        >
          {teams.map((team) => (
            <motion.div key={team.id} variants={staggerItem}>
              <TeamCard
                name={team.name}
                description={team.description ?? null}
                avatarColor={team.avatarColor ?? null}
                agentCount={team.agentCount}
                agentsLabel={t("agents")}
              />
            </motion.div>
          ))}
        </motion.div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
cd /Users/lucasmailland/Desktop/dev/orchester
git add apps/web/components/teams/ apps/web/app/\[locale\]/\(shell\)/teams/
git commit -m "feat: teams page with animated team cards and agent count"
```

---

## Task 8: Agents Page

**Files:**
- Create: `apps/web/app/[locale]/(shell)/agents/page.tsx`
- Create: `apps/web/components/agents/AgentRow.tsx`

- [ ] **Step 1: Create AgentRow.tsx**

Create `apps/web/components/agents/AgentRow.tsx`:

```tsx
"use client";

import { motion } from "framer-motion";
import { Chip } from "@heroui/react";
import { Bot } from "lucide-react";
import { staggerItem } from "@/lib/motion";

interface AgentRowProps {
  name: string;
  role: string;
  model: string;
  status: "active" | "inactive" | "draft";
  teamName: string | null;
  statusLabels: { active: string; inactive: string; draft: string };
}

const STATUS_COLORS = {
  active: "success",
  inactive: "default",
  draft: "warning",
} as const;

export function AgentRow({ name, role, model, status, teamName, statusLabels }: AgentRowProps) {
  return (
    <motion.div
      variants={staggerItem}
      className="flex items-center gap-4 rounded-xl border border-default-100 bg-background p-4 dark:border-white/5 dark:bg-white/[0.02]"
    >
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-fichap-primary/10 text-fichap-primary">
        <Bot size={18} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-semibold text-sm text-default-900 dark:text-default-100">
            {name}
          </span>
          <Chip size="sm" variant="flat" color={STATUS_COLORS[status]}>
            {statusLabels[status]}
          </Chip>
        </div>
        <p className="truncate text-xs text-default-500">{role}</p>
      </div>
      <div className="hidden shrink-0 flex-col items-end gap-1 sm:flex">
        <span className="rounded-md bg-default-100 px-2 py-0.5 font-mono text-[11px] text-default-600 dark:bg-white/10 dark:text-default-300">
          {model}
        </span>
        {teamName && (
          <span className="text-[11px] text-default-400">{teamName}</span>
        )}
      </div>
    </motion.div>
  );
}
```

- [ ] **Step 2: Create agents page**

Create `apps/web/app/[locale]/(shell)/agents/page.tsx`:

```tsx
import { getTranslations } from "next-intl/server";
import { Bot } from "lucide-react";
import { motion } from "framer-motion";
import { AgentRow } from "@/components/agents/AgentRow";
import { EmptyState } from "@/components/ui/EmptyState";
import { getAgents } from "@/lib/db-queries";
import { getCurrentWorkspace } from "@/lib/workspace";
import { staggerContainer } from "@/lib/motion";

export default async function AgentsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "pages.agents" });

  const workspace = await getCurrentWorkspace();
  const agents = workspace
    ? await getAgents(workspace.workspace.id).catch(() => [])
    : [];

  const statusLabels = {
    active: t("status.active"),
    inactive: t("status.inactive"),
    draft: t("status.draft"),
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-default-900 dark:text-default-100">
          {t("title")}
        </h1>
        <p className="mt-1 text-sm text-default-500">{t("subtitle")}</p>
      </div>

      {agents.length === 0 ? (
        <EmptyState
          icon={<Bot size={28} />}
          title={t("empty")}
          description=""
          ctaLabel={t("emptyCta")}
          onCta={() => {}}
        />
      ) : (
        <motion.div
          variants={staggerContainer}
          initial="hidden"
          animate="visible"
          className="flex flex-col gap-2"
        >
          {agents.map((agent) => (
            <AgentRow
              key={agent.id}
              name={agent.name}
              role={agent.role}
              model={agent.model}
              status={agent.status}
              teamName={agent.teamName ?? null}
              statusLabels={statusLabels}
            />
          ))}
        </motion.div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
cd /Users/lucasmailland/Desktop/dev/orchester
git add apps/web/components/agents/ apps/web/app/\[locale\]/\(shell\)/agents/
git commit -m "feat: agents page with status badges and model display"
```

---

## Task 9: Employees Page (client-side search)

**Files:**
- Create: `apps/web/app/[locale]/(shell)/employees/page.tsx`
- Create: `apps/web/components/employees/EmployeeTable.tsx`

- [ ] **Step 1: Create EmployeeTable.tsx**

Create `apps/web/components/employees/EmployeeTable.tsx`:

```tsx
"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Input, Chip } from "@heroui/react";
import { Search } from "lucide-react";
import { staggerContainer, staggerItem } from "@/lib/motion";

interface Employee {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  area: string | null;
  active: boolean;
}

interface EmployeeTableProps {
  employees: Employee[];
  labels: {
    search: string;
    area: string;
    email: string;
    phone: string;
    active: string;
    inactive: string;
    empty: string;
    emptyCta: string;
  };
}

export function EmployeeTable({ employees, labels }: EmployeeTableProps) {
  const [query, setQuery] = useState("");

  const filtered = employees.filter((e) => {
    if (!query) return true;
    const q = query.toLowerCase();
    return e.name.toLowerCase().includes(q) || e.email.toLowerCase().includes(q);
  });

  return (
    <div className="space-y-4">
      <Input
        value={query}
        onValueChange={setQuery}
        placeholder={labels.search}
        startContent={<Search size={15} className="shrink-0 text-default-400" />}
        classNames={{ inputWrapper: "bg-default-100 dark:bg-default-50/10 max-w-sm" }}
        size="sm"
      />

      {filtered.length === 0 ? (
        <p className="py-8 text-center text-sm text-default-400">{labels.empty}</p>
      ) : (
        <motion.div
          variants={staggerContainer}
          initial="hidden"
          animate="visible"
          className="overflow-hidden rounded-xl border border-default-100 dark:border-white/5"
        >
          {filtered.map((emp, idx) => (
            <motion.div
              key={emp.id}
              variants={staggerItem}
              className={`flex items-center gap-4 px-4 py-3 ${
                idx < filtered.length - 1
                  ? "border-b border-default-100 dark:border-white/5"
                  : ""
              } bg-background hover:bg-default-50 dark:bg-transparent dark:hover:bg-white/[0.02]`}
            >
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-fichap-primary to-fichap-accent text-[11px] font-bold text-white">
                {emp.name.split(" ").map((w) => w[0]).slice(0, 2).join("")}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-default-900 dark:text-default-100">
                  {emp.name}
                </p>
                <p className="truncate text-xs text-default-500">{emp.email}</p>
              </div>
              <div className="hidden shrink-0 flex-col items-end gap-1 sm:flex">
                {emp.area && (
                  <span className="rounded-md bg-default-100 px-2 py-0.5 text-[11px] text-default-600 dark:bg-white/10 dark:text-default-300">
                    {emp.area}
                  </span>
                )}
                <Chip
                  size="sm"
                  variant="dot"
                  color={emp.active ? "success" : "default"}
                  classNames={{ base: "border-0 text-[11px]" }}
                >
                  {emp.active ? labels.active : labels.inactive}
                </Chip>
              </div>
            </motion.div>
          ))}
        </motion.div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Create employees page**

Create `apps/web/app/[locale]/(shell)/employees/page.tsx`:

```tsx
import { getTranslations } from "next-intl/server";
import { EmployeeTable } from "@/components/employees/EmployeeTable";
import { getEmployees } from "@/lib/db-queries";
import { getCurrentWorkspace } from "@/lib/workspace";

export default async function EmployeesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "pages.employees" });

  const workspace = await getCurrentWorkspace();
  const employees = workspace
    ? await getEmployees(workspace.workspace.id).catch(() => [])
    : [];

  const labels = {
    search: t("search"),
    area: t("area"),
    email: t("email"),
    phone: t("phone"),
    active: t("active"),
    inactive: t("inactive"),
    empty: t("empty"),
    emptyCta: t("emptyCta"),
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-default-900 dark:text-default-100">
          {t("title")}
        </h1>
        <p className="mt-1 text-sm text-default-500">{t("subtitle")}</p>
      </div>

      <EmployeeTable employees={employees} labels={labels} />
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
cd /Users/lucasmailland/Desktop/dev/orchester
git add apps/web/components/employees/ apps/web/app/\[locale\]/\(shell\)/employees/
git commit -m "feat: employees page with client-side search and area/status display"
```

---

## Task 10: Conversations Page

**Files:**
- Create: `apps/web/app/[locale]/(shell)/conversations/page.tsx`
- Create: `apps/web/components/conversations/ConversationRow.tsx`

- [ ] **Step 1: Create ConversationRow.tsx**

Create `apps/web/components/conversations/ConversationRow.tsx`:

```tsx
"use client";

import { motion } from "framer-motion";
import { Chip } from "@heroui/react";
import { MessageSquare, Globe, Phone } from "lucide-react";
import { staggerItem } from "@/lib/motion";
import { cn } from "@/lib/utils";

type ConvStatus = "open" | "closed" | "escalated";
type ChannelType = "web" | "whatsapp" | "telegram";

interface ConversationRowProps {
  employeeName: string | null;
  agentName: string | null;
  status: ConvStatus;
  channelType: ChannelType | null;
  messageCount: number;
  durationSeconds: number | null;
  startedAt: Date;
  statusLabels: Record<ConvStatus, string>;
  channelLabels: Record<ChannelType, string>;
  messagesLabel: string;
  durationLabel: string;
}

const STATUS_COLORS = {
  open: "primary",
  closed: "default",
  escalated: "danger",
} as const;

const CHANNEL_ICONS = {
  web: <Globe size={12} />,
  whatsapp: <Phone size={12} />,
  telegram: <MessageSquare size={12} />,
};

function formatTime(date: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  }).format(new Date(date));
}

export function ConversationRow({
  employeeName, agentName, status, channelType, messageCount, durationSeconds,
  startedAt, statusLabels, channelLabels, messagesLabel, durationLabel,
}: ConversationRowProps) {
  return (
    <motion.div
      variants={staggerItem}
      className={cn(
        "flex items-center gap-4 px-4 py-3",
        "border-b border-default-100 last:border-0 dark:border-white/5",
        "bg-background hover:bg-default-50 dark:bg-transparent dark:hover:bg-white/[0.02]"
      )}
    >
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-fichap-primary/10 text-fichap-primary">
        <MessageSquare size={14} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-default-900 dark:text-default-100">
          {employeeName ?? "Unknown employee"}
        </p>
        <p className="truncate text-xs text-default-500">
          {agentName ?? "Unknown agent"} · {formatTime(startedAt)}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {channelType && (
          <Chip
            size="sm"
            variant="flat"
            startContent={CHANNEL_ICONS[channelType]}
            classNames={{ base: "gap-1 text-[11px]" }}
          >
            {channelLabels[channelType]}
          </Chip>
        )}
        <Chip size="sm" color={STATUS_COLORS[status]} variant="flat">
          {statusLabels[status]}
        </Chip>
        <span className="hidden text-[11px] text-default-400 sm:block">
          {messageCount} {messagesLabel}
          {durationSeconds ? ` · ${durationSeconds}${durationLabel}` : ""}
        </span>
      </div>
    </motion.div>
  );
}
```

- [ ] **Step 2: Create conversations page**

Create `apps/web/app/[locale]/(shell)/conversations/page.tsx`:

```tsx
import { getTranslations } from "next-intl/server";
import { MessageSquare } from "lucide-react";
import { motion } from "framer-motion";
import { ConversationRow } from "@/components/conversations/ConversationRow";
import { EmptyState } from "@/components/ui/EmptyState";
import { getConversations } from "@/lib/db-queries";
import { getCurrentWorkspace } from "@/lib/workspace";
import { staggerContainer } from "@/lib/motion";

export default async function ConversationsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "pages.conversations" });

  const workspace = await getCurrentWorkspace();
  const conversations = workspace
    ? await getConversations(workspace.workspace.id, 50).catch(() => [])
    : [];

  const statusLabels = {
    open: t("status.open"),
    closed: t("status.closed"),
    escalated: t("status.escalated"),
  };

  const channelLabels = {
    web: t("channel.web"),
    whatsapp: t("channel.whatsapp"),
    telegram: t("channel.telegram"),
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-default-900 dark:text-default-100">
          {t("title")}
        </h1>
        <p className="mt-1 text-sm text-default-500">{t("subtitle")}</p>
      </div>

      {conversations.length === 0 ? (
        <EmptyState
          icon={<MessageSquare size={28} />}
          title={t("empty")}
          description=""
          ctaLabel={t("emptyCta")}
          onCta={() => {}}
        />
      ) : (
        <motion.div
          variants={staggerContainer}
          initial="hidden"
          animate="visible"
          className="overflow-hidden rounded-xl border border-default-100 dark:border-white/5"
        >
          {conversations.map((conv) => (
            <ConversationRow
              key={conv.id}
              employeeName={conv.employeeName ?? null}
              agentName={conv.agentName ?? null}
              status={conv.status}
              channelType={conv.channelType ?? null}
              messageCount={conv.messageCount ?? 0}
              durationSeconds={conv.durationSeconds ?? null}
              startedAt={conv.startedAt}
              statusLabels={statusLabels}
              channelLabels={channelLabels}
              messagesLabel={t("messages")}
              durationLabel={t("duration")}
            />
          ))}
        </motion.div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
cd /Users/lucasmailland/Desktop/dev/orchester
git add apps/web/components/conversations/ apps/web/app/\[locale\]/\(shell\)/conversations/
git commit -m "feat: conversations page with employee, agent, status and channel display"
```

---

## Task 11: Stub Shell Pages (Channels, Integrations, Usage, Settings)

**Files:**
- Create: `apps/web/app/[locale]/(shell)/channels/page.tsx`
- Create: `apps/web/app/[locale]/(shell)/integrations/page.tsx`
- Create: `apps/web/app/[locale]/(shell)/usage/page.tsx`
- Create: `apps/web/app/[locale]/(shell)/settings/page.tsx`

- [ ] **Step 1: Create channels page**

Create `apps/web/app/[locale]/(shell)/channels/page.tsx`:

```tsx
import { getTranslations } from "next-intl/server";
import { Radio } from "lucide-react";
import { EmptyState } from "@/components/ui/EmptyState";

export default async function ChannelsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "pages.channels" });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-default-900 dark:text-default-100">
          {t("title")}
        </h1>
        <p className="mt-1 text-sm text-default-500">{t("subtitle")}</p>
      </div>
      <EmptyState
        icon={<Radio size={28} />}
        title={t("empty")}
        description=""
        ctaLabel={t("emptyCta")}
        onCta={() => {}}
      />
    </div>
  );
}
```

- [ ] **Step 2: Create integrations page**

Create `apps/web/app/[locale]/(shell)/integrations/page.tsx`:

```tsx
import { getTranslations } from "next-intl/server";
import { Plug } from "lucide-react";
import { EmptyState } from "@/components/ui/EmptyState";

export default async function IntegrationsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "pages.integrations" });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-default-900 dark:text-default-100">
          {t("title")}
        </h1>
        <p className="mt-1 text-sm text-default-500">{t("subtitle")}</p>
      </div>
      <EmptyState
        icon={<Plug size={28} />}
        title={t("empty")}
        description=""
        ctaLabel={t("emptyCta")}
        onCta={() => {}}
      />
    </div>
  );
}
```

- [ ] **Step 3: Create usage page**

Create `apps/web/app/[locale]/(shell)/usage/page.tsx`:

```tsx
import { getTranslations } from "next-intl/server";
import { BarChart3 } from "lucide-react";
import { EmptyState } from "@/components/ui/EmptyState";

export default async function UsagePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "pages.usage" });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-default-900 dark:text-default-100">
          {t("title")}
        </h1>
        <p className="mt-1 text-sm text-default-500">{t("subtitle")}</p>
      </div>
      <EmptyState
        icon={<BarChart3 size={28} />}
        title={t("empty")}
        description=""
      />
    </div>
  );
}
```

- [ ] **Step 4: Create settings page**

Create `apps/web/app/[locale]/(shell)/settings/page.tsx`:

```tsx
import { getTranslations } from "next-intl/server";
import { Settings } from "lucide-react";
import { EmptyState } from "@/components/ui/EmptyState";

export default async function SettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "pages.settings" });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-default-900 dark:text-default-100">
          {t("title")}
        </h1>
        <p className="mt-1 text-sm text-default-500">{t("subtitle")}</p>
      </div>
      <EmptyState
        icon={<Settings size={28} />}
        title={t("empty")}
        description=""
      />
    </div>
  );
}
```

- [ ] **Step 5: Commit all stub pages**

```bash
cd /Users/lucasmailland/Desktop/dev/orchester
git add apps/web/app/\[locale\]/\(shell\)/channels/ apps/web/app/\[locale\]/\(shell\)/integrations/ apps/web/app/\[locale\]/\(shell\)/usage/ apps/web/app/\[locale\]/\(shell\)/settings/
git commit -m "feat: add channels, integrations, usage, settings stub pages with EmptyState"
```

---

## Task 12: Topbar — Live Session User

**Files:**
- Modify: `apps/web/components/shell/Topbar.tsx`

- [ ] **Step 1: Update Topbar to accept user prop**

Replace `apps/web/components/shell/Topbar.tsx`:

```tsx
"use client";

import { motion } from "framer-motion";
import { Avatar } from "@heroui/react";
import { ThemeToggle } from "./ThemeToggle";
import { LanguageSelector } from "./LanguageSelector";
import { PresentationModeToggle } from "./PresentationModeToggle";
import { fadeInDown } from "@/lib/motion";
import { usePresentationMode } from "@/components/providers/PresentationModeProvider";
import { cn } from "@/lib/utils";

interface TopbarProps {
  locale: string;
  userName?: string;
  userImage?: string | null;
}

export function Topbar({ locale: _locale, userName, userImage }: TopbarProps) {
  const { isPresenting } = usePresentationMode();

  const initials = userName
    ? userName.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase()
    : "U";

  return (
    <motion.header
      variants={fadeInDown}
      initial="hidden"
      animate="visible"
      className={cn(
        "flex h-14 shrink-0 items-center justify-between border-b px-6",
        "border-default-100 bg-background/80 dark:border-white/5",
        "backdrop-blur-md"
      )}
    >
      <div className="flex items-center gap-2">
        {isPresenting && (
          <motion.span
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -8 }}
            className="rounded-full bg-fichap-primary/10 px-2.5 py-0.5 text-xs font-medium text-fichap-primary"
          >
            Presentation Mode
          </motion.span>
        )}
      </div>

      <div className="flex items-center gap-1">
        <PresentationModeToggle />
        <ThemeToggle />
        <LanguageSelector />
        <div className="ml-2 cursor-pointer">
          <Avatar
            size="sm"
            name={initials}
            src={userImage ?? undefined}
            classNames={{
              base: "bg-gradient-to-br from-fichap-primary to-fichap-accent",
              name: "text-white font-semibold text-xs",
            }}
          />
        </div>
      </div>
    </motion.header>
  );
}
```

- [ ] **Step 2: Update shell layout to pass user to Topbar**

Modify `apps/web/app/[locale]/(shell)/layout.tsx` — change the `<Topbar>` call:

```tsx
// Change this line:
<Topbar locale={locale} />
// To:
<Topbar locale={locale} userName={session.user.name} userImage={session.user.image} />
```

The full file becomes:

```tsx
import { redirect } from "next/navigation";
import { Sidebar } from "@/components/shell/Sidebar";
import { Topbar } from "@/components/shell/Topbar";
import { getCurrentSession, getCurrentWorkspace } from "@/lib/workspace";

export default async function ShellLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  const session = await getCurrentSession();

  if (!session) {
    redirect(`/${locale}/login`);
  }

  const workspaceData = await getCurrentWorkspace();

  if (!workspaceData && !session.user.onboardingCompleted) {
    redirect(`/${locale}/onboarding`);
  }

  return (
    <div className="flex h-screen overflow-hidden bg-default-50 dark:bg-[#0a0a0f]">
      <Sidebar locale={locale} />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Topbar locale={locale} userName={session.user.name} userImage={session.user.image} />
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
cd /Users/lucasmailland/Desktop/dev/orchester
git add apps/web/components/shell/Topbar.tsx apps/web/app/\[locale\]/\(shell\)/layout.tsx
git commit -m "feat: topbar shows real session user name and avatar"
```

---

## Phase 2 Completion Checklist

- [ ] `pnpm test` — all tests pass (target: 33+ tests)
- [ ] TypeScript: `pnpm exec tsc --noEmit` — 0 errors (CSS false positive OK)
- [ ] `http://localhost:3001/en` — Dashboard shows 4 KPI cards (zeroes without DB, real numbers with seeded DB)
- [ ] `http://localhost:3001/en/teams` — Team cards with agent counts
- [ ] `http://localhost:3001/en/agents` — Agent list with model badges and status chips
- [ ] `http://localhost:3001/en/employees` — Employee table with search input
- [ ] `http://localhost:3001/en/conversations` — Conversation list with status chips
- [ ] `http://localhost:3001/en/channels` — EmptyState with CTA
- [ ] `http://localhost:3001/en/settings` — EmptyState
- [ ] All pages render in pt-BR and es locales
- [ ] Dark mode looks correct on all pages

---

## What's Next (Phase 3)

**Phase 3**: Agent builder (drag-and-drop prompt editor, model selector, tool configuration) + channel setup wizard (web widget embed code, WhatsApp/Telegram webhook config) + live conversation view with real-time message streaming via Server-Sent Events.
